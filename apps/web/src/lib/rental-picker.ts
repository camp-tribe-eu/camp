import { countryName } from "./api";
import {
  countriesOf,
  type CamperType,
  type Provider,
} from "./rental-providers";
import { isUnpublishedCountry } from "./unpublished-countries";

// CAMP-461 — що саме пропонує віджет на хабі оренди.
//
// 🔴 ПЕРЕЛІК — ЛИШЕ З ТОГО, ЩО Є В КАТАЛОЗІ. Країна, у якій жодна компанія
// не видає машин, дала б «0 із N» одразу після кліку; тип, якого жодна
// компанія не назвала, — теж. Тому віджет не має власного списку країн чи
// типів: він виводиться з тих самих компаній, які покаже каталог.
//
// 🔴 КІПР НЕ ПОКАЗУЄМО (рішення власника 26.10.2026). У даних компаній він
// є (`provider-countries.json`), у читача — ні.
//
// 🔴 КОДИ ДЖЕРЕЛА ПЕРЕЛІЧЕНО, А НЕ ПРИПУЩЕНО (див. тест): у трьох файлах
// засіву компаній 26 різних кодів країн, усі — ISO 3166-1 alpha-2 держав
// ЄС-27 (без MT); `EL` чи `UK` серед них немає. Якби був `EL`, `countryName`
// повернув би його ж літерами, і в селекті стояв би код замість назви.

export interface PickerChoices {
  countries: Array<{ code: string; name: string }>;
  types: CamperType[];
}

export function pickerChoices(
  providers: readonly Provider[],
  types: readonly CamperType[],
): PickerChoices {
  const countries = countriesOf(providers as Provider[])
    .filter((c) => !isUnpublishedCountry(c))
    .map((code) => ({ code, name: countryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const used = new Set(providers.flatMap((p) => p.camperTypeSlugs));
  return {
    countries,
    types: types.filter((t) => used.has(t.slug)),
  };
}
