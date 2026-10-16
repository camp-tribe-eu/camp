// CAMP-229 — what the browser is allowed to say to this API, in one place.
//
// 🔴 WHY THIS IS A FUNCTION OF ITS OWN AND NOT AN OBJECT IN main.ts. `main.ts`
// boots a server and cannot be imported by a test; the options it passed to
// `enableCors` were therefore a thing nobody could check, and the one line
// that mattered on 16.10.2026 — which request headers a page may send — was
// a literal in a file with no spec. `cors.spec.ts` puts THIS object through the
// real middleware and sends a real preflight, and also reads `main.ts` to
// confirm it is the object `main.ts` uses.

/**
 * 🔴 `Authorization` IS ALLOWED NOW, AND THE REASON IS THE ACCOUNT PAGE.
 *
 * Until CAMP-229 no page of ours sent a bearer token: sign-in, sign-up and the
 * letter forms are POSTs that carry a body and no credential. The account page
 * has to ask "who am I?" with the session token in `Authorization`, from the
 * reader's browser, across origins — and a cross-origin request with that header
 * is preflighted. Without the header in `Access-Control-Allow-Headers` the
 * preflight fails and the page cannot tell a signed-in person from a stranger:
 * measured below in `cors.spec.ts` as the one-word difference between a 204 that
 * names `authorization` and a 204 that does not.
 *
 * 🔴 WHAT THIS DOES NOT LOOSEN, because the old comment ("we send no cookies and
 * no Authorization, so credentials must stay off") was right about the second
 * half and is now out of date about the first:
 *
 *   · `credentials: false` stays. A token the page attaches by hand is not an
 *     ambient credential: a stranger's page on another origin cannot make the
 *     browser add it, because it lives in OUR origin's storage and no cookie
 *     carries it. Turning `credentials` on is what would make a mistaken
 *     allowlist entry dangerous rather than merely wrong.
 *   · `origin` stays the allowlist and never `true` or `*`. An origin not on the
 *     list gets no `Access-Control-Allow-Origin`, so its page cannot read the
 *     answer even if it somehow held a token.
 */
export function corsOptions(origins: string[]) {
  return {
    origin: origins,
    // 🔴 POST is here for CAMP-92's client-error report and the account forms.
    // It is safe only because the allowlist above is still the gate — a POST
    // from an origin we did not list never reaches the handler. A wider method
    // set needs its own reasoning, not this one.
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86_400,
  };
}
