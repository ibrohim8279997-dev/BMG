import ru from './ru.json';
import uz from './uz.json';
import en from './en.json';

export const LANGS = ['uz', 'ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { ru, uz, en };

export function isLang(x: string): x is Lang {
  return (LANGS as readonly string[]).includes(x);
}
export function getDict(lang: Lang): Dict {
  return dicts[lang];
}
/** Missing keys fall back to Russian, then to the key itself (visible in dev, caught by tests). */
export function translate(dict: Dict, key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? dicts.ru[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
