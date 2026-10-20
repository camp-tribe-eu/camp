'use client';

import dynamic from 'next/dynamic';

/**
 * Клієнтська межа навколо мапи одного кемпінгу.
 *
 * 🔴 Окремий файл із тієї самої причини, що й `map-embed.tsx`: Next 15
 * відмовляється від `ssr: false` у `next/dynamic` всередині серверного
 * компонента — збірка падає. Сторінка кемпінгу лишається серверною, тож
 * її заголовок, зручності й структуровані дані їдуть у HTML і для
 * читача без JavaScript, і для пошуковика.
 *
 * `ssr: false` тут не вподобання: MapLibre тягнеться до `window` і до
 * WebGL-канвасу в момент імпорту, і рендер на сервері валить увесь
 * пререндер сторінки.
 */
import type { Outline } from '@/lib/outline';

const SiteMap = dynamic(() => import('@/components/site-map'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full rounded-card border border-line-2 bg-surface-2" />
  ),
});

export default function SiteMapEmbed(props: {
  lat: number;
  lon: number;
  type: string;
  label: string;
  outline?: Outline | null;
}) {
  return <SiteMap {...props} />;
}
