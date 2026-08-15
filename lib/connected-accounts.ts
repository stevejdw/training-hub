import type { PoolClient } from 'pg';
import pool from './db';
import { decryptSecret, encryptSecret } from './secrets';

/**
 * Credential store for providers whose tokens rotate and therefore can't live
 * in a GitHub secret.
 *
 * Garmin's DI bearer refreshes roughly hourly, and GitHub Actions can't write
 * back to its own secrets without a PAT carrying `secrets:write`. Neon is the
 * only store both Vercel and the Actions jobs already authenticate to, so the
 * bundle lives here — encrypted, per lib/secrets.ts. This is the same shape as
 * the existing `strava_tokens` rotation, minus the manual toil that the
 * "!! STRAVA ROTATED YOUR REFRESH TOKEN — update BOTH" block in
 * .github/scripts/sync_strava.py exists to warn about.
 *
 * The secret is never returned to the browser. Status routes read the metadata
 * columns only.
 */

export type AccountStatus = 'ok' | 'reauth_required' | 'error';

export interface AccountMeta {
  provider: string;
  status: AccountStatus;
  expiresAt: Date | null;
  lastOkAt: Date | null;
  lastError: string | null;
  updatedAt: Date | null;
}

interface AccountRow {
  provider: string;
  secret_nonce: Buffer;
  secret_ciphertext: Buffer;
  status: AccountStatus;
  expires_at: Date | null;
  last_ok_at: Date | null;
  last_error: string | null;
  updated_at: Date | null;
}

/** Idempotent DDL. Safe to call on every request — mirrors ensureDeletionSchema. */
export async function ensureConnectedAccounts(client: PoolClient): Promise<void> {
  await client.query(`
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
  `);
}

function toMeta(row: AccountRow): AccountMeta {
  return {
    provider:  row.provider,
    status:    row.status,
    expiresAt: row.expires_at,
    lastOkAt:  row.last_ok_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

/**
 * Metadata only — never the secret. This is what /api/garmin/status serves.
 * Returns null when the provider has never been connected.
 */
export async function getAccountMeta(provider: string): Promise<AccountMeta | null> {
  const client = await pool.connect();
  try {
    await ensureConnectedAccounts(client);
    const res = await client.query<AccountRow>(
      `SELECT provider, status, expires_at, last_ok_at, last_error, updated_at
         FROM connected_accounts WHERE provider = $1`,
      [provider]
    );
    return res.rows[0] ? toMeta(res.rows[0]) : null;
  } finally {
    client.release();
  }
}

/** Decrypted secret. Server-side only — must never reach a response body. */
export async function getAccountSecret<T = unknown>(provider: string): Promise<T | null> {
  const client = await pool.connect();
  try {
    await ensureConnectedAccounts(client);
    const res = await client.query<AccountRow>(
      `SELECT secret_nonce, secret_ciphertext FROM connected_accounts WHERE provider = $1`,
      [provider]
    );
    const row = res.rows[0];
    if (!row) return null;
    return decryptSecret<T>(row.secret_nonce, row.secret_ciphertext);
  } finally {
    client.release();
  }
}

/** Store (or replace) a provider's secret and mark it healthy. */
export async function putAccountSecret(
  provider: string,
  secret: unknown,
  meta: { expiresAt?: Date | null } = {}
): Promise<void> {
  const { nonce, ciphertext } = encryptSecret(secret);
  const client = await pool.connect();
  try {
    await ensureConnectedAccounts(client);
    await client.query(
      `INSERT INTO connected_accounts
         (provider, secret_nonce, secret_ciphertext, status, expires_at, last_ok_at, last_error, updated_at)
       VALUES ($1, $2, $3, 'ok', $4, NOW(), NULL, NOW())
       ON CONFLICT (provider) DO UPDATE SET
         secret_nonce      = EXCLUDED.secret_nonce,
         secret_ciphertext = EXCLUDED.secret_ciphertext,
         status            = 'ok',
         expires_at        = EXCLUDED.expires_at,
         last_ok_at        = NOW(),
         last_error        = NULL,
         updated_at        = NOW()`,
      [provider, nonce, ciphertext, meta.expiresAt ?? null]
    );
  } finally {
    client.release();
  }
}

/**
 * Flag a provider as needing attention without touching the stored secret.
 * The sync jobs call this on a 401/403 and then exit 0 — a dead Garmin token
 * is a known condition, not a job failure, matching sync_strava.py's
 * convention of not failure-emailing on things the next run can't fix.
 */
export async function setAccountStatus(
  provider: string,
  status: AccountStatus,
  lastError: string | null = null
): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureConnectedAccounts(client);
    await client.query(
      `UPDATE connected_accounts
          SET status = $2, last_error = $3, updated_at = NOW()
        WHERE provider = $1`,
      [provider, status, lastError]
    );
  } finally {
    client.release();
  }
}
