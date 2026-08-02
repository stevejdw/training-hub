import { getProfileFull, saveProfile } from '@/lib/profile';

export const runtime = 'nodejs';

export async function GET() {
  try {
    // Full profile: the client edits this object and PUTs it back, so it must
    // include events[].route or saveProfile would drop the geometry.
    const profile = await getProfileFull();
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
