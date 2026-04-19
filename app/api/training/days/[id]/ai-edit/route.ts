import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { updateTrainingDay } from '@/lib/training-plans';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { TrainingDay, TrainingSegment } from '@/lib/training-plans';

export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const tool: Anthropic.Tool = {
  name: 'update_training_day',
  description: 'Apply the requested changes to this training day. Call this once you know exactly what to change.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title:        { type: 'string',  description: 'Workout title' },
      type:         { type: 'string',  enum: ['rest','recovery','endurance','tempo','threshold','vo2max','race'] },
      duration_min: { type: 'number',  description: 'Total duration in minutes' },
      tss_target:   { type: 'number',  description: 'Target TSS' },
      description:  { type: 'string',  description: 'Full workout description' },
      segments: {
        type: 'array',
        description: 'Session structure. Provide the complete array — omit to leave segments unchanged.',
        items: {
          type: 'object',
          properties: {
            type:             { type: 'string', enum: ['warmup','main','cooldown','interval'] },
            duration_min:     { type: 'number' },
            description:      { type: 'string' },
            target_np_watts:  { type: 'number' },
            target_avg_hr:    { type: 'number' },
            zone:             { type: 'string' },
            notes:            { type: 'string' },
          },
          required: ['type', 'duration_min', 'description'],
        },
      },
    },
  },
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const dayId = Number(id);
    const { message, day } = await req.json() as { message: string; day: TrainingDay };
    const profile = await getProfile();
    const ftp = effectiveFtp(profile);

    const segmentSummary = day.segments.length > 0
      ? day.segments.map(s =>
          `  • ${s.type} — ${s.duration_min} min${s.description ? ': ' + s.description : ''}${s.target_np_watts ? ` @ ${s.target_np_watts}W` : ''}${s.target_avg_hr ? ` / ${s.target_avg_hr}bpm` : ''}`
        ).join('\n')
      : '  (no structured segments)';

    const systemPrompt = `You are a cycling coach editing a single training session for ${profile.name} (FTP: ${ftp}W).

## Current session
- Title: ${day.title}
- Date: ${day.date}
- Type: ${day.type}
- Duration: ${day.duration_min} min
- TSS target: ${day.tss_target ?? 'none'}
- Description: ${day.description || '(none)'}
- Segments:
${segmentSummary}

## Instructions
The athlete wants to change this session. Think briefly about the best approach, then call update_training_day with only the fields that need to change. Keep everything else the same. When modifying segments, provide the full segments array. Be concise — one short paragraph confirming what you changed and why.`;

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          let messages: Anthropic.MessageParam[] = [
            { role: 'user', content: message },
          ];

          while (true) {
            const stream = anthropic.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 2048,
              system: systemPrompt,
              tools: [tool],
              messages,
            });

            for await (const event of stream) {
              if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
              ) {
                controller.enqueue(encoder.encode(event.delta.text));
              }
            }

            const final = await stream.finalMessage();
            if (final.stop_reason !== 'tool_use') break;

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of final.content) {
              if (block.type === 'tool_use') {
                const input = block.input as Partial<TrainingDay> & { segments?: TrainingSegment[] };
                await updateTrainingDay(dayId, input);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: `Updated day ${dayId} successfully.`,
                });
              }
            }

            messages = [
              ...messages,
              { role: 'assistant', content: final.content },
              { role: 'user', content: toolResults },
            ];
          }

          // Signal that a save occurred so client can reload
          controller.enqueue(encoder.encode('\n\n__UPDATED__'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (err) {
    console.error('AI day edit error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
