// ============================================================
// Baileys AuthenticationState backed by Supabase.
//
// Baileys ships `useMultiFileAuthState`, which writes a directory of
// JSON files per session. That is wrong for this deployment in three
// ways:
//
//   1. Sessions must survive container replacement. A redeploy that
//      wipes the filesystem would force every customer to re-scan.
//   2. Per-tenant credentials must not share a filesystem where a path
//      bug in one project can read another's keys.
//   3. Nothing on disk is encrypted.
//
// So we implement the same interface over `whatsapp_session_keys`,
// with every value encrypted at rest (AES-256-GCM, the app's existing
// ENCRYPTION_KEY) and every row keyed by project_id. The table denies
// all access to anon/authenticated — only this service, holding the
// service-role key, can read it.
//
// Baileys stores two kinds of thing: one `creds` blob, and many typed
// key rows (pre-keys, sessions, sender-keys, app-state sync keys). The
// (project_id, key_type, key_id) primary key models that directly.
// ============================================================

import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";

import { decrypt, encrypt } from "./crypto.js";
import { logger } from "./logger.js";
import { supabase } from "./supabase.js";

const TABLE = "whatsapp_session_keys";
const CREDS_TYPE = "creds";
const CREDS_ID = "creds";

/**
 * Baileys values contain Buffers, which JSON.stringify would mangle.
 * BufferJSON is Baileys' own replacer/reviver pair for exactly this.
 */
function serialise(value: unknown): string {
  return encrypt(JSON.stringify(value, BufferJSON.replacer));
}

function deserialise<T>(payload: string): T {
  return JSON.parse(decrypt(payload), BufferJSON.reviver) as T;
}

async function readValue<T>(
  projectId: string,
  keyType: string,
  keyId: string,
): Promise<T | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("payload")
    .eq("project_id", projectId)
    .eq("key_type", keyType)
    .eq("key_id", keyId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, projectId, keyType, keyId }, "auth-state read failed");
    return null;
  }
  if (!data?.payload) return null;

  try {
    return deserialise<T>(data.payload as string);
  } catch (err) {
    // A decrypt failure means the ENCRYPTION_KEY changed since this row
    // was written. The credential is unrecoverable; report it rather
    // than crashing the socket, and let the session fall through to a
    // fresh pairing.
    logger.error(
      { err, projectId, keyType, keyId },
      "auth-state decrypt failed — ENCRYPTION_KEY may have changed; a re-scan will be required",
    );
    return null;
  }
}

async function writeValue(
  projectId: string,
  keyType: string,
  keyId: string,
  value: unknown,
): Promise<void> {
  const { error } = await supabase.from(TABLE).upsert(
    {
      project_id: projectId,
      key_type: keyType,
      key_id: keyId,
      payload: serialise(value),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id,key_type,key_id" },
  );
  if (error) {
    logger.error({ err: error, projectId, keyType, keyId }, "auth-state write failed");
  }
}

async function deleteValue(
  projectId: string,
  keyType: string,
  keyId: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("project_id", projectId)
    .eq("key_type", keyType)
    .eq("key_id", keyId);
  if (error) {
    logger.error({ err: error, projectId, keyType, keyId }, "auth-state delete failed");
  }
}

export interface SupabaseAuthState {
  state: AuthenticationState;
  /** Persist the creds blob. Baileys calls this on `creds.update`. */
  saveCreds: () => Promise<void>;
}

/**
 * Load (or initialise) the auth state for one project.
 *
 * Every query in here is filtered by `project_id`. There is no code
 * path that reads a key without naming the project it belongs to —
 * that is the whole isolation story for this file, since the
 * service-role client has no RLS to fall back on.
 */
export async function useSupabaseAuthState(
  projectId: string,
): Promise<SupabaseAuthState> {
  const stored = await readValue<AuthenticationCreds>(
    projectId,
    CREDS_TYPE,
    CREDS_ID,
  );
  const creds: AuthenticationCreds = stored ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        async get(type, ids) {
          const result: Record<string, unknown> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readValue<unknown>(projectId, type, id);
              // Baileys expects app-state sync keys as a decoded proto
              // message, not the raw JSON it handed us.
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as Record<string, unknown>,
                );
              }
              if (value !== null && value !== undefined) {
                result[id] = value;
              }
            }),
          );
          return result as { [id: string]: SignalDataTypeMap[typeof type] };
        },

        async set(data) {
          // `data` is {type: {id: value|null}}; a null value is a
          // delete. Baileys batches these, so run them together rather
          // than one round trip per key — a fresh pairing writes
          // hundreds of pre-keys at once.
          const tasks: Array<Promise<void>> = [];
          for (const type of Object.keys(data)) {
            const entries = data[type as keyof typeof data] ?? {};
            for (const id of Object.keys(entries)) {
              const value = (entries as Record<string, unknown>)[id];
              tasks.push(
                value
                  ? writeValue(projectId, type, id, value)
                  : deleteValue(projectId, type, id),
              );
            }
          }
          await Promise.all(tasks);
        },
      },
    },

    saveCreds: () => writeValue(projectId, CREDS_TYPE, CREDS_ID, creds),
  };
}

/**
 * Destroy every credential for a project — used on logout, and when
 * WhatsApp tells us the pairing is dead. Leaving stale keys behind
 * makes the next pairing attempt fail in confusing ways.
 */
export async function clearAuthState(projectId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("project_id", projectId);
  if (error) {
    logger.error({ err: error, projectId }, "auth-state clear failed");
    throw new Error(`Failed to clear session credentials: ${error.message}`);
  }
}
