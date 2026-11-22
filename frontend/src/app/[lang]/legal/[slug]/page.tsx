import { notFound } from 'next/navigation';
import { Lang } from '@/i18n';
import { serverApi } from '@/lib/api';
import { pageMeta } from '@/lib/seo';

type P = { params: Promise<{ lang: Lang; slug: string }> };

export async function generateMetadata({ params }: P) {
  const { lang, slug } = await params;
  const d = await serverApi<any>(`/api/v1/legal/${slug}?lang=${lang}`);
  return d ? pageMeta(lang, `/legal/${slug}`, d.title, d.title) : {};
}

export default async function Legal({ params }: P) {
  const { lang, slug } = await params;
  const d = await serverApi<any>(`/api/v1/legal/${slug}?lang=${lang}`);
  if (!d) notFound();
  return (
    <>
      <h1>{d.title}</h1>
      <p className="muted small">v{d.version} · {d.effective_from}</p>
      <div style={{ whiteSpace: 'pre-wrap' }}>{d.body}</div>
    </>
  );
}
