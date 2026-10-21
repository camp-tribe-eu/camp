import { expect, test } from '@playwright/test';
import BlogIndexView, { blogPagePath } from '../../src/components/blog-index';
import BlogIndexPage from '../../src/app/blog/page/[n]/page';
import BlogPost from '../../src/app/blog/[slug]/page';
import { POSTS_PER_PAGE, type PostSummary } from '../../src/lib/posts';
import { renderAsyncComponent, renderComponent } from './render-component';

// CAMP-364 — 🔴 D1 З РЕЦЕНЗІЇ #311: КОМПОНЕНТ І НОВИЙ МАРШРУТ НЕ МАЛИ
// ЖОДНОГО ТЕСТУ.
//
// Усі шість мутацій, якими я перевіряв пагінацію, били по `lib/posts.ts`.
// А поява пагінації залежить від ОДНОГО виразу в компоненті —
// `pageCount(all.length)`. Заміряно рецензією: мутація на
// `pageCount(posts.length)` прибирає пагінацію з обох сторінок цілком
// (дописи з одинадцятого недосяжні, з другої сторінки немає «Previous»),
// і ВЕСЬ набір лишається зеленим.
//
// Тому тут перевіряється те, що видно читачеві у HTML, а не те, що
// повертають функції.

const post = (i: number): PostSummary => ({
  slug: `post-${i}`,
  title: `Post ${i}`,
  summary: `Summary ${i}`,
  publishedAt: `2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  authorName: 'Yurii S',
});

const many = Array.from({ length: POSTS_PER_PAGE * 2 + 3 }, (_, i) => post(i));
const slice = (n: number) =>
  many.slice((n - 1) * POSTS_PER_PAGE, n * POSTS_PER_PAGE);

/** Адреси всіх посилань пагінації в порядку появи. */
const pagerLinks = (html: string): string[] => {
  const nav = html.match(/<nav[^>]*data-testid="pagination"[\s\S]*?<\/nav>/);
  if (!nav) return [];
  return [...nav[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
};

const cardCount = (html: string) =>
  (html.match(/class="[^"]*rounded-card[^"]*"/g) ?? []).length;

test.describe('🔴 каталог блогу: що бачить читач', () => {
  test('сторінка 1 з трьох: десять карток, «Next», без «Previous»', () => {
    const html = renderComponent(BlogIndexView, {
      all: many,
      posts: slice(1),
      page: 1,
    });
    expect(cardCount(html)).toBe(POSTS_PER_PAGE);
    expect(html).toContain('Page 1 of 3');
    expect(pagerLinks(html)).toEqual(['/blog/page/2']);
    expect(html).not.toContain('>Previous<');
  });

  test('сторінка 2: обидва боки, і «Previous» веде на /blog без суфікса', () => {
    const html = renderComponent(BlogIndexView, {
      all: many,
      posts: slice(2),
      page: 2,
    });
    expect(html).toContain('Page 2 of 3');
    expect(pagerLinks(html)).toEqual(['/blog', '/blog/page/3']);
  });

  test('остання сторінка: три картки, «Next» немає', () => {
    const html = renderComponent(BlogIndexView, {
      all: many,
      posts: slice(3),
      page: 3,
    });
    expect(cardCount(html)).toBe(3);
    expect(html).toContain('Page 3 of 3');
    expect(pagerLinks(html)).toEqual(['/blog/page/2']);
    expect(html).not.toContain('>Next<');
  });

  // 🔴 САМЕ ЦЕ ПРОПУСКАВ НАБІР. Зріз завжди має щонайбільше
  // POSTS_PER_PAGE елементів, тож `pageCount(posts.length)` на першій
  // сторінці дає 1 — і пагінація зникає разом із доступом до решти
  // дописів. Перевіряється не число, а НАЯВНІСТЬ виходу з першої
  // сторінки при повному переліку.
  test('пагінація рахується з УСЬОГО переліку, а не зі зрізу', () => {
    const html = renderComponent(BlogIndexView, {
      all: many,
      posts: slice(1),
      page: 1,
    });
    expect(
      html,
      'пагінації немає — з першої сторінки неможливо дійти до решти',
    ).toContain('data-testid="pagination"');
    expect(pagerLinks(html).length).toBeGreaterThan(0);
  });

  test('один допис — пагінації немає взагалі', () => {
    const one = [post(0)];
    const html = renderComponent(BlogIndexView, {
      all: one,
      posts: one,
      page: 1,
    });
    expect(html).not.toContain('data-testid="pagination"');
    expect(html).not.toContain(' of ');
  });

  test('порожній блог каже про це словами', () => {
    const html = renderComponent(BlogIndexView, { all: [], posts: [], page: 1 });
    expect(html).toContain('data-testid="blog-empty"');
    expect(html).not.toContain('data-testid="pagination"');
  });

  test('перша сторінка живе за /blog, а не за /blog/page/1', () => {
    expect(blogPagePath(1)).toBe('/blog');
    expect(blogPagePath(2)).toBe('/blog/page/2');
  });
});

/** Підміна `fetch` на час одного випробування; завжди повертається назад. */
async function withApi(
  answers: Record<string, { status?: number; body: unknown }>,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    const hit = answers[new URL(String(url)).pathname];
    const { status = 200, body } = hit ?? { status: 404, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

test.describe('🔴 маршрут /blog/page/[n]', () => {
  const api = { '/posts': { body: { posts: many } } };

  test('друга сторінка віддає свої дописи', async () => {
    await withApi(api, async () => {
      const html = await renderAsyncComponent(BlogIndexPage, {
        params: Promise.resolve({ n: '2' }),
      });
      expect(html).toContain('Page 2 of 3');
      expect(html).toContain(`/blog/${many[POSTS_PER_PAGE].slug}`);
      expect(html).not.toContain(`/blog/${many[0].slug}"`);
    });
  });

  // 🔴 404 ТУТ — ЦЕ НЕ ДРІБНИЦЯ. Сторінка за межами переліку, віддана з
  // кодом 200, це запрошення пошуковику індексувати /blog/page/9999.
  for (const n of ['1', '4', '9999', '02', '2abc']) {
    test(`«${n}» це 404, а не порожній каталог`, async () => {
      await withApi(api, async () => {
        await expect(
          renderAsyncComponent(BlogIndexPage, {
            params: Promise.resolve({ n }),
          }),
        ).rejects.toThrow();
      });
    });
  }
});

