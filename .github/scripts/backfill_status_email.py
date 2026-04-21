"""
Daily status email for the three historical backfills:
  - Power streams  (activity_streams.watts)
  - Segment efforts (activities.segments_synced_at)
  - Laps           (laps table, one row per lap, grouped by activity)

Sends via Resend (https://resend.com — free tier: 100 emails/day, 3k/month).
Stops (exits 0 without sending) if all three backfills are complete.
"""
import os
import sys
import json
import urllib.request
import urllib.error
import psycopg2

DATABASE_URL    = os.environ["DATABASE_URL"]
RESEND_API_KEY  = os.environ["RESEND_API_KEY"]
EMAIL_TO        = os.environ.get("EMAIL_TO", "steve@dewit.com.au")
EMAIL_FROM      = os.environ.get("EMAIL_FROM", "onboarding@resend.dev")

def query_one(cur, sql, params=()):
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else 0

def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur  = conn.cursor()

    # --- Power streams ---------------------------------------------------
    ps_total_eligible = query_one(cur, """
        SELECT COUNT(*) FROM activities
        WHERE average_watts IS NOT NULL OR average_heartrate IS NOT NULL
    """)
    ps_done = query_one(cur, """
        SELECT COUNT(*) FROM activity_streams
        WHERE watts IS NOT NULL OR hr IS NOT NULL
    """)
    ps_last_24h = query_one(cur, """
        SELECT COUNT(*) FROM activity_streams
        WHERE created_at > NOW() - INTERVAL '24 hours'
    """)
    ps_remaining = max(0, ps_total_eligible - ps_done)

    # --- Segment efforts (by activity scan) ------------------------------
    se_total = query_one(cur, "SELECT COUNT(*) FROM activities")
    se_done  = query_one(cur, """
        SELECT COUNT(*) FROM activities WHERE segments_synced_at IS NOT NULL
    """)
    se_last_24h = query_one(cur, """
        SELECT COUNT(*) FROM activities
        WHERE segments_synced_at > NOW() - INTERVAL '24 hours'
    """)
    se_remaining = max(0, se_total - se_done)

    # --- Laps ------------------------------------------------------------
    laps_total_activities = query_one(cur, "SELECT COUNT(*) FROM activities")
    laps_done_activities = query_one(cur, """
        SELECT COUNT(DISTINCT activity_id) FROM laps
    """)
    laps_last_24h_activities = query_one(cur, """
        SELECT COUNT(DISTINCT activity_id) FROM laps
        WHERE created_at > NOW() - INTERVAL '24 hours'
    """)
    laps_remaining = max(0, laps_total_activities - laps_done_activities)

    cur.close()
    conn.close()

    all_done = (ps_remaining == 0 and se_remaining == 0 and laps_remaining == 0)

    # Build rows
    def row(label, done_24h, remaining, total, unit):
        pct = (total - remaining) / total * 100 if total else 100
        check = "✅" if remaining == 0 else ""
        return (f"<tr><td><b>{label}</b>{check}</td>"
                f"<td align='right'>{done_24h:,} {unit}</td>"
                f"<td align='right'>{remaining:,} remaining</td>"
                f"<td align='right'>{pct:.1f}%</td></tr>")

    html = f"""
    <div style="font-family:-apple-system,sans-serif;max-width:560px">
      <h2 style="margin-bottom:4px">
        {'🎉 All backfills complete' if all_done else '⏳ Backfill progress'}
      </h2>
      <p style="color:#666;margin-top:0">Last 24h snapshot</p>
      <table cellpadding="6" style="border-collapse:collapse;width:100%;border:1px solid #eee">
        <thead>
          <tr style="background:#f7f7f7"><th align="left">Backfill</th><th align="right">Last 24h</th><th align="right">Remaining</th><th align="right">% done</th></tr>
        </thead>
        <tbody>
          {row("Power streams",   ps_last_24h,          ps_remaining,    ps_total_eligible,    "activities")}
          {row("Segment efforts", se_last_24h,          se_remaining,    se_total,             "activities")}
          {row("Laps",            laps_last_24h_activities, laps_remaining, laps_total_activities, "activities")}
        </tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:20px">
        {'You can now disable the Backfill Status Email workflow in GitHub Actions.' if all_done else 'Email will stop automatically once all three reach 0 remaining.'}
      </p>
    </div>
    """

    subject = ("✅ Training Hub: all backfills complete"
               if all_done
               else f"Training Hub backfill: {ps_last_24h + se_last_24h + laps_last_24h_activities} scanned (last 24h)")

    # Print to log for debug
    print(f"ps: done={ps_done}/{ps_total_eligible} 24h={ps_last_24h} remaining={ps_remaining}")
    print(f"se: done={se_done}/{se_total} 24h={se_last_24h} remaining={se_remaining}")
    print(f"laps: done={laps_done_activities}/{laps_total_activities} 24h={laps_last_24h_activities} remaining={laps_remaining}")

    # Send via Resend
    payload = json.dumps({
        "from":    EMAIL_FROM,
        "to":      [EMAIL_TO],
        "subject": subject,
        "html":    html,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
            print(f"Resend OK ({resp.status}): {body[:200]}")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        print(f"Resend HTTP error {e.code}")
        print(f"Response headers: {dict(e.headers)}")
        print(f"Response body (full): {body}")
        print(f"Request: from={EMAIL_FROM} to={EMAIL_TO}")
        sys.exit(1)
    except Exception as e:
        print(f"Resend failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
