import { notFound } from 'next/navigation';
import CatalogLayout from '@/components/CatalogLayout';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang; slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: P) {
  const { lang, slug } = await params;
  const c = await serverApi<any>(`/api/v1/categories/${slug}?lang=${lang}`);
  const t = serverT(lang);
  if (!c) return {};
  return pageMeta(lang, `/catalog/${slug}`, `${c.name} — ${t('seo.category.suffix')}`,
    c.description || `${c.name}: ${t('seo.category.desc')}`);
}

export default async function Category({ params, searchParams }: P) {
  const { lang, slug } = await params;
  const sp = await searchParams;
  const t = serverT(lang);
  const qs = new URLSearchParams({ lang, category: slug });
  for (const k of ['q', 'page', 'price_min', 'price_max', 'sort']) if (sp[k]) qs.set(k, String(sp[k]).slice(0, 100));
  const [c, cats, prods] = await Promise.all([
    serverApi<any>(`/api/v1/categories/${slug}?lang=${lang}`),
    serverApi<any[]>(`/api/v1/categories?lang=${lang}`),
    serverApi<any>(`/api/v1/products?${qs}`),
  ]);
  if (!c) notFound();
  return (
    <>
      <CatalogLayout lang={lang} t={t} cats={cats || []} prods={prods} sp={sp} basePath={`/${lang}/catalog/${slug}`} activeSlug={slug} title={c.name} />
      {c.description && <p className="muted" style={{ marginTop: 24 }}>{c.description}</p>}
    </>
  );
}
