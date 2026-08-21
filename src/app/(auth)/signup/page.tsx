import { redirect } from "next/navigation";

// Public self-service account creation is disabled. src/proxy.ts
// already bounces /signup → /login before this page can render; this
// redirect is a second line of defence so the account-creation form
// and its supabase.auth.signUp() call can never run, even if the
// proxy is bypassed or removed.
export default function SignupPage() {
  redirect("/login");
}
