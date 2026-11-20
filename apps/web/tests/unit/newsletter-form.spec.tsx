import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { SiteFooter } from "@/components/site-chrome";
import { NewsletterResultView, RESULTS, type NewsletterResult } from "@/components/newsletter-result";
import { metadata as confirmedMeta } from "@/app/newsletter/confirmed/page";
import { metadata as unsubscribedMeta } from "@/app/newsletter/unsubscribed/page";
import { metadata as invalidMeta } from "@/app/newsletter/link-invalid/page";
import {
  FILL_MARGIN_MS,
  MAX_EMAIL,
  MIN_FILL_MS,
  SENT_BODY,
  SENT_TITLE,
  interpret,
  messageFor,
  requestBody,
  sendSubscription,
  validateEmail,
  waitBeforeSending,
} from "@/lib/newsletter-form";
import { renderComponent } from "./render-component";
import { visibleText } from "./rendered-text";

// CAMP-441, review item 7 — the email field in the footer.
//
// 🔴 EVERY CLAIM ABOUT THE PAGE READS THE HTML THE FOOTER RENDERS — the real
// `SiteFooter`, through the same `visibleText` the other page specs use. Not a
// constant of the component, not a class name, not a `data-testid`, not an
// `sr-only` caption.

const footer = () => renderComponent(SiteFooter, { nav: [] });

const formOf = (html: string) => {
  const m = /<section\b[^>]*data-testid="footer-newsletter"[\s\S]*?<\/section>/.exec(html);
  expect(m, "the newsletter field is not in the footer").not.toBeNull();
  return m![0];
};

const API_RULES = readFileSync(
  join(__dirname, "../../../api/src/newsletter/newsletter.rules.ts"),
  "utf8",
);
const API_SERVICE = readFileSync(
  join(__dirname, "../../../api/src/newsletter/newsletter.service.ts"),
  "utf8",
);

test.describe("the footer carries the field", () => {
  test("anchor: the footer renders, with its legal column beside the field", () => {
    const html = footer();
    expect(html).toContain('aria-label="Legal"');
    expect(visibleText(formOf(html))).toContain("Occasional news by email");
  });

  test("🔴 a label, one email input, a submit button — and the label points at the input", () => {
    const form = formOf(footer());
    const text = visibleText(form);
    expect(text).toContain("Email address");
    expect(text).toContain("Subscribe");
    expect(form).toMatch(/<form\b/);
    const email = /<input\b[^>]*type="email"[^>]*>/.exec(form);
    expect(email, "no email input").not.toBeNull();
    expect(email![0]).toMatch(/\brequired\b/);
    expect(email![0]).toMatch(/autoComplete="email"/i);
    const id = /\bid="([^"]+)"/.exec(email![0])![1];
    expect(form).toContain(`for="${id}"`);
    expect(/<button\b[^>]*type="submit"/.test(form)).toBe(true);
  });

  test("🔴 the consent sentence says what happens, what is stored, and that nothing is sent before confirming — and links to the policy section", () => {
    const form = formOf(footer());
    const p = /<p\b[^>]*data-testid="newsletter-consent"[^>]*>[\s\S]*?<\/p>/.exec(form);
    expect(p, "no consent sentence").not.toBeNull();
    const text = visibleText(p![0]);
    expect(text).toContain("We will send you one letter to confirm this address");
    expect(text).toContain("you are not subscribed and we send you nothing else");
    expect(text).toContain("your address and the dates of your request");
    expect(text).toContain("in our own database, on our own server");
    expect(text).toContain("share it with nobody");
    expect(text).toContain("unsubscribe with one click");
    expect(p![0]).toContain('href="/legal/privacy#newsletter"');
    // and it comes AFTER the button, not before the field
    expect(form.indexOf('data-testid="newsletter-consent"')).toBeGreaterThan(form.indexOf("Subscribe"));
  });

  test("🔴 the consent sentence does not promise what the code does not do", () => {
    const text = visibleText(formOf(footer()));
    expect(text).not.toMatch(/weekly|daily|every day|exclusive|offers|deals|discount|free/i);
    expect(text).not.toMatch(/GDPR|lawful basis|legitimate interest/i);
  });

  test("🔴 without JavaScript the field says so and gives an address; the controls are not live before hydration", () => {
    const form = formOf(footer());
    expect(form).toMatch(/<noscript>[\s\S]*This form needs JavaScript[\s\S]*hello@camptribe\.eu[\s\S]*<\/noscript>/);
    const live = [...form.matchAll(/<(input|button)\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => !/aria-hidden|tabindex="-1"/.test(t));
    expect(live.length).toBe(2);
    // the ATTRIBUTE, not the `disabled:opacity-60` class that the field carries
    for (const t of live) expect(t, `a live control before hydration: ${t}`).toMatch(/\sdisabled(=""|\s|\/|>)/);
  });

  test("🔴 the trap is in the HTML, out of the tab order, hidden from assistive technology, named so autofill skips it", () => {
    const form = formOf(footer());
    const wrap = /<div\b[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/div>/.exec(form);
    expect(wrap, "no hidden wrapper").not.toBeNull();
    const input = /<input\b[^>]*name="leaveBlank"[^>]*>/.exec(wrap![0]);
    expect(input, "no trap input inside the hidden wrapper").not.toBeNull();
    expect(input![0]).toMatch(/tabindex="-1"/i);
    expect(input![0]).toMatch(/autoComplete="off"/i);
    expect(input![0]).not.toMatch(/name="(email|name|website|url|phone)"/);
  });

  test("the success state is not in the first HTML: the field starts idle", () => {
    const html = footer();
    expect(html).not.toContain("newsletter-sent");
    expect(visibleText(html)).not.toContain(SENT_TITLE);
  });
});

