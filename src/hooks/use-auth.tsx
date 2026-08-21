"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  canConnectWhatsApp as canConnectWhatsAppFor,
  canEditSettings as canEditSettingsFor,
  canManageCustomers as canManageCustomersFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  isPlatformRole,
  type AccountRole,
  type PlatformRole,
} from "@/lib/auth/roles";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
  /** Platform-level role: super_admin or customer. */
  platform_role: PlatformRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  /** Default deal currency (ISO-4217). NOT NULL DEFAULT 'USD' in the
   *  DB (migration 021); narrowed to DEFAULT_CURRENCY when absent. */
  default_currency: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in, *without* waiting for the profile row. Use
   * this for chrome (sidebar / header) that can render with just the
   * user object.
   */
  loading: boolean;
  /**
   * Profile-row loading. Stays true until `fetchProfile` settles
   * (success, missing row, or error). Code that branches on
   * `profile.beta_features` MUST gate on this — otherwise it sees the
   * `{ loading: false, profile: null }` window during initial load
   * and may take the "not opted in" branch incorrectly.
   */
  profileLoading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context (added by the account-sharing series)
  //
  // All of these are nullable until `profileLoading` is false.
  // After the profile resolves they're guaranteed to be set,
  // because migration 017 made `account_id` / `account_role`
  // NOT NULL on `profiles`.
  // ----------------------------------------------------------

  /** Account id the current user belongs to. Null while loading. */
  accountId: string | null;
  /**
   * The ACTIVE project — the data boundary inside the organisation
   * (migrations 041–045). Null while loading, or if the user has been
   * assigned to no project.
   *
   * Client-side queries must filter on this, not on `accountId`: RLS
   * admits every project the caller belongs to, so an account-scoped
   * query returns a sibling project's rows too. Writes must set
   * `project_id` for the same reason — plus the column is NOT NULL.
   *
   * It is NOT a permission signal. The server re-resolves the active
   * project from an httpOnly cookie on every request and the database
   * enforces membership; this is only here so the client can scope
   * what it owns.
   */
  activeProjectId: string | null;
  /** The active project's WhatsApp transport. Null while loading. */
  activeProjectChannel: "qr" | "cloud_api" | null;
  /** Which connection methods are enabled for the active project. */
  allowedChannels: ("qr" | "cloud_api")[];
  /** Role within that account. Null while loading. */
  accountRole: AccountRole | null;
  /** Lightweight account meta — id + name + default_currency. Null while loading. */
  account: AccountSummary | null;
  /** Account default deal currency. Falls back to DEFAULT_CURRENCY
   *  while loading or when no account is resolved, so callers can use
   *  it unconditionally. */
  defaultCurrency: string;
  /** True if `accountRole === 'owner'`. */
  isOwner: boolean;
  /** True if `accountRole === 'admin'` (does NOT include owner — use canManageMembers for "admin or above"). */
  isAdmin: boolean;
  /** True if `accountRole === 'agent'`. */
  isAgent: boolean;
  /** True if `accountRole === 'viewer'`. */
  isViewer: boolean;
  /** True if the caller can manage members (admin+). */
  canManageMembers: boolean;
  /** True if the caller can onboard customer users (admin+). */
  canManageCustomers: boolean;
  /** True if the caller can edit account-wide settings (admin+). */
  canEditSettings: boolean;
  /** True if the caller can send messages and edit operational data (agent+). */
  canSendMessages: boolean;
  /** True if the caller can connect or disconnect WhatsApp on their assigned project (agent+). */
  canConnectWhatsApp: boolean;
  /** Platform-level role — super_admin or customer. Null while loading. */
  platformRole: PlatformRole | null;
  /** True if the caller is a platform super_admin. */
  isSuperAdmin: boolean;
  /** True if the caller is a platform customer. */
  isCustomer: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * AuthProvider — wrap this around the dashboard layout.
 * Makes ONE getSession() call for the whole tree instead of one per
 * component, avoiding internal lock contention in the Supabase client.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [activeProject, setActiveProject] = useState<{
    id: string;
    channel_type: "qr" | "cloud_api";
    allowed_channels: ("qr" | "cloud_api")[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracked separately from `loading`. The session settles fast (one
  // local cookie read); the profile fetch crosses the network and
  // settles later. Callers that gate on `profile.*` need to know which
  // window they're in — see the type doc above.
  const [profileLoading, setProfileLoading] = useState(true);

  // Tracks the user ID we've successfully initiated/completed fetching
  // a profile for. This prevents redundant re-fetches and toggling
  // profileLoading back to true on window focus events/token refresh.
  const lastFetchedUserIdRef = useRef<string | null>(null);

  // Shared across init, auth-state-change listener, and the exposed
  // refreshProfile() callback. Reads the current session's user id and
  // pulls the matching profile row along with its account summary.
  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = createClient();
    setProfileLoading(true);
    lastFetchedUserIdRef.current = userId;
    try {
      // First try with platform_role (requires migration 047).
      // If the column doesn't exist yet (400 from PostgREST), fall
      // back to a query without it so the rest of the app still works.
      type ProfileRow = {
        id: string; full_name: string | null; email: string;
        avatar_url: string | null; role: string | null;
        beta_features: string[]; account_id: string | null;
        account_role: string | null; platform_role?: string | null;
      };

      let profileRow: ProfileRow | null = null;
      let fetchError: { message: string; code?: string } | null = null;

      const primaryCols =
        "id, full_name, email, avatar_url, role, beta_features, account_id, account_role, platform_role";
      const fallbackCols =
        "id, full_name, email, avatar_url, role, beta_features, account_id, account_role";

      const primary = await supabase
        .from("profiles")
        .select(primaryCols)
        .eq("user_id", userId)
        .maybeSingle();

      if (primary.error && primary.error.code === "42703") {
        // column does not exist — fall back without platform_role
        const fallback = await supabase
          .from("profiles")
          .select(fallbackCols)
          .eq("user_id", userId)
          .maybeSingle();
        profileRow = (fallback.data ?? null) as ProfileRow | null;
        fetchError = fallback.error;
      } else {
        profileRow = (primary.data ?? null) as ProfileRow | null;
        fetchError = primary.error;
      }

      if (fetchError) {
        console.error("[AuthProvider] fetchProfile error:", {
          message: fetchError.message,
          code: fetchError.code,
        });
        lastFetchedUserIdRef.current = null;
        return;
      }

      if (!profileRow) {
        lastFetchedUserIdRef.current = null;
        return;
      }

      // Load the account with a plain lookup by id instead of an
      // embedded FK join. The embed (`account:accounts!inner(...)`)
      // forces PostgREST to resolve the profiles.account_id →
      // accounts.id relationship from its schema cache; a stale cache
      // (common right after a migration adds the FK) makes it fail
      // hard with PGRST200 and blanks the whole profile — the user
      // then loses account context everywhere (issue #294). A point
      // lookup by id needs no relationship inference, so the profile
      // (with account_id / account_role) still resolves even if the
      // account name lookup itself can't.
      let accountRow: AccountSummary | null = null;
      if (profileRow.account_id) {
        const { data: account, error: accountErr } = await supabase
          .from("accounts")
          .select("id, name, default_currency")
          .eq("id", profileRow.account_id)
          .maybeSingle();
        if (accountErr) {
          console.error("[AuthProvider] fetchAccount error:", {
            message: accountErr.message,
            details: accountErr.details,
            hint: accountErr.hint,
            code: accountErr.code,
          });
        } else if (account) {
          accountRow = {
            id: account.id,
            name: account.name,
            default_currency: account.default_currency ?? DEFAULT_CURRENCY,
          };
        }
      }

      // Narrow the DB enum into our AccountRole union. The DB
      // constraint should make this unconditional, but a future
      // migration that broadens the enum without updating TS would
      // otherwise crash here — fall back to null and let UI gates
      // treat the caller as least-privileged.
      const accountRole = isAccountRole(profileRow.account_role)
        ? profileRow.account_role
        : null;

      // Platform role — defaults to 'customer' for backward compat.
      const platformRole = isPlatformRole(profileRow.platform_role)
        ? profileRow.platform_role
        : "customer";

      setProfile({
        id: profileRow.id,
        full_name: profileRow.full_name,
        email: profileRow.email,
        avatar_url: profileRow.avatar_url,
        role: profileRow.role,
        // `beta_features` is `NOT NULL DEFAULT ARRAY[]` in the DB, but
        // narrow defensively in case the column hasn't been migrated yet
        // (older deployments running 011 lazily) — `null` reads as no
        // opt-ins, which is the safe default for any future beta gate.
        beta_features: profileRow.beta_features ?? [],
        account_id: profileRow.account_id ?? null,
        account_role: accountRole,
        platform_role: platformRole,
      });
      setAccount(accountRow);
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
      lastFetchedUserIdRef.current = null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn("[AuthProvider] getSession() timed out after 3s");
        setLoading(false);
        setProfileLoading(false);
      }
    }, 3000);

    const init = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) console.error("[AuthProvider] getSession error:", error.message);

        if (!mounted) return;
        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          // Don't block session loading on profile fetch — chrome
          // (header, sidebar) can render from the user object alone,
          // profile enriches async. Callers that need to branch on
          // profile data gate on `profileLoading` instead.
          fetchProfile(currentUser.id);
        } else {
          // No user → no profile to load. Flip profileLoading off so
          // pages that gate on it don't wait forever on the logged-out
          // path (the route guard or redirect should fire instead).
          setProfileLoading(false);
        }
      } catch (err) {
        console.error("[AuthProvider] init threw:", err);
      } finally {
        if (mounted) setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        if (currentUser.id !== lastFetchedUserIdRef.current) {
          fetchProfile(currentUser.id);
        }
      } else {
        lastFetchedUserIdRef.current = null;
        setProfile(null);
        setAccount(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // Active project. Resolved server-side (the httpOnly cookie is
  // re-validated against project membership on every request), so this
  // only mirrors the answer for client-side query scoping. Fetched
  // once the user is known — before that there is nothing to scope.
  useEffect(() => {
    let cancelled = false;

    // Every state write lives inside the async body, including the
    // signed-out reset. Setting state synchronously in an effect body
    // triggers a cascading render (react-hooks/set-state-in-effect);
    // deferring it by a microtask costs nothing here because no
    // consumer can act on the project before it resolves anyway.
    (async () => {
      if (!user?.id) {
        if (!cancelled) setActiveProject(null);
        return;
      }
      try {
        const response = await fetch("/api/projects", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        const active = (data.projects ?? []).find(
          (p: { id: string }) => p.id === data.active_project_id,
        );
        setActiveProject(active ?? null);
      } catch {
        // Leave null. Consumers that need a project skip their query
        // rather than running an unscoped one.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setAccount(null);
    setActiveProject(null);
    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;
    await fetchProfile(user.id);
  }, [user?.id, fetchProfile]);

  // Derive the role booleans once per profile change rather than on
  // every consumer render. Cheap regardless, but the memo also gives
  // each derived value a stable identity for React.memo / useEffect
  // dependencies downstream.
  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    const pRole = profile?.platform_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      platformRole: pRole,
      isSuperAdmin: pRole === "super_admin",
      isCustomer: pRole === "customer",
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canManageCustomers: role ? canManageCustomersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
      canConnectWhatsApp: role ? canConnectWhatsAppFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id, profile?.platform_role]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
        activeProjectId: activeProject?.id ?? null,
        activeProjectChannel: activeProject?.channel_type ?? null,
        allowedChannels: activeProject?.allowed_channels ?? ["qr"],
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page). Account state
    // collapses to least-privileged null — every `canX` boolean is
    // false so UI gates fail closed.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      defaultCurrency: DEFAULT_CURRENCY,
      accountId: null,
      activeProjectId: null,
      activeProjectChannel: null,
      allowedChannels: ["qr"],
      accountRole: null,
      platformRole: null,
      isSuperAdmin: false,
      isCustomer: false,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canManageCustomers: false,
      canEditSettings: false,
      canSendMessages: false,
      canConnectWhatsApp: false,
    };
  }
  return ctx;
}
