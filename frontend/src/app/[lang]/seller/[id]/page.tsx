import { notFound } from 'next/navigation';
import { SellerContact } from '@/components/Actions';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang; id: string }> };

export async function generateMetadata({ params }: P) {
  const { lang, id } = await params;
  const s = await serverApi<any>(`/api/v1/sellers/${id}`);
  if (!s) return {};
  const t = serverT(lang);
  return pageMeta(lang, `/seller/${id}`, `${s.company_name} — ${t('seo.seller.suffix')}`, s.description || s.company_name);
}

export default async function Seller({ params }: P) {
  const { lang, id } = await params;
  const t = serverT(lang);
  const s = await serverApi<any>(`/api/v1/sellers/${id}`);
  if (!s) notFound();
  return (
    <>
      <h1>{s.company_name}</h1>
      <p className="muted">{t('seller.rating')}: {s.rating}</p>
      {s.description && <p>{s.description}</p>}
      {s.regions.length > 0 && <p>{t('seller.regions')}: {s.regions.join(', ')}</p>}
      <SellerContact sellerId={s.id} hasDocs={s.has_documents} />
    </>
  );
}