test.describe("what the page checks before sending", () => {
  test("accepts an address and refuses the others, with a reason", () => {
    expect(validateEmail("anna@example.eu")).toBeNull();
    expect(validateEmail("  anna@example.eu  ")).toBeNull();
    for (const bad of ["", "   ", "anna", "anna@", "anna@localhost", "a b@example.eu", "a@b@example.eu", "anna@example.eu\nBcc: x@example.eu"])
      expect(validateEmail(bad), `accepted «${JSON.stringify(bad)}»`).not.toBeNull();
    expect(validateEmail("")).toBe("Please give your email address.");
    expect(validateEmail("x".repeat(MAX_EMAIL) + "@example.eu")).not.toBeNull();
  });

  test("🔴 the request body is the address and two numbers — NOTHING else", () => {
    const body = requestBody("  Anna@Example.EU ", 8123.6);
    expect(body).toEqual({ email: "Anna@Example.EU", leaveBlank: "", elapsedMs: 8124 });
    expect(Object.keys(body).sort()).toEqual(["elapsedMs", "email", "leaveBlank"]);
  });

  test("🔴 the limits are the API's, read from the API's own file", () => {
    expect(API_RULES).toContain(`email: ${MAX_EMAIL}`);
    expect(API_RULES).toMatch(new RegExp(`MIN_FILL_MS = ${MIN_FILL_MS}\\b`));
  });

  test("a person is never «too fast»: the button waits out the remainder plus a margin", () => {
    expect(waitBeforeSending(0)).toBe(MIN_FILL_MS + FILL_MARGIN_MS);
    expect(waitBeforeSending(MIN_FILL_MS)).toBe(FILL_MARGIN_MS);
    expect(waitBeforeSending(MIN_FILL_MS + FILL_MARGIN_MS)).toBe(0);
    expect(waitBeforeSending(60_000)).toBe(0);
  });
});

