import pool from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const seconds = parseInt(url.searchParams.get('seconds') ?? '0', 10);

  if (!seconds || seconds < 1) {
    return Response.json({ error: 'seconds param required' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT watts FROM activity_streams WHERE activity_id = $1`,
      [id]
    );

    if (res.rows.length === 0 || !res.rows[0].watts) {
      return Response.json({ watts: null, seconds });
    }

    const watts: number[] = res.rows[0].watts;

    if (watts.length < seconds) {
      return Response.json({ watts: null, seconds });
    }

    // Rolling sum over `seconds` window — find max average
    let windowSum = 0;
    for (let i = 0; i < seconds; i++) windowSum += (watts[i] ?? 0);

    let maxSum = windowSum;
    for (let i = seconds; i < watts.length; i++) {
      windowSum += (watts[i] ?? 0) - (watts[i - seconds] ?? 0);
      if (windowSum > maxSum) maxSum = windowSum;
    }

    return Response.json({ watts: Math.round(maxSum / seconds), seconds });
  } finally {
    client.release();
  }
}
