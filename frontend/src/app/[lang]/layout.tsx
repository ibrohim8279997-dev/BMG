import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { LANGS, getDict, isLang } from '@/i18n';
import Providers from '@/components/Providers';
import Header, { ModeToggle } from '@/components/Header';
import { AskAI, RevealInit } from '@/components/Bits';
import ScrollFX from '@/components/ScrollFX';
import Link from 'next/link';
import { Cormorant_Garamond, Inter, Manrope } from 'next/font/google';
import FooterGroup from '@/components/FooterGroup';
import InstallButton from '@/components/InstallButton';
import Logo from '@/components/Logo';
import { serverApi } from '@/lib/api';
import './globals.css';
import './studio.css';

const body = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-body', display: 'swap' });
const heading = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-heading', display: 'swap', weight: ['600', '700', '800'] });

const display = Cormorant_Garamond({ subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-display-serif', display: 'swap', weight: ['400', '500', '600'], style: ['normal', 'italic'] });

// Every page carries a per-request CSP nonce on its inline scripts, so pages are rendered per request (never prerendered).
export const dynamic = 'force-dynamic';

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

const modeInit = `try{var p=localStorage.getItem('mode');var m=p==='full'||p==='lite'?p:'auto';if(m==='auto'){var n=navigator,c=n.connection||{};m=(c.saveData||/(^|-)2g$|3g/.test(c.effectiveType||'')||(n.deviceMemory&&n.deviceMemory<=2)||(n.hardwareConcurrency&&n.hardwareConcurrency<=2)||matchMedia('(prefers-reduced-motion: reduce)').matches||matchMedia('(prefers-reduced-data: reduce)').matches)?'lite':'full'}document.documentElement.dataset.mode=m}catch(e){}`;
const themeInit = `document.documentElement.classList.add('js');try{var m=localStorage.getItem('theme')||'system';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;

/** Fallback title/description for client-only pages (login, cart, account, admin); public pages override it with pageMeta. */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const d = getDict(lang);
  return { title: d['seo.home.title'], description: d['seo.home.desc'] };
}

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const dict = getDict(lang);
  const nonce = (await headers()).get('x-nonce') || undefined;
  const cfg = await serverApi<{ phone: string; telegram: string; email: string }>('/api/v1/config');
  const contacts = [cfg?.phone, cfg?.telegram, cfg?.email].filter(Boolean) as string[];
  return (
    <html lang={lang} suppressHydrationWarning className={`${body.variable} ${heading.variable} ${display.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f3f0ea" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#11100d" media="(prefers-color-scheme: dark)" />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit + modeInit }} />
      </head>
      <body>
        <Providers lang={lang} dict={dict}>
          <a className="skip" href="#main">{dict['skip']}</a>
          <Header />
          <main id="main" className="container main">{children}</main>
          <footer className="footer">
            <div className="container">
              <div className="foot-grid">
                <div><Logo size={40} /><p style={{ marginTop: 14, maxWidth: 380 }}>{dict['foot.tag']}</p><InstallButton /></div>
                <FooterGroup title={dict['foot.nav']}><ul>
                  <li><Link href={`/${lang}/catalog`}>{dict['nav.catalog']}</Link></li>
                  <li><Link href={`/${lang}/calculator`}>{dict['nav.calculator']}</Link></li>
                  <li><Link href={`/${lang}/sellers`}>{dict['nav.sellers']}</Link></li>
                  <li><Link href={`/${lang}/login`}>{dict['nav.login']}</Link></li></ul></FooterGroup>
                <FooterGroup title={dict['foot.company']}><ul>
                  <li><Link href={`/${lang}/about`}>{dict['nav.about']}</Link></li>
                  <li><Link href={`/${lang}/contacts`}>{dict['nav.contacts']}</Link></li>
                  <li><Link href={`/${lang}/become-seller`}>{dict['nav.become']}</Link></li></ul></FooterGroup>
                <FooterGroup title={dict['foot.legal']}><ul>
                  <li><Link href={`/${lang}/legal/privacy`}>{dict['foot.privacy']}</Link></li>
                  <li><Link href={`/${lang}/legal/terms`}>{dict['foot.terms']}</Link></li>
                  <li><Link href={`/${lang}/legal/cookies`}>{dict['foot.cookies']}</Link></li></ul></FooterGroup>
              </div>
              <div className="foot-bottom"><span>© BMG — Build Market Group</span><span>{dict['disclaimer']}</span><ModeToggle /></div>
            </div>
          </footer>
          <RevealInit />
          <ScrollFX />
          <AskAI />
        </Providers>
      </body>
    </html>
  );
}
