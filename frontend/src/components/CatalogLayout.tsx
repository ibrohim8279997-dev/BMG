import Link from 'next/link';
import { Lang } from '@/i18n';
import { ProductGrid } from './ProductGrid';

type Sp = { q?: string; page?: string; price_min?: string; price_max?: string; sort?: string };

/** Server-rendered filters (plain GET form: works without JS and stays crawlable). */
export default function CatalogLayout({ lang, t, cats, prods, sp, basePath, activeSlug, title }:
  { lang: Lang; t: (k: string, v?: any) => string; cats: any[]; prods: any; sp: Sp; basePath: string; activeSlug?: string; title: string }) {
  const roots = (cats || []).filter((c) => !c.parent);
  return (
    <div className="catalog">
      <aside className="card filters">
        <form action={basePath}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
            <h3 style={{ margin: 0 }}>{t('filters.title')}</h3>
            <Link href={basePath} className="small" style={{ flex: '0 0 auto', color: 'var(--accent)' }}>{t('filters.reset')}</Link>
          </div>
          <h4>{t('filters.categories')}</h4>
          <ul className="catlist">
            <li><Link className={!activeSlug ? 'on' : ''} href={`/${lang}/catalog`}>{t('filters.all')}</Link></li>
            {roots.map((c) => (
              <li key={c.slug}><Link className={activeSlug === c.slug ? 'on' : ''} href={`/${lang}/catalog/${c.slug}`}>{c.name}<span className="muted">{c.count}</span></Link></li>
            ))}
          </ul>
          <h4>{t('filters.price')}</h4>
          <div className="row" style={{ gap: 8 }}>
            <input name="price_min" type="number" min="0" placeholder={t('filters.from')} defaultValue={sp.price_min || ''} aria-label={t('filters.from')} />
            <input name="price_max" type="number" min="0" placeholder={t('filters.to')} defaultValue={sp.price_max || ''} aria-label={t('filters.to')} />
          </div>
          <h4>{t('filters.sort')}</h4>
          <select name="sort" defaultValue={sp.sort || 'name'} aria-label={t('filters.sort')}>
            {['name', 'price_asc', 'price_desc'].map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
          </select>
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <button className="btn block" style={{ marginTop: 14 }}>{t('filters.apply')}</button>
        </form>
      </aside>
      <section>
        <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
          <h1 style={{ margin: 0, flex: '1 1 260px' }}>{title}</h1>
          <span className="muted" style={{ flex: '0 0 auto' }}>{t('catalog.found', { n: prods?.total ?? 0 })}</span>
        </div>
        <form action={basePath} className="row" style={{ margin: '12px 0 16px' }}>
          <input name="q" defaultValue={sp.q || ''} placeholder={t('catalog.search')} maxLength={100} />
          <button className="btn" style={{ flex: '0 0 auto' }}>{t('catalog.find')}</button>
        </form>
        <ProductGrid prods={prods} lang={lang} t={t} />
      </section>
    </div>
  );
}
