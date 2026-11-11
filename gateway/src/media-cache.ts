// ============================================================
// Ephemeral QR Media Cache & Sealed Descriptor Helpers
//
// Keeps inbound WhatsApp QR media out of Supabase Storage/database.
// Only a compact AES-256-GCM encrypted descriptor (`ref`) is placed in
// `messages.media_url` (`/api/whatsapp/qr/media?ref=...`).
//
// When viewed in the Inbox, media is fetched on demand, decrypted with
// WhatsApp's keys, cached ephemerally in memory + `/tmp` LRU cache, and
// served with long-lived `Cache-Control` headers so the browser caches it.
// ============================================================

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extractMessageContent,
  getContentType,
  type WAMessage,
} from "@whiskeysockets/baileys";

import { config } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";
import { logger } from "./logger.js";

const DEFAULT_WA_MEDIA_HOST = "https://mmg.whatsapp.net";

export type SupportedMediaKey =
  | "imageMessage"
  | "videoMessage"
  | "audioMessage"
  | "documentMessage"
  | "stickerMessage";

const SUPPORTED_MEDIA_KEYS = new Set<string>([
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
]);

export interface QrMediaDescriptor {
  v: 1;
  /** Project ID that owns this message — enforced on every media fetch. */
  p: string;
  /** Remote chat JID for WAMessageKey (needed for WhatsApp reupload fallback). */
  r: string;
  /** Message key ID. */
  i: string;
  /** Whether the message was sent by this paired phone. */
  f: boolean;
  /** Optional participant JID. */
  pt?: string;
  /** Protobuf content key inside WAMessage.message. */
  t: SupportedMediaKey;
  /** Resolved MIME type. */
  mt: string;
  /** Original filename if document. */
  fn?: string | null;
  /** Media CDN URL if non-default. */
  u?: string;
  /** WhatsApp CDN directPath. */
  d?: string;
  /** WhatsApp thumbnail directPath fallback. */
  td?: string;
  /** Base64 mediaKey. */
  m?: string;
  /** Base64 fileSha256. */
  s?: string;
  /** Base64 fileEncSha256. */
  e?: string;
  /** Original file length. */
  l?: number | string;
}

function bytesToBase64(val: unknown): string | undefined {
  if (!val) return undefined;
  if (Buffer.isBuffer(val)) return val.toString("base64");
  if (val instanceof Uint8Array) return Buffer.from(val).toString("base64");
  if (typeof val === "string" && val.length > 0) return val;
  return undefined;
}

export function sealMediaDescriptor(descriptor: QrMediaDescriptor): string {
  const encrypted = encrypt(JSON.stringify(descriptor));
  return Buffer.from(encrypted, "utf8").toString("base64url");
}

export function unsealMediaDescriptor(ref: string): QrMediaDescriptor | null {
  try {
    const encrypted = Buffer.from(ref, "base64url").toString("utf8");
    const json = decrypt(encrypted);
    const parsed = JSON.parse(json) as Partial<QrMediaDescriptor>;
    if (
      parsed?.v !== 1 ||
      typeof parsed.p !== "string" ||
      typeof parsed.r !== "string" ||
      typeof parsed.i !== "string" ||
      typeof parsed.t !== "string" ||
      !SUPPORTED_MEDIA_KEYS.has(parsed.t)
    ) {
      return null;
    }
    return parsed as QrMediaDescriptor;
  } catch {
    return null;
  }
}

/**
 * Extract the minimal WhatsApp media descriptor needed to download & decrypt
 * the attachment on demand later, returning an authenticated same-origin
 * proxy URL (`/api/whatsapp/qr/media?ref=...`).
 */
