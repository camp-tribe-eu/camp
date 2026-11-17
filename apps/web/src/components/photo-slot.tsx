import type { PagePhoto } from "@/lib/page-photos";
import { getPhotoSlot, type PhotoSlotKey } from "@/lib/photo-slot";

import { PhotoFrame } from "./photo-frame";

/** Слот за ключем: читає фото власника, без нього — заглушка. */
export async function PhotoSlot({
  slot,
  ratio,
  hero = true,
  className,
  generated = null,
}: {
  slot: PhotoSlotKey;
  /** This page's generated picture, shown only when the owner has set none. */
  generated?: PagePhoto | null;
  ratio?: string;
  hero?: boolean;
  className?: string;
}) {
  const image = (await getPhotoSlot(slot)) ?? generated;
  return (
    <PhotoFrame
      image={image}
      slot={slot}
      ratio={ratio}
      hero={hero}
      className={className}
    />
  );
}
