import { expect, test } from "@playwright/test";
import RoutePage from "@/app/routes/[slug]/page";
import RouteMapEmbed from "@/components/route-map-embed";
import { ROUTE_FIXTURE } from "../fixtures/route";
import {
  NullRouteGeometry,
  REFERENCE_CAMPER,
  ROAD_FALLBACK_REASON,
  routeGeometryProvider,
  vehicleFromDraft,
} from "../../src/lib/route-geometry";
import {
  assertVehicle,
  decodePolyline6,
  RouteGeometryError,
  ValhallaRouteGeometry,
} from "../../src/lib/route-geometry-valhalla";
import {
  CAMPSITES_PER_STAGE,
  STAGE_RADIUS_M,
  STRAIGHT_LINE_LABEL,
} from "../../src/lib/routes";
import { renderAsyncComponent } from "./render-component";
import { visibleText } from "./rendered-text";

// CAMP-457 — THE CONSUMER OF ROAD ROUTING, BEHIND A FLAG THAT IS OFF.
//
// 🔴 No network anywhere: `fetch` is a stub. The Valhalla answer below is
// written by hand from the documented shape of `POST /route` (`trip.legs[]`
// with a polyline6 `shape` and a `summary` carrying `length` in km, `time` in
// seconds and the `has_*` flags). Its two polylines were encoded by an
// independent encoder, not by the decoder under test, so "first and last
// coordinate" is an outside fact. The pair is Zagreb→Split→Dubrovnik:
// 625.6 km, 434 min (Zagreb→Dubrovnik by road; 410 km is Zagreb→Split alone).
//
// 🔴 What the page says is read from the HTML the page serves
// (`renderAsyncComponent` + `visibleText`), and the fallback sentence is
// written out here by hand, not imported.

const ZAGREB = { lat: 45.815, lon: 15.9819 };
const SPLIT = { lat: 43.5081, lon: 16.4402 };
const DUBROVNIK = { lat: 42.6507, lon: 18.0944 };

const LEG1_SHAPE = "olikvAwsmn]ndpd@g|r^vngfBnxsB";
const LEG2_SHAPE = "gwo~qAowlj^fk_^orqy@ffiT_gki@";

const valhallaAnswer = () => ({
  trip: {
    status: 0,
    units: "kilometers",
    legs: [
      {
        shape: LEG1_SHAPE,
        summary: {
          length: 410.0,
          time: 15720,
          has_toll: true,
          has_ferry: false,
          has_highway: true,
        },
      },
      {
        shape: LEG2_SHAPE,
        summary: {
          length: 215.6,
          time: 10320,
          has_toll: false,
          has_ferry: true,
          has_highway: false,
        },
      },
    ],
    summary: { length: 625.6, time: 26040 },
  },
});

const CAMPER = { heightM: 3.2, widthM: 2.3, lengthM: 7.5, weightT: 3.5 };

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

interface Call {
  url: string;
  init: RequestInit;
}

