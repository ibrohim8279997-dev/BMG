import Link from 'next/link';
import HeroCalc from '@/components/HeroCalc';
import HouseZones from '@/components/HouseZones';
import { ProductGrid } from '@/components/ProductGrid';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

export const dynamic = 'force-dynamic';   // categories/products come from the live API, never frozen at build time

type P = { params: Promise<{ lang: Lang }> };

export async function generateMetadata({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '', t('seo.home.title'), t('seo.home.desc'));
}

export default async function Home({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  const [cats, prods] = await Promise.all([
    serverApi<{ slug: string; name: string; parent: string | null; count: number }[]>(`/api/v1/categories?lang=${lang}`),
    serverApi<any>(`/api/v1/products?lang=${lang}&sort=price_asc`),
  ]);
  const popular = prods ? { ...prods, results: prods.results.slice(0, 4) } : null;
  return (
    <>
      <section className="hero2">
        <div>
          <h1>{t('home.h1')}</h1>
          <p className="lead">{t('home.sub')}</p>
          <HeroCalc />
        </div>
        <div className="hero-art"><HouseZones active={['walls', 'roof']} /></div>
      </section>
      <section>
        <h2>{t('home.popular')}</h2>
        <p className="muted" style={{ marginTop: -8 }}>{t('home.popular_sub')}</p>
        <ProductGrid prods={popular} lang={lang} t={t} />
      </section>
      <section>
        <h2>{t('home.how')}</h2>
        <div className="grid steps">
          {['1', '2', '3'].map((n) => (
            <div className="card" key={n}><h3>{t(`home.step${n}.t`)}</h3><p className="muted">{t(`home.step${n}.d`)}</p></div>
          ))}
        </div>
      </section>
      <section>
        <h2>{t('catalog.categories')}</h2>
        <div className="grid">
          {(cats || []).filter((c) => !c.parent).map((c) => (
            <Link key={c.slug} href={`/${lang}/catalog/${c.slug}`} className="card"><h3>{c.name}</h3><span className="muted small">{c.count}</span></Link>
          ))}
        </div>
      </section>
      <div className="trust"><span>{t('trust.prices')}</span><span>{t('trust.delivery')}</span><span>{t('trust.pay')}</span></div>
      <div className="notice">⚠ {t('disclaimer')}</div>
    </>
  );
}
