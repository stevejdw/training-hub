import { NextRequest } from 'next/server';
import { listPlans, createPlan } from '@/lib/training-plans';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const plans = await listPlans();
    return Response.json(plans);
  } catch (err) {
    console.error('List plans error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, goal, days } = body;
    if (!name || !days) {
      return Response.json({ error: 'name and days required' }, { status: 400 });
    }
    const plan = await createPlan(name, goal ?? '', days);
    return Response.json(plan, { status: 201 });
  } catch (err) {
    console.error('Create plan error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
