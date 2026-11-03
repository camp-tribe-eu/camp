// CAMP-427: прокатні компанії — каталог, сервіси, парк і профілі відгуків.
//
// 🔴 ЧОМУ ЦЬОГО ДОСІ НЕ БУЛО, І ЧОМУ ЦЕ ВАЖЛИВО. `rental.entity.ts` описує
// ТИПИ кемперів і МІСТА, але жодної компанії. Тобто сторінка оренди могла
// розповісти, чим інтегрований відрізняється від напівінтегрованого, і не
// могла назвати жодного, у кого його взяти. Дірку назвав власник 02.11.2026;
// назва картки CAMP-54 («Camper Rental Search + афіліат») її ховала.
//
// 🔴 ЦІН ТУТ НЕМАЄ — і це та сама причина, що в `rental.entity.ts`:
// архітектура обрала афіліатні посилання замість стрічок цін, а будь-що
// схоже на живу ціну протухає за тиждень і стає оманливим у сенсі
// ст. 6(1) UCPD. Зберігаємо те, що не змінюється щотижня: хто це, де
// депо, що входить у ціну, а що ні, і який парк.

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ContentStatus } from './content.entity';
import { CamperType } from './rental.entity';

// ---------------------------------------------------------------------------
// Компанія
// ---------------------------------------------------------------------------

@Entity('rental_providers')
export class RentalProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  /**
   * Торгова назва, як компанія сама себе пише. НЕ в перекладах: «McRent»
   * однаково пишеться всіма мовами, а переклад назви бренду — це вже інша
   * компанія.
   */
  @Column()
  name: string;

  /**
   * Юридична назва й реєстраційний номер — для сторінки-сингла.
   * Nullable, бо частину компаній ми візьмемо з відкритих джерел раніше,
   * ніж дійдемо до їхніх реєстрів, і порожнє поле чесніше за вигадане.
   */
  @Column({ name: 'legal_name', nullable: true })
  legalName?: string;

  @Column({ name: 'registration_number', nullable: true })
  registrationNumber?: string;

  /** Країна штаб-квартири, ISO-3166-1 alpha-2. */
  @Index()
  @Column({ name: 'home_country', length: 2 })
  homeCountry: string;

  @Column({ nullable: true })
  website?: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  /**
   * Скільки депо компанія заявляє і в скількох країнах ЄС працює.
   * Це числа ДЛЯ СОРТУВАННЯ, і вони заявлені компанією, а не зміряні нами —
   * тому `declared` у назві. Сторінка мусить це казати словами.
   */
  @Column({ name: 'declared_depot_count', type: 'int', nullable: true })
  declaredDepotCount?: number;

  @Column({ name: 'declared_fleet_size', type: 'int', nullable: true })
  declaredFleetSize?: number;

  @Column({ name: 'founded_year', type: 'int', nullable: true })
  foundedYear?: number;

  /**
   * 🔴 ДЖЕРЕЛО КОЖНОГО ФАКТУ, а не «ми десь прочитали». Сторінка каталогу
   * порівнює компанії між собою, тобто кожне число тут впливає на чужий
   * бізнес. URL сторінки, з якої взято дані, і дата зняття.
   */
  @Column({ name: 'source_url', nullable: true })
  sourceUrl?: string;

  @Column({ name: 'source_checked_on', type: 'date', nullable: true })
  sourceCheckedOn?: string;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.DRAFT })
  status: ContentStatus;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Ворота публікації, у коді, а не в чиїйсь памʼяті.
   *
   * Компанія без сайту й без жодного депо — це рядок у таблиці, а не
   * сторінка: читач не зможе ані перевірити нас, ані дійти до компанії.
   * Без названого джерела ми не зможемо довести, звідки взяли числа.
   */
  meetsPublicationThreshold(): boolean {
    return Boolean(this.website) && Boolean(this.sourceUrl);
  }
}

@Entity('rental_provider_translations')
@Index(['providerId', 'languageCode'], { unique: true })
export class RentalProviderTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @ManyToOne(() => RentalProvider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider: RentalProvider;

  @Column({ name: 'language_code', length: 16 })
  languageCode: string;

  /** Один абзац: хто це і чим відрізняється. Не реклама — відмінність. */
  @Column({ type: 'text', nullable: true })
  intro?: string;

  /** Те, що варто знати саме про цю компанію: правила, межі, застереження. */
  @Column({ name: 'what_to_know', type: 'text', nullable: true })
  whatToKnow?: string;
}

