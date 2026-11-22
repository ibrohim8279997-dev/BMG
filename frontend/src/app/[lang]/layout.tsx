import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { LANGS, getDict, isLang } from '@/i18n';
import Providers from '@/components/Providers';
import Header from '@/components/Header';
import { AskAI } from '@/components/Bits';
import './globals.css';

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

const themeInit = `try{var m=localStorage.getItem('theme')||'system';var d=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const dict = getDict(lang);
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <Providers lang={lang} dict={dict}>
          <Header />
          <main className="container main">{children}</main>
          <footer className="footer"><div className="container">© BMG — Build Market Group</div></footer>
          <AskAI />
        </Providers>
      </body>
    </html>
  );
}
