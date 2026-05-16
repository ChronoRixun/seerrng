import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Replaces the server-side auth/redirect logic that previously lived in
 * `_app`'s getInitialProps. Moving it here lets pages be statically
 * optimized while preserving the original redirect behavior. The
 * client-side UserContext still revalidates the session on soft
 * navigations as a defense-in-depth fallback.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const apiBaseUrl = `http://${process.env.HOST || 'localhost'}:${
    process.env.PORT || 5055
  }`;

  let settings: { initialized?: boolean };
  try {
    const res = await fetch(`${apiBaseUrl}/api/v1/settings/public`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      return NextResponse.next();
    }
    settings = await res.json();
  } catch {
    // Backend not reachable (e.g. still starting up) — fail open and let
    // the client-side guards handle it rather than hard-failing every route.
    return NextResponse.next();
  }

  if (!settings.initialized) {
    if (!/(setup|login\/plex)/.test(pathname)) {
      return NextResponse.redirect(new URL('/setup', req.url));
    }
    return NextResponse.next();
  }

  let authed = false;
  try {
    const cookie = req.headers.get('cookie');
    const res = await fetch(`${apiBaseUrl}/api/v1/auth/me`, {
      headers: cookie ? { cookie } : undefined,
    });
    authed = res.ok;
  } catch {
    authed = false;
  }

  if (authed) {
    if (/(setup|login)/.test(pathname)) {
      return NextResponse.redirect(new URL('/', req.url));
    }
  } else if (!/(login|setup|resetpassword)/.test(pathname)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|imageproxy|avatarproxy|api-docs|_next|favicon.ico|.*\\.).*)',
  ],
};