// ---------------------------------------------------------------------------
// Сервіси: основні й додаткові
// ---------------------------------------------------------------------------

/**
 * Чи входить сервіс у ціну, чи коштує окремо, чи його просто немає.
 *
 * 🔴 «Немає» — ОКРЕМЕ значення, а не відсутній рядок. Відсутність рядка
 * означає «ми не перевіряли», і плутати її з «компанія цього не дає» не
 * можна: перше — наша прогалина, друге — факт про компанію. Сторінка має
 * показувати їх по-різному, інакше ми звинувачуємо компанію власним
 * недоглядом.
 */
export enum ServiceAvailability {
  INCLUDED = 'included',
  EXTRA = 'extra',
  UNAVAILABLE = 'unavailable',
}

@Entity('rental_provider_services')
@Index(['providerId', 'code'], { unique: true })
export class RentalProviderService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @ManyToOne(() => RentalProvider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider: RentalProvider;

  /**
   * Код сервісу зі спільного словника (`unlimited_km`, `one_way`,
   * `pets_allowed`, `bedding`, `bike_rack`, `winter_tyres`,
   * `excess_reduction`, `additional_driver`, `airport_transfer`…).
   *
   * Рядок, а не enum, навмисно: словник росте щотижня, а міграція на кожне
   * нове слово — та сама ціна, через яку в нас уже є `page_sections.type`
   * звичайним `varchar`. Перелік допустимих кодів тримає код і тест, не
   * схема.
   */
  @Column({ length: 64 })
  code: string;

  @Column({ type: 'enum', enum: ServiceAvailability })
  availability: ServiceAvailability;

  /**
   * Уточнення словами: «до 200 км/добу», «лише з депо у Франції».
   * БЕЗ ЦІНИ — з тієї ж причини, з якої цін немає ніде в цьому файлі.
   */
  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ name: 'source_url', nullable: true })
  sourceUrl?: string;

  @Column({ name: 'source_checked_on', type: 'date', nullable: true })
  sourceCheckedOn?: string;
}

// ---------------------------------------------------------------------------
// Парк
// ---------------------------------------------------------------------------

@Entity('rental_provider_vehicles')
@Index(['providerId', 'slug'], { unique: true })
export class RentalProviderVehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @ManyToOne(() => RentalProvider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider: RentalProvider;

  /** Як модель зветься В НИХ: читач шукатиме саме цю назву на їхньому сайті. */
  @Column()
  name: string;

  @Column({ length: 96 })
  slug: string;

  /**
   * Наш тип кемпера, до якого ця модель належить. Nullable: трапиться
   * модель, що не лягає в жоден наявний тип, і вигадати тип заради одного
   * рядка гірше, ніж лишити порожньо й побачити це в звіті.
   */
  @Column({ name: 'camper_type_id', nullable: true })
  camperTypeId?: string;

  @ManyToOne(() => CamperType, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'camper_type_id' })
  camperType?: CamperType;

  /**
   * 🔴 CAMP-371. ДОСЛІВНІ СЛОВА ПРОКАТНИКА, ЯКИМИ ТИП І ДОВЕДЕНО.
   *
   * «Car type: Semi-integrated», «Agile overcab motorhome»,
   * «полуинтегриран». Без них тип — це НАШ висновок, виданий за його.
   * Довжина підказала б тип майже завжди правильно, і саме тому поле
   * існує: майже-завжди-правильно про чужу машину це вигадка, а не дані.
   */
  @Column({ name: 'camper_type_said', nullable: true })
  camperTypeSaid?: string;

  /**
   * Окрема дата зрізу — бо тип читали НЕ тоді, коли парк: парк 02.11.2026,
   * типи 03.11. Спільна дата поставила б під фактом день, коли його не
   * читали.
   */
  @Column({ name: 'camper_type_checked_on', type: 'date', nullable: true })
  camperTypeCheckedOn?: string;

  @Column({ type: 'int', nullable: true })
  berths?: number;

  @Column({ name: 'belted_seats', type: 'int', nullable: true })
  beltedSeats?: number;

  /**
   * 🔴 МІСЦЯ ДЛЯ СНУ Й МІСЦЯ З ПАСКАМИ — РІЗНІ ЧИСЛА, і сплутати їх значить
   * посадити в машину більше людей, ніж вона може везти законно. Тому дві
   * колонки, а не одна «місткість».
   */
  @Column({ name: 'length_cm', type: 'int', nullable: true })
  lengthCm?: number;

  @Column({ name: 'source_url', nullable: true })
  sourceUrl?: string;

  @Column({ name: 'source_checked_on', type: 'date', nullable: true })
  sourceCheckedOn?: string;
}

