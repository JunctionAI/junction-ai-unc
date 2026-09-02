/* Secret store primitive — AES-256-GCM seal/open for connector token bundles.

   Key material comes from process.env only (never .env files, never the DB):

     CONNECTOR_SECRET_KEY            base64 of 32 random bytes  (openssl rand -base64 32)
     CONNECTOR_SECRET_KEY_VERSION    int, default 1 — stamped on every new seal
     CONNECTOR_SECRET_KEY_PREVIOUS   optional; the key that was current at VERSION-1, kept
                                     while old rows are re-sealed after a rotation

   Rotation: set PREVIOUS = old key, KEY = new key, VERSION = old+1. open() picks the key by
   the row's key_version; anything sealed under a version the keyring doesn't hold fails
   closed. Rows are re-sealed under the current key whenever tokens.ts rewrites them.

   Every ciphertext is bound to its row through GCM additional authenticated data (the
   connector id), so a sealed bundle copied onto another connector row does not open.
   Plaintext is never logged by anything in this module — the only Error messages are codes. */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SealedSecret {
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes
  keyVersion: number;
}

export interface Keyring {
  /** Version new seals are stamped with. */
  currentVersion: number;
  keys: Map<number, Buffer>;
}

export class SecretStoreError extends Error {
  constructor(readonly code: "not_configured" | "bad_key" | "unknown_key_version" | "open_failed" | "malformed") {
    super(`secret store: ${code}`);
    this.name = "SecretStoreError";
  }
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decodeKey(raw: string | undefined): Buffer | null {
  const v = (raw || "").trim();
  if (!v) return null;
  const buf = Buffer.from(v, "base64");
  if (buf.length !== KEY_BYTES) throw new SecretStoreError("bad_key");
  return buf;
}

/** Build the keyring from an env-shaped object. null when CONNECTOR_SECRET_KEY is absent;
    throws bad_key when it is present but not 32 base64 bytes (misconfiguration must be loud). */
export function keyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring | null {
  const current = decodeKey(env.CONNECTOR_SECRET_KEY);
  if (!current) return null;
  const versionRaw = (env.CONNECTOR_SECRET_KEY_VERSION || "1").trim();
  const currentVersion = Number.parseInt(versionRaw, 10);
  if (!Number.isInteger(currentVersion) || currentVersion < 1) throw new SecretStoreError("bad_key");
  const keys = new Map<number, Buffer>([[currentVersion, current]]);
  const previous = decodeKey(env.CONNECTOR_SECRET_KEY_PREVIOUS);
  if (previous && currentVersion > 1) keys.set(currentVersion - 1, previous);
  return { currentVersion, keys };
}

/** True iff CONNECTOR_SECRET_KEY is present and well-formed. Nothing that stores a token runs without it. */
export function isSecretStoreConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return keyringFromEnv(env) !== null;
  } catch {
    return false;
  }
}

/** Keyring for tests / callers that already hold raw key bytes. */
export function keyringFromKeys(current: { version: number; key: Buffer }, ...previous: { version: number; key: Buffer }[]): Keyring {
  if (current.key.length !== KEY_BYTES || previous.some((p) => p.key.length !== KEY_BYTES)) throw new SecretStoreError("bad_key");
  const keys = new Map<number, Buffer>([[current.version, current.key], ...previous.map((p) => [p.version, p.key] as [number, Buffer])]);
  return { currentVersion: current.version, keys };
}

/** Fresh 32-byte key, base64 — what CONNECTOR_SECRET_KEY should be set to. */
export function generateSecretKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/** Seal `plaintext` under the keyring's current key. `aad` (normally the connector id) must be
    passed identically to open(). */
export function seal(plaintext: string, keyring: Keyring, aad?: string): SealedSecret {
  const key = keyring.keys.get(keyring.currentVersion);
  if (!key) throw new SecretStoreError("unknown_key_version");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64"), keyVersion: keyring.currentVersion };
}

/** Open a sealed bundle. Fails closed (throws SecretStoreError) on a wrong key, a tampered
    ciphertext/tag/iv, mismatched aad, or a key version the keyring doesn't hold. */
export function open(sealed: SealedSecret, keyring: Keyring, aad?: string): string {
  const key = keyring.keys.get(sealed.keyVersion);
  if (!key) throw new SecretStoreError("unknown_key_version");
  let iv: Buffer, tag: Buffer, ciphertext: Buffer;
  try {
    iv = Buffer.from(sealed.iv, "base64");
    tag = Buffer.from(sealed.tag, "base64");
    ciphertext = Buffer.from(sealed.ciphertext, "base64");
  } catch {
    throw new SecretStoreError("malformed");
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretStoreError("malformed");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Node reports "Unsupported state or unable to authenticate data" — never echo more than a code.
    throw new SecretStoreError("open_failed");
  }
}

/** True when the row should be re-sealed under the current key (after a rotation). */
export function needsReseal(sealed: SealedSecret, keyring: Keyring): boolean {
  return sealed.keyVersion !== keyring.currentVersion;
}
