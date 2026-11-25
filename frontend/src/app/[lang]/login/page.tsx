'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorText } from '@/components/Bits';
import Captcha, { useCaptchaKey } from '@/components/Captcha';
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
  const [method, setMethod] = useState<'tg' | 'email'>('tg');
  const [email, setEmail] = useState('');
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
  const [regBot, setRegBot] = useState('');
  const captchaKey = useCaptchaKey();
  const [captcha, setCaptcha] = useState('');
  useEffect(() => { api('/api/v1/auth/providers').then((r) => setRegBot(r.telegram_bot_url || '')).catch(() => {}); }, []);

  async function requestCode() {
    setBusy(true); setErr(null); setBotUrl('');
    try {
      const r = await api(method === 'email' ? '/api/v1/auth/email/request-code' : '/api/v1/auth/request-code', { body: method === 'email' ? { email } : { phone } });
      setDevCode(r.dev_code || ''); setBotUrl(r.bot_url || ''); setStep('code');
    } catch (e: any) {
      setErr(e.error);
      if (e.error === 'telegram_not_linked') setBotUrl(e.data?.bot_url || '');
    }
    setBusy(false);
  }
  async function verify() {
    setBusy(true); setErr(null);
    try {
      await api(method === 'email' ? '/api/v1/auth/email/verify' : '/api/v1/auth/verify', {
        body: { ...(method === 'email' ? { email } : { phone }), code, language: lang, ...(needReg ? { role, company_name: company, accept_privacy: privacy, accept_terms: terms, captcha } : {}) },
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
          <div className="actions" role="tablist" style={{ marginBottom: 12 }}>
            <button role="tab" aria-selected={method === 'tg'} className={`btn small${method === 'tg' ? '' : ' ghost'}`} onClick={() => { setMethod('tg'); setErr(null); }}>{t('login.tab_phone')}</button>
            <button role="tab" aria-selected={method === 'email'} className={`btn small${method === 'email' ? '' : ' ghost'}`} onClick={() => { setMethod('email'); setErr(null); }}>{t('login.tab_email')}</button>
          </div>
          {method === 'tg' ? (
            <div className="field"><label htmlFor="ph">{t('login.phone')}</label>
              <input id="ph" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" /></div>
          ) : (
            <div className="field"><label htmlFor="em">{t('login.email')}</label>
              <input id="em" type="email" inputMode="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
          )}
          <button className="btn" disabled={busy || (method === 'email' && !email.includes('@'))} onClick={requestCode}>{method === 'email' ? t('login.get_email_code') : t('login.get_code')}</button>
          <ErrorText code={err} />
          {err === 'telegram_not_linked' && (
            <div className="notice">{t('login.link_bot')} {botUrl && <a href={botUrl} target="_blank" rel="noopener noreferrer"><strong>{botUrl}</strong></a>}</div>)}
          <p className="muted small">{method === 'tg' ? t('login.how') : t('login.code_sent_email')}</p>
          {regBot && <p className="small"><a href={regBot} target="_blank" rel="noopener noreferrer">{t('login.register_in_bot')}</a></p>}
          <GoogleSignIn />
        </>
      ) : (
        <>
          <p className="muted">{method === 'email' ? t('login.code_sent_email') : t('login.code_sent')}</p>
          {devCode && <p className="notice">DEV: {devCode}</p>}
          {method === 'tg' && botUrl && (
            <p className="muted small">{t('login.no_code')} {t('login.link_bot')} <a href={botUrl} target="_blank" rel="noopener noreferrer">{botUrl}</a></p>)}
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
              <Captcha siteKey={captchaKey} onToken={setCaptcha} lang={lang} />
            </>
          )}
          <div className="actions">
            <button className="btn" disabled={busy || code.length < 6 || (needReg && (!(privacy && terms) || (!!captchaKey && !captcha)))} onClick={verify}>{t('login.enter')}</button>
            <button className="btn ghost" onClick={() => { setStep('phone'); setCode(''); setNeedReg(false); }}>{t('back')}</button>
          </div>
          <ErrorText code={err} />
        </>
      )}
    </div>
  );
}
