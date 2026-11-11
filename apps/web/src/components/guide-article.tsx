import { needsAiDisclosure, PROVENANCE_LABEL, type Guide } from '@/lib/guides';
import { Block } from '@/components/layout';

/**
 * Тіло гіда — заголовок, позначка походження й текст.
 *
 * 🔴 ЧОМУ ЦЕ ОКРЕМИЙ КОМПОНЕНТ, А НЕ ШМАТОК СТОРІНКИ. CAMP-460 питає
 * власник: «при натисканні на картку навіщо переводити на наступну іншу
 * сторінку якщо ми на цій же можемо… дровер боковий як в темі». Відповідь
 * — робимо обидва: шухляда для того, хто клікнув, і власна адреса для
 * того, хто прийшов із пошуку.
 *
 * Два рендери того самого — це рівно та форма, де вміст розходиться
 * мовчки: у шухляді забули позначку походження, і сторінка з 200 каже
 * одне, а шухляда інше. Тому вміст тут ОДИН, а різниця лише в оболонці.
 * `tests/unit/guide-article.spec.tsx` звіряє, що обидва шляхи дають той
 * самий текст.
 *
 * 🔴 Позначка походження — ПЕРЕД текстом, і це не верстка. Ст. 50(2) AI
 * Act просить маркувати машинний текст; позначка, яку читач зустрічає
 * після того, як прочитав і повірив, є позначкою лише за формою.
 */
export default function GuideArticle({ guide }: { guide: Guide }) {
  const label = PROVENANCE_LABEL[guide.provenance];
  return (
    <>
    <h1 className="mt-3 max-w-[22ch] text-3xl leading-tight md:text-[42px]">
      {guide.title}
    </h1>

    {/* 🔴 Before the text, always. */}
    <aside
      data-testid="provenance"
      data-provenance={guide.provenance}
      className="mt-5 rounded-card border border-line-2 bg-surface-2 p-4 text-sm leading-6 text-ink-2"
    >
      <strong className="font-semibold text-heading">
        {label?.short ?? guide.provenance}
      </strong>
      {label?.explain && <> {label.explain}</>}
      {/* 🔴 CAMP-463: ІМʼЯ ПРОГРАМИ — ЛИШЕ ДЛЯ ТЕКСТУ, ЯКИЙ ПИСАЛА МОВНА МОДЕЛЬ.
          `region-facts@2` стояло на 463 сторінках гідів про воду як «The
          program is region-facts@2» — внутрішня назва лічильника записів,
          а не відповідь читача на питання «хто це написав» (на нього
          відповідає позначка вище: «written by a program from our own
          records»). Для моделі ім'я лишається — ст. 50(2) AI Act. У
          JSON-LD `generator` лишається як було. */}
      {guide.provenance !== 'data-generated' &&
        needsAiDisclosure(guide.provenance) &&
        guide.generator && <> The program is <code>{guide.generator}</code>.</>}
      {guide.authorName && (
        <>
          {' '}
          Written by {guide.authorName}
          {guide.authorCredentials ? ` — ${guide.authorCredentials}` : ''}.
        </>
      )}
      {guide.factsCheckedAt && (
        <>
          {' '}
          The figures were taken from our records on{' '}
          <time dateTime={guide.factsCheckedAt}>
            {new Date(guide.factsCheckedAt).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </time>
          .
        </>
      )}
    </aside>

    {guide.body && (
      <Block measure="read" className="mt-8 space-y-4 text-ink-2">
        {guide.body.split('\n\n').map((block, i) => {
          if (block.startsWith('- ')) {
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.split('\n').map((line, j) => (
                  <li key={j}>{line.replace(/^- /, '')}</li>
                ))}
              </ul>
            );
          }
          return <p key={i}>{block}</p>;
        })}
      </Block>
    )}
    </>
  );
}
