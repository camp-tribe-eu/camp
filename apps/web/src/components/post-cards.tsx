import Link from "next/link";

/**
 * Картки матеріалів — CAMP-449, секція 10 каталогу, і CAMP-465, пункт 3.
 *
 * Власник просив дві речі одним рухом: «сторінка Блог … повтори як ми в
 * Темі», і — щоб цю секцію «можна було класти на будь-яку сторінку», бо
 * внизу сторінок він хоче чергувати то блог-пости, то інші наші фічі.
 *
 * 🔴 СТРУКТУРА З ТЕМИ: `article-card` Fuse (`assets/article-card.build.css`;
 * читано з архіву `fuse.zip` 10.11.2026). Дослівно:
 *
 *   .article-card{display:flex;flex-direction:column;gap:12px}
 *   .article-card__link-image-wrapper{position:relative;overflow:hidden;
 *       display:block;width:100%;padding-top:82%;
 *       border-radius:var(--global-border-radius)}
 *   .article-card__image{position:absolute;top:0;left:0;width:100%;
 *       height:100%;object-fit:cover;object-position:center}
 *   .article-card__content{display:flex;flex-direction:column;gap:12px;
 *       width:100%;padding:0 8px}
 *   .article-card__title--clipped{overflow:hidden;display:-webkit-box;
 *       -webkit-line-clamp:2;-webkit-box-orient:vertical}
 *   .article-card__title-link{text-decoration:none;color:currentColor}
 *   .article-card__description{word-wrap:break-word;
 *       color:var(--color-text-secondary)}
 *   .article-card__info-item{display:inline-flex;align-items:center;
 *       gap:12px;padding:7px 15px;border:1px solid var(--color-border-thirdly);
 *       border-radius:44px;background-color:var(--color-background-secondary);
 *       font-size:calc(var(--body-font-size) * .875);font-weight:600;
 *       line-height:1.28}
 *
 * 🔴 ДЕ СВІДОМО НЕ КОПІЮЄМО ТЕМУ — названо:
 *   - коло, що наїжджає на фото під курсором (`::after` зі `scale(3.5)`),
 *     не беремо: воно нічого не каже, а на дотику його не існує;
 *   - теги поверх фото не беремо, бо тегів у наших постів немає;
 *   - обрізання заголовка двома рядками (`-webkit-line-clamp`) беремо:
 *     це не приховування змісту, а вирівнювання карток у ряду, і повний
 *     заголовок читач бачить на самій сторінці поста.
 *
 * 🔴 ФОТО В НАС НЕМАЄ ЖОДНОГО (CAMP-469), І ЦЕ ВИДНО ЧЕСНО: за
 * відсутності зображення картка показує наше лого — той самий один
 * файл `public/logo.svg`, що й картки сусідніх кемпінгів. Підміна
 * одного файлу міняє його скрізь.
 */

export interface PostCard {
  /** Стабільний ключ: заголовок може змінитись. */
  key: string;
  href: string;
  title: string;
  excerpt?: string;
  /** Підпис-пігулка: дата, час читання — те, що сторінка вже знає. */
  meta?: string;
  image?: { src: string; alt?: string };
}

// Не експортується навмисно: тест має читати відданий HTML, а не цю константу.
const POST_CSS = `
.ct-posts{display:grid;gap:24px;margin:0;padding:0;list-style:none}
.ct-post{display:flex;flex-direction:column;gap:12px}
.ct-post__media{position:relative;display:block;width:100%;padding-top:82%;overflow:hidden;border-radius:var(--r,16px);background-color:var(--color-surface-2)}
.ct-post__image{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center}
.ct-post__image--placeholder{object-fit:contain;padding:18%}
.ct-post__content{display:flex;flex-direction:column;gap:12px;width:100%;padding:0 8px}
.ct-post__meta{display:inline-flex;align-items:center;gap:12px;align-self:flex-start;padding:7px 15px;border:1px solid var(--color-line-2);border-radius:44px;background-color:var(--color-surface-2);font-size:calc(var(--body-font-size,16px) * .875);font-weight:600;line-height:1.28;color:var(--color-heading)}
.ct-post__title{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.3;color:var(--color-heading)}
.ct-post__title a{text-decoration:none;color:currentColor}
.ct-post__title a:focus-visible{outline:2px solid var(--color-heading);outline-offset:1px}
.ct-post__text{word-wrap:break-word;color:var(--color-ink-2)}
@media(hover:hover),(pointer:fine){.ct-post__title a:hover{text-decoration:underline}}
@media(min-width:768px){.ct-posts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:1200px){.ct-posts--three{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;

export default function PostCards({
  items,
  columns = 2,
  titleAs: TitleTag = "h3",
  testId,
}: {
  items: readonly PostCard[];
  /** Скільки колонок на широкому екрані. Тема дає два; гіди просять три. */
  columns?: 2 | 3;
  /** `h2` там, де картки самі є розділом; `h3` під заголовком секції. */
  titleAs?: "h2" | "h3";
  testId?: string;
}) {
  // 🔴 ПРАВИЛО КАТАЛОГУ: порожній перелік не малює нічого — ні сітки,
  // ні рамки. Картка CAMP-465 просить цього дослівно: «порожній блог не
  // ламає сторінку — секція просто не рендериться».
  if (items.length === 0) return null;

  return (
    <>
      <style href="ct-posts" precedence="ct-components">
        {POST_CSS}
      </style>
      <ul
        className={`ct-posts${columns === 3 ? " ct-posts--three" : ""}`}
        data-testid={testId}
      >
        {items.map((p) => (
          <li key={p.key} className="ct-post">
            <Link href={p.href} className="ct-post__media" tabIndex={-1} aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
              <img
                className={`ct-post__image${p.image ? "" : " ct-post__image--placeholder"}`}
                src={p.image?.src ?? "/logo.svg"}
                alt={p.image?.alt ?? ""}
                loading="lazy"
                data-testid={p.image ? undefined : "post-placeholder"}
              />
            </Link>
            {/* 🔴 ЗОБРАЖЕННЯ НЕ ДУБЛЮЄ ПОСИЛАННЯ ДЛЯ ЧИТАЧА ЕКРАНА.
                Воно клікабельне для миші, але `aria-hidden` і поза
                фокусом: інакше диктор оголошував би два однакові
                посилання на той самий матеріал поспіль. */}
            <div className="ct-post__content">
              {p.meta && <span className="ct-post__meta">{p.meta}</span>}
              <TitleTag className="ct-post__title">
                <Link href={p.href}>{p.title}</Link>
              </TitleTag>
              {p.excerpt && <p className="ct-post__text">{p.excerpt}</p>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
