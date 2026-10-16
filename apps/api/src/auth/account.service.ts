import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AuthToken, AuthTokenKind } from '../entities/auth-token.entity';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { AuthService, SignedIn } from './auth.service';
import { Cooldown } from './cooldown';
import { isPlausibleEmail, normalizeEmail } from './email';
import {
  LINK_TTL_MS,
  Mailer,
  changeEmailMessage,
  linkFor,
  resetPasswordMessage,
  verifyEmailMessage,
} from './mail';
import { NoSuchAccount, WrongPassword } from './account-rights.service';
import { PasswordProblem, checkNewPassword } from './password-policy';
import { hashPassword, looksLikeStoredHash, verifyPassword } from './password';
import { isExpired, newToken, tokenHash } from './session';

/** Injection token for the mailer, or null when this process cannot send. */
export const MAILER = Symbol('MAILER');

/** The wait between two letters of one kind to one address. The card's 60. */
export const COOLDOWN_MS = 60_000;

// Domain errors. The controller maps each to one HTTP answer; nothing here
// knows about HTTP, so the rules can be exercised without a server.
export class BadEmail extends Error {}
export class WeakPassword extends Error {
  constructor(readonly problem: PasswordProblem) {
    super(problem);
  }
}
export class EmailTaken extends Error {}
export class MailUnavailable extends Error {}
export class StaleLink extends Error {}
/** Нова адреса збігається з чинною: тут мовчати нема про що. */
export class SameEmail extends Error {}

export class TooSoon extends Error {
  constructor(readonly retryAfterSec: number) {
    super('too soon');
  }
}

export type SignedUp = {
  token: string;
  expiresAt: Date;
  email: string;
  emailVerified: false;
};

/** `23505` is Postgres's `unique_violation`; TypeORM wraps the driver error. */
const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
};

/**
 * Sign-up, confirmation and password reset (CAMP-228).
 *
 * The four legal decisions the card records, and where each lives:
 *
 *  1. The newsletter box is empty — `signUp` stores consent only for a literal
 *     `true`; anything else, including "absent", is null. (Planet49.)
 *  2. Terms have no box — nothing here takes a "terms accepted" input at all.
 *     The basis is the contract (GDPR 6(1)(b)), and an input that could be
 *     `false` would be a choice we do not offer.
 *  3. "If an account exists" — `requestLink` answers, and takes, the same for
 *     an address we hold and one we do not.
 *  4. The 60-second counter — `Cooldown`, keyed by address.
 */
@Injectable()
export class AccountService implements BeforeApplicationShutdown {
  private readonly log = new Logger(AccountService.name);

  /** Work started after a response was sent; see `later`. */
  private readonly pending = new Set<Promise<void>>();

  /** Reset links whose password is being hashed right now; see `resetPassword`. */
  private readonly resetting = new Set<string>();

