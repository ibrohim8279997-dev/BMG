const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

// Pages get a nonce-based CSP from src/middleware.ts (src/lib/csp.ts). Everything else (static files, proxied API)
// gets this strict fallback: no scripts at all.
const csp = "default-src 'self'; script-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'";

/** @type {import('next').NextConfig} */
export default {
  distDir: process.env.NEXT_DIST || '.next',   // lets a test build live beside a running dev server
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    // Browser talks to ONE origin; Django is reached through this proxy (same-origin cookies, no CORS).
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/admin-api/:path*', destination: `${BACKEND}/admin-api/:path*` },
      { source: '/sitemap.xml', destination: `${BACKEND}/sitemap.xml` },
      { source: '/robots.txt', destination: `${BACKEND}/robots.txt` },
    ];
  },
  async headers() {
    return [{
      // fallback CSP only where middleware doesn't set one (anything that isn't a /uz|ru|en page)
      source: '/:path((?!uz|ru|en).*)',
      headers: [{ key: 'Content-Security-Policy', value: csp }],
    }, {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }];
  },
};
