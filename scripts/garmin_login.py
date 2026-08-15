#!/usr/bin/env python3
"""One-off interactive Garmin login. Run on your Mac: `npm run garmin:login`.

Garmin's SSO can demand an MFA code, so this step cannot run unattended in
GitHub Actions. It runs here, once, and deposits an encrypted token bundle in
Neon. Every scheduled job afterwards resumes and refreshes that bundle without
ever seeing your password.

Your Garmin password is used for this one exchange and is never written
anywhere — not to the database, not to disk, not to shell history. What gets
stored is the DI token bundle, which is revocable from your Garmin account and
which you can replace at any time by re-running this script.

Expect to re-run it roughly once a year, when the refresh token expires, and
whenever Garmin changes their auth flow.

Requires DATABASE_URL and APP_SECRETS_KEY in .env.local.
"""

import getpass
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / ".github" / "scripts"))


def load_dotenv_local() -> None:
    """Minimal .env.local reader so this matches how the app is configured
    locally. Deliberately not a dependency — it handles KEY=value and quotes,
    which is all .env.local contains."""
    path = REPO / ".env.local"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main() -> int:
    load_dotenv_local()

    for var in ("DATABASE_URL", "APP_SECRETS_KEY"):
        if not os.environ.get(var):
            print(f"{var} is not set (checked environment and .env.local).")
            if var == "APP_SECRETS_KEY":
                print("Generate one with:  openssl rand -base64 32")
                print("Then add it to .env.local, Vercel env, and GitHub secrets.")
            return 1

    import garmin_common as gc
    from garminconnect import Garmin, GarminConnectAuthenticationError

    print("Garmin Connect login")
    print("Your password is used once for this exchange and is never stored.\n")

    email = input("Garmin email: ").strip()
    if not email:
        print("No email given.")
        return 1
    password = getpass.getpass("Garmin password: ")
    if not password:
        print("No password given.")
        return 1

    def prompt_mfa() -> str:
        return input("MFA code (check your email or authenticator app): ").strip()

    garmin = Garmin(email=email, password=password, prompt_mfa=prompt_mfa)
    try:
        garmin.login()
    except GarminConnectAuthenticationError as e:
        print(f"\nGarmin rejected the login:\n{e}")
        return 1
    except Exception as e:
        print(f"\nLogin failed: {e}")
        print("If this mentions Cloudflare or a bot challenge, wait a few minutes.")
        return 1
    finally:
        del password

    bundle = garmin.client.dumps()

    conn = gc.connect_db()
    try:
        cur = conn.cursor()
        cur.execute(gc.LOCK_SQL)
        gc.save_bundle(cur, bundle)
        conn.commit()
        cur.close()
    finally:
        conn.close()

    print(f"\nConnected as {garmin.get_full_name()}.")
    print("Token bundle encrypted and stored in Neon (connected_accounts).")
    print("Next: run the 'Garmin probe' workflow to confirm CI can use it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
