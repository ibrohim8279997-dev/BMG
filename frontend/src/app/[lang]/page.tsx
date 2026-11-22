import Link from 'next/link';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

export const dynamic = 'force-dynamic';   // categories come from the live API, never frozen at build time

type P = { params: Promise<{ lang: Lang }> };

export async function generateMetadata({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '', t('seo.home.title'), t('seo.home.desc'));
}

export default async function Home({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  const cats = (await serverApi<{ slug: string; name: string; parent: string | null }[]>(`/api/v1/categories?lang=${lang}`)) || [];
  return (
    <>
      <section className="hero">
        <h1>{t('home.h1')}</h1>
        <p>{t('home.sub')}</p>
        <div className="actions">
          <Link className="btn" href={`/${lang}/calculator`}>{t('home.cta')}</Link>
          <Link className="btn ghost" href={`/${lang}/catalog`}>{t('nav.catalog')}</Link>
        </div>
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
          {cats.filter((c) => !c.parent).map((c) => (
            <Link key={c.slug} href={`/${lang}/catalog/${c.slug}`} className="card"><h3>{c.name}</h3></Link>
          ))}
        </div>
      </section>
      <div className="notice">⚠ {t('disclaimer')}</div>
    </>
  );
}
