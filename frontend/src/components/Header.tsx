'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LANGS } from '@/i18n';
import { api } from '@/lib/api';
import { CartToast } from './Bits';
import Icon from './Icon';
import Logo from './Logo';
import { useAuth, useLang, useMode, useT } from './Providers';

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
    <button className="btn ghost" onClick={() => apply(next)} aria-label={`${mode === 'system' ? t('theme.system') : mode === 'light' ? t('theme.light') : t('theme.dark')} · ${t('theme.toggle')}`} title={t('theme.toggle')}>
      {mode === 'system' ? t('theme.system') : mode === 'light' ? t('theme.light') : t('theme.dark')}
    </button>
  );
}

export function ModeToggle() {
  const t = useT();
  const { pref, mode, setPref } = useMode();
  const next = pref === 'auto' ? 'full' : pref === 'full' ? 'lite' : 'auto';
  return (
    <button className="btn ghost" onClick={() => setPref(next)} aria-label={`${pref === 'auto' ? `${t('mode.auto')} · ${t(`mode.${mode}`)}` : t(`mode.${pref}`)} · ${t('mode.toggle')}`} title={t('mode.toggle')}>
      {pref === 'auto' ? `${t('mode.auto')} · ${t(`mode.${mode}`)}` : t(`mode.${pref}`)}
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
  const [bump, setBump] = useState(false);
  useEffect(() => {
    const h = () => { setBump(false); requestAnimationFrame(() => setBump(true)); };
    window.addEventListener('bmg:cart', h);
    return () => window.removeEventListener('bmg:cart', h);
  }, []);
  const rest = path.replace(/^\/(uz|ru|en)/, '') || '';
  async function logout() {
    await api('/api/v1/auth/logout', { method: 'POST' });
    await refresh();
    router.push(`/${lang}`);
  }
  const L = (p: string) => `/${lang}${p}`;
  const cur = (p: string) => (rest === p || rest.startsWith(p + '/') ? 'cur' : undefined);
  return (
    <>
    <header className={`header ${bump ? 'bump' : ''}`}>
      <div className="container bar">
        <Link href={L('')} className="logo"><Logo /></Link>
        <button className="btn ghost burger" onClick={() => setOpen(!open)} aria-label={t('menu')} aria-expanded={open}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
        </button>
        <nav className={`nav ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
          <Link className={cur('/catalog')} href={L('/catalog')}>{t('nav.catalog')}</Link>
          <Link className={cur('/calculator')} href={L('/calculator')}>{t('nav.calculator')}</Link>
          <Link className={cur('/sellers')} href={L('/sellers')}>{t('nav.sellers')}</Link>
          <Link className={cur('/contacts')} href={L('/contacts')}>{t('nav.contacts')}</Link>
          {me?.role === 'client' && <Link className={cur('/cart')} href={L('/cart')}><Icon name="cart" className="cart-ico" /> {t('nav.cart')}</Link>}
          {me?.role === 'client' && <Link className={cur('/account')} href={L('/account')}>{t('nav.account')}</Link>}
          {me?.role === 'seller' && <Link className={cur('/seller')} href={L('/seller')}>{t('nav.seller')}</Link>}
          {me?.role !== 'seller' && <Link className="btn ghost" href={L('/become-seller')}>{t('nav.become')}</Link>}
          {me ? <button className="btn ghost" onClick={logout}>{t('nav.logout')}</button>
              : <Link className="btn" href={L('/login')}>{t('nav.login')}</Link>}
        </nav>
        <div className={`tools ${open ? 'open' : ''}`}>
          <ThemeToggle />
          <select className="lang" value={lang} aria-label="language"
                  onChange={(e) => router.push(`/${e.target.value}${rest}`)}>
            {LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </div>
      </div>
    </header>
    <CartToast />
    </>
  );
}
