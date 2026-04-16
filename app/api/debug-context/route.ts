import { buildTrainingContext } from '@/lib/training-context';

export const runtime = 'nodejs';

export async function GET() {
  const ctx = await buildTrainingContext();
  return new Response(ctx, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
