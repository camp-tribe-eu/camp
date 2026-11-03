import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { listProviders } from "@/lib/rental-providers";

// CAMP-427 — сторінка однієї компанії, за зразком single product page.

interface ServiceRow {
  code: string;
  availability: "included" | "extra" | "unavailable";
  note: string | null;
  source_url: string | null;
  source_checked_on: string | null;
}
interface VehicleRow {
  name: string;
  slug: string;
  berths: number | null;
  belted_seats: number | null;
  length_cm: number | null;
}
interface ProviderPage {
  slug: string;
  name: string;
  intro: string | null;
  whatToKnow: string | null;
  legalName: string | null;
  registrationNumber: string | null;
  homeCountry: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  declaredDepotCount: number | null;
  declaredFleetSize: number | null;
  foundedYear: number | null;
  sourceUrl: string | null;
  sourceCheckedOn: string | null;
  services: ServiceRow[];
  vehicles: VehicleRow[];
  reviewProfiles: { source: string; profileUrl: string }[];
}

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

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/camper-rental/providers">← all companies</Link>
      </p>
      <h1 className="mt-4 text-3xl font-bold">{p.name}</h1>

      {/* 🔴 Абзац — це те, заради чого каталог існує. Без нього сторінка
          компанії нічим не відрізняється від рядка таблиці, і читач не
          дізнається, чим ця компанія відрізняється від сусідньої. Сівалка
          не пропустить провайдера без вступу. */}
      {p.intro && <p className="mt-4 max-w-2xl">{p.intro}</p>}

      {p.whatToKnow && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">What to know</h2>
          <p className="mt-2 max-w-2xl">{p.whatToKnow}</p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-xl font-semibold">Contacts</h2>
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
            <dt className="inline font-medium">Country: </dt>
            <dd className="inline">{p.homeCountry}</dd>
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
        <h2 className="text-xl font-semibold">
          Scale, as the company states it
        </h2>
        <p className="mt-2 text-sm">
          {p.declaredDepotCount !== null && (
            <>depots: {p.declaredDepotCount} · </>
          )}
          {p.declaredFleetSize !== null && <>fleet: {p.declaredFleetSize} · </>}
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

      {p.services.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Services</h2>
          <ul className="mt-2 grid gap-1 text-sm" data-testid="services">
            {p.services.map((s) => (
              <li key={s.code}>
                <span className="font-medium">{s.code.replace(/_/g, " ")}</span>{" "}
                — {AVAILABILITY_LABEL[s.availability]}
                {s.note && <> ({s.note})</>}
              </li>
            ))}
          </ul>
          {/* 🔴 Відсутність рядка — це «ми не перевіряли», а не «компанія
              не дає». Сказати це вголос дешевше, ніж бути звинуваченим у
              неправді про чужий бізнес. */}
          <p className="mt-2 text-xs">
            Only what we checked is here. A service that is not in the list is
            one we have not verified, not one the company fails to offer.
          </p>
        </section>
      )}

      {p.vehicles.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Fleet</h2>
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
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.reviewProfiles.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Reviews</h2>
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
            We do not show scores: the terms of these platforms allow it only
            with their written permission or through paid access. The link goes
            to their page, where the full picture is one click away.
          </p>
        </section>
      )}
    </main>
  );
}
