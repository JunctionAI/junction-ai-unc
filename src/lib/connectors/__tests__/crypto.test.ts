import { describe, expect, it } from "vitest";
import { generateSecretKey, isSecretStoreConfigured, keyringFromEnv, keyringFromKeys, needsReseal, open, seal, SecretStoreError } from "../crypto";

const KEY_A = Buffer.alloc(32, 7);
const KEY_B = Buffer.alloc(32, 9);
const ringA = keyringFromKeys({ version: 1, key: KEY_A });
const ringB = keyringFromKeys({ version: 1, key: KEY_B });

describe("seal / open", () => {
  it("round-trips a token bundle under a fixed key with a fresh iv each time", () => {
    const plain = JSON.stringify({ accessToken: "shpat_fixture_token", obtainedAt: "2026-09-02T00:00:00.000Z" });
    const a = seal(plain, ringA, "conn-1");
    const b = seal(plain, ringA, "conn-1");
    expect(open(a, ringA, "conn-1")).toBe(plain);
    expect(open(b, ringA, "conn-1")).toBe(plain);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.keyVersion).toBe(1);
    // nothing readable leaks into the sealed form
    expect(a.ciphertext).not.toContain("shpat");
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(a.tag, "base64")).toHaveLength(16);
  });

  it("detects tampering with the ciphertext, the tag and the iv", () => {
    const sealed = seal("secret", ringA, "conn-1");
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] ^= 0xff;
      return buf.toString("base64");
    };
    expect(() => open({ ...sealed, ciphertext: flip(sealed.ciphertext) }, ringA, "conn-1")).toThrow(SecretStoreError);
    expect(() => open({ ...sealed, tag: flip(sealed.tag) }, ringA, "conn-1")).toThrow(SecretStoreError);
    expect(() => open({ ...sealed, iv: flip(sealed.iv) }, ringA, "conn-1")).toThrow(SecretStoreError);
  });

  it("fails closed under the wrong key, the wrong aad and an unknown key version", () => {
    const sealed = seal("secret", ringA, "conn-1");
    expect(() => open(sealed, ringB, "conn-1")).toThrow(/open_failed/);
    expect(() => open(sealed, ringA, "conn-2")).toThrow(/open_failed/);
    expect(() => open({ ...sealed, keyVersion: 2 }, ringA, "conn-1")).toThrow(/unknown_key_version/);
    expect(() => open({ ...sealed, iv: "AAAA" }, ringA, "conn-1")).toThrow(/malformed/);
  });

  it("error messages carry a code, never the plaintext", () => {
    const sealed = seal("super-secret-token", ringA);
    try {
      open(sealed, ringB);
      throw new Error("should have thrown");
    } catch (e) {
      expect(String(e)).not.toContain("super-secret-token");
      expect((e as SecretStoreError).code).toBe("open_failed");
    }
  });
});

describe("key rotation", () => {
  it("opens rows sealed under the previous version and flags them for re-seal", () => {
    const sealedV1 = seal("t", ringA, "c");
    const rotated = keyringFromKeys({ version: 2, key: KEY_B }, { version: 1, key: KEY_A });
    expect(open(sealedV1, rotated, "c")).toBe("t");
    expect(needsReseal(sealedV1, rotated)).toBe(true);
    const resealed = seal("t", rotated, "c");
    expect(resealed.keyVersion).toBe(2);
    expect(needsReseal(resealed, rotated)).toBe(false);
    // and once the previous key is dropped, the old row is unreadable (fails closed)
    const dropped = keyringFromKeys({ version: 2, key: KEY_B });
    expect(() => open(sealedV1, dropped, "c")).toThrow(/unknown_key_version/);
  });
});

describe("keyring from env", () => {
  it("is unconfigured without CONNECTOR_SECRET_KEY", () => {
    expect(keyringFromEnv({})).toBeNull();
    expect(isSecretStoreConfigured({})).toBe(false);
  });

  it("parses a 32-byte base64 key, version and previous key", () => {
    const ring = keyringFromEnv({ CONNECTOR_SECRET_KEY: KEY_B.toString("base64"), CONNECTOR_SECRET_KEY_VERSION: "2", CONNECTOR_SECRET_KEY_PREVIOUS: KEY_A.toString("base64") })!;
    expect(ring.currentVersion).toBe(2);
    expect(ring.keys.get(2)!.equals(KEY_B)).toBe(true);
    expect(ring.keys.get(1)!.equals(KEY_A)).toBe(true);
    expect(isSecretStoreConfigured({ CONNECTOR_SECRET_KEY: generateSecretKey() })).toBe(true);
  });

  it("rejects a key that is not 32 bytes (loudly for the keyring, false for the gate)", () => {
    expect(() => keyringFromEnv({ CONNECTOR_SECRET_KEY: Buffer.alloc(16, 1).toString("base64") })).toThrow(/bad_key/);
    expect(isSecretStoreConfigured({ CONNECTOR_SECRET_KEY: "short" })).toBe(false);
  });
});
