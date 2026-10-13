import { expect, test } from '@playwright/test';

import About from '@/app/about/page';
import Contact from '@/app/contact/page';
import { COMPANY, CONTACT_EMAIL } from '@/lib/legal';
import { STATIC_HUBS } from '@/lib/sitemap';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-209: чотири сторінки були в карті сайту й не існували як адреси.
// Тут дві з них — `/about` і `/contact`.

const about = () => renderComponent(About, {});
const contact = () => renderComponent(Contact, {});

test('кожна відкривається й має власний заголовок', () => {
  expect(visibleText(about())).toContain('About CampTribe');
  expect(visibleText(contact())).toContain('Contact');
});

test('🔴 кожна має власні хлібні крихти, а не лише посилання «додому»', () => {
  // Правило карти сайту: кожна глибока сторінка це окремий лендинг.
  for (const [name, html, path] of [
    ['about', about(), '/about'],
    ['contact', contact(), '/contact'],
  ] as const) {
    expect(html, `${name}: немає BreadcrumbList`).toContain('BreadcrumbList');
    expect(html, `${name}: крихта не веде на себе`).toContain(path);
  }
});

test('🔴 кожна має власну CTA', () => {
  expect(about()).toContain('data-testid="about-cta"');
  expect(contact()).toContain('data-testid="contact-cta"');
  // І вона веде кудись конкретно, а не в порожнечу.
  expect(about()).toContain('href="/map"');
  expect(contact()).toContain(`mailto:${CONTACT_EMAIL}`);
});

test('🔴 контакти беруться з одного джерела, а не передруковуються', () => {
  // Друга копія адреси розійшлась би з першою на першій же правці.
  const html = contact();
  expect(html).toContain(CONTACT_EMAIL);
  expect(html).toContain(COMPANY.name);
  expect(html).toContain(COMPANY.city);
});

test('🔴 на «про нас» НЕМАЄ зашитого числа кемпінгів', () => {
  // По сайту розсипане `61 422`, заміряне 27.09.2026 і зашите в текст,
  // який читає людина, та в метадані, які читає пошуковик. Четверта
  // копія застаріла б своїм темпом; числа належать сторінкам, що їх
  // рахують.
  //
  // 🔴 Перша редакція цієї перевірки забороняла БУДЬ-ЯКЕ число з
  // чотирьох знаків і падала на поштовому індексі «2000 Antwerpen».
  // Твердження було ширше за намір — те саме, за що я чіпляюсь у
  // чужому коді.
  const said = visibleText(about());
  for (const stale of ['61 422', '61422', '48 970', '87 505']) {
    expect(said, `на сторінці зашито ${stale}`).not.toContain(stale);
  }
  expect(said).not.toMatch(/[\d\s]{4,}\s*campsites/i);
});

test('🔴 контактна сторінка каже, чого ми НЕ можемо', () => {
  // Інакше людина напише й чекатиме на бронювання або на правку в OSM.
  const said = visibleText(contact());
  expect(said).toContain('do not take bookings');
  expect(said).toContain('OpenStreetMap');
});

test('🔴 обидві є в карті сайту — інакше вони існують для нікого', () => {
  // Саме цього бракувало: сторінки були в карті сайту як намір, а в
  // переліку їх не було, бо й самих сторінок не було.
  //
  // 🔴 `STATIC_HUBS`, а не `hubUrls()`: друга ходить по індекс кемпінгів
  // і по гайди, тобто в мережу, і перевірка крізь неї падала б без
  // піднятого API — тобто доводила б доступність API, а не наявність
  // сторінки.
  const paths = STATIC_HUBS.map((u) => new URL(u.loc).pathname);
  expect(paths).toContain('/about');
  expect(paths).toContain('/contact');
});
