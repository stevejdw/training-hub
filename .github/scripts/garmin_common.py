"""Shared Garmin plumbing: credential storage, token lifecycle, sync health.

Garmin has no official personal API — the Connect Developer Program is
business-only and closed to individuals — so this rides the unofficial mobile
SSO flow via `garminconnect`. Two consequences shape everything here:

  1. Auth needs an interactive MFA code, so the *initial* login cannot run in
     CI. It runs on the laptop (scripts/garmin_login.py) and deposits an
     encrypted token bundle in Neon. CI only ever resumes and refreshes it.

  2. Garmin breaks this flow roughly annually. A dead token is therefore a
     *known condition*, not a job failure: we record status='reauth_required'
     and exit 0, matching sync_strava.py's convention of not failure-emailing
     on things the next scheduled run can't fix. Strava keeps running
     regardless, so the app degrades to yesterday's data quality rather than
     going dark.

The bundle is {"di_token", "di_refresh_token", "di_client_id"} as produced by
garminconnect's Client.dumps(). The DI bearer refreshes roughly hourly, which
is why the bundle lives in Neon rather than a GitHub secret: Actions can't
rewrite its own secrets without a PAT carrying `secrets:write`.
"""

import hashlib
import json
import os
import random
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import psycopg2

PROVIDER = "garmin"

# Advisory lock so the wellness and activity jobs can't interleave a
# read-modify-write on the token bundle. hashtext() must match the TS side if
# it ever takes the lock too.
LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('garmin_tokens'))"


class ReauthRequired(Exception):
    """Garmin rejected the stored bundle — needs `npm run garmin:login`."""


# ---------------------------------------------------------------- crypto

def _key() -> bytes:
    raw = os.environ.get("APP_SECRETS_KEY")
    if not raw:
        raise SystemExit(
            "APP_SECRETS_KEY is not set.\n"
            "Generate one with:  openssl rand -base64 32\n"
            "Then set it in Vercel env AND as a GitHub Actions secret."
        )
    import base64

    # Restore stripped '=' padding before decoding. Node's Buffer.from(x,
    # 'base64') accepts unpadded input and lib/secrets.ts therefore does too,
    # but Python's b64decode raises "Incorrect padding" on the same string —
    # so an unpadded key silently worked on Vercel and blew up in the Python
    # jobs. Both sides must accept exactly the same input; they decode to
    # identical bytes either way.
    raw = raw.strip()
    key = base64.b64decode(raw + "=" * (-len(raw) % 4))
    if len(key) != 32:
        raise SystemExit(
            f"APP_SECRETS_KEY must decode to 32 bytes, got {len(key)}. "
            "Generate one with: openssl rand -base64 32"
        )
    return key


