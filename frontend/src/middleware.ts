import { NextRequest, NextResponse } from 'next/server';
import { buildCsp, makeNonce } from '@/lib/csp';

const LANGS = ['uz', 'ru', 'en'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (LANGS.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) {
    const nonce = makeNonce();
    const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== 'production', google: !!process.env.GOOGLE_CLIENT_ID, captcha: !!process.env.TURNSTILE_SITE_KEY });
    const headers = new Headers(req.headers);
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set('Content-Security-Policy', csp);
    return res;
  }
  const saved = req.cookies.get('lang')?.value;
  const accept = (req.headers.get('accept-language') || '').toLowerCase();
  const guess = LANGS.find((l) => accept.startsWith(l) || accept.includes(`,${l}`)) || 'ru';
  const lang = saved && LANGS.includes(saved) ? saved : guess;
  const url = req.nextUrl.clone();
  url.pathname = `/${lang}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!api|admin-api|_next|sitemap.xml|robots.txt|.*\\..*).*)'] };