function stub(impl: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return Promise.resolve().then(() => impl(call));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const provider = (
  fetchImpl: typeof fetch,
  over: Partial<ConstructorParameters<typeof ValhallaRouteGeometry>[0]> = {},
) =>
  new ValhallaRouteGeometry({
    baseUrl: "http://valhalla.test:8002/",
    vehicle: CAMPER,
    fetchImpl,
    ...over,
  });

const sent = (c: Call) => JSON.parse(String(c.init.body));
const WAYPOINTS = [ZAGREB, SPLIT, DUBROVNIK];

// ── 1. THE REQUEST IS FOR A CAMPER, NOT FOR VALHALLA'S LORRY ─────────────

test("🔴 the request carries the camper's own dimensions and not the lorry defaults", async () => {
  const { calls, fetchImpl } = stub(() => ok(valhallaAnswer()));
  await provider(fetchImpl).road(WAYPOINTS);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("http://valhalla.test:8002/route");
  expect(calls[0].init.method).toBe("POST");
  const body = sent(calls[0]);
  expect(body.costing).toBe("truck");
  expect(body.costing_options.truck).toEqual({
    height: 3.2,
    width: 2.3,
    length: 7.5,
    weight: 3.5,
  });
  // Valhalla's own truck defaults, which are a lorry: 4.11 m and 21.77 t.
  expect(JSON.stringify(body)).not.toContain("4.11");
  expect(JSON.stringify(body)).not.toContain("21.77");
  expect(body.units).toBe("kilometers");
  expect(body.directions_options.units).toBe("kilometers");
  expect(body.locations).toEqual([
    { lat: 45.815, lon: 15.9819, type: "break" },
    { lat: 43.5081, lon: 16.4402, type: "break" },
    { lat: 42.6507, lon: 18.0944, type: "break" },
  ]);
});

test("🔴 a vehicle with a missing or broken field is refused before any request", async () => {
  // Omitting a field would let Valhalla use the lorry's value for it.
  for (const bad of [
    { ...CAMPER, heightM: NaN },
    { ...CAMPER, weightT: 0 },
    { ...CAMPER, widthM: -1 },
    { ...CAMPER, lengthM: undefined as unknown as number },
  ]) {
    const { calls, fetchImpl } = stub(() => ok(valhallaAnswer()));
    const err = await provider(fetchImpl, { vehicle: bad })
      .road(WAYPOINTS)
      .catch((e) => e);
    expect(err).toBeInstanceOf(RouteGeometryError);
    expect(err.kind).toBe("vehicle");
    expect(calls).toHaveLength(0);
  }
  expect(() => assertVehicle(CAMPER)).not.toThrow();
});

test("the planner form's strings become dimensions; empty or junk becomes nothing, with width defaulted", () => {
  expect(vehicleFromDraft({ height: "3,2", length: "7.5", weight: "3.5" })).toEqual(
    CAMPER,
  );
  expect(vehicleFromDraft({ height: "", length: "7.5", weight: "3.5" })).toBeUndefined();
  expect(vehicleFromDraft({ height: "tall", length: "7.5", weight: "3.5" })).toBeUndefined();
  expect(vehicleFromDraft({ height: "3.2", length: "7.5", weight: "0" })).toBeUndefined();
  expect(REFERENCE_CAMPER).toEqual(CAMPER);
});

// ── 2. WHAT COMES BACK ───────────────────────────────────────────────────

test("🔴 polyline6 decodes to the expected first and last coordinate, longitude first", () => {
  const a = decodePolyline6(LEG1_SHAPE);
  expect(a).toEqual([
    [15.9819, 45.815],
    [16.5, 45.2],
    [16.4402, 43.5081],
  ]);
  const b = decodePolyline6(LEG2_SHAPE);
  expect(b[b.length - 1]).toEqual([18.0944, 42.6507]);
});

test("distance, time, the joined line and per-leg flags come through", async () => {
  const { fetchImpl } = stub(() => ok(valhallaAnswer()));
  const r = await provider(fetchImpl).road(WAYPOINTS);
  expect(r.available).toBe(true);
  if (!r.available) return;
  const g = r.geometry;
  expect(g.metres).toBeCloseTo(625_600, 3);
  expect(g.seconds / 60).toBe(434);
  expect(g.engine).toBe("Valhalla");
  expect(g.vehicle).toEqual(CAMPER);
  // 3 + 3 points, the joint at Split kept once.
  expect(g.line).toHaveLength(5);
  expect(g.line[0]).toEqual([15.9819, 45.815]);
  expect(g.line[2]).toEqual([16.4402, 43.5081]);
  expect(g.line[4]).toEqual([18.0944, 42.6507]);
  expect(g.legs).toEqual([
    { metres: 410_000, seconds: 15720, hasToll: true, hasFerry: false, hasHighway: true },
    {
      metres: 215_600,
      seconds: 10320,
      hasToll: false,
      hasFerry: true,
      hasHighway: false,
    },
  ]);
});

// ── 3. FAILURE IS A NAMED ERROR, NEVER A STRAIGHT LINE ───────────────────

test("🔴 a 500 throws a named error", async () => {
  const { fetchImpl } = stub(() => new Response("boom", { status: 500 }));
  const err = await provider(fetchImpl).road(WAYPOINTS).catch((e) => e);
  expect(err).toBeInstanceOf(RouteGeometryError);
  expect(err.name).toBe("RouteGeometryError");
  expect(err.kind).toBe("http");
});

test("🔴 a request that never answers times out as a named error", async () => {
  const { fetchImpl } = stub(
    (c) =>
      new Promise<Response>((_, reject) => {
        (c.init.signal as AbortSignal).addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  const t0 = Date.now();
  const err = await provider(fetchImpl, { timeoutMs: 40 })
    .road(WAYPOINTS)
    .catch((e) => e);
  expect(err).toBeInstanceOf(RouteGeometryError);
  expect(err.kind).toBe("timeout");
  expect(Date.now() - t0).toBeLessThan(2000);
});

test("a refused connection, a non-route body and a missing leg are each named errors", async () => {
  const refused = stub(() => {
    throw new TypeError("fetch failed");
  });
  expect(
    (await provider(refused.fetchImpl).road(WAYPOINTS).catch((e) => e)).kind,
  ).toBe("network");

  const junk = stub(() => ok({ hello: "world" }));
  expect(
    (await provider(junk.fetchImpl).road(WAYPOINTS).catch((e) => e)).kind,
  ).toBe("shape");

  const oneLeg = valhallaAnswer();
  oneLeg.trip.legs.pop();
  const short = stub(() => ok(oneLeg));
  expect(
    (await provider(short.fetchImpl).road(WAYPOINTS).catch((e) => e)).kind,
  ).toBe("shape");
});

// ── 4. THE FLAG ──────────────────────────────────────────────────────────

test("🔴 flag off → NullRouteGeometry; Valhalla only when BOTH variables are set", () => {
  const url = "http://valhalla.test:8002";
  expect(routeGeometryProvider({ env: {} })).toBeInstanceOf(NullRouteGeometry);
  expect(routeGeometryProvider({ env: { VALHALLA_URL: url } })).toBeInstanceOf(
    NullRouteGeometry,
  );
  expect(
    routeGeometryProvider({ env: { ROUTING_PROVIDER: "valhalla" } }),
  ).toBeInstanceOf(NullRouteGeometry);
  expect(
    routeGeometryProvider({ env: { ROUTING_PROVIDER: "valhalla", VALHALLA_URL: "  " } }),
  ).toBeInstanceOf(NullRouteGeometry);
  expect(
    routeGeometryProvider({ env: { ROUTING_PROVIDER: "osrm", VALHALLA_URL: url } }),
  ).toBeInstanceOf(NullRouteGeometry);
  const on = routeGeometryProvider({
    env: { ROUTING_PROVIDER: "valhalla", VALHALLA_URL: url },
  });
  expect(on).toBeInstanceOf(ValhallaRouteGeometry);
  expect(on.id).toBe("valhalla");
});

test("🔴 the flag-on factory sends the reference camper when nobody supplied a vehicle, and the given one when they did", async () => {
  const env = { ROUTING_PROVIDER: "valhalla", VALHALLA_URL: "http://v.test" };
  const a = stub(() => ok(valhallaAnswer()));
  await routeGeometryProvider({ env, fetchImpl: a.fetchImpl }).road(WAYPOINTS);
  expect(sent(a.calls[0]).costing_options.truck).toEqual({
    height: 3.2,
    width: 2.3,
    length: 7.5,
    weight: 3.5,
  });
  const b = stub(() => ok(valhallaAnswer()));
  await routeGeometryProvider({
    env,
    fetchImpl: b.fetchImpl,
    vehicle: { heightM: 2.9, widthM: 2.2, lengthM: 6.0, weightT: 3.0 },
  }).road(WAYPOINTS);
  expect(sent(b.calls[0]).costing_options.truck).toEqual({
    height: 2.9,
    width: 2.2,
    length: 6,
    weight: 3,
  });
});

// ── 5. THE PAGE ──────────────────────────────────────────────────────────

const route = ROUTE_FIXTURE;

const FALLBACK_SENTENCE =
  "Road distance is not shown: our road-routing service did not answer, so the only distance on this page is the straight line between the stops.";

const nearBody = () => ({
  groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, spots: [] })),
  perPoint: CAMPSITES_PER_STAGE,
  radiusMetres: STAGE_RADIUS_M,
  returned: 0,
});
const servicesEmpty = () => ({
  groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, services: [] })),
  radiusMetres: 1,
  perKind: 1,
  returned: 0,
  truncated: false,
});