test.describe("what the page does with the answer", () => {
  test("status decides the outcome", () => {
    expect(interpret(200)).toBe("sent");
    expect(interpret(400)).toBe("invalid");
    expect(interpret(429)).toBe("throttled");
    expect(interpret(503)).toBe("failed");
    expect(interpret(500)).toBe("failed");
  });

  test("🔴 success never claims a letter was sent, because the API answers the same for every address", () => {
    expect(SENT_TITLE).toBe("Check your inbox to confirm");
    expect(SENT_BODY).toContain("unless this address is already on our list");
    expect(SENT_BODY).toContain("You are not subscribed until you open the link");
  });

  test("every failure has its own words and none of them says «subscribed»", () => {
    const texts = (["invalid", "throttled", "unavailable", "failed"] as const).map(messageFor);
    expect(new Set(texts).size).toBe(4);
    for (const t of texts) expect(t).not.toMatch(/you are subscribed|thank you/i);
  });

  test("sends one POST to {api}/newsletter, JSON, no credentials", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const out = await sendSubscription(
      requestBody("a@example.eu", 9000),
      "https://camptribe.eu/api",
      async (url, init) => {
        calls.push({ url, init });
        return new Response("{}", { status: 200 });
      },
    );
    expect(out).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://camptribe.eu/api/newsletter");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.credentials).toBe("omit");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "a@example.eu", leaveBlank: "", elapsedMs: 9000 });
  });

  test("🔴 an empty API address sends NOTHING and says so", async () => {
    let called = 0;
    const out = await sendSubscription(requestBody("a@example.eu", 9000), "", async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    });
    expect(out).toBe("unavailable");
    expect(called).toBe(0);
  });

  test("a network failure is `failed`, not a throw", async () => {
    const out = await sendSubscription(requestBody("a@example.eu", 9000), "https://x.example", async () => {
      throw new TypeError("network");
    });
    expect(out).toBe("failed");
  });
});

test.describe("where the links in the letter land", () => {
  const html = (state: NewsletterResult) => renderComponent(NewsletterResultView, { state });

  test("🔴 each page says what the link did — and only that", () => {
    expect(visibleText(html("confirmed"))).toContain("your address is confirmed");
    expect(visibleText(html("confirmed"))).toContain("You are subscribed");
    expect(visibleText(html("unsubscribed"))).toContain("You are unsubscribed");
    expect(visibleText(html("unsubscribed"))).toContain("we will not write to you again");
    const bad = visibleText(html("link-invalid"));
    expect(bad).toContain("This link does not work");
    expect(bad).toContain("Nothing was changed");
    // a failed link must not claim a result it did not have
    expect(bad).not.toMatch(/You are subscribed|You are unsubscribed/);
  });

  test("the pages that mention the privacy section or an address link to real ones", () => {
    expect(html("confirmed")).toContain('href="/legal/privacy#newsletter"');
    expect(html("unsubscribed")).toContain('href="mailto:privacy@camptribe.eu"');
    expect(html("link-invalid")).toContain('href="mailto:hello@camptribe.eu"');
  });

  test("🔴 «48 hours» on the dead-link page is the API's TTL", () => {
    expect(API_SERVICE).toMatch(/CONFIRM_TTL_HOURS = 48\b/);
    expect(visibleText(html("link-invalid"))).toContain("works for 48 hours");
  });

  test("all three pages are noindex, nofollow and send no referrer", () => {
    for (const m of [confirmedMeta, unsubscribedMeta, invalidMeta]) {
      expect(m.robots).toEqual({ index: false, follow: false });
      expect((m as { referrer?: string }).referrer).toBe("no-referrer");
    }
    expect(confirmedMeta.title).toBe(RESULTS.confirmed.title);
    expect(invalidMeta.title).toBe(RESULTS["link-invalid"].title);
  });

  test("the redirects the API makes land on routes that exist", () => {
    const controller = readFileSync(
      join(__dirname, "../../../api/src/newsletter/newsletter.controller.ts"),
      "utf8",
    );
    for (const page of ["confirmed", "unsubscribed", "link-invalid"]) {
      expect(controller).toContain(`'${page}'`);
      expect(
        readFileSync(join(__dirname, `../../src/app/newsletter/${page}/page.tsx`), "utf8").length,
      ).toBeGreaterThan(0);
    }
  });
});
