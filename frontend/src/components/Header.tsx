'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LANGS } from '@/i18n';
import { api } from '@/lib/api';
import Logo from './Logo';
import { useAuth, useLang, useT } from './Providers';

function ThemeToggle() {
  const t = useT();
  const [mode, setMode] = useState<'system' | 'light' | 'dark'>('system');
  useEffect(() => {
    try { setMode((localStorage.getItem('theme') as any) || 'system'); } catch { /* private mode */ }
  }, []);
  function apply(m: 'system' | 'light' | 'dark') {
    setMode(m);
    try { localStorage.setItem('theme', m); } catch { /* ignore */ }
    const dark = m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }
  const next = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
  return (
    <button className="btn ghost" onClick={() => apply(next)} aria-label={t('theme.toggle')} title={t('theme.toggle')}>
      {mode === 'system' ? t('theme.system') : mode === 'light' ? t('theme.light') : t('theme.dark')}
    </button>
  );
}

export default function Header() {
  const t = useT();
  const lang = useLang();
  const path = usePathname();
  const router = useRouter();
  const { me, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const rest = path.replace(/^\/(uz|ru|en)/, '') || '';
  async function logout() {
    await api('/api/v1/auth/logout', { method: 'POST' });
    await refresh();
    router.push(`/${lang}`);
  }
  const L = (p: string) => `/${lang}${p}`;
  return (
    <header className="header">
      <div className="container bar">
        <Link href={L('')} className="logo"><Logo /></Link>
        <button className="btn ghost burger" onClick={() => setOpen(!open)} aria-label="menu">☰</button>
        <nav className={`nav ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
          <Link href={L('/catalog')}>{t('nav.catalog')}</Link>
          <Link href={L('/calculator')}>{t('nav.calculator')}</Link>
          {me?.role === 'client' && <Link href={L('/cart')}>{t('nav.cart')}</Link>}
          {me?.role === 'client' && <Link href={L('/account')}>{t('nav.account')}</Link>}
          {me?.role === 'seller' && <Link href={L('/seller')}>{t('nav.seller')}</Link>}
          {me ? <button className="btn ghost" onClick={logout}>{t('nav.logout')}</button>
              : <Link className="btn" href={L('/login')}>{t('nav.login')}</Link>}
        </nav>
        <div className="tools">
          <ThemeToggle />
          <select className="lang" value={lang} aria-label="language"
                  onChange={(e) => router.push(`/${e.target.value}${rest}`)}>
            {LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      </div>
    </header>
  );
}
