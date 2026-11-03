import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch, countryName } from "@/lib/api";
import { jsonLdProps } from "@/lib/jsonld";
import { providerGraph, providerPath } from "@/lib/provider-jsonld";
import {
  listProviders,
  serviceLabel,
  type ProviderPage,
} from "@/lib/rental-providers";

// CAMP-427 — сторінка однієї компанії, за зразком single product page.

async function getProvider(slug: string): Promise<ProviderPage | null> {
  const res = await apiFetch(`/rental/providers/${encodeURIComponent(slug)}`, {
    next: { revalidate: 86_400 },
  });
  if (!res.ok) return null;
  return (await res.json()) as ProviderPage;
}

export async function generateStaticParams() {
  return (await listProviders()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProvider(slug);
  if (!p) return {};
  return {
    title: `${p.name} — camper rental`,
    description: `Contacts, services and fleet of ${p.name}. Every fact with its source and the date it was checked.`,
  };
}

const AVAILABILITY_LABEL = {
  included: "included in the price",
  extra: "costs extra",
  unavailable: "the company does not offer it",
} as const;

const SOURCE_LABEL: Record<string, string> = {
  trustpilot: "Trustpilot",
  google: "Google",
};

export default async function ProviderPageView({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = await getProvider(slug);
  if (!p) notFound();

  const path = providerPath(p.slug);

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      {/* CAMP-431 (пункт 4): граф компанії. Лише те, що є на сторінці —
          ні рейтингу, ні ціни, бо ні того, ні того ми не тримаємо. */}
      <script {...jsonLdProps(providerGraph(p, path))} />
      <p className="text-sm">
        <Link href="/camper-rental/providers">← all companies</Link>
      </p>
      <h1 className="mt-4 text-3xl font-bold leading-tight text-heading md:text-[42px]">
        {p.name}
      </h1>

      {/* 🔴 ДВІ КОЛОНКИ — ЦЕ НЕ СМАК, А ЧИСЛА З ТЕМИ FUSE.
          `assets/product.build.css`, сторінка товару:

            .product       { display:flex; column-gap:12px }
            .product-media { width: calc(100% - 480px - 12px) }
            .product-form  { position:sticky; top:0; width:480px }
            @media (max-width:1199.98px) { .product-media { width:100% } }

          Тобто ліворуч — те, заради чого на сторінку прийшли, праворуч —
          панель 480 px, де ухвалюється рішення, і вона їде за читачем.
          Нижче 1200 px усе стає одним стовпцем. Власник просив сингл
          «за зразком single product page» — ось він, із заміром, а не
          з голови. 75rem у Tailwind це рівно наш --breakpoint-xl=1200px. */}
      <div className="mt-6 flex flex-col gap-3 xl:flex-row">
        <div className="min-w-0 xl:w-[calc(100%-480px-12px)]">
          {/* 🔴 Абзац — це те, заради чого каталог існує. Без нього
              сторінка компанії нічим не відрізняється від рядка таблиці,
              і читач не дізнається, чим ця компанія відрізняється від
              сусідньої. Сівалка не пропустить провайдера без вступу. */}
          {p.intro && <p className="max-w-prose text-ink-2">{p.intro}</p>}

          {p.whatToKnow && (
            <section className="mt-6">
              <h2 className="text-2xl font-bold text-heading">What to know</h2>
              <p className="mt-3 max-w-prose text-ink-2">{p.whatToKnow}</p>
            </section>
          )}

          {p.services.length > 0 && (
            <section className="mt-6">
              <h2 className="text-2xl font-bold text-heading">Services</h2>
              <ul className="mt-2 grid gap-1 text-sm" data-testid="services">
                {p.services.map((s) => (
                  <li key={s.code}>
                    <span className="font-medium">{serviceLabel(s.code)}</span>{" "}
                    — {AVAILABILITY_LABEL[s.availability]}
                    {s.note && <> ({s.note})</>}
                    {/* Та сама умова, що й для парку: умови прокату
                        міняються, тож рядок несе дату свого прочитання. */}
                    {s.source_checked_on && (
                      <span
                        className="text-ink-2"
                        data-testid="service-checked"
                      >
                        {" "}
                        · read{" "}
                        {s.source_url ? (
                          <a
                            href={s.source_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            {s.source_checked_on}
                          </a>
                        ) : (
                          s.source_checked_on
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {/* 🔴 Відсутність рядка — це «ми не перевіряли», а не «компанія
                  не дає». Сказати це вголос дешевше, ніж бути звинуваченим у
                  неправді про чужий бізнес. */}
              <p className="mt-2 text-xs">
                Only what we checked is here. A service that is not in the list
                is one we have not verified, not one the company fails to offer.
              </p>
            </section>
          )}

          {p.vehicles.length > 0 && (
            <section className="mt-6">
              <h2 className="text-2xl font-bold text-heading">Fleet</h2>
              <ul className="mt-2 grid gap-1 text-sm" data-testid="vehicles">
                {p.vehicles.map((v) => (
                  <li key={v.slug}>
                    <span className="font-medium">{v.name}</span>
                    {v.berths !== null && <> · berths: {v.berths}</>}
                    {v.belted_seats !== null && (
                      <> · belted seats: {v.belted_seats}</>
                    )}
                    {v.length_cm !== null && (
                      <> · length: {(v.length_cm / 100).toFixed(2)} m</>
                    )}
                    {/* 🔴 CAMP-371: ДАТА ПРОЧИТАННЯ СТОЇТЬ ПОРУЧ ІЗ ФАКТОМ.
                        «У них є ця модель» без дати — твердження про
                        сьогодні, якого ми не перевіряли: машину могли
                        продати. Дата в базі була від самого початку, її
                        просто ніхто не показував. */}
                    {v.source_checked_on && (
                      <span
                        className="text-ink-2"
                        data-testid="vehicle-checked"
                      >
                        {" "}
                        · read{" "}
                        {v.source_url ? (
                          <a
                            href={v.source_url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            {v.source_checked_on}
                          </a>
                        ) : (
                          v.source_checked_on
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {/* Те саме застереження, що й про сервіси: перелік — це те,
                  що ми бачили в названий день, а не склад парку сьогодні. */}
              <p className="mt-2 text-xs text-ink-2">
                What a company had on the day we read its page. Fleets change;
                ask them before you plan around a model.
              </p>
            </section>
          )}
        </div>

        {/* Права панель 480 px, що їде за читачем — місце, де
            ухвалюється рішення. У теми це форма купівлі; у нас
            купити нічого, тому тут контакти, заявлений масштаб і
            посилання на відгуки. `self-start`, бо sticky всередині
            flex-рядка інакше розтягується на всю висоту й не їде. */}
        <aside
          data-testid="provider-panel"
          className="shrink-0 self-start rounded-card border border-line bg-surface p-6 shadow-card xl:sticky xl:top-4 xl:w-[480px]"
        >
          <section>
            <h2 className="text-2xl font-bold text-heading">Contacts</h2>
            <dl className="mt-2 grid gap-1 text-sm">
              {p.legalName && (
                <div>
                  <dt className="inline font-medium">Legal name: </dt>
                  <dd className="inline">{p.legalName}</dd>
                </div>
              )}
              {p.registrationNumber && (
                <div>
                  <dt className="inline font-medium">Registration number: </dt>
                  <dd className="inline">{p.registrationNumber}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-medium">Registered in: </dt>
                <dd className="inline">{countryName(p.homeCountry)}</dd>
              </div>
              {p.website && (
                <div>
                  <dt className="inline font-medium">Website: </dt>
                  <dd className="inline">
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {p.website.replace(/^https:\/\//, "")}
                    </a>
                  </dd>
                </div>
              )}
              {p.email && (
                <div>
                  <dt className="inline font-medium">Email: </dt>
                  <dd className="inline">{p.email}</dd>
                </div>
              )}
              {p.phone && (
                <div>
                  <dt className="inline font-medium">Phone: </dt>
                  <dd className="inline">{p.phone}</dd>
                </div>
              )}
            </dl>
          </section>

          {/* 🔴 «За даними компанії» — не ввічливість, а точність: ці числа
              заявлені, а не зміряні нами, і читач має знати різницю. */}
          <section className="mt-6">
            <h2 className="text-2xl font-bold text-heading">
              Scale, as the company states it
            </h2>
            <p className="mt-2 text-sm">
              {p.declaredDepotCount !== null && (
                <>depots: {p.declaredDepotCount} · </>
              )}
              {p.declaredFleetSize !== null && (
                <>fleet: {p.declaredFleetSize} · </>
              )}
              {p.foundedYear !== null && <>trading since {p.foundedYear}</>}
            </p>
            {p.sourceUrl && (
              <p className="mt-1 text-xs">
                Source:{" "}
                <a
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  {p.sourceUrl.replace(/^https:\/\//, "")}
                </a>
                {p.sourceCheckedOn && <> · checked {p.sourceCheckedOn}</>}
              </p>
            )}
          </section>

          {p.reviewProfiles.length > 0 && (
            <section className="mt-6">
              <h2 className="text-2xl font-bold text-heading">Reviews</h2>
              <p className="mt-2 text-sm" data-testid="review-links">
                {p.reviewProfiles.map((r, i) => (
                  <span key={r.source}>
                    {i > 0 && " · "}
                    <a
                      href={r.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {SOURCE_LABEL[r.source] ?? r.source}
                    </a>
                  </span>
                ))}
              </p>
              {/* Оцінок тут немає навмисно — див. коментар у компоненті каталогу. */}
              <p className="mt-1 text-xs">
                We do not show scores: the terms of these platforms allow it
                only with their written permission or through paid access. The
                link goes to their page, where the full picture is one click
                away.
              </p>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
