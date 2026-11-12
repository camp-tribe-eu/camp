'use client';

import { useEffect } from 'react';
import { referrerHost, sendSpotEvent } from '@/lib/events';
import type { BrowserEvent } from '@/lib/events';

// CAMP-504. Перегляд картки й кліки на елементи з `data-ct-event`.
//
// Зовнішнє джерело — лише для ПЕРШОГО перегляду в цьому завантаженні сторінки:
// `document.referrer` після переходів усередині сайту (без перезавантаження)
// лишається тим, що був на вході, і приписував би їм чужий вхід. Подальші
// перегляди надсилають власний хост, а сервер читає його як «зсередини сайту».
let first = true;

export default function SpotEvents({ slug }: { slug: string }) {
  useEffect(() => {
    const ref = first ? referrerHost(document.referrer) : window.location.hostname;
    first = false;
    sendSpotEvent('spot_view', slug, ref);

    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-ct-event]');
      const event = el?.getAttribute('data-ct-event') as BrowserEvent | null;
      if (event) sendSpotEvent(event, slug, window.location.hostname);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [slug]);
  return null;
}
