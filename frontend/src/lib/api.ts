export type ApiError = { status: number; error: string; data?: any };

function csrfCookie(): string {
  const m = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

let csrfReady: Promise<unknown> | null = null;
async function ensureCsrf() {
  if (!csrfCookie()) {
    csrfReady = csrfReady ?? fetch('/api/v1/csrf', { credentials: 'same-origin' });
    await csrfReady;
    csrfReady = null;
  }
}

/** Browser API client. Session is an HttpOnly cookie (no tokens in JS); CSRF token is sent on every write. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const method = opts.method || (opts.body || opts.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (method !== 'GET') {
    await ensureCsrf();
    headers['X-CSRFToken'] = csrfCookie();
  }
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw { status: res.status, error: data?.error || (res.status === 403 ? 'forbidden' : res.status === 429 ? 'rate_limited' : 'server_error'), data } as ApiError;
  return data as T;
}

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
/** One URL path segment from a route param: encoded, so `..`, `/` or `?` inside it cannot change the backend path. */
export const seg = (v: string | number) => encodeURIComponent(String(v));

/** Server-side fetch for public SSR pages (no cookies forwarded). Only /api/ paths without dot-segments. */
export async function serverApi<T = any>(path: string): Promise<T | null> {
  const pathname = path.split('?')[0];
  if (!pathname.startsWith('/api/') || /(^|\/)\.\.?(\/|$)|\\|%2e%2e/i.test(pathname)) return null;
  try {
    const res = await fetch(`${BACKEND}${path}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function money(v: string | number, lang: string): string {
  const n = Number(v);
  return new Intl.NumberFormat(lang === 'uz' ? 'uz-UZ' : lang === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 0 }).format(n) + ' UZS';
}
