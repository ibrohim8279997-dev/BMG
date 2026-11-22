'use client';
import { useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth, useLang, useT } from './Providers';

/** Always-visible estimate warning (required on every calculation screen). */
export function Disclaimer() {
  const t = useT();
  return <div className="notice" role="note">⚠ {t('disclaimer')}</div>;
}

export function ErrorText({ code }: { code: string | null }) {
  const t = useT();
  if (!code) return null;
  return <p className="error" role="alert">{t(`err.${code}`) === `err.${code}` ? t('err.server_error') : t(`err.${code}`)}</p>;
}

export function RequireAuth({ role, children }: { role?: string; children: ReactNode }) {
  const { me, loading } = useAuth();
  const lang = useLang();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me) router.replace(`/${lang}/login`);
  }, [loading, me, lang, router]);
  if (loading || !me) return <p className="muted">…</p>;
  if (role && me.role !== role) return <p className="error">403</p>;
  return <>{children}</>;
}

export function AskAI() {
  const t = useT();
  const lang = useLang();
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [ans, setAns] = useState<{ answer: string; disclaimer: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!me) return null;
  async function ask() {
    setBusy(true); setErr(null);
    try { setAns(await api('/api/v1/ai/ask', { body: { question: q, lang } })); }
    catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  return (
    <div className="ask">
      {open && (
        <div className="card ask-box">
          <strong>{t('ai.title')}</strong>
          <textarea value={q} maxLength={2000} onChange={(e) => setQ(e.target.value)} placeholder={t('ai.placeholder')} />
          <button className="btn" disabled={busy || !q.trim()} onClick={ask}>{busy ? '…' : t('ai.send')}</button>
          <ErrorText code={err} />
          {ans && <><p className="ai-answer">{ans.answer}</p><p className="muted small">{ans.disclaimer}</p></>}
        </div>
      )}
      <button className="btn fab" onClick={() => setOpen(!open)}>{t('ai.open')}</button>
    </div>
  );
}
