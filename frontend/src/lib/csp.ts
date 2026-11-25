/** Content-Security-Policy with a per-request nonce (no 'unsafe-inline' for scripts). Built in middleware; Next.js reads
 *  the nonce from the request's CSP header and puts it on its own scripts; our inline theme script reads it via x-nonce. */
export function buildCsp(nonce: string, opts: { dev: boolean; google: boolean; captcha?: boolean }) {
  const google = (opts.google ? ' https://accounts.google.com' : '') + (opts.captcha ? ' https://challenges.cloudflare.com' : '');
  return [
    "default-src 'self'",
    // same-origin files ('self') + the nonce for inline scripts; no 'unsafe-inline'.
    // 'wasm-unsafe-eval': the 3D house decodes KTX2 textures with the Basis WebAssembly transcoder.
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${opts.dev ? " 'unsafe-eval'" : ''}${google}`,
    // inline style ATTRIBUTES (React style={...}) can't carry a nonce, so styles keep 'unsafe-inline'; they can't run code
    "style-src 'self' 'unsafe-inline'" + google,
    "img-src 'self' data: blob:",
    "connect-src 'self' blob:" + google,
    ...(google ? [`frame-src${google}`] : []),
    "worker-src 'self' blob:",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function makeNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
