import Link from 'next/link';
import { AddToCart } from '@/components/Actions';
import { Lang } from '@/i18n';
import { fmt } from '@/lib/server';

export function ProductGrid({ prods, lang, t }: { prods: any; lang: Lang; t: (k: string) => string }) {
  if (!prods || prods.results.length === 0) return <p className="muted">{t('catalog.empty')}</p>;
  return (
    <div className="grid products">
      {prods.results.map((p: any) => (
        <div key={p.id} className="card pcard">
          <Link href={`/${lang}/product/${p.id}`} className="pimg" aria-hidden="true" tabIndex={-1}><span>{p.name.slice(0, 1)}</span></Link>
          <Link href={`/${lang}/product/${p.id}`}><h3>{p.name}</h3></Link>
          <div className="price">{t('catalog.from')} {fmt(p.min_price, lang)}{p.unit && <span className="muted small"> / {p.unit}</span>}</div>
          <div className="muted small">{p.offers} {t('catalog.offers')} · <span className="ok">{t('catalog.in_stock')}</span></div>
          {p.best_offer_id && <AddToCart offerId={p.best_offer_id} compact />}
        </div>
      ))}
    </div>
  );
}
