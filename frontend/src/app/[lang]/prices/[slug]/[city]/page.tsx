import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductGrid } from '@/components/ProductGrid';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

export const dynamic = 'force-dynamic';

type P = { params: Promise<{ lang: Lang; slug: string; city: string }> };

/** SEO landing page for one search-query group ("cement price Tashkent"): category x city, live offers only. */
async function load(lang: Lang, slug: string, rawCity: string) {
  const city = decodeURIComponent(rawCity);
  const [cat, prods, pages] = await Promise.all([
    serverApi<any>(`/api/v1/categories/${encodeURIComponent(slug)}?lang=${lang}`),
    serverApi<any>(`/api/v1/products?lang=${lang}&category=${encodeURIComponent(slug)}&city=${encodeURIComponent(city)}&sort=price_asc`),
    serverApi<{ category: string; city: string }[]>('/api/v1/seo/price-pages'),
  ]);
  return { city, cat, prods, others: (pages || []).filter((p) => p.category === slug && p.city !== city) };
}

export async function generateMetadata({ params }: P) {
  const { lang, slug, city: rawCity } = await params;
  const { city, cat, prods } = await load(lang, slug, rawCity);
  if (!cat || !prods || prods.total === 0) return {};
  const t = serverT(lang);
  return pageMeta(lang, `/prices/${slug}/${encodeURIComponent(city)}`, t('seo.price.title', { cat: cat.name, city }),
    t('price.desc', { city }));
}

export default async function PricePage({ params }: P) {
  const { lang, slug, city: rawCity } = await params;
  const t = serverT(lang);
  const { city, cat, prods, others } = await load(lang, slug, rawCity);
  if (!cat || !prods || prods.total === 0) notFound();   // no live offers: no page (keeps thin pages out of the index)
  return (
    <>
      <p className="crumb"><Link href={`/${lang}/catalog`}>{t('nav.catalog')}</Link><span>/</span><Link href={`/${lang}/catalog/${slug}`}>{cat.name}</Link></p>
      <h1 style={{ fontSize: 'clamp(1.7rem,3.4vw,2.5rem)' }}>{t('price.h1', { cat: cat.name, city })}</h1>
      <p className="muted">{t('price.desc', { city })}</p>
      <ProductGrid prods={prods} lang={lang} t={t} />
      {others.length > 0 && (
        <>
          <h2 style={{ marginTop: 48 }}>{t('price.other')}</h2>
          <div className="tabs">{others.map((o) => (
            <Link key={o.city} className="btn ghost small" href={`/${lang}/prices/${slug}/${encodeURIComponent(o.city)}`}>{o.city}</Link>))}</div>
        </>
      )}
    </>
  );
}
