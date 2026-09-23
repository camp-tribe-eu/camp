// CAMP-66: guides, and the label the law requires on them.
//
// 🔴 Article 50(2) of the EU AI Act applies from 02.08.2026 and is in
// force now: the Digital Omnibus (Regulation (EU) 2026/1744) deferred
// the high-risk obligations to 2027–2028 and left Article 50 alone.
// Text a machine produced must be marked as such, from the first
// publication.
//
// So the label is not a footnote and not a tooltip. It sits at the top
// of the page, before the text it describes, because a disclosure a
// reader meets after reading is not a disclosure.

import { API_BASE } from './api';

export type GuideProvenance =
  | 'human'
  | 'ai-assisted'
  | 'ai-generated'
  | 'data-generated';

export interface Guide {
  slug: string;
  category: string;
  title: string;
  summary: string | null;
  body: string | null;
  provenance: GuideProvenance;
  generator: string | null;
  authorName: string | null;
  authorCredentials: string | null;
  readingMinutes: number | null;
  factsCheckedAt: string | null;
  publishedAt: string | null;
}

/**
 * What the page says about how it was made.
 *
 * 🔴 Plain words, not a badge that reads "AI ✨". The point is that a
 * reader understands, and "written by a program from our own database"
 * is understood by everyone while "AI-assisted content" is marketing.
 */
export const PROVENANCE_LABEL: Record<
  GuideProvenance,
  { short: string; explain: string }
> = {
  human: {
    short: 'Written by a person',
    explain: 'A person wrote this and is named above.',
  },
  'ai-assisted': {
    short: 'Written with machine help',
    explain:
      'A person wrote and edited this with help from a language model. It is marked because you cannot tell which sentences are whose, and under Article 50 of the EU AI Act you are entitled to know.',
  },
  'ai-generated': {
    short: 'Written by a machine',
    explain:
      'A language model wrote this text and a person checked it before publication. Marked under Article 50 of the EU AI Act.',
  },
  'data-generated': {
    short: 'Assembled from our database',
    explain:
      'A program wrote this page from our own records. Every number on it is a count of what has been recorded — nothing here is an opinion, an estimate or a sentence a model invented.',
  },
};

/** Machine-made text is labelled; a person's work is credited. */
export function needsAiDisclosure(p: GuideProvenance): boolean {
  return p !== 'human';
}

/**
 * Is this guide publishable at all?
 *
 * 🔴 Used by the build guard, not only by the page. A guide with no
 * provenance is one we may not publish, and a generated guide with no
 * named generator cannot be disclosed properly — "a machine wrote it"
 * with no answer to "which one" is a disclosure in form only.
 */
export function publishable(guide: Guide): string[] {
  const problems: string[] = [];
  if (!guide.provenance) {
    problems.push(`${guide.slug}: no provenance — cannot be published`);
    return problems;
  }
  if (!PROVENANCE_LABEL[guide.provenance]) {
    problems.push(`${guide.slug}: unknown provenance "${guide.provenance}"`);
  }
  if (guide.provenance === 'human' && !guide.authorName) {
    problems.push(`${guide.slug}: written by a person, but nobody is named`);
  }
  if (needsAiDisclosure(guide.provenance) && !guide.generator) {
    problems.push(
      `${guide.slug}: machine-made but does not say which program made it`,
    );
  }
  if (!guide.title?.trim()) problems.push(`${guide.slug}: no title`);
  return problems;
}

export async function getGuides(): Promise<Guide[]> {
  const res = await fetch(`${API_BASE}/guides`, {
    next: { revalidate: 3600 },
  });
  return res.ok ? res.json() : [];
}

export async function getGuide(slug: string): Promise<Guide | null> {
  const res = await fetch(`${API_BASE}/guides/${slug}`, {
    next: { revalidate: 3600 },
  });
  return res.ok ? res.json() : null;
}
