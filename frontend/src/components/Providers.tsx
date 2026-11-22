'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Dict, Lang, translate } from '@/i18n';
import { api } from '@/lib/api';

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

export default function Providers({ lang, dict, children }: { lang: Lang; dict: Dict; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>('/api/v1/me')); } catch { setMe(null); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { document.cookie = `lang=${lang}; path=/; max-age=31536000; samesite=lax`; }, [lang]);
  return (
    <I18nCtx.Provider value={{ lang, dict }}>
      <AuthCtx.Provider value={{ me, loading, refresh }}>{children}</AuthCtx.Provider>
    </I18nCtx.Provider>
  );
}