// ---------------------------------------------------------------------------
// Профілі відгуків
// ---------------------------------------------------------------------------

export enum ReviewSource {
  TRUSTPILOT = 'trustpilot',
  GOOGLE = 'google',
}

/**
 * 🔴 ПОСИЛАННЯ Є, ЦИФРИ НЕМАЄ — І ЦЕ НЕ ЗАБУТО, А ВИРІШЕНО.
 *
 * Рішення власника 02.11.2026 після того, як умови прочитані в
 * першоджерелах:
 *
 *   · Trustpilot забороняє і збір, і показ TrustScore третьою стороною
 *     без їхнього прямого дозволу («unless we specifically say you are
 *     authorised to use them»); лист по дозвіл надіслано 02.11.2026;
 *   · Google дозволяє показ рейтингу лише через ПЛАТНИЙ Places API з
 *     логотипом Google Maps і їхнім застереженням — платити зараз нема з
 *     чого.
 *
 * Отже сьогодні показуємо НАЗВУ джерела й ПОСИЛАННЯ на профіль, яке
 * відкривається в новій вкладці. Назва — вказівник, куди веде лінк, а не
 * їхній контент; адреса сторінки — теж не контент.
 *
 * `rating` і `reviewCount` існують у схемі навмисно, але заповнювати їх
 * можна ЛИШЕ коли `permissionConfirmedOn` не порожнє. Інакше «тимчасово
 * без цифр» одного дня тихо стане «з цифрами», і ніхто не згадає, що
 * дозволу не було. Це стереже і перевірка в базі, і тест.
 */
@Entity('rental_provider_review_profiles')
@Index(['providerId', 'source'], { unique: true })
export class RentalProviderReviewProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @ManyToOne(() => RentalProvider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider: RentalProvider;

  @Column({ type: 'enum', enum: ReviewSource })
  source: ReviewSource;

  /** Сторінка саме цієї компанії в саме цього збирача відгуків. */
  @Column({ name: 'profile_url' })
  profileUrl: string;

  /** Дата письмового дозволу показувати цифру. Порожньо — дозволу немає. */
  @Column({ name: 'permission_confirmed_on', type: 'date', nullable: true })
  permissionConfirmedOn?: string;

  @Column({ type: 'numeric', precision: 2, scale: 1, nullable: true })
  rating?: string;

  @Column({ name: 'review_count', type: 'int', nullable: true })
  reviewCount?: number;

  /** Те саме правило, що й у схемі, — для коду, який малює сторінку. */
  mayShowFigures(): boolean {
    return Boolean(this.permissionConfirmedOn);
  }
}

/**
 * Країна ЄС, у якій компанія справді видає машини.
 *
 * 🔴 НЕ ПЛУТАТИ З `homeCountry`. Прописка — одна країна і юридичний
 * факт; це — перелік і факт операційний. На десяти зібраних компаніях
 * прописок чотири, а країн роботи двадцять.
 */
@Entity('rental_provider_countries')
@Index(['providerId', 'country'], { unique: true })
export class RentalProviderCountry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  providerId: string;

  @ManyToOne(() => RentalProvider, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider: RentalProvider;

  @Index()
  @Column({ length: 2 })
  country: string;

  @Column({ name: 'source_url', nullable: true })
  sourceUrl?: string;

  @Column({ name: 'source_checked_on', type: 'date', nullable: true })
  sourceCheckedOn?: string;
}
