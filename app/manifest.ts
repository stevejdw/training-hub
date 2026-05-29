import type { MetadataRoute } from 'next';
import { getProfile } from '@/lib/profile';

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const profile = await getProfile().catch(() => null);
  const icon = profile?.app_icon ?? 'speed';

  return {
    name: 'Training Hub',
    short_name: 'Training',
    description: 'Cycling training analytics and coaching',
    start_url: '/feed',
    display: 'standalone',
    background_color: '#030712',
    theme_color: '#030712',
    orientation: 'portrait',
    icons: [
      {
        src: `/app-icon-${icon}.png`,
        sizes: '1248x1248',
        type: 'image/png',
      },
    ],
  };
}
