import { NextRequest, NextResponse } from 'next/server';

const LANGS = ['uz', 'ru', 'en'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (LANGS.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))) return;
  const saved = req.cookies.get('lang')?.value;
  const accept = (req.headers.get('accept-language') || '').toLowerCase();
  const guess = LANGS.find((l) => accept.startsWith(l) || accept.includes(`,${l}`)) || 'ru';
  const lang = saved && LANGS.includes(saved) ? saved : guess;
  const url = req.nextUrl.clone();
  url.pathname = `/${lang}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!api|admin-api|_next|sitemap.xml|robots.txt|.*\\..*).*)'] };
