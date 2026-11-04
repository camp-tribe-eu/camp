import type { Metadata } from "next";
import ProviderCatalogue from "@/components/provider-catalogue";
import { collectionGraph, jsonLdProps } from "@/lib/jsonld";
import { listCamperTypes, listProviders } from "@/lib/rental-providers";

// CAMP-427 — сторінка вибору провайдера.
//
// 🔴 Дані беруться у ЗБІРЦІ, звуження робить браузер: сайт статичний, а
// компаній десяток. Правило звуження живе в `lib/rental-providers.ts`,
// тобто в одному місці, а не копією в компоненті.
export const metadata: Metadata = {
  title: "Camper rental in the EU: companies, services and fleet",
  description:
    "Camper rental companies in the European Union, with the services and fleet each one lists. Every fact carries its source and the date it was checked.",
};

export default async function ProvidersPage() {
  // 🔴 CAMP-371. Таксономія типів іде поруч із компаніями, і теж у збірці:
  // пʼять типів з бази, не константа в коді.
  const [all, types] = await Promise.all([listProviders(), listCamperTypes()]);
  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      {/* 🔴 Структуровані дані на КОЖНІЙ сторінці — вимога сторожа
          `check-structured-data`, і він спіймав цю сторінку порожньою.
          CollectionPage зі списком компаній описує рівно те, чим сторінка
          є: перелік, а не стаття. */}
      <script
        {...jsonLdProps(
          collectionGraph({
            name: "Camper rental companies in the EU",
            description:
              "Camper rental companies in the European Union, with the services and fleet each one lists.",
            path: "/camper-rental/providers",
            items: all.map((p) => ({
              name: p.name,
              path: `/camper-rental/providers/${p.slug}`,
            })),
          }),
        )}
      />
      <h1 className="text-3xl font-bold">Camper rental companies</h1>
      <p className="mt-3 max-w-2xl">
        The depot and fleet figures are{" "}
        <strong>what each company states about itself</strong>; we did not
        measure them, and on the company&apos;s own page the source and the date
        we checked it stand next to the number. There are no prices here on
        purpose: they change weekly, and any figure we printed would be out of
        date before you read it.
      </p>
      {all.length === 0 ? (
        <p className="mt-8">The catalogue is not filled in yet.</p>
      ) : (
        <div className="mt-8">
          <ProviderCatalogue all={all} types={types} />
        </div>
      )}
    </main>
  );
}
