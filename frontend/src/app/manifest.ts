import type { MetadataRoute } from 'next';

/** PWA manifest: the site installs to the home screen on Android and iOS and opens like an app (same server, same account). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BMG — Build Market Group', short_name: 'BMG', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f3f0ea', theme_color: '#14130f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
