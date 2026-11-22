import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCart } from '@/components/Actions';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { fmt, serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang; id: string }> };

export async function generateMetadata({ params }: P) {
  const { lang, id } = await params;
  const p = await serverApi<any>(`/api/v1/products/${id}?lang=${lang}`);
  const t = serverT(lang);
  if (!p) return {};
  const best = p.offers[0];
  return pageMeta(lang, `/product/${id}`, `${p.name} — ${t('seo.product.suffix')}`,
    `${p.name}${best ? `: ${t('catalog.from')} ${fmt(best.price, lang)}` : ''}. ${p.category.description || t('seo.category.desc')}`.slice(0, 300));
}

export default async function Product({ params }: P) {
  const { lang, id } = await params;
  const t = serverT(lang);
  const p = await serverApi<any>(`/api/v1/products/${id}?lang=${lang}`);
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
      <p className="muted small"><Link href={`/${lang}/catalog/${p.category.slug}`}>{p.category.name}</Link></p>
      <h1>{p.name}</h1>
      {p.unit && <p className="muted">{t('product.unit')}: {p.unit}</p>}
      <p className="muted small">{t('product.prices_note')}</p>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>{t('product.seller')}</th><th>{t('product.price')}</th><th>{t('product.stock')}</th><th /></tr></thead>
          <tbody>
            {p.offers.map((o: any) => (
              <tr key={o.id}>
                <td><Link href={`/${lang}/seller/${o.seller_id}`}>{o.seller || `#${o.seller_id}`}</Link></td>
                <td className="price">{fmt(o.price, lang)}</td>
                <td>{Number(o.stock)}</td>
                <td><AddToCart offerId={o.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
