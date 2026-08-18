import fs from 'node:fs'; import pg from 'pg';
for (const l of fs.readFileSync('.env.local','utf8').split('\n')) { const t=l.trim();
  if(!t||t.startsWith('#')||!t.includes('=')) continue; const i=t.indexOf('=');
  process.env[t.slice(0,i).trim()] ??= t.slice(i+1).trim().replace(/^["']|["']$/g,''); }
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:2});
const c=await pool.connect();
const SQL=`WITH todo AS MATERIALIZED (SELECT s.activity_id FROM activity_streams s
  LEFT JOIN activity_efficiency e ON e.activity_id=s.activity_id
  WHERE e.activity_id IS NULL AND s.watts IS NOT NULL AND s.hr IS NOT NULL
    AND array_length(s.watts,1)>60 AND array_length(s.hr,1)>60
  ORDER BY s.activity_id DESC LIMIT $1),
computed AS (SELECT t.activity_id, dims.n samples,
  COALESCE(AVG(x.wv) FILTER (WHERE x.ord<=dims.n/2),0) pw1,
  COALESCE(AVG(x.hv) FILTER (WHERE x.ord<=dims.n/2),0) hr1,
  COALESCE(AVG(x.wv) FILTER (WHERE x.ord>dims.n/2 AND x.ord<=dims.n),0) pw2,
  COALESCE(AVG(x.hv) FILTER (WHERE x.ord>dims.n/2 AND x.ord<=dims.n),0) hr2
  FROM todo t JOIN activity_streams s ON s.activity_id=t.activity_id
  CROSS JOIN LATERAL (SELECT LEAST(array_length(s.watts,1),array_length(s.hr,1)) n) dims
  CROSS JOIN LATERAL unnest(s.watts,s.hr) WITH ORDINALITY AS x(wv,hv,ord)
  WHERE x.wv IS NOT NULL AND x.hv IS NOT NULL AND x.hv>30 GROUP BY t.activity_id, dims.n),
ins AS (INSERT INTO activity_efficiency (activity_id,pw1,hr1,pw2,hr2,samples)
  SELECT activity_id,pw1,hr1,pw2,hr2,samples FROM computed
  ON CONFLICT (activity_id) DO UPDATE SET pw1=EXCLUDED.pw1,hr1=EXCLUDED.hr1,
    pw2=EXCLUDED.pw2,hr2=EXCLUDED.hr2,samples=EXCLUDED.samples,computed_at=NOW()
  RETURNING 1) SELECT count(*)::text n FROM ins`;
try{ let total=0;
  for(let i=0;i<40;i++){ const n=Number((await c.query(SQL,[50])).rows[0].n); total+=n;
    console.log(`batch ${i+1}: +${n} (total ${total})`); if(n===0) break; }
  console.log('remaining:', (await c.query(`SELECT count(*)::text n FROM activity_streams s
    LEFT JOIN activity_efficiency e ON e.activity_id=s.activity_id
    WHERE e.activity_id IS NULL AND s.watts IS NOT NULL AND s.hr IS NOT NULL
      AND array_length(s.watts,1)>60 AND array_length(s.hr,1)>60`)).rows[0].n);
} finally { c.release(); await pool.end(); }
