import Anthropic from '@anthropic-ai/sdk';
import { buildTrainingContext } from '@/lib/training-context';

export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const trainingContext = await buildTrainingContext();

    const systemPrompt = `You are a personal cycling coach and training analyst for Steve. You have access to his complete training history and should use it to give specific, data-driven advice.

${trainingContext}

## Your Role
- Analyse training data and identify patterns, strengths, and areas for improvement
- Answer questions about specific activities, weeks, or periods
- Give advice tailored to Steve's current fitness (CTL/ATL/TSB) and goals
- Help with pacing, race strategy, training load management
- Be direct and specific — use the actual numbers from his data
- When discussing power, always reference his FTP of ${process.env.ATHLETE_FTP || 340}W

Keep responses concise unless asked for detail. Use markdown formatting where helpful.`;

    const stream = await anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              controller.enqueue(encoder.encode(chunk.delta.text));
            }
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