  readonly cooldown = new Cooldown(COOLDOWN_MS);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthToken) private readonly tokens: Repository<AuthToken>,
    private readonly auth: AuthService,
    @Inject(MAILER) private readonly mailer: Mailer | null,
  ) {}

  // ── sign-up ────────────────────────────────────────────────────────────

  /**
   * Create an account and sign it in.
   *
   * 🔴 THIS ONE DOES TELL YOU WHETHER AN ADDRESS IS TAKEN, and it is the one
   * door that cannot be made not to. The card requires that a person saves
   * their route BEFORE confirming the address, which means a session exists
   * the moment the account does; a session handed out for a new address and
   * withheld for an old one is itself the answer, whatever else is made
   * uniform. The recovery form and the "send it again" form — the two that
   * take an address and promise nothing — are uniform, and measured so
   * (`account.db.spec.ts`). This one is bounded rather than hidden: it
   * costs a scrypt hash and a letter per new address, it is counted in the
   * `mail` bucket, and it never sends a letter to an address — AS SPELLED —
   * that already has an account.
   *
   * 🔴 WHAT THAT LAST CLAUSE IS NOT. It does not stop a mailbox being mailed
   * more than once. `victim+1@gmail.com`, `victim+2@gmail.com` and
   * `v.i.ctim@gmail.com` are three addresses to us, so three accounts and
   * three letters into one inbox. The only ceiling is the `mail` bucket: ten
   * requests per ten minutes per caller, that is SIXTY LETTERS AN HOUR from
   * one address into one victim's mailbox (and as many unconfirmed accounts),
   * multiplied by however many callers there are — which is Cloudflare's to
   * absorb, in front of us. Folding `+tags` and dots would shrink it, and it
   * would also decide who can register at all (dots mean different mailboxes
   * at some providers), so it is the owner's decision and is NOT made here.
   * `account.db.spec.ts` pins the residual with its number, so that closing it
   * is a conscious change and not a quiet one.
   *
   * The alternative — no session until the link is clicked — keeps this
   * uniform and breaks the card's central sentence, so it is the owner's to
   * choose, not mine.
   */
  async signUp(
    input: { email: unknown; password: unknown; newsletter: unknown },
    now: Date = new Date(),
  ): Promise<SignedUp> {
    const email = normalizeEmail(input.email);
    if (!isPlausibleEmail(email)) throw new BadEmail();
    const problem = checkNewPassword(input.password, email);
    if (problem) throw new WeakPassword(problem);
    // 🔴 Refused BEFORE the account exists. An account whose confirmation
    // letter can never be sent is an account nobody can finish creating.
    if (!this.mailer) throw new MailUnavailable();

    // Checked first only to spare the ~200 ms hash; the unique index below is
    // what actually decides, and a race lands in the `catch`.
    const taken = await this.users.findOne({
      where: { email },
      select: { id: true },
    });
    if (taken) throw new EmailTaken();

    const passwordHash = await hashPassword(input.password as string);
    let user: User;
    try {
      user = await this.users.save(
        this.users.create({
          email,
          passwordHash,
          // 🔴 `=== true`, not truthiness. "on", 1, "true" and a missing
          // field are all NOT consent; only the explicit boolean the form
          // sends when the box was ticked by a person is.
          marketingConsentAt: input.newsletter === true ? now : null,
          emailVerifiedAt: null,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new EmailTaken();
      throw e;
    }

    const session = await this.auth.startSession(user.id, now);
    // The first letter starts the clock for "send it again", so the counter
    // the page shows is the one the server enforces.
    this.cooldown.take(`verify_email:${email}`, now);
    this.later(() => this.issue('verify_email', user, now));
    return { ...session, email, emailVerified: false };
  }

  // ── "send me a link" — the two forms that must not tell ─────────────────

  /** Forgot password. Same answer, and same wait, for every address. */
  requestReset(rawEmail: unknown, now: Date = new Date()): Promise<void> {
    return this.requestLink('reset_password', rawEmail, now);
  }

  /** Send the confirmation letter again. Same promise as `requestReset`. */
  requestVerification(
    rawEmail: unknown,
    now: Date = new Date(),
  ): Promise<void> {
    return this.requestLink('verify_email', rawEmail, now);
  }

  /**
   * 🔴 THE EXISTENCE ORACLE, THIRD TIME (CAMP-50 twice before). Everything an
   * outsider can observe about this request is decided BEFORE we know whether
   * the address has an account, or is the same work for both:
   *
   *   - configuration (503) and input shape (400) depend on neither;
   *   - the cooldown is keyed by address, so asking twice is refused alike;
   *   - the one lookup runs for every address, hit or miss;
   *   - everything that only a HIT does — minting the token, writing the row,
   *     calling the mail provider (a network round trip to a vendor; the test
   *     uses 150 ms and checks 400 in a one-off measurement) — is deferred
   *     with `later`, i.e. after the response has been written.
   *
   * The last line is the one the other three depend on: a hit that awaited
   * its own letter would answer hundreds of milliseconds after a miss, and
   * that gap is readable from any network. It is what
   * `account.db.spec.ts` measures.
   */
  private async requestLink(
    kind: AuthTokenKind,
    rawEmail: unknown,
    now: Date,
  ): Promise<void> {
    if (!this.mailer) throw new MailUnavailable();
    const email = normalizeEmail(rawEmail);
    if (!isPlausibleEmail(email)) throw new BadEmail();

    const gate = this.cooldown.take(`${kind}:${email}`, now);
    if (gate.ok === false) throw new TooSoon(gate.retryAfterSec);

    const user = await this.users.findOne({ where: { email } });
    // A confirmation letter is for an address not yet confirmed; a reset is
    // for anyone. Both are decided here but only ACTED on after the response.
    //
    // 🔴 CAMP-229: NOT FOR AN ACCOUNT THAT IS BEING DELETED. A reset link would
    // be a way back that the screen says does not exist ("only by signing in
    // with the same password"), and a confirmation letter to someone who has
    // just asked us to forget them would be the opposite of what they asked.
    // The answer the caller sees is unchanged: the decision is made after it.
    if (
      user &&
      !user.deletedAt &&
      (kind === 'reset_password' || !user.emailVerifiedAt)
    )
      this.later(() => this.issue(kind, user, now));
  }

  // ── following a link ─────────────────────────────────────────────────────

  /** Confirm the address behind a link. Throws `StaleLink` for any bad link. */
  async verifyEmail(rawToken: unknown, now: Date = new Date()): Promise<void> {
    const row = await this.liveToken('verify_email', rawToken, now);
    await this.tokens.manager.transaction(async (m) => {
      // 🔴 РЯДОК ЛЮДИНИ ПЕРШИЙ, ЯК І ВСЮДИ. Тут цього не було, і доки
      // підтвердження адреси торкалось лише `verify_email`-рядків, а
      // скидання — лише `reset_password`-рядків, два набори не
      // перетинались і це сходило з рук. CAMP-229 їх перетнула:
      // `confirmEmailChange` бере рядок людини, а потім оновлює чужі
      // токени, тож ця транзакція й та брали замки навхрест.
      //
      // Рецензія відтворила: 30 пар із 30 дали `deadlock detected`
      // (40P01) і HTTP 500. Правило «спершу рядок людини» тепер діє на
      // КОЖНОМУ шляху, що пише і в `users`, і в `auth_tokens`, і саме
      // тому воно більше не залежить від того, які види токенів хто
      // чіпає.
      await m.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        row.userId,
      ]);
      await this.claim(m, row, now);
      // Only if still unconfirmed: the FIRST confirmation is the one worth
      // remembering, and a second link must not move it.
      await m.update(
        User,
        { id: row.userId, emailVerifiedAt: IsNull() },
        { emailVerifiedAt: now },
      );
    });
  }

  /** Set a new password with a reset link. */
  async resetPassword(
    rawToken: unknown,
    newPassword: unknown,
    now: Date = new Date(),
  ): Promise<void> {
    const row = await this.liveToken('reset_password', rawToken, now);
    // 🔴 ONE HASH PER LINK, however many times it is posted at once.
    //
    // Measured before this line existed (15.10.2026, a loaded laptop, one
    // burst): twelve concurrent requests carrying ONE valid link ran
    // `hashPassword` twelve times (673 ms against 267 ms for one) — eleven of
    // them to answer 410 — while a garbage token cost 1.02 ms. The request was in the 120-a-minute bucket, so one link bought
    // up to 120 scrypt hashes a minute from one address, where sign-in is held
    // to ten. Nothing about the link had to be guessed: it only had to be
    // asked for, which costs a letter.
    //
    // The check and the `add` below are one synchronous step, so of any number
    // of requests carrying the SAME link that passed `liveToken` together
    // exactly one goes on to hash and the rest answer the same "stale" the
    // claim would have. With that, a hash needs a link, a link needs a letter,
    // and letters are the `mail` bucket's — which is why this route may stay
    // in the ordinary bucket.
    //
    // 🔴 PER LINK, NOT PER USER, and that is all it claims. Two different
    // links of one person are two hashes (a letter each, so still the mail
    // bucket's); what arbitrates THEM is the lock order in the transaction
    // below, not this set. Per process, like the cooldown: two processes
    // allow two hashes for one link.
    if (this.resetting.has(row.id)) throw new StaleLink();
    this.resetting.add(row.id);
    try {
      await this.resetWith(row, newPassword, now);
    } finally {
      // Also on a refused password: the link is still good, and the person
      // must be able to try again.
      this.resetting.delete(row.id);
    }
  }

  private async resetWith(
    row: AuthToken,
    newPassword: unknown,
    now: Date,
  ): Promise<void> {
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user) throw new StaleLink();
    // 🔴 BEFORE the link is spent. A password that is too short must leave
    // the person able to try again, not holding a dead letter.
    const problem = checkNewPassword(newPassword, user.email);
    if (problem) throw new WeakPassword(problem);
    const passwordHash = await hashPassword(newPassword as string);

    await this.tokens.manager.transaction(async (m) => {
      // 🔴 LOCK ORDER: THE USER ROW FIRST, THEN THE TOKEN ROWS, ALWAYS.
      //
      // Two valid reset links of ONE user, posted together (the person asked
      // twice, got two letters and used both from two tabs), took these locks
      // crosswise: A's transaction held link A and wanted the user; B's held
      // link B and, having got the user, wanted every unused link of that
      // user — which includes A's. Postgres: `deadlock detected`, HTTP 500.
      // Reproduced by review 6 times in 6 on the real app, and 5 in 6 before
      // any of this card's later changes: it was there from the first commit.
      //
      // The user row is the one thing every such transaction needs, so it is
      // the one to queue on. Whoever gets it does all four writes and commits;
      // the other waits HERE, holding nothing, then finds its own link already
      // spent by the first one's "kill the other links" step and answers the
      // same 410 a spent link always answers.
      //
      // 🔴 ЦЕЙ АРГУМЕНТ БУВ ІНШИЙ І ПЕРЕСТАВ БУТИ ПРАВДОЮ. Тут стояло: «шлях
      // підтвердження не блокується з цим, бо торкається лише
      // `verify_email`-рядків, а цей — лише `reset_password`». CAMP-229
      // перетнула набори (зміна пароля тепер гасить УСІ невикористані
      // посилання людини, бо саме цього чекає той, кого зламали), і той
      // аргумент мовчки став хибним.
      //
      // Тепер гарантія не в тому, ЯКІ рядки хто чіпає, а в тому, що рядок
      // людини беруть ПЕРШИМ скрізь: `verifyEmail`, `confirmEmailChange`,
      // `changePassword` і цей шлях. `account.db.spec.ts` кидає обидва види
      // по два посилання одночасно.
      await m.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      await this.claim(m, row, now);
      await m.update(User, { id: user.id }, { passwordHash });
      // 🔴 УСІ невикористані посилання цієї людини, А НЕ ЛИШЕ НА СКИДАННЯ.
      // Тут стояв фільтр `kind: 'reset_password'`, і це був шлях до повного
      // захоплення акаунта: зловмисник, що мав пароль, просив переїзд на
      // свою адресу; жертва робила рівно те, що радить кожен («мене
      // зламали — міняю пароль»), і посилання переїзду лишалось робочим.
      // Рецензія заміряла: після зміни пароля та після скидання за листом
      // `change_email`-посилання відповідало 204 і пошта ставала
      // зловмисниковою. Видалення акаунта робило це правильно від початку.
      await m.update(
        AuthToken,
        { userId: user.id, usedAt: IsNull() },
        { usedAt: now },
      );
      // 🔴 And every session. A reset that leaves the old sessions alive
      // locks out the owner and lets in whoever made the reset necessary.
      await m.delete(Session, { userId: user.id });
    });
  }

  // ── settings (CAMP-229) ──────────────────────────────────────────────────

  /**
   * Перевірити пароль того, хто вже ввійшов.
   *
   * 🔴 ОКРЕМИЙ КРОК ПЕРЕД КОЖНОЮ ЗМІНОЮ ОБЛІКОВИХ ДАНИХ, і саме він тримає
   * усю сторінку налаштувань. Украдений токен сесії сам по собі не дає ні
   * змінити пароль, ні перевести акаунт на чужу адресу: обидві дії питають
   * те, чого в сесії немає. Без цього кроку крадіжка однієї вкладки
   * перетворювалась би на захоплення акаунта.
   *
   * Значення, яке не схоже на наш збережений хеш, відмовляється ДО scrypt —
   * так само, як при вході.
   */
  private async provePassword(
    userId: string,
    password: unknown,
  ): Promise<User> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        deletedAt: true,
      },
    });
    if (!user || user.deletedAt) throw new NoSuchAccount();
    // Значення, яке не є рядком, відмовляється тут, а не всередині scrypt:
    // це та сама відмова, що й хибний пароль, і коштує стільки ж.
    const ok =
      typeof password === 'string' && looksLikeStoredHash(user.passwordHash)
        ? await verifyPassword(password, user.passwordHash)
        : false;
    if (!ok) throw new WrongPassword();
    return user;
  }

  /**
   * Новий пароль для того, хто знає чинний.
   *
   * 🔴 ВСІ СЕСІЇ ВМИРАЮТЬ, ВКЛЮЧНО З ЦІЄЮ — І ЗВІДСИ ПОВЕРТАЄТЬСЯ НОВА.
   * Причина змінити пароль найчастіше звучить як «здається, хтось має
   * доступ»; зміна, що лишає чужу сесію живою, не робить нічого з тим, через
   * що її й затіяли. Зберегти саме поточну сесію означало б відрізняти її від
   * решти, а `Viewer` знає лише `id` людини, не свій рядок у `sessions`.
   * Тому чесніше: убити все і видати нову тут-таки, щоб сторінка, на якій
   * людина стоїть, не викинула її на /login посеред дії.
   *
   * Політика пароля перевіряється ДО того, як щось записано: закороткий
   * пароль мусить лишити людину там, де вона була.
   */
  async changePassword(
    userId: string,
    currentPassword: unknown,
    newPassword: unknown,
    now: Date = new Date(),
  ): Promise<SignedIn> {
    const user = await this.provePassword(userId, currentPassword);
    const problem = checkNewPassword(newPassword, user.email);
    if (problem) throw new WeakPassword(problem);
    const passwordHash = await hashPassword(newPassword as string);

    await this.tokens.manager.transaction(async (m) => {
      // Порядок блокувань той самий, що й у `resetWith`: спершу рядок людини.
      await m.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      await m.update(User, { id: user.id }, { passwordHash });
      // 🔴 УСІ невикористані посилання цієї людини — і на скидання, і на
      // переїзд. Та сама причина, що й у `resetWith`: канонічний засіб
      // жертви мусить закривати ВСЕ, що вже надіслано, інакше він лікує
      // половину нападу й залишає другу.
      await m.update(
        AuthToken,
        { userId: user.id, usedAt: IsNull() },
        { usedAt: now },
      );
      await m.delete(Session, { userId: user.id });
    });

    return this.auth.startSession(user.id, now);
  }

  /**
   * Попросити перевести акаунт на іншу адресу.
   *
   * 🔴 ЛИСТ ІДЕ НА НОВУ АДРЕСУ, І НІЧОГО НЕ МІНЯЄТЬСЯ ДО КЛІКУ. Єдине, що
   * доводить, ніби людина читає адресу, — відповідь на лист у неї. Поки
   * посилання не відкрито, `users.email` лишається попереднім, а нова адреса
   * живе тільки в рядку токена (див. `auth_tokens.new_email`).
   *
   * 🔴 «ЦЯ АДРЕСА ВЖЕ ЗАЙНЯТА» МИ НЕ КАЖЕМО. Відповідь однакова і для вільної
   * адреси, і для чужої: інакше форма налаштувань стає тим самим оракулом
   * перелічення, який ми закрили у формах відновлення. Лист при цьому не
   * надсилається — власникові чужої адреси нема за що отримувати листа про
   * чужу спробу.
   *
   * Власна чинна адреса — виняток: про неї людина й так знає, тож мовчати
   * нема про що, і тиха «успішна» відповідь на дію, яка нічого не зробить,
   * була б гіршою за відмову.
   */
  async requestEmailChange(
    userId: string,
    password: unknown,
    rawNewEmail: unknown,
    now: Date = new Date(),
  ): Promise<void> {
    if (!this.mailer) throw new MailUnavailable();
    const user = await this.provePassword(userId, password);

    const email = normalizeEmail(rawNewEmail);
    if (!isPlausibleEmail(email)) throw new BadEmail();
    if (email === user.email) throw new SameEmail();

    const gate = this.cooldown.take(`change_email:${email}`, now);
    if (gate.ok === false) throw new TooSoon(gate.retryAfterSec);

    const taken = await this.users.findOne({
      where: { email },
      select: { id: true },
    });

    // Рішення — після відповіді, як і в `requestLink`: інакше «зайнято» й
    // «вільно» розрізняються часом відповіді, а не її текстом.
    this.later(async () => {
      // 🔴 ІНВАЛІДАЦІЯ ПЕРШОЮ, РІШЕННЯ ДРУГИМ — І ПОРЯДОК ТУТ Є ВСІМ.
      // Спершу стояло `if (taken) return;`, і зайнята адреса лишала
      // попереднє посилання ЖИВИМ, а вільна його вбивала. Тіла відповідей
      // були байт-у-байт однакові, і час теж (заміряно: 166,6 мс проти
      // 167,4 мс на тлі scrypt) — різниця жила в СТАНІ. Той, хто має свій
      // акаунт, просив переїзд на власну запасну адресу, не клікав, тоді
      // просив переїзд на перевірювану, і дивився, чи вціліло перше
      // посилання: 204 означало «зайнята», 410 — «вільна».
      //
      // Тобто мовчання відповіді ще не робить дію мовчазною. Кожна гілка
      // мусить лишати по собі ОДНАКОВИЙ слід, а не однаковий текст.
      await this.tokens.update(
        { userId: user.id, kind: 'change_email', usedAt: IsNull() },
        { usedAt: now },
      );
      if (taken) return;
      await this.issue('change_email', user, now, email);
    });
  }

  /**
   * Відкрити посилання з листа й переїхати.
   *
   * 🔴 НОВА АДРЕСА ВВАЖАЄТЬСЯ ПІДТВЕРДЖЕНОЮ ТИМ САМИМ КЛІКОМ. Людина щойно
   * довела, що читає її — питати ще один лист означало б питати двічі те
   * саме.
   *
   * 🔴 МІЖ ЛИСТОМ І КЛІКОМ АДРЕСУ МІГ ХТОСЬ ЗАЙНЯТИ. Унікальний індекс по
   * `users.email` це ловить, і помилка Postgres перетворюється на
   * `EmailTaken`, а не на 500. Сказати про це тут можна: людина вже довела,
   * що читає цю скриньку, тож нічого нового вона не дізнається.
   *
   * Сесії вмирають усі — пошта це спосіб повернути доступ, і її зміна
   * мусить коштувати стільки ж, скільки зміна пароля.
   */
  async confirmEmailChange(
    rawToken: unknown,
    now: Date = new Date(),
  ): Promise<void> {
    const row = await this.liveToken('change_email', rawToken, now);
    const next = row.newEmail;
    // Рядок без адреси заборонений перевіркою `auth_tokens_new_email`, тож
    // сюди він потрапити не може. Якщо колись потрапить — це зламане
    // посилання, а не привід записати людині порожню пошту.
    if (!next) throw new StaleLink();

    try {
      await this.tokens.manager.transaction(async (m) => {
        await m.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
          row.userId,
        ]);
        await this.claim(m, row, now);
        await m.update(
          User,
          { id: row.userId },
          { email: next, emailVerifiedAt: now },
        );
        // Інші незужиті посилання цього акаунта більше не мають сенсу:
        // підтвердження старої адреси й друга спроба переїзду однаково
        // стосуються пошти, яка щойно змінилась.
        await m.update(
          AuthToken,
          { userId: row.userId, kind: 'change_email', usedAt: IsNull() },
          { usedAt: now },
        );
        await m.update(
          AuthToken,
          { userId: row.userId, kind: 'verify_email', usedAt: IsNull() },
          { usedAt: now },
        );
        await m.delete(Session, { userId: row.userId });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new EmailTaken();
      throw e;
    }
  }

  /**
   * Увімкнути чи вимкнути листи про новини.
   *
   * 🔴 УВІМКНЕННЯ — ЛИШЕ ВІД ЛІТЕРАЛЬНОГО `true`, те саме правило, що й у
   * `signUp` (Planet49, C-673/17). Будь-що інше — `"true"`, `1`, відсутність —
   * це вимкнено. Згода, яку можна отримати неточним значенням, не є згодою.
   *
   * Зберігається МОМЕНТ, а не галочка: «коли людина це дозволила» — те, що
   * доведеться показати, якщо спитають.
   */
  /**
   * Чи ввімкнені листи зараз.
   *
   * Повертає ТАК або НІ, а не момент згоди: сторінці треба стан перемикача,
   * і поле, якого вона не отримує, не може опинитись у її HTML.
   */
  async letters(userId: string): Promise<boolean> {
    const row = await this.users.findOne({
      where: { id: userId },
      select: { id: true, marketingConsentAt: true },
    });
    if (!row) throw new NoSuchAccount();
    return row.marketingConsentAt != null;
  }

  async setLetters(
    userId: string,
    letters: unknown,
    now: Date = new Date(),
  ): Promise<boolean> {
    const on = letters === true;
    const done = await this.users.update(
      { id: userId, deletedAt: IsNull() },
      { marketingConsentAt: on ? now : null },
    );
    if (done.affected !== 1) throw new NoSuchAccount();
    return on;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * The unspent, unexpired link of this KIND for this token, or `StaleLink`.
   *
   * One sentence for every way a link can be bad — unknown, expired, used,
   * the wrong kind — so the answer says nothing about which tokens exist.
   * The kind is part of the lookup: a confirmation link must not open the
   * reset form, and the reverse would be worse.
   */
  private async liveToken(
    kind: AuthTokenKind,
    raw: unknown,
    now: Date,
  ): Promise<AuthToken> {
    if (typeof raw !== 'string' || raw === '' || raw.length > 256)
      throw new StaleLink();
    const row = await this.tokens.findOne({
      where: { tokenHash: tokenHash(raw), kind },
    });
    if (!row || row.usedAt || isExpired(row.expiresAt, now))
      throw new StaleLink();
    return row;
  }

  /** Spend a link. `affected !== 1` means somebody else just did. */
  private async claim(
    m: EntityManager,
    row: AuthToken,
    now: Date,
  ): Promise<void> {
    const claimed = await m.update(
      AuthToken,
      { id: row.id, usedAt: IsNull() },
      { usedAt: now },
    );
    if (claimed.affected !== 1) throw new StaleLink();
  }

  /** Mint a link, store its hash, and send it. Runs after the response. */
  private async issue(
    kind: AuthTokenKind,
    user: Pick<User, 'id' | 'email'>,
    now: Date,
    /**
     * 🔴 CAMP-229 — куди переїжджає акаунт, і ЛИШЕ для `change_email`.
     * Для решти видів лишається `null`, і база це вимагає
     * (`auth_tokens_new_email`): запис іншого виду з адресою виглядав би
     * як запит на зміну пошти, якого ніхто не робив.
     */
    newEmail?: string,
  ): Promise<void> {
    const mailer = this.mailer as Mailer;
    // 🔴 256 bits, 43 URL-safe characters, and that is the ONLY thing between
    // a stranger and this account: the route that spends the link is not rate
    // limited as guessing (it cannot be, usefully). `account.db.spec.ts`
    // asserts the length of the token in the LETTER as a literal.
    const token = newToken();
    await this.tokens.save(
      this.tokens.create({
        userId: user.id,
        kind,
        tokenHash: tokenHash(token),
        expiresAt: new Date(now.getTime() + LINK_TTL_MS),
        usedAt: null,
        newEmail: kind === 'change_email' ? (newEmail ?? null) : null,
      }),
    );
    const link = linkFor(mailer.webBase, kind, token);
    // 🔴 Лист про переїзд іде на НОВУ адресу, решта — на чинну. Переплутати
    // тут означало б надіслати підтвердження тому, хто й так уже власник,
    // і нічого не довести про адресу, заради якої все робиться.
    await mailer.sender.send(
      kind === 'verify_email'
        ? verifyEmailMessage(user.email, link)
        : kind === 'change_email'
          ? changeEmailMessage(newEmail as string, link)
          : resetPasswordMessage(user.email, link),
    );
  }

  /**
   * Run `job` after the current response has gone out.
   *
   * 🔴 WHAT MATTERS IS THAT NOTHING HERE IS AWAITED BY THE REQUEST. That is
   * measured: a hit that awaited its own letter answered 150+ ms after a
   * miss (`account.db.spec.ts`, mutation "inline"). `setImmediate` rather
   * than a bare call is on top of that, and it is NOT measurable: with the
   * provider at 150 ms and 40 samples each way, the hit-minus-miss median
   * was +0.04 ms with it and +0.06 ms without. It stays because it costs
   * nothing and puts the hit-only work behind the response by construction
   * rather than by speed — but no test distinguishes the two, and nobody
   * should read this comment as one that does.
   *
   * Failures are logged by class only: a provider's error text can contain
   * the recipient, and a log of failed addresses is a list of people.
   */
  private later(job: () => Promise<void>): void {
    const done = new Promise<void>((resolve) => {
      setImmediate(() => {
        job()
          .catch((e: unknown) =>
            this.log.error(
              `letter not sent (${(e as { name?: string })?.name ?? 'error'})`,
            ),
          )
          .finally(resolve);
      });
    });
    this.pending.add(done);
    void done.then(() => this.pending.delete(done));
  }

  /** Wait for every deferred letter. Tests call it; shutdown does too. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /**
   * 🔴 `before`, not `on`. TypeORM closes its connection in
   * `onApplicationShutdown`, and a letter still being written when that runs
   * is a failed INSERT and a person who was told "check your email" and will
   * never get one. All `beforeApplicationShutdown` hooks run first.
   */
  beforeApplicationShutdown(): Promise<void> {
    return this.drain();
  }
}
