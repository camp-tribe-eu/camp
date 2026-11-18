import { pagePhoto } from "@/lib/page-photos";
import type { Topic } from "@/lib/guide-facets";

/**
 * CAMP-443 (2): the picture on the left of a guide card — the topic's own
 * illustration, small. Decorative (`alt=""`): the card's title says what
 * the topic is. The 640 variant is the smallest file we have; one topic
 * repeats across a page, so the browser fetches it once.
 */
export function TopicThumb({ topic }: { topic: Topic }) {
  const photo = pagePhoto("topic", topic);
  if (!photo) return null;
  const src = photo.src.replace(/\.webp$/, "-640.webp");
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={56}
      height={56}
      loading="lazy"
      decoding="async"
      className="h-14 w-14 rounded-md object-cover"
    />
  );
}
