import Anthropic from '@anthropic-ai/sdk';
import { buildTrainingContext } from '@/lib/training-context';
import { getProfile, effectiveFtp } from '@/lib/profile';
import { updateTrainingDay, updatePlanMeta } from '@/lib/training-plans';

export const runtime = 'nodejs';
export const maxDuration = 120;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const tools: Anthropic.Tool[] = [
  {
    name: 'update_training_day',
    description:
      'Update a specific training day in the active plan. Use this when the athlete asks to modify a workout — change its title, type, duration, TSS target, description, or interval segments. You MUST use the Day ID from the training context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        day_id: { type: 'number', description: 'The numeric Day ID from the training plan context' },
        title: { type: 'string', description: 'New workout title' },
        type: {
          type: 'string',
          enum: ['rest', 'recovery', 'endurance', 'tempo', 'threshold', 'vo2max', 'race'],
          description: 'Workout type',
        },
        duration_min: { type: 'number', description: 'Duration in minutes' },
        tss_target: { type: 'number', description: 'Target Training Stress Score' },
        description: { type: 'string', description: 'Full workout description and instructions' },
      },
      required: ['day_id'],
    },
  },
  {
    name: 'update_plan_goal',
    description: 'Update the active training plan name or goal description.',
    input_schema: {
      type: 'object' as const,
      properties: {
        plan_id: { type: 'number', description: 'The numeric Plan ID from the training plan context' },
        name: { type: 'string', description: 'Plan name' },
        goal: { type: 'string', description: 'Plan goal description' },
      },
      required: ['plan_id', 'name', 'goal'],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'update_training_day') {
      const { day_id, ...fields } = input as {
        day_id: number;
        title?: string;
        type?: 'rest' | 'recovery' | 'endurance' | 'tempo' | 'threshold' | 'vo2max' | 'race';
        duration_min?: number;
        tss_target?: number;
        description?: string;
      };
      await updateTrainingDay(day_id, fields);
      return `Successfully updated training day ${day_id}`;
    }
    if (name === 'update_plan_goal') {
      const { plan_id, name: planName, goal } = input as { plan_id: number; name: string; goal: string };
      await updatePlanMeta(plan_id, planName, goal);
      return `Successfully updated plan ${plan_id}`;
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Error executing tool: ${String(err)}`;
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const [trainingContext, profile] = await Promise.all([buildTrainingContext(), getProfile()]);
    const ftp = effectiveFtp(profile);

    const personaLine = profile.coach_persona
      ? `\n## Your Persona\n${profile.coach_persona}\n`
      : '';

    const systemPrompt = `You are a personal cycling coach for ${profile.name}. You have access to their complete training history and current plan, and can modify the plan when asked.

${personaLine}
${trainingContext}

## How to respond
- Be conversational and concise. Match response length to the question — quick questions get quick answers.
- Don't pad responses. Skip preamble, don't re-state the question, don't summarise at the end.
- Use specific numbers from the data (power, TSS, CTL/ATL/TSB). FTP is ${ftp}W.
- For short questions (e.g. "how was my last ride?"), reply in 2–4 sentences.
- Reserve detailed breakdowns for when explicitly asked ("analyse my...", "full breakdown of...").
- Use markdown sparingly — only when it genuinely aids readability.

## Plan Modifications
When asked to change a workout, use the update_training_day tool with the correct Day ID from the context. Apply the change directly — no need to ask for confirmation unless the request is ambiguous.`;

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          type ApiMessage = Anthropic.MessageParam;
          let currentMessages: ApiMessage[] = messages.map((m: { role: string; content: string }) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

          // Tool use loop — keep going until stop_reason is 'end_turn'
          while (true) {
            const stream = anthropic.messages.stream({
              model: 'claude-opus-4-6',
              max_tokens: 1024,
              system: systemPrompt,
              tools,
              messages: currentMessages,
            });

            // Stream text chunks as they arrive
            for await (const event of stream) {
              if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
              ) {
                controller.enqueue(encoder.encode(event.delta.text));
              }
            }

            const finalMsg = await stream.finalMessage();

            if (finalMsg.stop_reason !== 'tool_use') break;

            // Execute any tool calls
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of finalMsg.content) {
              if (block.type === 'tool_use') {
                const result = await executeTool(block.name, block.input as Record<string, unknown>);
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: result,
                });
              }
            }

            // Add the assistant turn + tool results to the conversation and loop
            currentMessages = [
              ...currentMessages,
              { role: 'assistant', content: finalMsg.content },
              { role: 'user', content: toolResults },
            ];
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Chat API error:', err);
    return new Response(JSON.stringify({ error: 'Failed to process request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
