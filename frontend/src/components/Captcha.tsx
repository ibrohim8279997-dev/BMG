'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

let siteKeyP: Promise<string> | null = null;
/** Captcha site key from the server ('' = captcha off). Fetched once per page load. */
export function useCaptchaKey() {
  const [key, setKey] = useState('');
  useEffect(() => {
    siteKeyP = siteKeyP ?? api('/api/v1/auth/providers').then((r) => r.captcha_site_key || '').catch(() => '');
    siteKeyP.then(setKey);
  }, []);
  return key;
}

/** Cloudflare Turnstile widget, shown only during registration when the server has captcha keys.
 *  Calls onToken with the token the server verifies (or '' when it expires). */
export default function Captcha({ siteKey, onToken, lang }: { siteKey: string; onToken: (t: string) => void; lang: string }) {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    let id: string | undefined;
    const render = () => {
      const ts = (window as any).turnstile;
      if (!ts || !slot.current) return;
      id = ts.render(slot.current, { sitekey: siteKey, language: lang, callback: onToken, 'expired-callback': () => onToken('') });
    };
    if ((window as any).turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => { if (id) (window as any).turnstile?.remove(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);
  if (!siteKey) return null;
  return <div ref={slot} style={{ margin: '12px 0', minHeight: 65 }} />;
}