/** A Valhalla answer with one leg per gap between this route's stages. */
const answerFor = (n: number) => {
  const base = valhallaAnswer();
  const legs = Array.from({ length: n - 1 }, (_, i) => ({
    ...base.trip.legs[i === n - 2 ? 1 : 0],
  }));
  return { trip: { legs } };
};

async function renderRoute(
  env: Record<string, string | undefined>,
  valhalla: (url: string, body: { locations: unknown[] }) => Response,
): Promise<{ html: string; valhallaCalls: number }> {
  const real = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  let valhallaCalls = 0;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    Promise.resolve().then(() => {
      const u = String(url);
      if (u.startsWith("http://valhalla.test")) {
        valhallaCalls += 1;
        return valhalla(u, JSON.parse(String(init?.body)));
      }
      if (u.includes("/routes/content")) {
        return ok(
          /\/routes\/content\/.+/.test(u)
            ? ROUTE_FIXTURE
            : { routes: [ROUTE_FIXTURE] },
        );
      }
      if (u.includes("/routes/near")) return ok(nearBody());
      if (u.includes("/routes/services")) return ok(servicesEmpty());
      throw new Error(`unexpected request in a unit test: ${u}`);
    })) as typeof fetch;
  try {
    const html = await renderAsyncComponent(
      RoutePage,
      { params: Promise.resolve({ slug: route.slug }) },
      { omit: [RouteMapEmbed] },
    );
    return { html, valhallaCalls };
  } finally {
    globalThis.fetch = real;
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const ON = { ROUTING_PROVIDER: "valhalla", VALHALLA_URL: "http://valhalla.test:8002" };
const OFF = { ROUTING_PROVIDER: undefined, VALHALLA_URL: undefined };

test("🔴 flag off: the page is as before — straight-line disclaimer, no road figure, Valhalla never called", async () => {
  const { html, valhallaCalls } = await renderRoute(OFF, () => {
    throw new Error("Valhalla must not be called with the flag off");
  });
  const text = visibleText(html);
  expect(valhallaCalls).toBe(0);
  expect(text).toContain(
    "Road distance is not shown: the only distance on this page is the straight line between the stops.",
  );
  expect(text).not.toContain(FALLBACK_SENTENCE);
  expect(text).toContain(STRAIGHT_LINE_LABEL);
  expect(html).not.toContain('data-testid="figure-road-distance"');
});

test("🔴 flag on + Valhalla down: the page falls back to the straight line and says so in one sentence", async () => {
  const { html, valhallaCalls } = await renderRoute(
    ON,
    () => new Response("down", { status: 500 }),
  );
  const text = visibleText(html);
  expect(valhallaCalls).toBe(1);
  expect(text).toContain(FALLBACK_SENTENCE);
  expect(ROAD_FALLBACK_REASON).toBe(FALLBACK_SENTENCE);
  // The straight line is still labelled as one; no road figure is invented.
  expect(text).toContain(STRAIGHT_LINE_LABEL);
  expect(html).not.toContain('data-testid="figure-road-distance"');
  expect(html).not.toContain('data-testid="figure-driving-time"');
  expect(html).toContain('data-testid="figure-road-distance-missing"');
});

test("🔴 flag on + Valhalla answering: the page prints the road figure for the camper, with toll and ferry", async () => {
  const { html } = await renderRoute(ON, (_u, body) =>
    ok(answerFor(body.locations.length)),
  );
  const text = visibleText(html);
  expect(text).not.toContain(FALLBACK_SENTENCE);
  expect(html).toContain('data-testid="figure-road-distance"');
  expect(text).toContain(
    "Computed by Valhalla for a camper 3.2 m high, 7.5 m long, 3.5 t. Includes toll roads. Includes a ferry.",
  );
  expect(text).toContain(STRAIGHT_LINE_LABEL);
});
