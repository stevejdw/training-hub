import pool from '@/lib/db';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM activities WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return Response.json(result.rows[0]);
  } finally {
    client.release();
  }
}
