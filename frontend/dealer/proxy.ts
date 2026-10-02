import { NextResponse, type NextRequest } from 'next/server';

/** Send visitors without a session cookie to /login (the API still validates every call). */
export function proxy(req: NextRequest) {
  if (!req.cookies.has('srms_dealer')) return NextResponse.redirect(new URL('/login', req.url));
  return NextResponse.next();
}

// The service worker and manifest must load without a session (and never be redirected).
export const config = { matcher: ['/((?!api|login|_next|favicon.ico|icon.svg|manifest.webmanifest|dealer-sw.js).*)'] };
