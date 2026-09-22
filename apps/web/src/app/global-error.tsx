'use client';

// CAMP-73 — the last resort.
//
// 🔴 This one replaces the root layout, so it has to render its own
// <html> and <body>, and it cannot use the site header, footer, fonts or
// anything else that lives in the layout — whatever broke may be the
// layout itself. Which is why the styles here are inline and not a
// single class from our stylesheet: if the CSS failed to load, a page
// styled with our classes would be unreadable white-on-white, and this
// is the page that has to work when nothing else did.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: '48px 20px',
          background: '#F0F2F4',
          color: '#343D50',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          lineHeight: 1.5,
        }}
      >
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h1 style={{ fontSize: 28, margin: '0 0 12px' }}>
            CampTribe could not load this page
          </h1>
          <p style={{ margin: '0 0 16px', color: '#5A5A5A' }}>
            Something failed before the page could be built. The fault is
            ours.
          </p>
          {error.digest && (
            <p style={{ margin: '0 0 24px', fontSize: 12, color: '#5A5A5A' }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              font: 'inherit',
              fontWeight: 600,
              padding: '10px 16px',
              borderRadius: 6,
              border: '1px solid #404B62',
              background: '#FFFFFF',
              color: '#343D50',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <p style={{ marginTop: 24 }}>
            <a href="/" style={{ color: '#404B62' }}>
              Go to the home page
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
