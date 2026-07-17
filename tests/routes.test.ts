/**
 * End-to-end behaviour of the six route handlers.
 *
 * The handlers are invoked directly — they are plain functions of a `Request`,
 * so a server would add a socket and nothing else. Gemini is the only thing
 * mocked, and it is mocked by delegation: unless a test says otherwise the real
 * client runs and fails exactly as it would with no key, which is what makes the
 * degradation tests below mean something. Both of its entry points are stubbed
 * that way — `generate`, whose failure is a 503, and `generateOptional`, whose
 * failure is the missing prose the degradation tests are about.
 *
 * The properties under test are the ones a hand-written route can silently get
 * wrong: that validation actually runs before the model is called, that a model
 * outage costs the prose and never the computed route or plan, that the prompt
 * is grounded in live venue data rather than the model's own memory, and that no
 * response — success or failure — escapes without the security headers.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as advisorPOST } from "@/app/api/advisor/route";
import { POST as assistantPOST } from "@/app/api/assistant/route";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as itineraryPOST } from "@/app/api/itinerary/route";
import { GET as snapshotGET } from "@/app/api/snapshot/route";
import { POST as wayfindingPOST } from "@/app/api/wayfinding/route";
import { FORECAST_HORIZON_MINUTES, currentReport, forecastAt, snapshotAt } from "@/lib/crowd-model";
import { MODEL_NAME, generate, generateOptional, isConfigured, resetModelCache } from "@/lib/gemini";
import { HOST_DISTRICTS } from "@/lib/itinerary";
import { describeTrendForFan, describeZoneForFan } from "@/lib/prompt";
import { ZONES, getZone } from "@/lib/venue";
import { findRoute } from "@/lib/wayfinding";
import { bodyOf, expectSecurityHeaders } from "./helpers";

const realGemini = await vi.importActual<typeof import("@/lib/gemini")>("@/lib/gemini");
const realWayfinding = await vi.importActual<typeof import("@/lib/wayfinding")>("@/lib/wayfinding");
const realCrowdModel = await vi.importActual<typeof import("@/lib/crowd-model")>("@/lib/crowd-model");

vi.mock("@/lib/gemini", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/gemini")>();
	// Delegating by default keeps both entry points honest: with no key configured
	// the real gate throws, so the graceful-degradation tests exercise the real
	// path — the real `generateOptional`, absorbing a real `generate` failure.
	//
	// Both are stubbed, because they are separate seams. `generateOptional` calls
	// `generate` inside the module, where a mock cannot reach: replacing the
	// exported `generate` does not change whom `generateOptional` calls. So a
	// route that narrates optionally is controlled by stubbing `generateOptional`,
	// and one that needs a 503 by stubbing `generate`. `withHealthyModel` stubs
	// both, which is also what stops a stubbed key from reaching the network.
	return { ...actual, generate: vi.fn(actual.generate), generateOptional: vi.fn(actual.generateOptional) };
});

vi.mock("@/lib/wayfinding", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/wayfinding")>();
	// Delegating by default, exactly like the Gemini mock: the router really runs
	// unless a test needs to force the "no path" case the venue graph cannot
	// currently produce.
	return { ...actual, findRoute: vi.fn(actual.findRoute) };
});

vi.mock("@/lib/crowd-model", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/crowd-model")>();
	// Delegating by default, like the two mocks above: the real model runs unless
	// a test needs to force a report the venue topology cannot currently produce.
	return { ...actual, currentReport: vi.fn(actual.currentReport) };
});

const generateMock = vi.mocked(generate);
const generateOptionalMock = vi.mocked(generateOptional);
const findRouteMock = vi.mocked(findRoute);
const currentReportMock = vi.mocked(currentReport);

/** Canned model output, distinctive enough to prove it reached the response. */
const CANNED = "1. Open Gate B lanes 4-6. Gate A is 91% full with a 9 min queue.";

const PHASES = new Set(["pre-match", "first-half", "half-time", "second-half", "egress"]);
const TRENDS = new Set(["rising", "falling", "steady"]);

/**
 * Wall-clock instant the handlers see.
 *
 * The handlers read the crowd model at `Date.now()`, and `clockFromWallTime`
 * advances the match clock every four real seconds — so an unfrozen suite tests
 * a different phase on every run, and reports a different coverage figure with
 * it. Freezing it makes each run reproduce the last. The instant chosen is
 * `clock = 30`: pre-match, gates and transit loaded, queues non-zero, which is
 * the state with the most to say in a prompt.
 */
const FROZEN_NOW = 30 * 4 * 1000;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(FROZEN_NOW);
	resetModelCache();
	generateMock.mockImplementation(realGemini.generate);
	generateOptionalMock.mockImplementation(realGemini.generateOptional);
	findRouteMock.mockImplementation(realWayfinding.findRoute);
	currentReportMock.mockImplementation(realCrowdModel.currentReport);
	// Absent unless a test opts in, so "AI unavailable" is the default world and
	// a leaked developer key in the shell cannot quietly turn these into live calls.
	vi.stubEnv("GEMINI_API_KEY", undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	resetModelCache();
	generateMock.mockReset();
	generateOptionalMock.mockReset();
	findRouteMock.mockReset();
	currentReportMock.mockReset();
});

