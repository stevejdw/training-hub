import { NextRequest } from 'next/server';
import { updateTrainingDay } from '@/lib/training-plans';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    await updateTrainingDay(Number(id), body);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Update day error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
