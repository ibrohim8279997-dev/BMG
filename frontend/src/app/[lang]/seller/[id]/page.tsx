import { notFound } from 'next/navigation';
import { SellerContact } from '@/components/Actions';
import Icon from '@/components/Icon';
import Stars from '@/components/Stars';
import { Lang } from '@/i18n';
import { seg, serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang; id: string }> };

export async function generateMetadata({ params }: P) {
  const { lang, id } = await params;
  const s = await serverApi<any>(`/api/v1/sellers/${seg(id)}`);
  if (!s) return {};
  const t = serverT(lang);
  return pageMeta(lang, `/seller/${id}`, `${s.company_name} — ${t('seo.seller.suffix')}`, s.description || s.company_name);
}

export default async function Seller({ params }: P) {
  const { lang, id } = await params;
  const t = serverT(lang);
  const [s, rv, cfg] = await Promise.all([
    serverApi<any>(`/api/v1/sellers/${seg(id)}`),
    serverApi<any>(`/api/v1/sellers/${seg(id)}/reviews`),
    serverApi<{ phone: string; telegram: string; email: string }>('/api/v1/config'),
  ]);
  if (!s) notFound();
  const contacts = [cfg?.phone, cfg?.telegram, cfg?.email].filter(Boolean);
  return (
    <>
      <h1>{s.company_name}</h1>
      <p className="row" style={{ alignItems: 'center', gap: 10, margin: '0 0 8px' }}>
        {s.verified_by_bmg && <span className="tag ok" style={{ flex: '0 0 auto' }}><Icon name="check" size={13} /> {t('seller.verified')}</span>}
        <span style={{ flex: '0 0 auto' }}><Stars value={s.rating} /> <b>{s.rating}</b></span>
        <span className="muted small" style={{ flex: '0 0 auto' }}>{t('review.count', { n: s.review_count })}</span>
      </p>
      {s.description && <p>{s.description}</p>}
      {s.regions.length > 0 && <p>{t('seller.regions')}: {s.regions.join(', ')}</p>}
      <SellerContact sellerId={s.id} hasDocs={s.has_documents} />
      {contacts.length > 0 && <p className="muted small" style={{ marginTop: 12 }}>{t('seller.complain')}: {contacts.join(' · ')}</p>}
      <h2 style={{ marginTop: 40 }}>{t('review.title')}</h2>
      {!rv || rv.results.length === 0 ? <p className="muted">{t('review.empty')}</p> : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
          {rv.results.map((r: any, i: number) => (
            <div className="card" key={i}><Stars value={r.rating} />
              {r.text && <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{r.text}</p>}
              <p className="muted small" style={{ margin: '8px 0 0' }}>{new Date(r.created_at).toLocaleDateString(lang)}</p></div>
          ))}
        </div>
      )}
    </>
  );
}
