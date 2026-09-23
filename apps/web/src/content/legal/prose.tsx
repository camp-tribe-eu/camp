import type { ReactNode } from 'react';

// CAMP-56: the small set of elements the legal pages are built from.
//
// 🔴 Deliberately plain. A legal page that is hard to read is a legal
// page a court may read against us: Article 5 of the GDPR requires
// information to be given "in a concise, transparent, intelligible and
// easily accessible form, using clear and plain language", and the
// Unfair Terms Directive tests whether a term was drafted plainly at all.
// So short lines, real headings, and no wall of capital letters — the
// shouting block that template terms use is a readability problem
// dressed up as seriousness.

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-10 scroll-mt-24 text-xl font-bold text-heading first:mt-0"
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 text-base font-semibold text-heading">{children}</h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-prose text-sm leading-6 text-ink-2">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-3 max-w-prose list-disc space-y-2 pl-5 text-sm leading-6 text-ink-2">
      {children}
    </ul>
  );
}

/**
 * The parts a reader must not skim past — what we are not, and the
 * rights we cannot and do not take away.
 */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 max-w-prose rounded-card border border-line-blue bg-accent-surface p-4 text-sm leading-6 text-heading">
      {children}
    </div>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      className="underline decoration-line-blue underline-offset-2"
      {...(external ? { rel: 'noopener' } : {})}
    >
      {children}
    </a>
  );
}

export const B = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-heading">{children}</strong>
);
