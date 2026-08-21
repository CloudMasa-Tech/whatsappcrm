import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for privileged admin operations
// (onboarding customer users, flows, automations, AI). Bypasses RLS —
// never expose it to the browser. Mirrors the other admin clients.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
