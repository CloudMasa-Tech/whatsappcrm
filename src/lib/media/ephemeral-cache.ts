import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface EphemeralMediaValue {
  buffer: Buffer;
  contentType: string;
  filename?: string | null;
}

interface MemoryNode {
  value: EphemeralMediaValue;
  bytes: number;
  expiresAt: number;
}

const MEMORY_MAX_BYTES = 64 * 1024 * 1024;
const DISK_MAX_BYTES = 256 * 1024 * 1024;
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Bounded two-tier ephemeral cache (RAM LRU + container `/tmp` LRU) so inbox
 * media loads smoothly from cache without writing chat media to Supabase Storage.
 */
class ServerEphemeralMediaCache {
  private readonly mem = new Map<string, MemoryNode>();
  private memBytes = 0;
  private readonly inFlight = new Map<string, Promise<EphemeralMediaValue>>();
  private readonly diskDir = path.join(os.tmpdir(), "masacrm-web-media-cache");

  keyFor(namespace: string, rawKey: string): string {
    return crypto
      .createHash("sha256")
      .update(`${namespace}:${rawKey}`)
      .digest("hex");
  }

  get(key: string): EphemeralMediaValue | null {
    const now = Date.now();
    const hit = this.mem.get(key);
    if (hit) {
      if (hit.expiresAt > now) {
        this.mem.delete(key);
        this.mem.set(key, hit);
        return hit.value;
      }
      this.mem.delete(key);
      this.memBytes -= hit.bytes;
    }

    const binPath = path.join(this.diskDir, `${key}.bin`);
    const metaPath = path.join(this.diskDir, `${key}.json`);
    try {
      if (!fs.existsSync(binPath) || !fs.existsSync(metaPath)) return null;
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
        contentType: string;
        filename?: string | null;
        expiresAt: number;
      };
      if (!meta || meta.expiresAt <= now) {
        fs.rmSync(binPath, { force: true });
        fs.rmSync(metaPath, { force: true });
        return null;
      }
      const buffer = fs.readFileSync(binPath);
      const value: EphemeralMediaValue = {
        buffer,
        contentType: meta.contentType || "application/octet-stream",
        filename: meta.filename ?? null,
      };
      this.setMemory(key, value);
      return value;
    } catch {
      return null;
    }
  }

  async getOrLoad(
    key: string,
    loader: () => Promise<EphemeralMediaValue>,
  ): Promise<EphemeralMediaValue> {
    const cached = this.get(key);
    if (cached) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const value = await loader();
      this.setMemory(key, value);
      this.setDisk(key, value);
      return value;
    })();

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private setMemory(key: string, value: EphemeralMediaValue): void {
    const bytes = value.buffer.length;
    if (bytes > MEMORY_MAX_BYTES / 2) return;

    const prev = this.mem.get(key);
    if (prev) {
      this.memBytes -= prev.bytes;
      this.mem.delete(key);
    }

    while (this.memBytes + bytes > MEMORY_MAX_BYTES && this.mem.size > 0) {
      const oldestKey = this.mem.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.mem.get(oldestKey);
      this.mem.delete(oldestKey);
      if (oldest) this.memBytes -= oldest.bytes;
    }

    this.mem.set(key, {
      value,
      bytes,
      expiresAt: Date.now() + MEMORY_TTL_MS,
    });
    this.memBytes += bytes;
  }

  private setDisk(key: string, value: EphemeralMediaValue): void {
    try {
      fs.mkdirSync(this.diskDir, { recursive: true });
      fs.writeFileSync(path.join(this.diskDir, `${key}.bin`), value.buffer);
      fs.writeFileSync(
        path.join(this.diskDir, `${key}.json`),
        JSON.stringify({
          contentType: value.contentType,
          filename: value.filename ?? null,
          expiresAt: Date.now() + DISK_TTL_MS,
        }),
      );
      this.pruneDiskIfNeeded();
    } catch {
      // Best-effort ephemeral disk write
    }
  }

  private pruneDiskIfNeeded(): void {
    try {
      const files = fs
        .readdirSync(this.diskDir)
        .filter((f) => f.endsWith(".bin"))
        .map((f) => {
          const full = path.join(this.diskDir, f);
          const st = fs.statSync(full);
          return { full, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime);

      let total = files.reduce((sum, f) => sum + f.size, 0);
      while (total > DISK_MAX_BYTES && files.length > 0) {
        const oldest = files.shift()!;
        total -= oldest.size;
        fs.rmSync(oldest.full, { force: true });
        fs.rmSync(oldest.full.replace(/\.bin$/, ".json"), { force: true });
      }
    } catch {
      // Best-effort LRU prune
    }
  }
}

export const ephemeralMediaCache = new ServerEphemeralMediaCache();

