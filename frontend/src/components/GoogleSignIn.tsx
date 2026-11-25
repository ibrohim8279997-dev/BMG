'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ErrorText } from './Bits';
import Captcha, { useCaptchaKey } from './Captcha';
import { useAuth, useLang, useT } from './Providers';
import { api } from '@/lib/api';
import { nextFromLocation } from '@/lib/pending';

/** "Continue with Google". Rendered only when the server has a Google client id. New accounts still choose a role and accept
 *  the policies; an existing Google account signs in directly. The ID token goes to our server, which verifies it with Google. */
export default function GoogleSignIn() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { refresh } = useAuth();
  const slot = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState('');
  const [cred, setCred] = useState('');
  const [role, setRole] = useState('client');
  const [company, setCompany] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [needReg, setNeedReg] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const captchaKey = useCaptchaKey();
  const [captcha, setCaptcha] = useState('');

  useEffect(() => { api('/api/v1/auth/providers').then((r) => setClientId(r.google_client_id || '')).catch(() => {}); }, []);

  async function send(credential: string, reg: boolean) {
    setErr(null);
    try {
      await api('/api/v1/auth/google', { body: { credential, language: lang, ...(reg ? { role, company_name: company, accept_privacy: privacy, accept_terms: terms, captcha } : {}) } });
      await refresh();
      router.push(reg && role === 'seller' ? `/${lang}/seller` : nextFromLocation() || `/${lang}`);
    } catch (e: any) {
      if (e.error === 'registration_required') { setNeedReg(true); setCred(credential); } else setErr(e.error);
    }
  }

  useEffect(() => {
    if (!clientId) return;
    const init = () => {
      const g = (window as any).google?.accounts?.id;
      if (!g || !slot.current) return;
      g.initialize({ client_id: clientId, callback: (r: any) => send(r.credential, false) });
      g.renderButton(slot.current, { type: 'standard', theme: 'outline', size: 'large', width: 300, locale: lang });
    };
    if ((window as any).google?.accounts?.id) { init(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <p className="muted small" style={{ textAlign: 'center', margin: '0 0 10px' }}>{t('login.or')}</p>
      <div ref={slot} style={{ display: 'grid', placeItems: 'center', minHeight: 44 }} />
      {needReg && (
        <div style={{ marginTop: 14 }}>
          <p><strong>{t('login.register')}</strong></p>
          <div className="field"><label htmlFor="grl">{t('login.role')}</label>
            <select id="grl" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="client">{t('role.client')}</option><option value="seller">{t('role.seller')}</option></select></div>
          {role === 'seller' && <div className="field"><label htmlFor="gco">{t('login.company')}</label>
            <input id="gco" maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} /></div>}
          <label className="check"><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
            <span>{t('login.accept')} <Link href={`/${lang}/legal/privacy`} target="_blank">{t('legal.privacy')}</Link></span></label>
          <label className="check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <span>{t('login.accept')} <Link href={`/${lang}/legal/terms`} target="_blank">{t('legal.terms')}</Link></span></label>
          <Captcha siteKey={captchaKey} onToken={setCaptcha} lang={lang} />
          <div className="actions"><button className="btn" disabled={!(privacy && terms) || (!!captchaKey && !captcha)} onClick={() => send(cred, true)}>{t('login.enter')}</button></div>
        </div>)}
      <ErrorText code={err} />
    </div>
  );
}
