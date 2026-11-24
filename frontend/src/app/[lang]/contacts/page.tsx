import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

export const dynamic = 'force-dynamic';   // contacts are edited by staff; never frozen at build time

type P = { params: Promise<{ lang: Lang }> };

export async function generateMetadata({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '/contacts', t('contacts.title') + ' — BMG', t('contacts.sub'));
}

/** Only contact details that staff have actually entered are shown. */
export default async function Contacts({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  const cfg = await serverApi<{ phone?: string; telegram?: string; email?: string }>('/api/v1/config');
  const rows = [['phone', cfg?.phone], ['telegram', cfg?.telegram], ['email', cfg?.email]].filter(([, v]) => v) as [string, string][];
  return (
    <div style={{ maxWidth: 640 }}>
      <h1>{t('contacts.title')}</h1>
      <p className="muted">{t('contacts.sub')}</p>
      {rows.length === 0 ? (
        <div className="notice" role="status">{t('contacts.none')}</div>
      ) : (
        <div className="card">{rows.map(([k, v]) => (
          <div className="brk" key={k}><span className="muted">{t(`contacts.${k}`)}</span><b>{v}</b></div>
        ))}</div>
      )}
    </div>
  );
}
