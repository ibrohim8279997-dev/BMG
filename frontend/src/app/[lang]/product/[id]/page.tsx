import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCart } from '@/components/Actions';
import ProductImage from '@/components/ProductImage';
import Stars from '@/components/Stars';
import { Lang } from '@/i18n';
import { seg, serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { fmt, serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang; id: string }> };

export async function generateMetadata({ params }: P) {
  const { lang, id } = await params;
  const p = await serverApi<any>(`/api/v1/products/${seg(id)}?lang=${seg(lang)}`);
  const t = serverT(lang);
  if (!p) return {};
  const best = p.offers[0];
  return pageMeta(lang, `/product/${id}`, `${p.name} — ${t('seo.product.suffix')}`,
    `${p.name}${best ? `: ${t('catalog.from')} ${fmt(best.price, lang)}` : ''}. ${p.category.description || t('seo.category.desc')}`.slice(0, 300));
}

export default async function Product({ params }: P) {
  const { lang, id } = await params;
  const t = serverT(lang);
  const p = await serverApi<any>(`/api/v1/products/${seg(id)}?lang=${seg(lang)}`);
  if (!p) notFound();
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, category: p.category.name,
    offers: p.offers.length ? {
      '@type': 'AggregateOffer', priceCurrency: 'UZS', lowPrice: p.offers[0].price,
      highPrice: p.offers[p.offers.length - 1].price, offerCount: p.offers.length,
    } : undefined,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <p className="crumb"><Link href={`/${lang}/catalog`}>{t('nav.catalog')}</Link><span>/</span><Link href={`/${lang}/catalog/${p.category.slug}`}>{p.category.name}</Link></p>
      <div className="pgrid">
        <ProductImage cat={p.category.slug} src={p.image} big />
        <div>
          <h1 style={{ fontSize: 'clamp(1.7rem,3.4vw,2.5rem)' }}>{p.name}</h1>
          {p.offers[0] && <div className="price" style={{ fontSize: '1.7rem' }}>{t('catalog.from')} {fmt(p.offers[0].price, lang)}{p.unit && <span className="muted small"> / {p.unit}</span>}</div>}
          <p className="muted small">{t('product.prices_note')}</p>
          <div className="table-wrap card" style={{ padding: 8, marginTop: 14 }}>
            <table>
              <thead><tr><th>{t('product.seller')}</th><th>{t('product.price')}</th><th>{t('product.stock')}</th><th /></tr></thead>
              <tbody>
                {p.offers.map((o: any, i: number) => (
                  <tr key={o.id}>
                    <td><Link href={`/${lang}/seller/${o.seller_id}`}><b>{o.seller || `#${o.seller_id}`}</b></Link>{Number(o.rating) > 0 && <div><Stars value={o.rating} size={13} /></div>}{i === 0 && p.offers.length > 1 && <div><span className="tag ok">{t('product.best')}</span></div>}</td>
                    <td className="price">{fmt(o.price, lang)}</td>
                    <td>{Number(o.stock)}</td>
                    <td><AddToCart offerId={o.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
