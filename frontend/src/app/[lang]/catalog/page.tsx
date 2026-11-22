import CatalogLayout from '@/components/CatalogLayout';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang }>; searchParams: Promise<Record<string, string | undefined>> };

export async function generateMetadata({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '/catalog', t('seo.catalog.title'), t('seo.catalog.desc'));
}

export default async function Catalog({ params, searchParams }: P) {
  const { lang } = await params;
  const sp = await searchParams;
  const t = serverT(lang);
  const qs = new URLSearchParams({ lang });
  for (const k of ['q', 'page', 'price_min', 'price_max', 'sort']) if (sp[k]) qs.set(k, String(sp[k]).slice(0, 100));
  const [cats, prods] = await Promise.all([
    serverApi<any[]>(`/api/v1/categories?lang=${lang}`),
    serverApi<any>(`/api/v1/products?${qs}`),
  ]);
  return <CatalogLayout lang={lang} t={t} cats={cats || []} prods={prods} sp={sp} basePath={`/${lang}/catalog`} title={t('nav.catalog')} />;
}
