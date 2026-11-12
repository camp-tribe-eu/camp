# robots.txt: звідки взято імена ШІ-ботів

Прочитано curl 12.11.2026. Рішення власника 12.11.2026: усі боти дозволені,
кожен названий явно (`apps/web/src/lib/robots-rules.ts`). Адреси лежать тут, а
не в коді: сторож атрибуції (`attribution-sources.spec.ts`) вимагає, щоб кожен
зовнішній хост у виробничому коді був на сторінці джерел.

| Бот | Призначення за вендором | Джерело |
|---|---|---|
| OAI-SearchBot | показ у пошукових відповідях ChatGPT | https://platform.openai.com/docs/bots |
| ChatGPT-User | відвідини за дією користувача | https://platform.openai.com/docs/bots |
| GPTBot | збір для навчання моделей OpenAI | https://platform.openai.com/docs/bots |
| Claude-SearchBot | якість пошукових відповідей Claude | https://support.claude.com/en/articles/8896518 |
| Claude-User | людина питає Claude, той відкриває сайт | https://support.claude.com/en/articles/8896518 |
| ClaudeBot | збір для навчання моделей Anthropic | https://support.claude.com/en/articles/8896518 |
| PerplexityBot | пошук Perplexity, не навчання моделей | https://docs.perplexity.ai/guides/bots |
| Perplexity-User | дія користувача в Perplexity | https://docs.perplexity.ai/guides/bots |
| Google-Extended | навчання Gemini і grounding; на Google Search не впливає | https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers |
| Applebot-Extended | opt-out від навчання моделей Apple | https://support.apple.com/en-us/119829 |
| CCBot | відкритий корпус Common Crawl | https://commoncrawl.org/ccbot |
