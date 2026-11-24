'use client';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import Icon from './Icon';
import { useAuth, useLang, useMode, useT } from './Providers';

/** Always-visible estimate warning (required on every calculation screen). */
export function Disclaimer() {
  const t = useT();
  return <div className="notice" role="note"><Icon name="warn" size={16} /> <span>{t('disclaimer')}</span></div>;
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

/** Sections marked data-reveal enter once as they scroll into view (opacity + transform only), never again. */
export function RevealInit() {
  const path = usePathname();
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('[data-reveal]:not(.in)'));
    if (typeof IntersectionObserver === 'undefined') { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [path]);
  return null;
}

/** Number that counts from its previous value to the new one (400-600 ms). Shows the final value at once when motion is reduced or lite. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const { mode } = useMode();
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (mode === 'lite' || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(value); from.current = value; return; }
    const a = from.current, t0 = performance.now(), dur = 600;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span ref={ref} className="num">{format(value)}</span>;
}

/** Whole-number CountUp usable from server components (functions cannot cross that boundary). */
export function IntCount({ value }: { value: number }) {
  return <CountUp value={value} format={(n) => String(Math.round(n))} />;
}

/** Tell the shell that something went into the cart: the toast shows and the cart icon bounces. */
export const notifyCart = () => window.dispatchEvent(new Event('bmg:cart'));

export function CartToast() {
  const t = useT();
  const lang = useLang();
  const [on, setOn] = useState(false);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const h = () => { setOn(true); clearTimeout(id); id = setTimeout(() => setOn(false), 3200); };
    window.addEventListener('bmg:cart', h);
    return () => { window.removeEventListener('bmg:cart', h); clearTimeout(id); };
  }, []);
  return (
    <div className={`toast ${on ? 'on' : ''}`} role="status" aria-live="polite">
      {on && <><Icon name="check" /> <span>{t('cart.added')}</span> <a href={`/${lang}/cart`}>{t('nav.cart')}</a></>}
    </div>
  );
}
