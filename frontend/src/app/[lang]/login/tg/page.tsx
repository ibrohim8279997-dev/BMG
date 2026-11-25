'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ErrorText } from '@/components/Bits';
import { useAuth, useLang, useT } from '@/components/Providers';
import { api } from '@/lib/api';

/** Landing page for the one-time sign-in link the Telegram bot sends. The token is single-use and expires in 5 min. */
export default function BotLinkLogin() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { refresh } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = new URLSearchParams(window.location.search).get('token') || '';
    window.history.replaceState(null, '', window.location.pathname);   // drop the token from the address bar
    api('/api/v1/auth/bot-token', { body: { token } })
      .then(async (u) => { await refresh(); router.replace(u.role === 'seller' ? `/${lang}/seller` : `/${lang}`); })
      .catch((e) => setErr(e.error));
  }, [lang, refresh, router]);

  return (
    <div className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
      <h1>{t('login.title')}</h1>
      {err ? <><ErrorText code={err} /><p className="muted small">{t('login.bot_link_again')}</p></> : <p className="muted">{t('login.bot_link_wait')}</p>}
    </div>
  );
}
