import type { Metadata } from "next";
import ProviderCatalogue from "@/components/provider-catalogue";
import { listProviders } from "@/lib/rental-providers";

// CAMP-427 — сторінка вибору провайдера.
//
// 🔴 Дані беруться у ЗБІРЦІ, звуження робить браузер: сайт статичний, а
// компаній десяток. Правило звуження живе в `lib/rental-providers.ts`,
// тобто в одному місці, а не копією в компоненті.
export const metadata: Metadata = {
  title: "Прокат кемперів у ЄС: компанії, сервіси й парк",
  description:
    "Компанії прокату кемперів у Європейському Союзі з переліком сервісів і парку. Кожен факт має джерело й дату перевірки.",
};

export default async function ProvidersPage() {
  const all = await listProviders();
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">Компанії прокату кемперів</h1>
      <p className="mt-3 max-w-2xl">
        Числа депо й парку — <strong>заявлені самими компаніями</strong>, ми їх
        не вимірювали; поруч із кожним на сторінці компанії стоїть джерело й
        дата перевірки. Цін тут немає навмисно: вони змінюються щотижня, і
        будь-яке число тут було б застарілим раніше, ніж ви його прочитаєте.
      </p>
      {all.length === 0 ? (
        <p className="mt-8">Каталог ще не заповнений.</p>
      ) : (
        <div className="mt-8">
          <ProviderCatalogue all={all} />
        </div>
      )}
    </main>
  );
}
