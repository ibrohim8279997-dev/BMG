import Link from 'next/link';
import { Lang } from '@/i18n';
import { fmt } from '@/lib/server';

export function ProductGrid({ prods, lang, t }: { prods: any; lang: Lang; t: (k: string) => string }) {
  if (!prods || prods.results.length === 0) return <p className="muted">{t('catalog.empty')}</p>;
  return (
    <div className="grid">
      {prods.results.map((p: any) => (
        <Link key={p.id} href={`/${lang}/product/${p.id}`} className="card">
          <h3>{p.name}</h3>
          <div className="price">{t('catalog.from')} {fmt(p.min_price, lang)}</div>
          <div className="muted small">{p.offers} {t('catalog.offers')}</div>
        </Link>
      ))}
    </div>
  );
}
