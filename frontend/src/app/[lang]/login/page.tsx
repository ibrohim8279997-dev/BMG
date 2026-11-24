'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorText } from '@/components/Bits';
import GoogleSignIn from '@/components/GoogleSignIn';
import { useAuth, useLang, useT } from '@/components/Providers';
import { api } from '@/lib/api';
import { nextFromLocation } from '@/lib/pending';

export default function Login() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { refresh } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+998');
  const [code, setCode] = useState('');
  const [needReg, setNeedReg] = useState(false);
  const [role, setRole] = useState('client');
  const [company, setCompany] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [botUrl, setBotUrl] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setBusy(true); setErr(null); setBotUrl('');
    try {
      const r = await api('/api/v1/auth/request-code', { body: { phone } });
      setDevCode(r.dev_code || ''); setStep('code');
    } catch (e: any) {
      setErr(e.error);
      if (e.error === 'telegram_not_linked') setBotUrl(e.data?.bot_url || '');
    }
    setBusy(false);
  }
  async function verify() {
    setBusy(true); setErr(null);
    try {
      await api('/api/v1/auth/verify', {
        body: { phone, code, language: lang, ...(needReg ? { role, company_name: company, accept_privacy: privacy, accept_terms: terms } : {}) },
      });
      await refresh();
      router.push(role === 'seller' && needReg ? `/${lang}/seller` : nextFromLocation() || `/${lang}`);
    } catch (e: any) {
      if (e.error === 'registration_required') setNeedReg(true);
      else setErr(e.error);
    }
    setBusy(false);
  }
  return (
    <div className="card" style={{ maxWidth: 460, margin: '0 auto' }}>
      <h1>{t('login.title')}</h1>
      {step === 'phone' ? (
        <>
          <div className="field"><label htmlFor="ph">{t('login.phone')}</label>
            <input id="ph" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></div>
          <button className="btn" disabled={busy} onClick={requestCode}>{t('login.get_code')}</button>
          <ErrorText code={err} />
          {err === 'telegram_not_linked' && (
            <div className="notice">{t('login.link_bot')} {botUrl && <a href={botUrl} target="_blank" rel="noopener noreferrer"><strong>{botUrl}</strong></a>}</div>)}
          <p className="muted small">{t('login.how')}</p>
          <GoogleSignIn />
        </>
      ) : (
        <>
          <p className="muted">{t('login.code_sent')}</p>
          {devCode && <p className="notice">DEV: {devCode}</p>}
          <div className="field"><label htmlFor="cd">{t('login.code')}</label>
            <input id="cd" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></div>
          {needReg && (
            <>
              <p><strong>{t('login.register')}</strong></p>
              <div className="field"><label htmlFor="rl">{t('login.role')}</label>
                <select id="rl" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="client">{t('role.client')}</option><option value="seller">{t('role.seller')}</option></select></div>
              {role === 'seller' && <div className="field"><label htmlFor="co">{t('login.company')}</label>
                <input id="co" maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} /></div>}
              <label className="check"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
                <span>{t('login.accept')} <Link href={`/${lang}/legal/privacy`} target="_blank">{t('legal.privacy')}</Link></span></label>
              <label className="check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>{t('login.accept')} <Link href={`/${lang}/legal/terms`} target="_blank">{t('legal.terms')}</Link></span></label>
            </>
          )}
          <div className="actions">
            <button className="btn" disabled={busy || code.length < 6 || (needReg && !(privacy && terms))} onClick={verify}>{t('login.enter')}</button>
            <button className="btn ghost" onClick={() => { setStep('phone'); setCode(''); setNeedReg(false); }}>{t('back')}</button>
          </div>
          <ErrorText code={err} />
        </>
      )}
    </div>
  );
}
