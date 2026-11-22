import { notFound } from 'next/navigation';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';
import { ProductGrid } from '@/components/ProductGrid';

type P = { params: Promise<{ lang: Lang; slug: string }> };

export async function generateMetadata({ params }: P) {
  const { lang, slug } = await params;
  const c = await serverApi<any>(`/api/v1/categories/${slug}?lang=${lang}`);
  const t = serverT(lang);
  if (!c) return {};
  return pageMeta(lang, `/catalog/${slug}`, `${c.name} — ${t('seo.category.suffix')}`,
    c.description || `${c.name}: ${t('seo.category.desc')}`);
}

export default async function Category({ params }: P) {
  const { lang, slug } = await params;
  const t = serverT(lang);
  const [c, prods] = await Promise.all([
    serverApi<any>(`/api/v1/categories/${slug}?lang=${lang}`),
    serverApi<any>(`/api/v1/products?category=${slug}&lang=${lang}`),
  ]);
  if (!c) notFound();
  return (
    <>
      <h1>{c.name}</h1>
      {c.description && <p className="muted">{c.description}</p>}
      <ProductGrid prods={prods} lang={lang} t={t} />
    </>
  );
}
