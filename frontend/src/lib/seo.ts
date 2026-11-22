import type { Metadata } from 'next';
import { LANGS } from '@/i18n';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

/** Per-page title/description + canonical + hreflang alternates for all 3 languages. */
export function pageMeta(lang: string, path: string, title: string, description: string, noindex = false): Metadata {
  return {
    metadataBase: new URL(SITE),
    title, description,
    alternates: {
      canonical: `/${lang}${path}`,
      languages: Object.fromEntries(LANGS.map((l) => [l, `/${l}${path}`])),
    },
    openGraph: { title, description, locale: lang, type: 'website' },
    robots: noindex ? { index: false, follow: false } : undefined,
  };
}
