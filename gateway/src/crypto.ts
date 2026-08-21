// ============================================================
// AES-256-GCM, byte-compatible with the Next app's
// src/lib/whatsapp/encryption.ts.
//
// Deliberately a copy rather than an import: the gateway is a separate
// deployable with its own dependency tree, and reaching across into
// the Next app's src/ would couple their build graphs. The format is
// frozen and tiny — if you change one, change both.
//
//   <iv-hex>:<ciphertext-hex>:<authTag-hex>
//
// GCM (not CBC) because the ciphertexts sit in a database row: the
// auth tag means tampering fails the decrypt instead of silently
// yielding corrupted session credentials.
// ============================================================

import crypto from "node:crypto";

import { config } from "./config.js";

const GCM_IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function key(): Buffer {
  const buf = Buffer.from(config.encryptionKey, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `[gateway] ENCRYPTION_KEY must be 64 hex characters (32 bytes); got ${buf.length} bytes.`,
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  let out = cipher.update(plaintext, "utf8", "hex");
  out += cipher.final("hex");
  return `${iv.toString("hex")}:${out}:${cipher.getAuthTag().toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error(
      `[gateway] Unrecognised ciphertext format (expected 2 colons, got ${parts.length - 1}).`,
    );
  }
  const [ivHex, ctHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (iv.length !== GCM_IV_LENGTH) {
    throw new Error(`[gateway] Unexpected IV length ${iv.length}`);
  }
  if (tag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`[gateway] Unexpected auth-tag length ${tag.length}`);
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  let out = decipher.update(ctHex, "hex", "utf8");
  out += decipher.final("utf8");
  return out;
}
