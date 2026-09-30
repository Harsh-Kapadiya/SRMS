import type { MetadataRoute } from 'next';

/** Installable on phones ("Add to home screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Smart Ration',
    short_name: 'Ration',
    description: 'Your monthly ration, history and complaints',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f7f5',
    theme_color: '#16794a',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
