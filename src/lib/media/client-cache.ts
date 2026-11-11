"use client";

const CACHE_NAME = "masacrm-chat-media-v1";
const MAX_CACHE_ENTRIES = 150;

export function isCacheableProxyMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith("/api/whatsapp/media/") ||
    url.startsWith("/api/whatsapp/qr/media") ||
    url.startsWith("/api/instagram/dm-media")
  );
}

/**
 * Resolve a proxy media URL into a local `blob:` URL using browser CacheStorage
 * first (falling back to HTTP disk cache via `fetch`), so switching chats
 * never re-downloads media or requires Supabase Storage persistence.
 */
export async function resolveCachedMediaObjectUrl(url: string): Promise<string> {
  if (!isCacheableProxyMediaUrl(url)) {
    return url;
  }

  let response: Response | null = null;

  if (typeof window !== "undefined" && "caches" in window) {
    try {
      const cache = await window.caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit && hit.ok) {
        response = hit;
      } else {
        const fetched = await fetch(url, { cache: "force-cache" });
        if (!fetched.ok) {
          throw new Error(`Media request failed (${fetched.status})`);
        }
        try {
          await cache.put(url, fetched.clone());
          const keys = await cache.keys();
          if (keys.length > MAX_CACHE_ENTRIES) {
            const overflow = keys.length - MAX_CACHE_ENTRIES;
            for (let i = 0; i < overflow; i++) {
              await cache.delete(keys[i]);
            }
          }
        } catch {
          // Quota / private-browsing storage limits are non-fatal
        }
        response = fetched;
      }
    } catch {
      response = null;
    }
  }

  if (!response) {
    const fetched = await fetch(url, { cache: "force-cache" });
    if (!fetched.ok) {
      throw new Error(`Media request failed (${fetched.status})`);
    }
    response = fetched;
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