/** Build a POST request carrying a JSON body. */
function post(path: string, body: unknown): NextRequest {
	return new NextRequest(`https://pitchops.test${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Build a POST request carrying a raw body that is not valid JSON. */
function postRaw(path: string, raw: string): NextRequest {
	return new NextRequest(`https://pitchops.test${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: raw,
	});
}

/** Narrow an unknown body to a record so its fields can be read. */
function asRecord(value: unknown): Record<string, unknown> {
	expect(typeof value).toBe("object");
	expect(value).not.toBeNull();
	if (typeof value !== "object" || value === null) throw new Error("expected an object body");
	return value as Record<string, unknown>;
}

/**
 * Configure a key and a canned reply, standing in for a healthy Gemini.
 *
 * Both seams are stubbed. A route reaches the model through exactly one of them,
 * and stubbing only the one under test would leave the other delegating to the
 * real client — which, with the key this stubs, would try the network.
 */
function withHealthyModel(reply = CANNED): void {
	vi.stubEnv("GEMINI_API_KEY", "test-key-value");
	generateMock.mockResolvedValue(reply);
	generateOptionalMock.mockResolvedValue(reply);
}

/**
 * The single prompt string the route sent, by whichever seam it uses.
 *
 * Pooled rather than asking the caller which entry point its route happens to
 * call: what every one of these tests is really asserting is that the model was
 * asked exactly once, and what it was told. Pooling also keeps the count honest
 * — a route that somehow asked twice, by either seam, fails here.
 */
function promptSent(): string {
	const calls = [...generateMock.mock.calls, ...generateOptionalMock.mock.calls];
	expect(calls).toHaveLength(1);
	const prompt = calls[0]?.[0];
	expect(typeof prompt).toBe("string");
	return prompt ?? "";
}

/** Assert the route never reached the model, by either seam. */
function expectNoModelCall(): void {
	expect(generateMock).not.toHaveBeenCalled();
	expect(generateOptionalMock).not.toHaveBeenCalled();
}

/** Forget prior calls on both seams, so the next `promptSent` reads this one. */
function clearModelCalls(): void {
	generateMock.mockClear();
	generateOptionalMock.mockClear();
}

const GOOD_ADVISOR = { zoneId: "gate-a" };
const GOOD_ASSISTANT = { question: "Where is the nearest step-free entrance?", language: "Español" };
const GOOD_WAYFINDING = { origin: "rail", destination: "food-ne", stepFreeOnly: false };
const GOOD_ITINERARY = {
	districtId: "secaucus",
	interests: ["Local food", "Photography"],
	stepFreeNeeded: false,
	language: "Français",
};

describe("GET /api/health", () => {
	it("reports status ok with the model name and a package version", async () => {
		const response = await healthGET();
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["status"]).toBe("ok");
		expect(body["model"]).toBe(MODEL_NAME);
		expect(typeof body["version"]).toBe("string");
	});

	/** The point of the field is to report this process's real capability. */
	it("reports aiConfigured false when no key is present", async () => {
		expect(isConfigured()).toBe(false);
		expect(asRecord(await bodyOf(await healthGET()))["aiConfigured"]).toBe(false);
	});

	it("reports aiConfigured true once a key is present", async () => {
		vi.stubEnv("GEMINI_API_KEY", "test-key-value");
		expect(asRecord(await bodyOf(await healthGET()))["aiConfigured"]).toBe(true);
	});

	/** Computed from the topology, so a zone added to ZONES must show up here. */
	it("reports a zone count equal to the venue topology", async () => {
		expect(asRecord(await bodyOf(await healthGET()))["zoneCount"]).toBe(ZONES.length);
	});

	it("reports a phase drawn from the match-phase vocabulary", async () => {
		const body = asRecord(await bodyOf(await healthGET()));
		expect(PHASES).toContain(body["phase"]);
	});

	/**
	 * The clock and phase are documented as computed per request rather than
	 * hard-coded, and a static string could not fail. Moving the wall clock and
	 * watching both fields follow is what actually demonstrates that.
	 */
	it("derives the clock and phase from wall-clock time on every request", async () => {
		vi.setSystemTime(30 * 4 * 1000);
		const preMatch = asRecord(await bodyOf(await healthGET()));
		expect(preMatch["clockMinutes"]).toBe(30);
		expect(preMatch["phase"]).toBe("pre-match");

		vi.setSystemTime(160 * 4 * 1000);
		const egress = asRecord(await bodyOf(await healthGET()));
		expect(egress["clockMinutes"]).toBe(160);
		expect(egress["phase"]).toBe("egress");
	});

	it("carries the security headers", async () => {
		expectSecurityHeaders(await healthGET());
	});
});