def encrypt_secret(value):
    """AES-256-GCM. Wire format matches lib/secrets.ts exactly: a 12-byte nonce
    and ciphertext with the 16-byte tag appended, over a JSON-encoded plaintext."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    blob = AESGCM(_key()).encrypt(nonce, json.dumps(value).encode("utf-8"), None)
    return nonce, blob


def decrypt_secret(nonce: bytes, ciphertext: bytes):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    plain = AESGCM(_key()).decrypt(bytes(nonce), bytes(ciphertext), None)
    return json.loads(plain.decode("utf-8"))


# ---------------------------------------------------------------- database

# A stale credential is not a transient outage: retrying can never fix it, and
# exiting 0 turns a dead cron into a green tick. A rotated Neon password once
# went unnoticed for hours because every workflow reported success while doing
# nothing, so these must fail the job loudly.
FATAL_DB_ERRORS = (
    "password authentication failed",
    "role \"",
    "does not exist",
    "no pg_hba.conf entry",
)


def _is_fatal_db_error(err) -> bool:
    msg = str(err).lower()
    return any(s.lower() in msg for s in FATAL_DB_ERRORS)


def load_dotenv_local() -> None:
    """Populate env from .env.local when running on a laptop.

    In GitHub Actions the values arrive as secrets and this is a no-op, but
    without it every local invocation needs the vars exported by hand."""
    path = Path(__file__).resolve().parents[2] / ".env.local"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def connect_db():
    """Open a Neon connection, retrying transient outages.

    Neon is serverless and can be briefly unreachable, so a timed-out or
    refused connection just skips the run (exit 0) rather than emailing. An
    authentication or authorisation failure exits non-zero instead — see
    FATAL_DB_ERRORS."""
    load_dotenv_local()
    last_err = None
    for attempt in range(5):
        try:
            return psycopg2.connect(
                os.environ["DATABASE_URL"],
                connect_timeout=15,
                keepalives=1,
                keepalives_idle=30,
                keepalives_interval=10,
                keepalives_count=5,
            )
        except psycopg2.OperationalError as e:
            if _is_fatal_db_error(e):
                raise SystemExit(
                    f"DATABASE_URL is rejected by Neon: {e}\n"
                    "This will not fix itself — the credential is stale or revoked.\n"
                    "Update the DATABASE_URL GitHub secret from the current Neon "
                    "connection string (and check the Vercel env var matches)."
                )
            last_err = e
            print(f"DB connect failed (attempt {attempt + 1}/5): {e}")
            time.sleep(2 ** attempt + random.uniform(0, 1))
    print(
        f"Database unreachable after 5 attempts: {last_err}\n"
        "Skipping this run; the next scheduled run will catch up.",
        flush=True,
    )
    raise SystemExit(0)


def ensure_connected_accounts(cur) -> None:
    """Mirrors ensureConnectedAccounts() in lib/connected-accounts.ts. The repo
    has no migration tooling — all DDL is idempotent and runs inline."""
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS connected_accounts (
          provider          TEXT PRIMARY KEY,
          secret_nonce      BYTEA NOT NULL,
          secret_ciphertext BYTEA NOT NULL,
          status            TEXT NOT NULL DEFAULT 'ok',
          expires_at        TIMESTAMPTZ,
          last_ok_at        TIMESTAMPTZ,
          last_error        TEXT,
          updated_at        TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )


def load_bundle(cur):
    """Decrypted token bundle string, or None if Garmin was never connected."""
    ensure_connected_accounts(cur)
    cur.execute(
        "SELECT secret_nonce, secret_ciphertext FROM connected_accounts WHERE provider = %s",
        (PROVIDER,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return decrypt_secret(row[0], row[1])


def save_bundle(cur, bundle: str) -> None:
    ensure_connected_accounts(cur)
    nonce, blob = encrypt_secret(bundle)
    cur.execute(
        """
        INSERT INTO connected_accounts
          (provider, secret_nonce, secret_ciphertext, status, last_ok_at, last_error, updated_at)
        VALUES (%s, %s, %s, 'ok', NOW(), NULL, NOW())
        ON CONFLICT (provider) DO UPDATE SET
          secret_nonce      = EXCLUDED.secret_nonce,
          secret_ciphertext = EXCLUDED.secret_ciphertext,
          status            = 'ok',
          last_ok_at        = NOW(),
          last_error        = NULL,
          updated_at        = NOW()
        """,
        (PROVIDER, psycopg2.Binary(nonce), psycopg2.Binary(blob)),
    )


def set_status(cur, status: str, last_error=None) -> None:
    ensure_connected_accounts(cur)
    cur.execute(
        """UPDATE connected_accounts
              SET status = %s, last_error = %s, updated_at = NOW()
            WHERE provider = %s""",
        (status, (last_error or "")[:500] or None, PROVIDER),
    )


def touch_ok(cur) -> None:
    ensure_connected_accounts(cur)
    cur.execute(
        """UPDATE connected_accounts
              SET status = 'ok', last_ok_at = NOW(), last_error = NULL, updated_at = NOW()
            WHERE provider = %s""",
        (PROVIDER,),
    )


# ---------------------------------------------------------------- session

@contextmanager
def garmin_session():
    """Yields (garmin, conn, cur) with a live, token-refreshed Garmin client.

    Holds a transaction-scoped advisory lock for the whole session so two
    Garmin jobs can't clobber each other's refreshed bundle. On exit the bundle
    is written back only if it actually changed, so this costs a handful of
    writes per day rather than one per run.

    Raises ReauthRequired (already recorded in the DB) when the stored bundle
    is gone or rejected. Callers should catch it and exit 0.
    """
    from garminconnect import Garmin, GarminConnectAuthenticationError

    conn = connect_db()
    cur = conn.cursor()
    try:
        cur.execute(LOCK_SQL)

        bundle = load_bundle(cur)
        if not bundle:
            set_status(cur, "reauth_required", "No stored Garmin token bundle")
            conn.commit()
            raise ReauthRequired(
                "Garmin is not connected. Run `npm run garmin:login` on your Mac."
            )

        before = hashlib.sha256(bundle.encode("utf-8")).hexdigest()

        garmin = Garmin()
        try:
            # Passing the bundle as inline JSON makes login() load it, refresh
            # the DI bearer if it expires soon, and fetch the social profile
            # (which populates display_name — required by the activity and
            # wellness endpoints). No credentials are involved: if the bundle
            # is rejected, login() has nothing to fall back to and raises.
            garmin.login(tokenstore=bundle)
        except GarminConnectAuthenticationError as e:
            set_status(cur, "reauth_required", str(e))
            conn.commit()
            raise ReauthRequired(
                f"Garmin rejected the stored token: {e}\n"
                "Run `npm run garmin:login` on your Mac to re-authenticate."
            ) from e

        yield garmin, conn, cur

        after_bundle = garmin.client.dumps()
        if hashlib.sha256(after_bundle.encode("utf-8")).hexdigest() != before:
            save_bundle(cur, after_bundle)
            print("Token bundle refreshed — written back to Neon.")
        else:
            touch_ok(cur)
        conn.commit()
    finally:
        cur.close()
        conn.close()


# ---------------------------------------------------------------- health

def ensure_sync_health(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sync_health (
          provider             TEXT PRIMARY KEY,
          last_ok_at           TIMESTAMPTZ,
          last_error           TEXT,
          consecutive_failures INT NOT NULL DEFAULT 0,
          detail               TEXT,
          updated_at           TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )


def record_sync_health(cur, provider: str, ok: bool, detail=None, error=None) -> None:
    """One row per provider, written at the end of every sync path.

    With a single active source there is no redundancy to fall back on, so a
    stalled sync has to be *visible* — the Settings page reads this and shows
    amber once a provider hasn't succeeded in 6 hours."""
    ensure_sync_health(cur)
    if ok:
        cur.execute(
            """
            INSERT INTO sync_health (provider, last_ok_at, last_error, consecutive_failures, detail, updated_at)
            VALUES (%s, NOW(), NULL, 0, %s, NOW())
            ON CONFLICT (provider) DO UPDATE SET
              last_ok_at = NOW(), last_error = NULL, consecutive_failures = 0,
              detail = EXCLUDED.detail, updated_at = NOW()
            """,
            (provider, (detail or "")[:200] or None),
        )
    else:
        cur.execute(
            """
            INSERT INTO sync_health (provider, last_error, consecutive_failures, updated_at)
            VALUES (%s, %s, 1, NOW())
            ON CONFLICT (provider) DO UPDATE SET
              last_error = EXCLUDED.last_error,
              consecutive_failures = sync_health.consecutive_failures + 1,
              updated_at = NOW()
            """,
            (provider, (error or "")[:500] or None),
        )


