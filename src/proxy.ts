import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Public self-service signup is disabled. Bounce every attempt to
  // reach /signup — typed directly, or via a stale /signup link — to
  // /login. Query params are preserved (e.g. ?invite=...) so the
  // login page's invite forwarding logic below still routes signed-in
  // users on to /join/<token>.
  if (request.nextUrl.pathname === '/signup') {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (inviteToken && request.nextUrl.pathname === '/login') {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/admin', '/agents', '/flows', '/notifications', '/join', '/whatsapp', '/instagram', '/facebook', '/profile']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Customer profile shortcut → settings?tab=profile
  if (user && request.nextUrl.pathname === '/profile') {
    const url = request.nextUrl.clone()
    url.pathname = '/settings'
    url.searchParams.set('tab', 'profile')
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // ----------------------------------------------------------------
  // PLATFORM ROLE ENFORCEMENT
  //
  // Once authenticated, we resolve the user's platform_role and
  // enforce route access:
  //
  //   - /admin/*  → super_admin only
  //   - customer  → must NOT reach /admin/* or admin-only API routes
  // ----------------------------------------------------------------
  if (user) {
    try {
      // Fetch the platform role from profiles.
      // Gracefully handle missing column (pre-migration 047) by
      // falling back to a query without platform_role — in that
      // case every user is treated as 'customer'.
      const primaryProfile = await supabase
        .from('profiles')
        .select('platform_role')
        .eq('user_id', user.id)
        .maybeSingle()

      let platformRole: string = 'customer'

      if (primaryProfile.error && primaryProfile.error.code === '42703') {
        // platform_role column does not exist yet — default to customer
      } else if (primaryProfile.data) {
        platformRole = primaryProfile.data.platform_role ?? 'customer'
      }

      // Customers must not access the admin area
      if (platformRole !== 'super_admin' && request.nextUrl.pathname.startsWith('/admin')) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return withRefreshedCookies(NextResponse.redirect(url))
      }

      // Customers must not access admin-only API routes
      if (platformRole !== 'super_admin' &&
          request.nextUrl.pathname.startsWith('/api/admin')) {
        return withRefreshedCookies(
          NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        )
      }
    } catch {
      // If profile lookup fails (edge case, test environment, or
      // missing column), let the request through — the server-side
      // API checks will catch unauthorized access.
    }
  }

  // API routes that need auth (not webhooks)
  if (!user && request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
      !request.nextUrl.pathname.includes('/webhook')) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
