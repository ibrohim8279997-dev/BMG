import type { ReactNode } from 'react';
import { Lang } from '@/i18n';
import { pageMeta } from '@/lib/seo';
import { serverT } from '@/lib/server';

export async function generateMetadata({ params }: { params: Promise<{ lang: Lang }> }) {
  const { lang } = await params;
  const t = serverT(lang);
  return pageMeta(lang, '/calculator', t('seo.calc.title'), t('seo.calc.desc'));
}

export default function CalcLayout({ children }: { children: ReactNode }) {
  return children;
}