def primary_source(cur) -> str:
    """Mirror of lib/sync-sources.ts. Defaults to strava when unset."""
    try:
        cur.execute("SELECT data->>'primary_source' FROM athlete_profile WHERE id = 1")
        row = cur.fetchone()
    except Exception:
        return "strava"
    return "garmin" if (row and row[0] == "garmin") else "strava"


def athlete_ftp(cur, default: float = 250.0) -> float:
    """Mirror of effectiveFtp() in lib/profile.ts — eFTP wins when use_eftp."""
    try:
        cur.execute(
            "SELECT data->>'ftp', data->>'eftp', data->>'use_eftp' FROM athlete_profile WHERE id = 1"
        )
        row = cur.fetchone() or (None, None, None)
        ftp, eftp, use_eftp = row
        if use_eftp in ("true", "True", True) and eftp:
            return float(eftp)
        if ftp:
            return float(ftp)
    except Exception:
        pass
    return default


def bail_on_reauth(exc: ReauthRequired) -> None:
    """Print and exit 0. A dead Garmin token is expected eventually; Strava is
    still running, so this must not fail the workflow or send email. The
    Settings page surfaces it from connected_accounts.status."""
    print("=" * 72, flush=True)
    print(f"GARMIN RE-AUTH REQUIRED\n{exc}", flush=True)
    print("=" * 72, flush=True)
    sys.exit(0)