describe("GET /api/snapshot", () => {
	it("returns a reading for every zone in the topology", async () => {
		const response = await snapshotGET();
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		const zones = body["zones"];
		expect(Array.isArray(zones)).toBe(true);
		expect(Array.isArray(zones) ? zones.length : 0).toBe(ZONES.length);
		expect(ZONES.length).toBe(17);
	});

	/** Density is documented as a 0..1 ratio; the UI scales it straight to a bar. */
	it("returns densities inside 0..1 and a friction score inside 0..100", async () => {
		const body = asRecord(await bodyOf(await snapshotGET()));
		const zones = body["zones"];
		if (!Array.isArray(zones)) throw new Error("expected a zones array");

		for (const zone of zones) {
			const reading = asRecord(zone);
			const density = reading["density"];
			expect(typeof density).toBe("number");
			expect(typeof density === "number" ? density : -1).toBeGreaterThanOrEqual(0);
			expect(typeof density === "number" ? density : 2).toBeLessThanOrEqual(1);
		}

		const friction = body["frictionScore"];
		expect(typeof friction === "number" ? friction : -1).toBeGreaterThanOrEqual(0);
		expect(typeof friction === "number" ? friction : 101).toBeLessThanOrEqual(100);
		expect(PHASES).toContain(body["phase"]);
	});

	/**
	 * The forecast rides on this response rather than living at its own endpoint,
	 * so that the console's single poller gets both halves in one round trip. If
	 * it stopped being attached, every trend on the console would silently vanish.
	 */
	it("attaches a forecast covering every zone in the topology", async () => {
		const body = asRecord(await bodyOf(await snapshotGET()));
		const forecast = asRecord(body["forecast"]);

		expect(forecast["horizonMinutes"]).toBe(FORECAST_HORIZON_MINUTES);
		expect(PHASES).toContain(forecast["horizonPhase"]);
		expect(TRENDS).toContain(forecast["trend"]);

		const zones = forecast["zones"];
		expect(Array.isArray(zones)).toBe(true);
		expect(Array.isArray(zones) ? zones.length : 0).toBe(ZONES.length);

		for (const zone of Array.isArray(zones) ? zones : []) {
			const trend = asRecord(zone);
			expect(TRENDS).toContain(trend["trend"]);
			const projected = trend["projectedDensity"];
			expect(typeof projected === "number" ? projected : -1).toBeGreaterThanOrEqual(0);
			expect(typeof projected === "number" ? projected : 2).toBeLessThanOrEqual(1);
		}
	});

	/**
	 * The anchoring property, end to end. The route reads the wall clock once, so
	 * the snapshot it serves and the forecast attached to it must describe the
	 * same minute — a client drawing a density from one and a trend arrow from
	 * the other would otherwise be mixing two instants in a single panel.
	 */
	it("anchors the attached forecast to the same instant as the snapshot", async () => {
		const body = asRecord(await bodyOf(await snapshotGET()));
		const forecast = asRecord(body["forecast"]);

		expect(body["clockMinutes"]).toBe(30);
		expect(forecast["clockMinutes"]).toBe(30);
		expect(forecast["horizonClockMinutes"]).toBe(30 + FORECAST_HORIZON_MINUTES);
		expect(forecast["projectedFrictionScore"]).toBe(forecastAt(30, FORECAST_HORIZON_MINUTES).projectedFrictionScore);
	});

	/**
	 * The forecast is computed, not generated, so a model outage must not cost it
	 * — the whole suite runs with no key, and this route never touches Gemini.
	 */
	it("serves the forecast with no model key configured", async () => {
		expect(isConfigured()).toBe(false);

		const response = await snapshotGET();
		expect(response.status).toBe(200);
		expect(asRecord(asRecord(await bodyOf(response))["forecast"])["trend"]).toBeDefined();
		expectNoModelCall();
	});

	it("carries the security headers", async () => {
		expectSecurityHeaders(await snapshotGET());
	});
});

describe("request validation across the POST routes", () => {
	const cases: readonly (readonly [string, (request: NextRequest) => Promise<Response>, string, unknown])[] = [
		["/api/advisor", advisorPOST, "/api/advisor", { zoneId: "gate-z" }],
		["/api/assistant", assistantPOST, "/api/assistant", { question: "hi", language: "English" }],
		["/api/wayfinding", wayfindingPOST, "/api/wayfinding", { origin: "rail", destination: "rail" }],
		["/api/itinerary", itineraryPOST, "/api/itinerary", { districtId: "brooklyn", interests: [] }],
	];

	for (const [label, handler, path, badBody] of cases) {
		it(`rejects an invalid body on ${label} with 422 VALIDATION_ERROR`, async () => {
			const response = await handler(post(path, badBody));
			expect(response.status).toBe(422);

			const body = asRecord(await bodyOf(response));
			const error = asRecord(body["error"]);
			expect(error["code"]).toBe("VALIDATION_ERROR");
			expect(Array.isArray(error["issues"])).toBe(true);
			expectSecurityHeaders(response);
		});

		/** Validation must precede generation, or a bad body still costs a call. */
		it(`does not call the model for an invalid body on ${label}`, async () => {
			withHealthyModel();
			await handler(post(path, badBody));
			expectNoModelCall();
		});

		it(`rejects malformed JSON on ${label} with 400 MALFORMED_BODY`, async () => {
			const response = await handler(postRaw(path, "{ not json"));
			expect(response.status).toBe(400);
			expect(asRecord(asRecord(await bodyOf(response))["error"])["code"]).toBe("MALFORMED_BODY");
			expectSecurityHeaders(response);
		});
	}
});

