'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ErrorText } from '@/components/Bits';
import { useAuth, useLang, useT } from '@/components/Providers';
import { api } from '@/lib/api';

/** Landing page for the one-time sign-in link the Telegram bot sends. The token is single-use and expires in 5 min.
 *  The link is not tied to the browser that asked for it, so a forwarded link could sign someone into the sender's
 *  account: the page shows whose account it is and signs in only after the person confirms. */
export default function BotLinkLogin() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { refresh } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const token = useRef('');
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    token.current = new URLSearchParams(window.location.search).get('token') || '';
    window.history.replaceState(null, '', window.location.pathname);   // drop the token from the address bar
    api('/api/v1/auth/bot-token', { body: { token: token.current, preview: true } })
      .then((r) => setAccount(r.account || ''))
      .catch((e) => setErr(e.error));
  }, []);

  async function signIn() {
    setBusy(true);
    try {
      const u = await api('/api/v1/auth/bot-token', { body: { token: token.current } });
      await refresh();
      router.replace(u.role === 'seller' ? `/${lang}/seller` : `/${lang}`);
    } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }

  return (
    <div className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
      <h1>{t('login.title')}</h1>
      {err ? <><ErrorText code={err} /><p className="muted small">{t('login.bot_link_again')}</p></>
        : account ? <>
          <p>{t('login.bot_confirm', { account })}</p>
          <button className="btn" disabled={busy} onClick={signIn}>{t('login.enter')}</button>
          <p className="muted small">{t('login.bot_not_you')}</p>
        </> : <p className="muted">{t('login.bot_link_wait')}</p>}
    </div>
  );
}
