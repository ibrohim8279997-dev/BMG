import Link from 'next/link';
import { notFound } from 'next/navigation';
import CatalogLayout from '@/components/CatalogLayout';
import { Lang } from '@/i18n';
import { seg, serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang; slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: P) {
  const { lang, slug } = await params;
  const c = await serverApi<any>(`/api/v1/categories/${seg(slug)}?lang=${seg(lang)}`);
  const t = serverT(lang);
  if (!c) return {};
  return pageMeta(lang, `/catalog/${slug}`, `${c.name} — ${t('seo.category.suffix')}`,
    c.description || `${c.name}: ${t('seo.category.desc')}`);
}

export default async function Category({ params, searchParams }: P) {
  const { lang, slug } = await params;
  const sp = await searchParams;
  const t = serverT(lang);
  const qs = new URLSearchParams({ lang, category: slug });
  for (const k of ['q', 'page', 'price_min', 'price_max', 'sort']) if (sp[k]) qs.set(k, String(sp[k]).slice(0, 100));
  const [c, cats, prods, pages] = await Promise.all([
    serverApi<any>(`/api/v1/categories/${seg(slug)}?lang=${seg(lang)}`),
    serverApi<any[]>(`/api/v1/categories?lang=${lang}`),
    serverApi<any>(`/api/v1/products?${qs}`),
    serverApi<{ category: string; city: string }[]>('/api/v1/seo/price-pages'),
  ]);
  if (!c) notFound();
  return (
    <>
      <CatalogLayout lang={lang} t={t} cats={cats || []} prods={prods} sp={sp} basePath={`/${lang}/catalog/${slug}`} activeSlug={slug} title={c.name} />
      {c.description && <p className="muted" style={{ marginTop: 24 }}>{c.description}</p>}
      {(pages || []).some((p) => p.category === slug) && (
        <>
          <h2 style={{ marginTop: 40 }}>{t('price.other')}</h2>
          <div className="tabs">{(pages || []).filter((p) => p.category === slug).map((p) => (
            <Link key={p.city} className="btn ghost small" href={`/${lang}/prices/${slug}/${encodeURIComponent(p.city)}`}>{p.city}</Link>))}</div>
        </>
      )}
    </>
  );
}