describe("POST /api/advisor", () => {
	/** Advice with no model behind it would be a fabrication, so this one 503s. */
	it("returns 503 AI_UNAVAILABLE when no key is configured", async () => {
		const response = await advisorPOST(post("/api/advisor", GOOD_ADVISOR));
		expect(response.status).toBe(503);
		expect(asRecord(asRecord(await bodyOf(response))["error"])["code"]).toBe("AI_UNAVAILABLE");
		expectSecurityHeaders(response);
	});

	it("returns the model's actions, the snapshot summary and the model name", async () => {
		withHealthyModel();

		const response = await advisorPOST(post("/api/advisor", GOOD_ADVISOR));
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["actions"]).toBe(CANNED);
		expect(body["model"]).toBe(MODEL_NAME);

		const snapshot = asRecord(body["snapshot"]);
		expect(PHASES).toContain(snapshot["phase"]);
		expect(typeof snapshot["frictionScore"]).toBe("number");
		expect(Array.isArray(snapshot["criticalZones"])).toBe(true);
		expectSecurityHeaders(response);
	});

	/**
	 * The panel labels the reply with the audience the *server* answered for, so
	 * a late response cannot be mislabelled by a picker that has since moved on.
	 * That only works if the server actually echoes it.
	 */
	it("echoes the audience it wrote for, defaulting to the duty manager", async () => {
		withHealthyModel();
		expect(asRecord(await bodyOf(await advisorPOST(post("/api/advisor", GOOD_ADVISOR))))["audience"]).toBe(
			"duty-manager",
		);

		clearModelCalls();
		const steward = await advisorPOST(post("/api/advisor", { zoneId: "gate-a", audience: "steward" }));
		expect(asRecord(await bodyOf(steward))["audience"]).toBe("steward");
	});

	/**
	 * The forecast summary rides on the response so the panel can attribute the
	 * advice to the projection it was asked to anticipate, without a second call
	 * on a clock that has since advanced.
	 */
	it("returns the forecast summary the advice was grounded in", async () => {
		withHealthyModel();
		const body = asRecord(await bodyOf(await advisorPOST(post("/api/advisor", GOOD_ADVISOR))));

		const forecast = asRecord(body["forecast"]);
		expect(forecast["horizonMinutes"]).toBe(FORECAST_HORIZON_MINUTES);
		expect(typeof forecast["projectedFrictionScore"]).toBe("number");
		expect(typeof forecast["frictionDelta"]).toBe("number");
		expect(TRENDS).toContain(forecast["trend"]);
		expect(Array.isArray(forecast["risingZones"])).toBe(true);
	});

	/**
	 * The response has to describe one instant. The snapshot summary and the
	 * forecast are read from `currentReport`, which takes a single clock reading
	 * — so the friction the response reports and the friction the forecast
	 * projects from must be the same number the model was shown.
	 */
	it("reports a snapshot and forecast anchored to the same instant", async () => {
		withHealthyModel();
		const body = asRecord(await bodyOf(await advisorPOST(post("/api/advisor", GOOD_ADVISOR))));

		const reported = asRecord(body["snapshot"])["frictionScore"];
		const forecast = asRecord(body["forecast"]);

		// FROZEN_NOW pins the clock at minute 30, so the whole report is derivable.
		const expected = forecastAt(30, FORECAST_HORIZON_MINUTES);
		expect(reported).toBe(snapshotAt(30).frictionScore);
		expect(forecast["projectedFrictionScore"]).toBe(expected.projectedFrictionScore);
		expect(forecast["frictionDelta"]).toBe(expected.frictionDelta);
		expect(forecast["trend"]).toBe(expected.trend);
	});

	/**
	 * Grounding. The model is asked to prioritise a state it was handed, so the
	 * prompt must carry the live zone table — every zone by name, with its real
	 * reading. A prompt without it would leave the model inventing the venue.
	 */
	it("grounds the prompt in live readings for every zone", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", GOOD_ADVISOR));

		const prompt = promptSent();
		expect(prompt).toContain("Gate A — North");
		expect(prompt).toContain("North Concourse");
		for (const zone of ZONES) {
			expect(prompt, zone.id).toContain(zone.name);
		}
		expect(prompt).toContain("Fan Friction Score");
	});

	/** A focused request must actually reach the prompt as a focus instruction. */
	it("names the focused zone in the prompt and omits the focus line without one", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", { zoneId: "medical-w" }));
		expect(promptSent()).toContain("focused on Medical Post West");

		clearModelCalls();
		await advisorPOST(post("/api/advisor", {}));
		expect(promptSent()).toContain("No specific zone is in focus");
	});

	/**
	 * The alignment claim this route rests on: the advice is *anticipatory*. That
	 * is only true if the projection actually reaches the model — a duty manager
	 * told only what is happening now receives advice that lands after the queue
	 * it describes. So the prompt must carry the projected friction and a
	 * projected reading for every zone, not merely mention that a forecast exists.
	 */
	it("grounds the prompt in the projection as well as the present, for every zone", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", GOOD_ADVISOR));

		const prompt = promptSent();
		const expected = forecastAt(30, FORECAST_HORIZON_MINUTES);

		expect(prompt).toContain(`Projected ${String(FORECAST_HORIZON_MINUTES)} minutes from now`);
		expect(prompt).toContain(`${String(expected.projectedFrictionScore)}/100`);
		expect(prompt).toContain(`venue trend ${expected.trend}`);

		for (const zone of expected.zones) {
			const now = Math.round(zone.density * 100);
			const then = Math.round(zone.projectedDensity * 100);
			expect(prompt, zone.zoneId).toContain(`${String(now)}% → ${String(then)}%`);
		}
	});

	/**
	 * A delta printed bare reads as a level rather than a movement, so it is
	 * signed. The frozen clock at minute 30 has friction falling into kick-off,
	 * which only ever exercises the negative branch — minute 80 is the run-up to
	 * half-time, where friction is rising and the `+` has to appear.
	 */
	it("signs a rising friction delta in the prompt", async () => {
		withHealthyModel();
		vi.setSystemTime(80 * 4 * 1000);
		await advisorPOST(post("/api/advisor", GOOD_ADVISOR));

		const expected = forecastAt(80, FORECAST_HORIZON_MINUTES);
		expect(expected.frictionDelta, "minute 80 should be rising into half-time").toBeGreaterThan(0);
		expect(promptSent()).toContain(`(+${String(expected.frictionDelta)} vs now)`);
	});

	it("states a falling friction delta with its own sign", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", GOOD_ADVISOR));

		const expected = forecastAt(30, FORECAST_HORIZON_MINUTES);
		expect(expected.frictionDelta, "minute 30 should be falling into kick-off").toBeLessThan(0);
		expect(promptSent()).toContain(`(${String(expected.frictionDelta)} vs now)`);
	});

	/** An anticipatory instruction is worthless if the model is not asked to act on it. */
	it("instructs the model to prefer acting on the projection where it justifies one", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", GOOD_ADVISOR));

		const prompt = promptSent();
		expect(prompt).toContain(`takes about ${String(FORECAST_HORIZON_MINUTES)} minutes to reach the floor`);
		expect(prompt).toContain("cite");
		expect(prompt).toContain("Do not project beyond the figures given");
	});
});

