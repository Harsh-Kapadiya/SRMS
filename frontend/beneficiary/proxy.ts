import { NextResponse, type NextRequest } from 'next/server';

/** Send visitors without a session cookie straight to /login (the API still validates every call). */
export function proxy(req: NextRequest) {
  if (!req.cookies.has('srms_beneficiary')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|login|register|_next|favicon.ico|icon.svg|manifest.webmanifest).*)'],
};
