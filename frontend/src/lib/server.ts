import { Dict, Lang, getDict, translate } from '@/i18n';

export function serverT(lang: Lang) {
  const dict: Dict = getDict(lang);
  return (k: string, vars?: Record<string, string | number>) => translate(dict, k, vars);
}
export const fmt = (v: string | number, lang: string) =>
  new Intl.NumberFormat(lang === 'uz' ? 'uz-UZ' : lang === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 0 }).format(Number(v)) + ' UZS';
