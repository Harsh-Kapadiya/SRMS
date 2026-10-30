import type { MetadataRoute } from 'next';

/** Installable on the shop's phone or tablet ("Add to home screen"); opens full-screen, works offline. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Smart Ration — Dealer',
    short_name: 'Ration Dealer',
    description: 'Issue ration, manage shop stock — works without internet',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f7f5',
    theme_color: '#16794a',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
