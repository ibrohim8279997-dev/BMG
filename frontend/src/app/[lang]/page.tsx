import Link from 'next/link';
import Icon from '@/components/Icon';
import HeroCalc from '@/components/HeroCalc';
import ProductImage from '@/components/ProductImage';
import { ProductGrid } from '@/components/ProductGrid';
import { IntCount } from '@/components/Bits';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { catImg } from '@/lib/images';
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
  const roots = (cats || []).filter((c) => !c.parent);
  const why = [['shield', '1'], ['home', '2'], ['calc', '3'], ['star', '4']] as const;
  const words = (s: string, from = 0) => s.split(' ').map((w, i) => <span className="w" key={i}><span style={{ ['--i' as any]: from + i }}>{w}&nbsp;</span></span>);
  const a = t('home.h1a').split(' ').length;
  const names = roots.map((c) => c.name);
  const stats: [number, string][] = [[roots.length, t('stat.cats')], [prods?.total ?? 0, t('stat.offers')], [3, t('stat.langs')]];
  const rv = (i: number) => ({ ['--i' as any]: i });
  return (
    <>
      <section className="studio-hero bleed">
        <div className="sh-lines" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={rv(i)} />)}</div>
        <div className="container sh-inner">
          <div className="sh-copy">
            <p className="kicker"><i />{t('home.eyebrow')}</p>
            <h1 className="display">{words(t('home.h1a'))}<em>{words(t('home.h1b'), a)}</em></h1>
            <p className="lead">{t('home.sub')}</p>
            <div className="actions">
              <Link className="btn lg" href={`/${lang}/catalog`}>{t('home.catalog')} <span className="arrow">→</span></Link>
              <Link className="btn lg ghost" href={`/${lang}/become-seller`}>{t('nav.become')}</Link>
            </div>
          </div>
          <div className="sh-art">
            <div className="sh-frame">
              <div className="sh-par" data-parallax="0.1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/img/house.jpg" alt={t('calc.house_alt')} width={880} height={550} fetchPriority="high" />
              </div>
            </div>
            <svg className="sh-dim" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path pathLength={1} d="M0 8 V0 H8" /><path pathLength={1} d="M92 100 H100 V92" />
            </svg>
            <span className="sh-tag"><i />41.2995° N · 69.2401° E</span>
          </div>
        </div>
        <div className="container sh-stats">
          {stats.map(([n, label], i) => <div className="sh-stat" key={label} style={rv(i)}><b><IntCount value={n} /></b><span>{label}</span></div>)}
        </div>
      </section>

      {names.length > 0 && (
        <div className="marquee bleed" aria-hidden="true">
          <div className="marquee-track">{[0, 1].map((k) => <span key={k}>{[...names, ...names].map((n, i) => <span key={i}>{n}</span>)}</span>)}</div>
        </div>
      )}

      <section className="band" data-reveal>
        <div className="band-head rv">
          <div><span className="sec-no">01</span><h2>{t('home.cats')}</h2><p>{t('home.cats_sub')}</p></div>
          <Link className="linkarrow" href={`/${lang}/catalog`}>{t('home.all')} <span>→</span></Link>
        </div>
        <div className="tiles">
          {roots.slice(0, 8).map((c, i) => (
            <Link key={c.slug} href={`/${lang}/catalog/${c.slug}`} className="tile rv" style={rv(i % 4)}>
              <span className="tile-no">{String(i + 1).padStart(2, '0')}</span>
              {catImg(c.slug)
                ? <div className="cat-img"><img src={catImg(c.slug)!} alt="" width={400} height={300} loading="lazy" /></div>
                : <ProductImage cat={c.slug} />}
              <div className="tile-body"><h3>{c.name}</h3><span className="go"><span className="muted">{c.count}</span><b aria-hidden="true">→</b></span></div>
            </Link>
          ))}
        </div>
      </section>

      <section className="band" data-reveal style={{ paddingTop: 0 }}>
        <div className="band-head rv">
          <div><span className="sec-no">02</span><h2>{t('home.popular')}</h2><p>{t('home.popular_sub')}</p></div>
          <Link className="linkarrow" href={`/${lang}/catalog`}>{t('home.all')} <span>→</span></Link>
        </div>
        <ProductGrid prods={popular} lang={lang} t={t} />
      </section>

      <section className="band" data-reveal style={{ paddingTop: 0 }}>
        <div className="calc-band">
          <div className="rv"><span className="sec-no">03</span><h2>{t('home.calc.t')}</h2><p className="muted">{t('home.calc.d')}</p></div>
          <div className="rv" style={rv(1)}><HeroCalc /></div>
        </div>
      </section>

      <section className="band" data-reveal style={{ paddingTop: 0 }}>
        <div className="rv"><span className="sec-no">04</span><h2 style={{ marginBottom: 40 }}>{t('home.why.t')}</h2></div>
        <div className="pillars">
          {why.map(([ico, n], i) => (
            <div className="pillar rv" key={n} style={rv(i)}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              <h3>{t(`home.why${n}.t`)}</h3><p className="muted">{t(`home.why${n}.d`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="night bleed band" data-reveal>
        <div className="container">
          <h2 className="rv">{t('home.how.t')}</h2>
          <div className="process">
            {['1', '2', '3'].map((n, i) => (
              <div className="proc" key={n}><span className="draw" style={rv(i)} />
                <div className="rv" style={rv(i)}><span className="num2">{String(i + 1).padStart(2, '0')}</span><h3>{t(`home.step${n}.t`)}</h3><p>{t(`home.step${n}.d`)}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cta-band" data-reveal>
        <h2 className="rv">{t('home.final.t')}</h2>
        <p className="muted rv" style={rv(1)}>{t('home.final.d')}</p>
        <div className="actions rv" style={rv(2)}>
          <Link className="btn lg" href={`/${lang}/become-seller`}>{t('nav.become')} <span className="arrow">→</span></Link>
          <Link className="btn ghost lg" href={`/${lang}/catalog`}>{t('home.catalog')}</Link>
        </div>
      </section>
    </>
  );
}
