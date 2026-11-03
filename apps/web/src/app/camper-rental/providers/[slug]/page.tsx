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
    title: `${p.name} — прокат кемперів`,
    description: `Контакти, сервіси й парк компанії ${p.name}. Кожен факт із джерелом і датою перевірки.`,
  };
}

const AVAILABILITY_LABEL = {
  included: "входить у ціну",
  extra: "за окрему плату",
  unavailable: "компанія не надає",
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
        <Link href="/camper-rental/providers">← усі компанії</Link>
      </p>
      <h1 className="mt-4 text-3xl font-bold">{p.name}</h1>

      {/* 🔴 Абзац — це те, заради чого каталог існує. Без нього сторінка
          компанії нічим не відрізняється від рядка таблиці, і читач не
          дізнається, чим ця компанія відрізняється від сусідньої. Сівалка
          не пропустить провайдера без вступу. */}
      {p.intro && <p className="mt-4 max-w-2xl">{p.intro}</p>}

      {p.whatToKnow && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Що варто знати</h2>
          <p className="mt-2 max-w-2xl">{p.whatToKnow}</p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-xl font-semibold">Контакти</h2>
        <dl className="mt-2 grid gap-1 text-sm">
          {p.legalName && (
            <div>
              <dt className="inline font-medium">Юридична назва: </dt>
              <dd className="inline">{p.legalName}</dd>
            </div>
          )}
          {p.registrationNumber && (
            <div>
              <dt className="inline font-medium">Реєстраційний номер: </dt>
              <dd className="inline">{p.registrationNumber}</dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">Країна: </dt>
            <dd className="inline">{p.homeCountry}</dd>
          </div>
          {p.website && (
            <div>
              <dt className="inline font-medium">Сайт: </dt>
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
              <dt className="inline font-medium">Пошта: </dt>
              <dd className="inline">{p.email}</dd>
            </div>
          )}
          {p.phone && (
            <div>
              <dt className="inline font-medium">Телефон: </dt>
              <dd className="inline">{p.phone}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* 🔴 «За даними компанії» — не ввічливість, а точність: ці числа
          заявлені, а не зміряні нами, і читач має знати різницю. */}
      <section className="mt-6">
        <h2 className="text-xl font-semibold">Масштаб, за даними компанії</h2>
        <p className="mt-2 text-sm">
          {p.declaredDepotCount !== null && (
            <>депо: {p.declaredDepotCount} · </>
          )}
          {p.declaredFleetSize !== null && <>парк: {p.declaredFleetSize} · </>}
          {p.foundedYear !== null && <>працює з {p.foundedYear}</>}
        </p>
        {p.sourceUrl && (
          <p className="mt-1 text-xs">
            Джерело:{" "}
            <a
              href={p.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {p.sourceUrl.replace(/^https:\/\//, "")}
            </a>
            {p.sourceCheckedOn && <> · перевірено {p.sourceCheckedOn}</>}
          </p>
        )}
      </section>

      {p.services.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Сервіси</h2>
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
            Тут лише те, що ми перевірили. Сервіс, якого немає в переліку, — не
            перевірений нами, а не відсутній у компанії.
          </p>
        </section>
      )}

      {p.vehicles.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Парк</h2>
          <ul className="mt-2 grid gap-1 text-sm" data-testid="vehicles">
            {p.vehicles.map((v) => (
              <li key={v.slug}>
                <span className="font-medium">{v.name}</span>
                {v.berths !== null && <> · спальних місць: {v.berths}</>}
                {v.belted_seats !== null && (
                  <> · місць із пасками: {v.belted_seats}</>
                )}
                {v.length_cm !== null && (
                  <> · довжина: {(v.length_cm / 100).toFixed(2)} м</>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.reviewProfiles.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Відгуки</h2>
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
            Оцінок ми не показуємо: умови цих майданчиків дозволяють це лише з
            їхнього письмового дозволу або через платний доступ. Посилання веде
            на їхню сторінку, де видно повну картину.
          </p>
        </section>
      )}
    </main>
  );
}
