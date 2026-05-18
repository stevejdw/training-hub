import { NextRequest } from 'next/server';
import { repairPlanDates } from '@/lib/training-plans';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await repairPlanDates(Number(id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Repair plan dates error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
