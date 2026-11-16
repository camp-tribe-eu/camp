import { getPhotoSlot, type PhotoSlotKey } from "@/lib/photo-slot";

import { PhotoFrame } from "./photo-frame";

/** Слот за ключем: читає фото власника, без нього — заглушка. */
export async function PhotoSlot({
  slot,
  ratio,
  hero = true,
  className,
}: {
  slot: PhotoSlotKey;
  ratio?: string;
  hero?: boolean;
  className?: string;
}) {
  const image = await getPhotoSlot(slot);
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
