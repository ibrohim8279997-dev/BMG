'use client';
import { useEffect, useState } from 'react';
import { useT } from './Providers';

/** Shown only where the browser offers to install the site as an app (Android Chrome and similar). */
export default function InstallButton() {
  const t = useT();
  const [evt, setEvt] = useState<any>(null);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (!evt) return null;
  return <button className="btn outline-light small" onClick={async () => { evt.prompt(); await evt.userChoice.catch(() => {}); setEvt(null); }}>{t('pwa.install')}</button>;
}
