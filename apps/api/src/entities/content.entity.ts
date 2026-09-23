// CAMP-89: editorial content that lives in Directus.
//
// Ownership rule for this whole file: the DDL belongs to our TypeORM
// migrations, Directus only registers these tables as collections and gives
// editors a UI. Two systems cannot safely own one schema - and per the
// Directus licence (§4.1(a), see CAMP-62) anything built *inside* Directus
// becomes Directus property, so our schema stays in our repository.
//
// Translations follow the standard Directus i18n pattern: one base row per
// item plus one row per language. That doubles the collection count, which
// is why the set is kept deliberately small (see the count in CAMP-89).

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * How the sentences in a guide came to exist.
 *
 * 🔴 Article 50(2) of the EU AI Act, in force since 02.08.2026, requires
 * machine-generated text to be marked as such. The Digital Omnibus
 * deferred the high-risk obligations; it did not defer Article 50. So
 * this is a publication condition, not metadata — and the column is NOT
 * NULL so that it cannot be forgotten rather than merely remembered.
 */
export enum GuideProvenance {
  /** A person wrote it. We name them; no machine label is due. */
  HUMAN = 'human',
  /** A person wrote and edited it with machine help. Labelled. */
  AI_ASSISTED = 'ai-assisted',
  /** A machine wrote it and a person checked it. Labelled. */
  AI_GENERATED = 'ai-generated',
  /**
   * Assembled from our own database by a named program, where every
   * sentence is a value we hold.
   *
   * 🔴 Not a loophole. A template filled from measured rows is narrower
   * than what the Act covers, not wider — but a reader still deserves to
   * know a program wrote the sentence, and it is the one kind of text we
   * can produce at volume without inventing anything.
   */
  DATA_GENERATED = 'data-generated',
}

/** Publication state shared by every editorial collection. */
export enum ContentStatus {
  DRAFT = 'draft',
  REVIEW = 'review',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

/**
 * Languages we publish in. Code is the primary key so translation rows read
 * as `language_code = 'de-DE'` rather than through an opaque id.
 *
 * ⚠️ Adding a row here is not the same as launching a language: a locale
 * with machine-translated guides is worse than no locale (CAMP-81).
 */
@Entity('languages')
export class Language {
  /** BCP 47, e.g. `en-GB`, `de-DE`. */
  @PrimaryColumn({ length: 16 })
  code: string;

  @Column()
  name: string;

  @Column({ default: 'ltr', length: 3 })
  direction: string;

  @Column({ default: false })
  published: boolean;
}

// ---------------------------------------------------------------------------
// Guides (CAMP-84)
// ---------------------------------------------------------------------------

@Entity('guides')
export class Guide {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  /** Matches the hub categories in the CAMP-84 mock-up. */
  @Column()
  category: string;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.DRAFT })
  status: ContentStatus;

  /**
   * How this guide was made. Required — see GuideProvenance.
   *
   * The database also enforces the pair: a `human` guide must name its
   * author, anything else must name the program that produced it.
   */
  @Column({ type: 'enum', enum: GuideProvenance })
  provenance: GuideProvenance;

  /** The program that produced a generated guide, e.g. "region-facts@1". */
  @Column({ nullable: true })
  generator?: string;

  @Column({ name: 'author_name', nullable: true })
  authorName?: string;

  /** "Проїхала 14 країн кемпером за 3 роки" - the E-E-A-T line. */
  @Column({ name: 'author_credentials', nullable: true })
  authorCredentials?: string;

  @Column({ name: 'reading_minutes', type: 'int', nullable: true })
  readingMinutes?: number;

  /**
   * When the facts were last verified, not when the row was touched.
   * Shown publicly ("Оновлено 12.09.2026") because a guide about border
   * rules is worthless without a date the reader can judge.
   */
  @Column({ name: 'facts_checked_at', type: 'date', nullable: true })
  factsCheckedAt?: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('guide_translations')
@Index(['guideId', 'languageCode'], { unique: true })
export class GuideTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'guide_id' })
  guideId: string;

  @ManyToOne(() => Guide, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guide_id' })
  guide: Guide;

  @Column({ name: 'language_code', length: 16 })
  languageCode: string;

  @Column()
  title: string;

  /**
   * The «Коротко» block from CAMP-84. Deliberately a separate field, not the
   * first paragraph of the body: it is what an assistant quotes and what a
   * reader in a hurry reads, so it has to survive being pulled out alone.
   */
  @Column({ type: 'text', nullable: true })
  summary?: string;

  @Column({ type: 'text', nullable: true })
  body?: string;
}

// ---------------------------------------------------------------------------
// Legal pages (CAMP-87)
// ---------------------------------------------------------------------------

@Entity('legal_pages')
export class LegalPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** privacy · terms · disclaimer · affiliate · attribution */
  @Index({ unique: true })
  @Column()
  slug: string;

  /**
   * Version and effective date are not decoration: without them nobody can
   * answer "what did I agree to in May" (CAMP-87).
   */
  @Column({ length: 16, default: '1.0' })
  version: string;

  @Column({ name: 'effective_from', type: 'date', nullable: true })
  effectiveFrom?: Date;

  @Column({ type: 'enum', enum: ContentStatus, default: ContentStatus.DRAFT })
  status: ContentStatus;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('legal_page_translations')
@Index(['legalPageId', 'languageCode'], { unique: true })
export class LegalPageTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'legal_page_id' })
  legalPageId: string;

  @ManyToOne(() => LegalPage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'legal_page_id' })
  legalPage: LegalPage;

  @Column({ name: 'language_code', length: 16 })
  languageCode: string;

  @Column()
  title: string;

  /**
   * The «Якщо коротко» box. GDPR art. 12 requires plain language, so this
   * is a schema-level obligation rather than a nicety - a legal section
   * without it is not finished.
   */
  @Column({ name: 'plain_summary', type: 'text', nullable: true })
  plainSummary?: string;

  @Column({ type: 'text', nullable: true })
  body?: string;
}

// ---------------------------------------------------------------------------
// Editorial picks for the home page (CAMP-81)
// ---------------------------------------------------------------------------

export enum FeaturedKind {
  ROUTE = 'route',
  CAMPING_SPOT = 'camping_spot',
  GUIDE = 'guide',
  RENTAL_CITY = 'rental_city',
}

/**
 * What an editor pins to the home page. Kept as kind + id rather than four
 * nullable foreign keys so adding a fifth kind later does not mean another
 * migration and another column nobody fills.
 */
@Entity('featured_blocks')
export class FeaturedBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: FeaturedKind })
  kind: FeaturedKind;

  /** Id of the row in the collection named by `kind`. */
  @Column({ name: 'target_id' })
  targetId: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  /** Optional editorial line shown instead of the item's own summary. */
  @Column({ type: 'text', nullable: true })
  note?: string;

  @Column({ name: 'active_from', type: 'timestamptz', nullable: true })
  activeFrom?: Date;

  @Column({ name: 'active_to', type: 'timestamptz', nullable: true })
  activeTo?: Date;
}
