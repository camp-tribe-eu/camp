import { expect, test } from "@playwright/test";
import {
  POSTS_PER_PAGE,
  pageCount,
  pageSlice,
  parsePageNumber,
  postList,
} from "@/lib/posts";

// CAMP-364 — пагінація каталогу блогу.
//
// 🔴 КОНСТАНТА ІМПОРТОВАНА, А НЕ ВПИСАНА ЧИСЛОМ. Якби тут стояло «10»,
// зміна `POSTS_PER_PAGE` на 12 лишила б набір зеленим і неправдивим —
// він перевіряв би сторінку, якої вже немає.

/** Підміна `fetch` на час одного випробування; завжди повертається назад. */
async function withApi(
  answers: Record<string, { status?: number; body: unknown }>,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    const hit = answers[new URL(String(url)).pathname];
    const { status = 200, body } = hit ?? { body: [] };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

test.describe("лічильник сторінок", () => {
  test("порожній блог це одна сторінка, а не нуль", () => {
    expect(pageCount(0)).toBe(1);
  });

  test("межа рівно на POSTS_PER_PAGE", () => {
    expect(pageCount(POSTS_PER_PAGE)).toBe(1);
    expect(pageCount(POSTS_PER_PAGE + 1)).toBe(2);
    expect(pageCount(POSTS_PER_PAGE * 3)).toBe(3);
    expect(pageCount(POSTS_PER_PAGE * 3 + 1)).toBe(4);
  });
});

test.describe("зріз сторінки", () => {
  const all = Array.from(
    { length: POSTS_PER_PAGE * 2 + 3 },
    (_, i) => `post-${i}`,
  );

  // 🔴 Властивість, а не переказ формули: сторінки мусять РОЗІБРАТИ
  // перелік — без втрат, без повторів і без зміни порядку. Зсув на
  // одиницю в будь-який бік ламає саме це, а не «slice(0,10)».
  test("сторінки разом дають увесь перелік рівно один раз", () => {
    const n = pageCount(all.length);
    const seen = Array.from({ length: n }, (_, i) => pageSlice(all, i + 1));
    expect(seen.flat()).toEqual(all);
    for (const [i, chunk] of seen.entries()) {
      expect(chunk.length, `сторінка ${i + 1} порожня або завелика`)
        .toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(POSTS_PER_PAGE);
    }
  });

  test("за межами переліку зріз порожній — це і є 404", () => {
    expect(pageSlice(all, pageCount(all.length) + 1)).toEqual([]);
    expect(pageSlice(all, 9999)).toEqual([]);
  });
});

test.describe("номер сторінки з адреси", () => {
  test("приймається тільки точний запис цілого від двох", () => {
    expect(parsePageNumber("2")).toBe(2);
    expect(parsePageNumber("10")).toBe(10);
  });

  // 🔴 Кожен відкинутий запис — це дублікат для пошуковика, якби його
  // прийняли: та сама добірка під іншою адресою з власним canonical.
  for (const raw of [
    "1", // перша сторінка живе за `/blog`
    "0",
    "-2",
    "+2",
    "02",
    "2.0",
    " 2",
    "2 ",
    "2abc",
    "abc",
    "",
    "٢", // арабсько-індійська двійка
    "²",
    "2e1",
    "0x2",
    "Infinity",
  ]) {
    test(`«${raw}» відкидається`, () => {
      expect(parsePageNumber(raw)).toBeNull();
    });
  }
});

test.describe("слаг, зайнятий маршрутом пагінації", () => {
  test("допис зі слагом «page» падає гучно й називає себе", async () => {
    await withApi(
      {
        "/posts": {
          body: {
            posts: [
              { slug: "page", title: "T", summary: null, publishedAt: null, authorName: null },
            ],
          },
        },
      },
      async () => {
        await expect(postList()).rejects.toThrow(/«page».*зарезервован/s);
      },
    );
  });

  test("звичайний слаг проходить", async () => {
    await withApi(
      {
        "/posts": {
          body: {
            posts: [
              { slug: "pages-are-fine", title: "T", summary: null, publishedAt: null, authorName: null },
            ],
          },
        },
      },
      async () => {
        expect((await postList()).map((p) => p.slug)).toEqual([
          "pages-are-fine",
        ]);
      },
    );
  });
});
