const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const google = process.env.GOOGLE_CLIENT_ID ? ' https://accounts.google.com' : '';   // only when Google sign-in is configured
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'") + google,
  "style-src 'self' 'unsafe-inline'" + google,
  "img-src 'self' data: blob:",
  "connect-src 'self'" + google,
  ...(google ? ["frame-src https://accounts.google.com"] : []),
  "worker-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

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
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }];
  },
};
