import Link from 'next/link';
import { AddToCart } from '@/components/Actions';
import ProductImage from '@/components/ProductImage';
import { Lang } from '@/i18n';
import { fmt } from '@/lib/server';

export function ProductGrid({ prods, lang, t, resetHref, filtered }: { prods: any; lang: Lang; t: (k: string) => string; resetHref?: string; filtered?: boolean }) {
  if (!prods || prods.results.length === 0) {
    return (
      <div className="empty card" role="status">
        <p style={{ margin: 0 }}>{filtered ? t('catalog.empty_filtered') : t('catalog.empty')}</p>
        {filtered && resetHref && <Link className="btn ghost" href={resetHref}>{t('filters.reset')}</Link>}
      </div>
    );
  }
  return (
    <div className="grid products">
      {prods.results.map((p: any, i: number) => (
        <div key={p.id} className="card pcard stg" style={{ ['--i' as any]: i % 8 }}>
          <Link href={`/${lang}/product/${p.id}`} aria-hidden="true" tabIndex={-1}><ProductImage cat={p.category} src={p.image} first={i < 4} /></Link>
          <div className="body">
            <Link href={`/${lang}/product/${p.id}`}><h3>{p.name}</h3></Link>
            <div className="price">{p.min_price ? <>{t('catalog.from')} {fmt(p.min_price, lang)}{p.unit && <span className="muted small"> / {p.unit}</span>}</> : t('catalog.ask_price')}</div>
            <div className="muted small">{p.offers} {t('catalog.offers')} · <span className="ok">{t('catalog.in_stock')}</span></div>
            {p.best_offer_id && <AddToCart offerId={p.best_offer_id} compact />}
          </div>
        </div>
      ))}
    </div>
  );
}
