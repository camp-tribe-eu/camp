import { PrivacyOwnerVerifyLink1797810000000 } from '../migrations/1797810000000-PrivacyOwnerVerifyLink';
import { PER_SPOT_PER_DAY, PER_USER_PER_DAY } from './spot-claim';
import {
  LINK_TTL_MS,
  MIN_STABLE_DAYS,
  PER_ADDRESS_PER_DAY,
} from './owner-email';

// CAMP-505 — те, що політика приватності 2.9 каже про заявку власника,
// звірене з кодом, а не з пам'яттю. Сторінка — виданий текст міграції.

const NUMBER_WORD: Record<number, string> = { 3: 'three', 10: 'ten' };
const page = new PrivacyOwnerVerifyLink1797810000000().page;
const body = page.body;

describe('політика 2.9: розділ про заявку власника', () => {
  it('версія піднята й це 2.9', () => {
    expect(page.version).toBe('2.9');
    expect(page.slug).toBe('privacy');
  });

  it('🔴 межі розсилки на сторінці — ті самі числа, що в коді, і сказано, що вони на акаунт', () => {
    expect(body).toContain(
      `an account at most **${NUMBER_WORD[PER_SPOT_PER_DAY]}** letters per campsite per day, **${NUMBER_WORD[PER_USER_PER_DAY]}** letters in all per day, and **${NUMBER_WORD[PER_ADDRESS_PER_DAY]}** per address per day`,
    );
    expect(body).toContain('The limits are per account');
  });

  it('🔴 «30 днів» на сторінці — це справді MIN_STABLE_DAYS', () => {
    expect(body).toContain(`at least **${MIN_STABLE_DAYS} days**`);
  });

  it('🔴 про піддомен і спільний домен сказано те, що робить код', () => {
    expect(body).toContain('only that exact host matches');
    expect(body).toContain('more than one campsite in our data mentions');
  });

  it('🔴 підстава для листів — 6(1)(f), а не 6(1)(b): адресу міг ввести сторонній', () => {
    expect(body).toContain('so Article 6(1)(b) cannot be the basis for them');
    expect(body).not.toContain(
      'the same Article 6(1)(b): you asked for that letter',
    );
  });

  it('🔴 «не в журналі» — лише журнал застосунку, а доставку пошти названо окремо', () => {
    expect(body).toContain('not in our application logs');
    expect(body).toContain('keeps its own delivery record');
    expect(body).not.toContain('and not in our logs.');
  });

  it('🔴 «посилання живе годину» — це справді LINK_TTL_MS', () => {
    expect(LINK_TTL_MS).toBe(60 * 60 * 1000);
    expect(body).toContain('only once, for one hour');
  });

  it('🔴 стара неправда прибрана: «ніколи посилання» й «не на ту, що ви ввели» без застережень', () => {
    expect(body).not.toContain(
      'We prove it is yours with a code — and the code goes to the address',
    );
    expect(body).not.toContain(
      'It carries a code to type here, never a link to click.',
    );
    // Код з OSM лишився кодом, і сторінка так і каже:
    expect(body).toContain(
      'The letter to the published address carries a code to type here, never a link to click.',
    );
  });

  it('🔴 каже, що введена адреса не зберігається, а лічильник — лише в пам’яті', () => {
    expect(body).toContain('it is not kept: not in the record');
    expect(body).toContain('**in its memory only**');
  });

  it('🔴 каже, що безкоштовна пошта не підходить навіть коли вона є на сторінці', () => {
    expect(body).toContain(
      'never qualifies, even when the address on the page is a Gmail one',
    );
  });

  it('🔴 каже, що саме відкриття нічого не підтверджує', () => {
    expect(body).toContain('Opening it does not confirm anything even there');
  });
});
