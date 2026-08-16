import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for third-party credentials held in Postgres.
 *
 * Strava's tokens and the intervals.icu API key are stored in the clear today.
 * Anything added from here on gets encrypted, because the Garmin token bundle
 * is a persistent, un-scoped grant on the whole Garmin account — it is not a
 * read-only API key.
 *
 * AES-256-GCM in app code rather than pgcrypto: pgcrypto puts the key into the
 * SQL statement text, where it shows up in Neon's query logging and in
 * pg_stat_statements. The GitHub Actions jobs need a crypto dependency either
 * way, so nothing is saved by pushing it into the database.
 *
 * Wire format is deliberately the one Python's `cryptography` AESGCM produces,
 * so `.github/scripts/garmin_common.py` interops byte-for-byte:
 *
 *   nonce      12 random bytes, stored in its own column
 *   ciphertext AES-256-GCM output with the 16-byte auth tag APPENDED
 *
 * Node keeps the tag separate (`getAuthTag()`); Python concatenates it. We
 * follow Python and append, so neither side needs a special case.
 */

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** 32-byte key from APP_SECRETS_KEY (base64). Read lazily so importing this
 *  module doesn't crash routes that never touch a secret. */
function key(): Buffer {
  const raw = process.env.APP_SECRETS_KEY;
  if (!raw) {
    throw new Error(
      'APP_SECRETS_KEY is not set. Generate one with: ' +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  // Buffer.from tolerates missing '=' padding; Python's b64decode does not.
  // Normalise here so both implementations accept exactly the same string —
  // see the matching comment in .github/scripts/garmin_common.py.
  const trimmed = raw.trim();
  const buf = Buffer.from(trimmed + '='.repeat((4 - (trimmed.length % 4)) % 4), 'base64');
  if (buf.length !== 32) {
    throw new Error(`APP_SECRETS_KEY must decode to 32 bytes, got ${buf.length}`);
  }
  return buf;
}

/** True when a usable key is configured — for status routes that must not throw. */
export function secretsConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(value: unknown): { nonce: Buffer; ciphertext: Buffer } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return { nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
}

export function decryptSecret<T = unknown>(nonce: Buffer, ciphertext: Buffer): T {
  if (ciphertext.length < TAG_BYTES) {
    throw new Error('Ciphertext too short to contain an auth tag');
  }
  const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);
  const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key(), nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}
