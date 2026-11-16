import { needsAiDisclosure, PROVENANCE_LABEL, type Guide } from "@/lib/guides";
import { Block } from "@/components/layout";

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
const BULLET = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
    className="mt-1 h-5 w-5 shrink-0 text-heading"
  >
    <circle cx="12" cy="12" r="9" />
    <path
      d="m8.2 12.3 2.6 2.6 5-5.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * `showTitle={false}` — на сторінці гайда заголовок живе в банері
 * (CAMP-443/9), і другий `h1` зламав би обрис. Шухляда лишає свій.
 */
export default function GuideArticle({
  guide,
  showTitle = true,
}: {
  guide: Guide;
  showTitle?: boolean;
}) {
  const label = PROVENANCE_LABEL[guide.provenance];
  return (
    <>
      {showTitle && (
        <h1 className="mt-3 max-w-[22ch] text-3xl leading-tight md:text-[42px]">
          {guide.title}
        </h1>
      )}

      {/* 🔴 Before the text, always. */}
      <aside
        data-testid="provenance"
        data-provenance={guide.provenance}
        className={`${showTitle ? "mt-5 bg-surface-2" : "bg-surface"} rounded-card border border-line-2 p-4 text-sm leading-6 text-ink-2`}
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
        {guide.provenance !== "data-generated" &&
          needsAiDisclosure(guide.provenance) &&
          guide.generator && (
            <>
              {" "}
              The program is <code>{guide.generator}</code>.
            </>
          )}
        {guide.authorName && (
          <>
            {" "}
            Written by {guide.authorName}
            {guide.authorCredentials ? ` — ${guide.authorCredentials}` : ""}.
          </>
        )}
        {guide.factsCheckedAt && (
          <>
            {" "}
            The figures were taken from our records on{" "}
            <time dateTime={guide.factsCheckedAt}>
              {new Date(guide.factsCheckedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </time>
            .
          </>
        )}
      </aside>

      {guide.body && (
        <Block measure="read" className="mt-8 space-y-5 break-words text-ink-2">
          {guide.body.split("\n\n").map((block, i) => {
            if (block.startsWith("- ")) {
              return (
                <ul key={i} className="space-y-3">
                  {block.split("\n").map((line, j) => (
                    <li key={j} className="flex gap-3">
                      {BULLET}
                      <span>{line.replace(/^- /, "")}</span>
                    </li>
                  ))}
                </ul>
              );
            }
            // Блок-запитання — те, на що відповідає гайд; виділяється, а
            // не переписується. Лише форма: слова ті самі.
            if (i === 0 && block.endsWith("?")) {
              return (
                <p
                  key={i}
                  className="text-xl font-semibold leading-snug text-heading md:text-2xl"
                >
                  {block}
                </p>
              );
            }
            if (block.endsWith(":")) {
              return (
                <p key={i} className="font-semibold text-heading">
                  {block}
                </p>
              );
            }
            return <p key={i}>{block}</p>;
          })}
        </Block>
      )}
    </>
  );
}