describe("POST /api/advisor — steward audience", () => {
	const STEWARD = { zoneId: "gate-a", audience: "steward" };

	it("returns 200 and the briefing for a steward posted at a zone", async () => {
		withHealthyModel("What you will see: Gate A is busy for the next while.");

		const response = await advisorPOST(post("/api/advisor", STEWARD));
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["actions"]).toBe("What you will see: Gate A is busy for the next while.");
		expect(body["audience"]).toBe("steward");
		expect(body["model"]).toBe(MODEL_NAME);
		expectSecurityHeaders(response);
	});

	/** Same grounding rule as every other AI panel: no key, no fabricated briefing. */
	it("returns 503 AI_UNAVAILABLE when no key is configured", async () => {
		const response = await advisorPOST(post("/api/advisor", STEWARD));
		expect(response.status).toBe(503);
		expect(asRecord(asRecord(await bodyOf(response))["error"])["code"]).toBe("AI_UNAVAILABLE");
	});

	/**
	 * The whole point of the audience. A volunteer is posted at one zone, and a
	 * briefing that ranges over the venue is one they cannot use while talking to
	 * the fan in front of them — worse, it invites the model to send them
	 * somewhere they are not posted.
	 *
	 * Asserted as an exclusion over the real topology rather than by spot-check:
	 * every zone that is not the steward's post must be absent by name.
	 */
	it("scopes the steward prompt to their own post and no other zone", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", STEWARD));

		const prompt = promptSent();
		expect(prompt).toContain("Gate A — North");

		for (const zone of ZONES) {
			if (zone.id === "gate-a") continue;
			expect(prompt, `steward prompt names ${zone.id}`).not.toContain(zone.name);
		}
	});

	/** The duty manager's venue table is exactly what this audience must not get. */
	it("omits the venue-wide zone table and the ops register", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", STEWARD));

		const prompt = promptSent();
		expect(prompt).not.toContain("Live zone readings:");
		expect(prompt).not.toContain("id: gate-a");
		expect(prompt).not.toContain("people");
		expect(prompt).not.toContain("prioritised operational actions");
	});

	/** Grounded in the same live model as everything else — the post's own reading. */
	it("grounds the briefing in the post's live reading and its projection", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", STEWARD));

		const prompt = promptSent();
		const reading = snapshotAt(30).zones.find((z) => z.zoneId === "gate-a");
		const trend = forecastAt(30, FORECAST_HORIZON_MINUTES).zones.find((z) => z.zoneId === "gate-a");
		expect(reading).toBeDefined();
		expect(trend).toBeDefined();
		if (reading === undefined || trend === undefined) return;

		// The fan-facing rendering of the post, verbatim.
		expect(prompt).toContain(describeZoneForFan(reading));
		expect(prompt).toContain(describeTrendForFan(trend));
		expect(prompt).toContain(`What the next ${String(FORECAST_HORIZON_MINUTES)} minutes look like`);
	});

	/** The three things a volunteer actually needs, asked for by name. */
	it("asks for the three briefing headings a steward can act on", async () => {
		withHealthyModel();
		await advisorPOST(post("/api/advisor", STEWARD));

		const prompt = promptSent();
		expect(prompt).toContain("What you will see");
		expect(prompt).toContain("What to tell fans");
		expect(prompt).toContain("When to escalate");
		expect(prompt).toContain("Plain language");
	});

	/**
	 * A steward briefing is about a post. Without one there is nothing to brief,
	 * and the request is rejected at the boundary rather than answered with the
	 * duty manager's document in a friendlier voice.
	 */
	it("rejects a steward request with no zone, before calling the model", async () => {
		withHealthyModel();

		const response = await advisorPOST(post("/api/advisor", { audience: "steward" }));
		expect(response.status).toBe(422);

		const error = asRecord(asRecord(await bodyOf(response))["error"]);
		expect(error["code"]).toBe("VALIDATION_ERROR");
		expectNoModelCall();
		expectSecurityHeaders(response);
	});

	it("rejects an unknown audience with 422 and does not call the model", async () => {
		withHealthyModel();

		const response = await advisorPOST(post("/api/advisor", { zoneId: "gate-a", audience: "mascot" }));
		expect(response.status).toBe(422);
		expect(asRecord(asRecord(await bodyOf(response))["error"])["code"]).toBe("VALIDATION_ERROR");
		expectNoModelCall();
	});

	/**
	 * The other side of the schema's guarantee. A steward briefing is composed
	 * from the live reading for their post, and a post with no reading has no
	 * briefing — so the route must fail loudly rather than send the model a
	 * prompt with a hole where the venue state should be.
	 *
	 * Unreachable against the current topology: the schema only admits known
	 * zones and the snapshot carries every zone. Forced here, because an
	 * invariant nothing tests is a comment.
	 */
	it("fails with 500 rather than briefing a steward about a post it has no reading for", async () => {
		withHealthyModel();
		currentReportMock.mockReturnValue({
			snapshot: { ...snapshotAt(30), zones: [] },
			forecast: { ...forecastAt(30, FORECAST_HORIZON_MINUTES), zones: [] },
		});

		const response = await advisorPOST(post("/api/advisor", STEWARD));
		expect(response.status).toBe(500);

		const error = asRecord(asRecord(await bodyOf(response))["error"]);
		expect(error["code"]).toBe("INTERNAL_ERROR");
		expectSecurityHeaders(response);
		// The prompt is abandoned before the model is asked to narrate a hole in it.
		expectNoModelCall();
	});

	/** Both audiences must answer, at every post on the map. */
	it("briefs a steward at every zone in the topology", async () => {
		for (const zone of ZONES) {
			clearModelCalls();
			withHealthyModel();

			const response = await advisorPOST(post("/api/advisor", { zoneId: zone.id, audience: "steward" }));
			expect(response.status, zone.id).toBe(200);
			expect(promptSent(), zone.id).toContain(zone.name);
		}
	});
});

