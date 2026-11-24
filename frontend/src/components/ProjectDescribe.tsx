'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorText } from './Bits';
import { useLang, useT } from './Providers';
import { api, money } from '@/lib/api';

type Fields = { type: string | null; area: number | null; floors: number | null; rooms: number | null; city: string | null };
type Result = { fields: Fields; zones: string[]; materials: { category: string; name: string; offer: null | { product_id: number; product: string; unit: string; seller: string; price: string } }[] };

const SR_LANG: Record<string, string> = { uz: 'uz-UZ', ru: 'ru-RU', en: 'en-US' };

/** "Describe the job in words": type it or dictate it (the browser's own speech recognition); AI fills the form and picks
 *  material categories. Prices shown are the sellers' offers, never the AI's. Nothing is applied until the client presses apply. */
export default function ProjectDescribe({ onApply }: { onApply: (fields: Fields, zones: string[]) => void }) {
  const t = useT();
  const lang = useLang();
  const [text, setText] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(false);
  const [canVoice, setCanVoice] = useState(false);
  const [applied, setApplied] = useState(false);
  const recRef = useRef<any>(null);
  const base = useRef('');

  useEffect(() => {
    const w = window as any;
    setCanVoice(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recRef.current?.stop?.();
  }, []);

  function toggleVoice() {
    if (rec) { recRef.current?.stop(); return; }
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    const r = new SR();
    r.lang = SR_LANG[lang] || 'ru-RU';
    r.interimResults = true;
    r.continuous = true;
    base.current = text ? `${text.trim()} ` : '';
    r.onresult = (e: any) => {
      let s = '';
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText((base.current + s).slice(0, 2000));
    };
    r.onerror = (e: any) => { setRec(false); setErr(e.error === 'not-allowed' ? 'forbidden' : 'server_error'); };
    r.onend = () => setRec(false);
    recRef.current = r;
    setErr(null); setRec(true);
    r.start();
  }

  async function go() {
    recRef.current?.stop?.();
    setBusy(true); setErr(null); setRes(null); setApplied(false);
    try { setRes(await api('/api/v1/ai/describe-project', { body: { text, lang } })); } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }

  const f = res?.fields;
  const known = f ? Object.values(f).some((v) => v !== null) : false;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3>{t('voice.title')}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>{t('voice.hint')}</p>
      <div className="field"><label htmlFor="pd">{t('voice.label')}</label>
        <textarea id="pd" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('voice.placeholder')} /></div>
      <div className="actions" style={{ marginTop: 0 }}>
        {canVoice && <button type="button" className={`btn ghost mic ${rec ? 'rec' : ''}`} onClick={toggleVoice} aria-pressed={rec}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          {rec ? t('voice.stop') : t('voice.speak')}</button>}
        <button className="btn" disabled={busy || !text.trim()} onClick={go}>{busy ? '…' : t('voice.go')}</button>
      </div>
      {canVoice && <p className="muted small">{t('voice.privacy')}</p>}
      <ErrorText code={err} />
      {res && (
        <div style={{ marginTop: 12 }}>
          {!known && res.materials.length === 0 && <p className="muted">{t('voice.nothing')}</p>}
          {known && f && (
            <p>{[f.type && t(`type.${f.type}`), f.area !== null && `${f.area} ${t('voice.m2')}`, f.floors !== null && `${f.floors} ${t('voice.floors')}`,
              f.rooms !== null && `${f.rooms} ${t('voice.rooms')}`, f.city].filter(Boolean).join(' · ')}
              {res.zones.length > 0 && <> · {res.zones.map((z) => t(`zone.${z}`)).join(', ')}</>}</p>)}
          {known && <button className="btn small" disabled={applied} onClick={() => { onApply(res.fields, res.zones); setApplied(true); }}>{applied ? `✓ ${t('voice.applied')}` : t('voice.apply')}</button>}
          {res.materials.length > 0 && (
            <div className="mats">
              <strong>{t('voice.materials')}</strong>
              {res.materials.map((m) => (
                <div className="mat" key={m.category}>
                  <span>{m.name}</span>
                  {m.offer ? <Link href={`/${lang}/product/${m.offer.product_id}`}>{m.offer.product} · {money(m.offer.price, lang)}{m.offer.unit && ` / ${m.offer.unit}`} · {m.offer.seller}</Link>
                           : <span className="muted">{t('calc.no_offer')}</span>}
                </div>))}
              <p className="muted small" style={{ margin: 0 }}>{t('voice.prices_note')}</p>
            </div>)}
        </div>)}
    </div>
  );
}
