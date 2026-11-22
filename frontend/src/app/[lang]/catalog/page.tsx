import Link from 'next/link';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { ProductGrid } from '@/components/ProductGrid';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang }>; searchParams: Promise<{ q?: string; page?: string }> };

export async function generateMetadata({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '/catalog', t('seo.catalog.title'), t('seo.catalog.desc'));
}

export default async function Catalog({ params, searchParams }: P) {
  const { lang } = await params;
  const sp = await searchParams;
  const t = serverT(lang);
  const qs = new URLSearchParams({ lang, ...(sp.q ? { q: sp.q.slice(0, 100) } : {}), ...(sp.page ? { page: sp.page } : {}) });
  const [cats, prods] = await Promise.all([
    serverApi<any[]>(`/api/v1/categories?lang=${lang}`),
    serverApi<any>(`/api/v1/products?${qs}`),
  ]);
  return (
    <>
      <h1>{t('nav.catalog')}</h1>
      <form action={`/${lang}/catalog`} className="row" style={{ marginBottom: 16 }}>
        <input name="q" defaultValue={sp.q || ''} placeholder={t('catalog.search')} maxLength={100} />
        <button className="btn" style={{ flex: '0 0 auto' }}>{t('catalog.find')}</button>
      </form>
      <div className="tabs">
        {(cats || []).filter((c) => !c.parent).map((c) => <Link className="btn ghost small" key={c.slug} href={`/${lang}/catalog/${c.slug}`}>{c.name}</Link>)}
      </div>
      <ProductGrid prods={prods} lang={lang} t={t} />
    </>
  );
}