describe("POST /api/assistant", () => {
	it("returns 503 AI_UNAVAILABLE when no key is configured", async () => {
		const response = await assistantPOST(post("/api/assistant", GOOD_ASSISTANT));
		expect(response.status).toBe(503);
		expect(asRecord(asRecord(await bodyOf(response))["error"])["code"]).toBe("AI_UNAVAILABLE");
	});

	it("returns the answer and echoes the language it was asked for", async () => {
		withHealthyModel("La entrada sin escalones más cercana es la Puerta A.");

		const response = await assistantPOST(post("/api/assistant", GOOD_ASSISTANT));
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["answer"]).toBe("La entrada sin escalones más cercana es la Puerta A.");
		expect(body["language"]).toBe("Español");
		expect(body["model"]).toBe(MODEL_NAME);
		expectSecurityHeaders(response);
	});

	/**
	 * The fan's language is the request, not a post-processing step, so it has
	 * to be an instruction in the prompt alongside the grounded venue state.
	 */
	it("carries the question, the requested language and live zone data into the prompt", async () => {
		withHealthyModel();
		await assistantPOST(post("/api/assistant", GOOD_ASSISTANT));

		const prompt = promptSent();
		expect(prompt).toContain(GOOD_ASSISTANT.question);
		expect(prompt).toContain("Español");
		expect(prompt).toContain("Gate A — North");
		expect(prompt).toContain("step-free access");
	});
});

describe("POST /api/wayfinding", () => {
	/**
	 * The contract that separates this route from the advisor: the path is
	 * computed, not generated, so a model outage must cost the narration and
	 * nothing else. Returning 503 here would throw away a usable answer.
	 */
	it("returns 200 with the route and directionsAvailable false when no key is configured", async () => {
		const response = await wayfindingPOST(post("/api/wayfinding", GOOD_WAYFINDING));
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["directions"]).toBeNull();
		expect(body["directionsAvailable"]).toBe(false);

		const route = asRecord(body["route"]);
		expect(route["path"]).toEqual(["rail", "gate-a", "conc-n", "food-ne"]);
		expect(typeof route["metres"]).toBe("number");
		expectSecurityHeaders(response);
	});

	it("returns the narration with directionsAvailable true when the model answers", async () => {
		withHealthyModel("Head left out of the rail platform, then follow signs to Gate A.");

		const response = await wayfindingPOST(post("/api/wayfinding", GOOD_WAYFINDING));
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["directions"]).toBe("Head left out of the rail platform, then follow signs to Gate A.");
		expect(body["directionsAvailable"]).toBe(true);
		expect(body["model"]).toBe(MODEL_NAME);
	});

	/** The narration must describe the computed stops, not invent its own. */
	it("grounds the narration prompt in the computed stops and their step-free status", async () => {
		withHealthyModel();
		await wayfindingPOST(post("/api/wayfinding", { origin: "rail", destination: "access-n", stepFreeOnly: true }));

		const prompt = promptSent();
		expect(prompt).toContain("Rail Link — Meadowlands");
		expect(prompt).toContain("North Accessible Platform");
		expect(prompt).toContain("computed step-free");
	});

	/**
	 * The North Stand and both walkways into it have steps, so a step-free
	 * request there has no graph solution. The route must say so rather than
	 * return a path the fan cannot use.
	 */
	it("returns 404 NO_ROUTE for a step-free request to a stepped stand", async () => {
		const response = await wayfindingPOST(
			post("/api/wayfinding", { origin: "gate-a", destination: "stand-n", stepFreeOnly: true }),
		);
		expect(response.status).toBe(404);

		const error = asRecord(asRecord(await bodyOf(response))["error"]);
		expect(error["code"]).toBe("NO_ROUTE");
		expect(String(error["message"])).toContain("step-free");
		expectSecurityHeaders(response);
	});

	/** The same pair is routable without the constraint, so the 404 is the constraint's. */
	it("routes the same pair successfully once the step-free constraint is lifted", async () => {
		const response = await wayfindingPOST(
			post("/api/wayfinding", { origin: "gate-a", destination: "stand-n", stepFreeOnly: false }),
		);
		expect(response.status).toBe(200);
		expect(asRecord(asRecord(await bodyOf(response))["route"])["stepFree"]).toBe(false);
	});

	it("does not call the model when no route exists", async () => {
		withHealthyModel();
		await wayfindingPOST(post("/api/wayfinding", { origin: "gate-a", destination: "stand-n", stepFreeOnly: true }));
		expectNoModelCall();
	});
});

