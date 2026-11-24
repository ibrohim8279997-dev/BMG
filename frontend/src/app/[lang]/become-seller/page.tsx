'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorText } from '@/components/Bits';
import Icon from '@/components/Icon';
import { useLang, useT } from '@/components/Providers';
import { api } from '@/lib/api';

const EMPTY = { company_name: '', contact_name: '', phone: '+998', email: '', category: '', comment: '' };

/** Public "become a seller" form: stored in the database for staff review (statuses: new / in progress / approved / rejected). */
export default function BecomeSeller() {
  const t = useT();
  const lang = useLang();
  const [f, setF] = useState(EMPTY);
  const [privacy, setPrivacy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setFields({});
    try {
      await api('/api/v1/seller-applications', { body: { ...f, accept_privacy: privacy, language: lang } });
      setDone(true); setF(EMPTY); setPrivacy(false);
    } catch (x: any) {
      setFields(x.data?.fields || {});
      setErr(x.error === 'invalid_request' ? null : x.error);   // field errors are shown under their fields; the form keeps what was typed
    }
    setBusy(false);
  }
  const fe = (k: string) => (fields[k] ? <p className="error" id={`e-${k}`} role="alert">{t(`field.${fields[k]}`)}</p> : null);
  const inp = (k: keyof typeof EMPTY, label: string, extra: any = {}) => (
    <div className="field"><label htmlFor={`a-${k}`}>{label}</label>
      <input id={`a-${k}`} value={f[k]} onChange={set(k)} aria-invalid={!!fields[k]} aria-describedby={fields[k] ? `e-${k}` : undefined} {...extra} />{fe(k)}</div>
  );
  if (done) {
    return (
      <div className="card" style={{ maxWidth: 560 }} role="status">
        <h1 style={{ fontSize: '1.8rem' }}><Icon name="check" size={26} /> {t('apply.ok.t')}</h1>
        <p>{t('apply.ok.d')}</p>
        <div className="actions"><button className="btn ghost" onClick={() => setDone(false)}>{t('apply.again')}</button>
          <Link className="btn" href={`/${lang}/catalog`}>{t('home.catalog')}</Link></div>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 640 }}>
      <h1>{t('apply.title')}</h1>
      <p className="muted">{t('apply.sub')}</p>
      <form className="card" onSubmit={submit} noValidate>
        {inp('company_name', t('apply.company'), { maxLength: 200, autoComplete: 'organization' })}
        {inp('contact_name', t('apply.contact'), { maxLength: 120, autoComplete: 'name' })}
        {inp('phone', t('apply.phone'), { inputMode: 'tel', autoComplete: 'tel', maxLength: 20 })}
        {inp('email', t('apply.email'), { type: 'email', autoComplete: 'email', maxLength: 254 })}
        {inp('category', t('apply.category'), { maxLength: 120 })}
        <div className="field"><label htmlFor="a-comment">{t('apply.comment')}</label>
          <textarea id="a-comment" value={f.comment} onChange={set('comment')} maxLength={2000} />{fe('comment')}</div>
        <label className="check"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} aria-invalid={!!fields.accept_privacy} />
          <span>{t('apply.privacy')} <Link href={`/${lang}/legal/privacy`} target="_blank">{t('foot.privacy')}</Link></span></label>
        {fe('accept_privacy')}
        <ErrorText code={err} />
        <button className={`btn lg block ${busy ? 'busy' : ''}`} style={{ marginTop: 14 }} disabled={busy}>{busy ? t('apply.sending') : t('apply.submit')}</button>
      </form>
    </div>
  );
}
