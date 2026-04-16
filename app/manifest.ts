import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Training Hub',
    short_name: 'Training',
    description: 'Cycling training analytics and coaching',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#030712',
    theme_color: '#030712',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