describe("POST /api/itinerary", () => {
	/**
	 * The departure time, gate and walk are computed before Gemini is called at
	 * all, so an outage must not cost them. A fan with a departure time and no
	 * prose can still make kick-off.
	 */
	it("returns 200 with the computed plan and itineraryAvailable false when no key is configured", async () => {
		const response = await itineraryPOST(post("/api/itinerary", GOOD_ITINERARY));
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["itinerary"]).toBeNull();
		expect(body["itineraryAvailable"]).toBe(false);

		const plan = asRecord(body["plan"]);
		// Secaucus is 15 min by rail plus the 15 min entry buffer.
		expect(plan["departureMinutesBeforeKickoff"]).toBe(30);
		expect(plan["arrivalGate"]).toBe("gate-a");
		expect(asRecord(plan["district"])["id"]).toBe("secaucus");
		expect(plan["route"]).not.toBeNull();
		expectSecurityHeaders(response);
	});

	it("returns the narrated itinerary with itineraryAvailable true when the model answers", async () => {
		withHealthyModel("KO-30 : Quittez votre hébergement à Secaucus.");

		const response = await itineraryPOST(post("/api/itinerary", GOOD_ITINERARY));
		expect(response.status).toBe(200);

		const body = asRecord(await bodyOf(response));
		expect(body["itinerary"]).toBe("KO-30 : Quittez votre hébergement à Secaucus.");
		expect(body["itineraryAvailable"]).toBe(true);
		expect(body["language"]).toBe("Français");
		expect(body["model"]).toBe(MODEL_NAME);
	});

	/** A step-free fan needs the extra accessible-lane buffer and a level seat. */
	it("adds the step-free buffer and routes to the accessible platform", async () => {
		const response = await itineraryPOST(post("/api/itinerary", { ...GOOD_ITINERARY, stepFreeNeeded: true }));
		const plan = asRecord(asRecord(await bodyOf(response))["plan"]);

		expect(plan["departureMinutesBeforeKickoff"]).toBe(40);
		const route = asRecord(plan["route"]);
		expect(route["stepFree"]).toBe(true);
		expect(Array.isArray(route["path"]) ? route["path"].at(-1) : null).toBe("access-n");
	});

	/**
	 * The prompt must hand the model every load-bearing number already computed
	 * — the departure time above all — so it arranges facts rather than deriving
	 * them. It must also carry the live readings for the fan's arrival zones.
	 */
	it("supplies the computed numbers, the interests and live arrival-zone data to the prompt", async () => {
		withHealthyModel();
		await itineraryPOST(post("/api/itinerary", GOOD_ITINERARY));

		const prompt = promptSent();
		expect(prompt).toContain("30 minutes before kick-off");
		expect(prompt).toContain("Secaucus");
		expect(prompt).toContain("Gate A — North");
		expect(prompt).toContain("Rail Link — Meadowlands");
		expect(prompt).toContain("Local food, Photography");
		expect(prompt).toContain("Français");
		expect(prompt).toContain("do not change or recompute any of them");
	});

	/** The bus districts land at the bus terminal, and the prompt must say so. */
	it("plans a bus district through its own transit zone and gate", async () => {
		withHealthyModel();
		const response = await itineraryPOST(post("/api/itinerary", { ...GOOD_ITINERARY, districtId: "east-rutherford" }));

		expect(asRecord(asRecord(await bodyOf(response))["plan"])["arrivalGate"]).toBe("gate-c");
		expect(promptSent()).toContain("Bus Terminal");
	});

	/**
	 * A step-free plan must reach the fan's seat, not merely decline politely.
	 * The bus terminal's two gates differ: Gate C is stepped over a stepped
	 * walkway, Gate D is level over a level one. Sending a wheelchair user to
	 * Gate C strands them at a door they cannot open, so the gate assignment —
	 * not just the router — has to respect the constraint.
	 *
	 * Reachability is asserted structurally rather than through the prose,
	 * because the failure mode here is a person who cannot get in.
	 */
	it("plans a step-free bus arrival to a gate the fan can actually use", async () => {
		withHealthyModel();
		const response = await itineraryPOST(
			post("/api/itinerary", { ...GOOD_ITINERARY, districtId: "east-rutherford", stepFreeNeeded: true }),
		);

		expect(response.status).toBe(200);
		const plan = asRecord(asRecord(await bodyOf(response))["plan"]);

		const gate = plan["arrivalGate"];
		expect(gate, "the bus terminal's accessible gate is Gate D").toBe("gate-d");
		expect(ZONES.find((zone) => zone.id === gate)?.stepFree, `arrival gate ${String(gate)} is stepped`).toBe(true);

		// A step-free walk to the accessible platform exists and must be planned.
		const route = asRecord(plan["route"]);
		expect(route["stepFree"], "planned route is not step-free").toBe(true);
		expect(route["path"]).toContain("access-n");
	});

	/**
	 * The step-free lead time is additive on top of the district's transit time:
	 * accessible entry lanes are fewer, so the same crowd clears them slower.
	 * East Rutherford is 10 min by bus, +15 entry buffer, +10 step-free.
	 */
	it("adds step-free lead time on top of the district's transit time", async () => {
		withHealthyModel();
		const response = await itineraryPOST(
			post("/api/itinerary", { ...GOOD_ITINERARY, districtId: "east-rutherford", stepFreeNeeded: true }),
		);

		const plan = asRecord(asRecord(await bodyOf(response))["plan"]);
		expect(plan["departureMinutesBeforeKickoff"]).toBe(35);
	});

	/**
	 * The defect this guards: the prompt names one gate and quotes another gate's
	 * queue. `buildPrompt` selects its crowding lines through `approachZones`,
	 * which computes the gate itself — so if it computes that gate without the
	 * step-free flag while the handler computes the reported gate with it, the two
	 * diverge silently. For east-rutherford + stepFreeNeeded they diverge by a
	 * whole gate: the plan says Gate D, the crowding lines say Gate C. The model
	 * is instructed to cite the queue at the named gate, so it would cite Gate C's
	 * queue under Gate D's name, and a fan would join a queue that is not there.
	 *
	 * Asserted over every district and both flag values, because the divergence
	 * only shows up where the flag changes the gate — one district would miss it.
	 */
	it("quotes live crowding for exactly the gate the plan reports, for every district and both access needs", async () => {
		for (const district of HOST_DISTRICTS) {
			for (const stepFreeNeeded of [false, true]) {
				clearModelCalls();
				withHealthyModel();

				const response = await itineraryPOST(
					post("/api/itinerary", { ...GOOD_ITINERARY, districtId: district.id, stepFreeNeeded }),
				);

				const label = `${district.id} stepFree=${String(stepFreeNeeded)}`;
				const plan = asRecord(asRecord(await bodyOf(response))["plan"]);
				const reportedGate = plan["arrivalGate"];
				const reportedName = getZone(String(reportedGate))?.name;
				expect(typeof reportedName, label).toBe("string");

				const prompt = promptSent();

				// The gate the plan reports is named as the entry point...
				expect(prompt, `${label}: prompt does not enter at the reported gate`).toContain(
					`enter the venue at ${String(reportedName)}`,
				);

				// ...and it is the only gate with a crowding line, so the queue the
				// model is told to cite belongs to the gate it is told to name.
				const crowding = prompt
					.split("\n")
					.filter((line) => line.startsWith("- "))
					.map((line) => line.slice(2, line.indexOf(" (")));
				const gateLines = crowding.filter((name) =>
					ZONES.some((zone) => zone.kind === "gate" && zone.name === name),
				);
				expect(gateLines, `${label}: crowding lines name the wrong gate`).toEqual([reportedName]);
			}
		}
	});

	/**
	 * The response type states `plan.route` is a `Route`, not `Route | null`, and
	 * that claim rests on the venue graph. Rather than trust it, re-derive it: for
	 * every district and both access needs, a walk from the assigned gate to the
	 * assigned seat must exist — and be step-free whenever the fan asked for that.
	 */
	it("computes a route for every district and both access needs", async () => {
		for (const district of HOST_DISTRICTS) {
			for (const stepFreeNeeded of [false, true]) {
				const response = await itineraryPOST(
					post("/api/itinerary", { ...GOOD_ITINERARY, districtId: district.id, stepFreeNeeded }),
				);

				const label = `${district.id} stepFree=${String(stepFreeNeeded)}`;
				expect(response.status, label).toBe(200);

				const plan = asRecord(asRecord(await bodyOf(response))["plan"]);
				const route = asRecord(plan["route"]);
				expect(Array.isArray(route["path"]) ? route["path"][0] : null, label).toBe(plan["arrivalGate"]);
				expect(Array.isArray(route["path"]) ? route["path"].at(-1) : null, label).toBe(
					stepFreeNeeded ? "access-n" : "stand-n",
				);
				if (stepFreeNeeded) expect(route["stepFree"], `${label}: planned an unusable route`).toBe(true);
			}
		}
	});

	/**
	 * The other side of that guarantee. `plan.route` is non-nullable, so a graph
	 * that cannot be routed must fail loudly rather than ship a plan the client's
	 * own schema would reject. Unreachable against the current topology — forced
	 * here, because an invariant nothing tests is a comment.
	 */
	it("fails with 500 NO_ROUTE rather than serving a plan without a route", async () => {
		withHealthyModel();
		findRouteMock.mockReturnValue(null);

		const response = await itineraryPOST(post("/api/itinerary", GOOD_ITINERARY));
		expect(response.status).toBe(500);

		const error = asRecord(asRecord(await bodyOf(response))["error"]);
		expect(error["code"]).toBe("NO_ROUTE");
		expectSecurityHeaders(response);
		// The plan is abandoned before the model is asked to narrate a hole in it.
		expectNoModelCall();
	});
});
