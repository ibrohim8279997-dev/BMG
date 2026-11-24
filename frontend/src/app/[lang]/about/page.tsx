import Link from 'next/link';
import { Lang } from '@/i18n';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

type P = { params: Promise<{ lang: Lang }> };

export async function generateMetadata({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '/about', t('about.title') + ' — BMG', t('about.p1'));
}

export default async function About({ params }: P) {
  const { lang } = await params;
  const t = serverT(lang);
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>{t('about.title')}</h1>
      <p style={{ fontSize: '1.1rem' }}>{t('about.p1')}</p>
      <p className="muted">{t('about.p2')}</p>
      <h2 style={{ marginTop: 32 }}>{t('about.rules')}</h2>
      <ul className="rules">{['r1', 'r2', 'r3'].map((r) => <li key={r}>{t(`about.${r}`)}</li>)}</ul>
      <div className="actions">
        <Link className="btn lg" href={`/${lang}/catalog`}>{t('home.catalog')}</Link>
        <Link className="btn ghost lg" href={`/${lang}/become-seller`}>{t('nav.become')}</Link>
      </div>
    </div>
  );
}