export function buildQrMediaProxyUrl(
  projectId: string,
  message: WAMessage,
  mimeType: string,
  filename: string | null,
): string | null {
  const mContent = extractMessageContent(message.message);
  if (!mContent) return null;

  const contentType = getContentType(mContent);
  if (!contentType || !SUPPORTED_MEDIA_KEYS.has(contentType)) {
    return null;
  }

  const media = (mContent as Record<string, unknown>)[contentType] as
    | Record<string, unknown>
    | undefined;
  if (!media || typeof media !== "object") return null;

  const directPath =
    typeof media.directPath === "string" ? media.directPath : undefined;
  const rawUrl = typeof media.url === "string" ? media.url : undefined;
  const thumbnailDirectPath =
    typeof media.thumbnailDirectPath === "string"
      ? media.thumbnailDirectPath
      : undefined;

  if (!directPath && !rawUrl && !thumbnailDirectPath) {
    return null;
  }

  const remoteJid = message.key.remoteJid ?? "";
  const msgId = message.key.id ?? "";
  if (!remoteJid || !msgId) return null;

  const omitUrl =
    rawUrl && directPath && rawUrl === `${DEFAULT_WA_MEDIA_HOST}${directPath}`;

  const descriptor: QrMediaDescriptor = {
    v: 1,
    p: projectId,
    r: remoteJid,
    i: msgId,
    f: Boolean(message.key.fromMe),
    t: contentType as SupportedMediaKey,
    mt: mimeType || "application/octet-stream",
    ...(message.key.participant ? { pt: message.key.participant } : {}),
    ...(filename ? { fn: filename } : {}),
    ...(!omitUrl && rawUrl ? { u: rawUrl } : {}),
    ...(directPath ? { d: directPath } : {}),
    ...(thumbnailDirectPath ? { td: thumbnailDirectPath } : {}),
    ...(bytesToBase64(media.mediaKey) ? { m: bytesToBase64(media.mediaKey) } : {}),
    ...(bytesToBase64(media.fileSha256) ? { s: bytesToBase64(media.fileSha256) } : {}),
    ...(bytesToBase64(media.fileEncSha256)
      ? { e: bytesToBase64(media.fileEncSha256) }
      : {}),
    ...(media.fileLength !== undefined && media.fileLength !== null
      ? { l: Number(media.fileLength) || String(media.fileLength) }
      : {}),
  };

  const ref = sealMediaDescriptor(descriptor);
  return `/api/whatsapp/qr/media?ref=${ref}`;
}

/** Reconstruct a minimal WAMessage that Baileys `downloadMediaMessage` accepts. */
export function reconstructWaMessage(desc: QrMediaDescriptor): WAMessage {
  const url =
    desc.u ??
    (desc.d ? `${DEFAULT_WA_MEDIA_HOST}${desc.d}` : undefined);

  const mediaPayload: Record<string, unknown> = {
    mimetype: desc.mt,
    ...(url ? { url } : {}),
    ...(desc.d ? { directPath: desc.d } : {}),
    ...(desc.td ? { thumbnailDirectPath: desc.td } : {}),
    ...(desc.m ? { mediaKey: Buffer.from(desc.m, "base64") } : {}),
    ...(desc.s ? { fileSha256: Buffer.from(desc.s, "base64") } : {}),
    ...(desc.e ? { fileEncSha256: Buffer.from(desc.e, "base64") } : {}),
    ...(desc.l !== undefined ? { fileLength: desc.l } : {}),
    ...(desc.fn ? { fileName: desc.fn } : {}),
  };

  return {
    key: {
      remoteJid: desc.r,
      id: desc.i,
      fromMe: desc.f,
      ...(desc.pt ? { participant: desc.pt } : {}),
    },
    message: {
      [desc.t]: mediaPayload,
    },
  } as unknown as WAMessage;
}

export interface CachedMediaEntry {
  buffer: Buffer;
  mimeType: string;
  filename: string | null;
}

interface MemoryCacheNode {
  entry: CachedMediaEntry;
  expiresAt: number;
  bytes: number;
}

const DEFAULT_MEMORY_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_DISK_MAX_BYTES = 512 * 1024 * 1024;
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Two-tier ephemeral cache (RAM LRU + container `/tmp` LRU) so repeated
 * views do not re-hit WhatsApp CDN and zero chat media hits Supabase Storage.
 */
class EphemeralQrMediaCache {
  private readonly mem = new Map<string, MemoryCacheNode>();
  private memBytes = 0;
  private readonly inFlight = new Map<string, Promise<CachedMediaEntry>>();
  private readonly diskDir: string;

  constructor() {
    this.diskDir = path.join(os.tmpdir(), "masacrm-qr-media-cache");
  }

