import { NextRequest } from 'next/server';
import { getPlan, deletePlan, replacePlanDays } from '@/lib/training-plans';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const plan = await getPlan(Number(id));
    if (!plan) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(plan);
  } catch (err) {
    console.error('Get plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { goal, days } = await req.json();
    await replacePlanDays(Number(id), goal ?? '', days ?? []);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Replace plan days error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deletePlan(Number(id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Delete plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
