import { getProfile, saveProfile } from '@/lib/profile';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const profile = await getProfile();
    return Response.json(profile);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await saveProfile(body);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
