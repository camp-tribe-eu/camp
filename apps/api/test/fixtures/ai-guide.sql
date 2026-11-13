-- Один гайд, написаний за участі мовної моделі — ЛИШЕ для фікстури CI.
--
-- 🔴 ЧОМУ ВІН ІСНУЄ. CAMP-463 (fb2102f3) звузив тест «AI-written guide
-- names the model» до `ai-generated` / `ai-assisted`. Генератор
-- `region-facts@2` дає лише `data-generated`, тож відтоді цей тест не
-- біжить НІДЕ: чотири пропуски на повній матриці (chromium, firefox,
-- webkit, mobile-chrome), 150 → 154 проти бюджету 150 — і `e2e` на `main`
-- червоний у КОЖНОМУ прогоні з 11.11.2026 22:27 UTC (12 із 12, заміряно
-- по логах 43111889330…43309227482). На PR webkit мовчить, пропусків
-- три, і ворота цього не бачать.
--
-- Підняти бюджет до 154 означало б записати, що вимогу ст. 50(2)
-- AI Act у нас не перевіряє жоден прогін. Тому тест отримує те, чого
-- йому бракує: гайд, який він шукає.
--
-- 🔴 ЦЕ НЕ ТЕКСТ ДЛЯ ПРОДУ, і файл не названо `ci-seed-*.sql` з тієї ж
-- причини, що й `blog-post.sql`: `regenerate.sh` збирає ті файли у
-- зліпок продакшну, а цей рядок зліпком не є. `generator` тут — умовне
-- імʼя, а не твердження про те, чим писали справжні гайди.
--
-- Вантажиться ПІСЛЯ `generate.ts`: той прибирає лише свої
-- (`generator LIKE 'region-facts@%'`), цього не чіпає.

BEGIN;

INSERT INTO guides (slug, category, status, provenance, generator,
                    reading_minutes, facts_checked_at, published_at)
VALUES ('si-bovec-motorhome', 'region', 'published', 'ai-assisted',
        'ci-fixture-model', 1, '2026-11-01', '2026-11-01T09:00:00Z');

INSERT INTO guide_translations (guide_id, language_code, title, summary, body)
SELECT id,
       'en-GB',
       'Motorhome stopovers around Bovec',
       'A fixture guide: it exists so the AI disclosure has a page to be checked on.',
       E'Where can a motorhome stop around Bovec?\n\nThis page is a test fixture. It is drafted with the help of a language model and says so above the text, which is the only thing it is here to show.'
  FROM guides
 WHERE slug = 'si-bovec-motorhome';

COMMIT;
