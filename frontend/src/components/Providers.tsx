'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Dict, Lang, translate } from '@/i18n';
import { api } from '@/lib/api';
import { Mode, ModePref, readPref, resolveMode } from '@/lib/mode';

type I18n = { lang: Lang; dict: Dict };
const I18nCtx = createContext<I18n>({ lang: 'ru', dict: {} });
export const useLang = () => useContext(I18nCtx).lang;
export function useT() {
  const { dict } = useContext(I18nCtx);
  return useCallback((k: string, vars?: Record<string, string | number>) => translate(dict, k, vars), [dict]);
}

export type Me = { id: number; phone: string; role: string; language: string; is_staff: boolean; seller_status: string | null };
type Auth = { me: Me | null; loading: boolean; refresh: () => Promise<void> };
const AuthCtx = createContext<Auth>({ me: null, loading: true, refresh: async () => {} });
export const useAuth = () => useContext(AuthCtx);

type ModeCtxT = { pref: ModePref; mode: Mode; setPref: (p: ModePref) => void };
const ModeCtx = createContext<ModeCtxT>({ pref: 'auto', mode: 'full', setPref: () => {} });
export const useMode = () => useContext(ModeCtx);

export default function Providers({ lang, dict, children }: { lang: Lang; dict: Dict; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [pref, setPrefState] = useState<ModePref>('auto');
  const [mode, setModeState] = useState<Mode>('full');
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/api/v1/me')); } catch { setMe(null); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const p = readPref(); setPrefState(p); setModeState(resolveMode(p)); }, []);
  const setPref = useCallback((p: ModePref) => {
    setPrefState(p);
    const m = resolveMode(p);
    setModeState(m);
    document.documentElement.dataset.mode = m;
    try { localStorage.setItem('mode', p); } catch { /* private mode */ }
  }, []);
  useEffect(() => {   // installable app: only in production, only where supported
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  useEffect(() => { document.cookie = `lang=${lang}; path=/; max-age=31536000; samesite=lax`; }, [lang]);
  return (
    <I18nCtx.Provider value={{ lang, dict }}>
      <ModeCtx.Provider value={{ pref, mode, setPref }}>
        <AuthCtx.Provider value={{ me, loading, refresh }}>{children}</AuthCtx.Provider>
      </ModeCtx.Provider>
    </I18nCtx.Provider>
  );
}
