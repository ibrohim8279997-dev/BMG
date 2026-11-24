import type { Design } from './house/design';

/** Guest -> login -> back flow: what the guest was doing is parked in sessionStorage (this tab only), the login page
 *  returns them to `?next=`, and the page that parked it picks it up again. Nothing sensitive is stored: no tokens. */
const KEY = 'bmg.pending';

export type Pending =
  | { kind: 'calc'; form: Record<string, string>; design?: Design; zones: string[]; res: any }
  | { kind: 'cart'; offer_id: number; qty: string };

export function savePending(p: Pending) {
  try { sessionStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: the user just logs in and re-enters */ }
}
export function peekPending(): Pending | null {
  try { const v = sessionStorage.getItem(KEY); return v ? (JSON.parse(v) as Pending) : null; } catch { return null; }
}
export function clearPending() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Only same-site relative paths are allowed as a return target (no open redirect via `?next=//evil.com`). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\r\n]/.test(next)) return null;
  return next;
}
export const loginUrl = (lang: string, next: string) => `/${lang}/login?next=${encodeURIComponent(next)}`;
export function nextFromLocation(): string | null {
  return safeNext(new URLSearchParams(window.location.search).get('next'));
}