  cacheKey(desc: QrMediaDescriptor): string {
    return crypto
      .createHash("sha256")
      .update(`${desc.p}:${desc.r}:${desc.i}:${desc.t}`)
      .digest("hex");
  }

  get(key: string): CachedMediaEntry | null {
    const now = Date.now();
    const memHit = this.mem.get(key);
    if (memHit) {
      if (memHit.expiresAt > now) {
        // Refresh LRU order
        this.mem.delete(key);
        this.mem.set(key, memHit);
        return memHit.entry;
      }
      this.mem.delete(key);
      this.memBytes -= memHit.bytes;
    }

    // L2 ephemeral disk lookup
    const binPath = path.join(this.diskDir, `${key}.bin`);
    const metaPath = path.join(this.diskDir, `${key}.json`);
    try {
      if (!fs.existsSync(binPath) || !fs.existsSync(metaPath)) return null;
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
        mimeType: string;
        filename: string | null;
        expiresAt: number;
      };
      if (!meta || meta.expiresAt <= now) {
        fs.rmSync(binPath, { force: true });
        fs.rmSync(metaPath, { force: true });
        return null;
      }
      const buffer = fs.readFileSync(binPath);
      const entry: CachedMediaEntry = {
        buffer,
        mimeType: meta.mimeType || "application/octet-stream",
        filename: meta.filename ?? null,
      };
      this.setMemory(key, entry);
      return entry;
    } catch {
      return null;
    }
  }

  set(key: string, entry: CachedMediaEntry): void {
    this.setMemory(key, entry);
    this.setDisk(key, entry);
  }

  async getOrLoad(
    key: string,
    loader: () => Promise<CachedMediaEntry>,
  ): Promise<CachedMediaEntry> {
    const cached = this.get(key);
    if (cached) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = (async () => {
      const result = await loader();
      if (result.buffer.length <= config.maxMediaBytes) {
        this.set(key, result);
      }
      return result;
    })();

    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private setMemory(key: string, entry: CachedMediaEntry): void {
    const bytes = entry.buffer.length;
    if (bytes > DEFAULT_MEMORY_MAX_BYTES / 2) return;

    const prev = this.mem.get(key);
    if (prev) {
      this.memBytes -= prev.bytes;
      this.mem.delete(key);
    }

    while (this.memBytes + bytes > DEFAULT_MEMORY_MAX_BYTES && this.mem.size > 0) {
      const oldestKey = this.mem.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.mem.get(oldestKey);
      this.mem.delete(oldestKey);
      if (oldest) this.memBytes -= oldest.bytes;
    }

    this.mem.set(key, {
      entry,
      bytes,
      expiresAt: Date.now() + MEMORY_TTL_MS,
    });
    this.memBytes += bytes;
  }

  private setDisk(key: string, entry: CachedMediaEntry): void {
    try {
      fs.mkdirSync(this.diskDir, { recursive: true });
      const binPath = path.join(this.diskDir, `${key}.bin`);
      const metaPath = path.join(this.diskDir, `${key}.json`);
      fs.writeFileSync(binPath, entry.buffer);
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          mimeType: entry.mimeType,
          filename: entry.filename,
          expiresAt: Date.now() + DISK_TTL_MS,
        }),
      );
      this.pruneDiskIfNeeded();
    } catch (err) {
      logger.debug({ err }, "ephemeral disk media cache write skipped");
    }
  }

  private pruneDiskIfNeeded(): void {
    try {
      const names = fs.readdirSync(this.diskDir).filter((n) => n.endsWith(".bin"));
      const stats = names
        .map((n) => {
          const full = path.join(this.diskDir, n);
          const st = fs.statSync(full);
          return { name: n, full, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime);

      let total = stats.reduce((acc, s) => acc + s.size, 0);
      while (total > DEFAULT_DISK_MAX_BYTES && stats.length > 0) {
        const oldest = stats.shift()!;
        total -= oldest.size;
        fs.rmSync(oldest.full, { force: true });
        fs.rmSync(oldest.full.replace(/\.bin$/, ".json"), { force: true });
      }
    } catch {
      // Best-effort LRU prune
    }
  }
}

export const mediaCache = new EphemeralQrMediaCache();

