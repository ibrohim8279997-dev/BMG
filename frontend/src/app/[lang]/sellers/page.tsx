import Link from 'next/link';
import Icon from '@/components/Icon';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang }>; searchParams: Promise<{ q?: string }> };
type Row = { id: number; company_name: string; description: string; categories: string[]; regions: string[]; verified_by_bmg: boolean };

export async function generateMetadata({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '/sellers', t('sellers.title') + ' — BMG', t('sellers.sub'));
}

export default async function Sellers({ params, searchParams }: P) {
  const { lang } = await params;
  const { q = '' } = await searchParams;
  const t = serverT(lang);
  const rows = await serverApi<Row[]>(`/api/v1/sellers?lang=${lang}&q=${encodeURIComponent(q.slice(0, 80))}`);
  return (
    <>
      <h1>{t('sellers.title')}</h1>
      <p className="muted">{t('sellers.sub')}</p>
      <form action={`/${lang}/sellers`} className="row searchrow" style={{ margin: '14px 0 22px', maxWidth: 560 }}>
        <input name="q" defaultValue={q} maxLength={80} placeholder={t('sellers.search')} aria-label={t('sellers.search')} />
        <button className="btn" style={{ flex: '0 0 auto' }}>{t('catalog.find')}</button>
      </form>
      {!rows || rows.length === 0 ? (
        <div className="empty card" role="status"><p style={{ margin: 0 }}>{q ? t('sellers.empty') : t('sellers.none')}</p>
          {q && <Link className="btn ghost" href={`/${lang}/sellers`}>{t('filters.reset')}</Link>}</div>
      ) : (
        <div className="grid">
          {rows.map((s, i) => (
            <article key={s.id} className="card stg" style={{ ['--i' as any]: i % 8 }}>
              <div className="row" style={{ alignItems: 'center', flexWrap: 'nowrap', gap: 10 }}>
                <span className="mono-logo" aria-hidden="true">{s.company_name.trim().charAt(0).toUpperCase()}</span>
                <h2 className="sub" style={{ margin: 0 }}>{s.company_name}</h2>
              </div>
              {s.verified_by_bmg && <p style={{ margin: '8px 0 0' }}><span className="tag ok"><Icon name="check" size={13} /> {t('seller.verified')}</span></p>}
              {s.description && <p className="muted small">{s.description}</p>}
              <p className="small" style={{ margin: '8px 0' }}>
                {s.categories.length ? s.categories.map((c) => <span key={c} className="tag" style={{ marginRight: 6 }}>{c}</span>) : <span className="muted">{t('sellers.no_cats')}</span>}
              </p>
              {s.regions.length > 0 && <p className="muted small" style={{ margin: '0 0 12px' }}>{t('sellers.regions')}: {s.regions.join(', ')}</p>}
              <Link className="btn ghost block" href={`/${lang}/seller/${s.id}`}>{t('sellers.open')}</Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