test.describe('🔴 «читати далі» на сторінці допису', () => {
  const three = [post(0), post(1), post(2)];
  const content = (slug: string) => ({
    body: {
      slug,
      title: `Post ${slug}`,
      metaTitle: null,
      metaDescription: null,
      noindex: false,
      sections: [{ type: 'prose', variant: null, heading: null,
        subheading: null, body: 'word '.repeat(50), imageUrl: null,
        imageAlt: null, ctaHref: null, ctaLabel: null, items: [] }],
    },
  });

  const render = async (slug: string, posts: PostSummary[]) => {
    let html = '';
    await withApi(
      { '/posts': { body: { posts } }, [`/posts/${slug}`]: content(slug) },
      async () => {
        html = await renderAsyncComponent(BlogPost, {
          params: Promise.resolve({ slug }),
        });
      },
    );
    return html;
  };

  const nextLinks = (html: string) => {
    const nav = html.match(/<nav[^>]*data-testid="read-next"[\s\S]*?<\/nav>/);
    return nav ? [...nav[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]) : [];
  };

  test('перший допис має одного сусіда, середній двох, останній одного', async () => {
    expect(nextLinks(await render('post-0', three))).toEqual(['/blog/post-1']);
    expect(nextLinks(await render('post-1', three))).toEqual([
      '/blog/post-0',
      '/blog/post-2',
    ]);
    expect(nextLinks(await render('post-2', three))).toEqual(['/blog/post-1']);
  });

  test('єдиний допис — блоку «читати далі» немає', async () => {
    const html = await render('post-0', [post(0)]);
    expect(html).not.toContain('data-testid="read-next"');
  });

  test('час читання стоїть у шапці допису', async () => {
    const html = await render('post-0', three);
    expect(html).toContain('data-testid="reading-time"');
    expect(html).toContain('1 min read');
  });
});
