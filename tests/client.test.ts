/**
 * The browser client's failure contract.
 *
 * This module exists so that a component cannot reach data without first
 * acknowledging that the call may have failed. That only holds if the functions
 * really never throw, so every hostile case a network can produce is put through
 * them here: a rejecting transport, a non-JSON body, a well-formed body of the
 * wrong shape, and an error envelope the server sent deliberately.
 *
 * The shape check is the subtle one. A payload that parses as JSON but does not
 * match the schema is exactly what a drifted API returns, and returning it would
 * push the crash into a render pass far from the cause.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	ABORTED,
	type ApiResult,
	fetchAdvice,
	fetchAssistantAnswer,
	fetchItinerary,
	fetchRoute,
	fetchSnapshot,
} from "@/lib/client";
import { FORECAST_HORIZON_MINUTES, clockFromWallTime, forecastAt, snapshotAt } from "@/lib/crowd-model";
import { findRoute } from "@/lib/wayfinding";
import { omit } from "./helpers";

/** The instant every reference payload below is built at, so they agree. */
const clock = clockFromWallTime(Date.now());

/**
 * A live snapshot with its forecast, exactly as `GET /api/snapshot` serves it.
 *
 * Built from the crowd model's own output rather than hand-written, so the shape
 * this asserts is the shape the server really emits — a field added to either
 * half fails here instead of in a render pass.
 */
const snapshot = { ...snapshotAt(clock), forecast: forecastAt(clock, FORECAST_HORIZON_MINUTES) };
const route = findRoute("rail", "food-ne", snapshot, { stepFreeOnly: false });

/** Serialise a value as an HTTP JSON response. */
function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/** Install a fetch stub and hand back the mock for call assertions. */
function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
	const mock = vi.fn(impl);
	vi.stubGlobal("fetch", mock);
	return mock;
}

/** A never-aborted signal, which every client function requires. */
function signal(): AbortSignal {
	return new AbortController().signal;
}

/** Narrow a result to its success branch, failing the test when it is an error. */
function expectOk<T>(result: ApiResult<T>): T {
	if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
	return result.data;
}

/** Narrow a result to its error branch, failing the test when it succeeded. */
function expectErr<T>(result: ApiResult<T>): { readonly code: string; readonly message: string } {
	if (result.ok) throw new Error("expected an error result");
	return result.error;
}

const ADVISOR_BODY = {
	actions: "1. Open Gate B lanes 4-6.",
	audience: "duty-manager",
	snapshot: { phase: snapshot.phase, frictionScore: snapshot.frictionScore, criticalZones: ["Gate A — North"] },
	forecast: {
		horizonMinutes: FORECAST_HORIZON_MINUTES,
		projectedFrictionScore: snapshot.forecast.projectedFrictionScore,
		frictionDelta: snapshot.forecast.frictionDelta,
		trend: snapshot.forecast.trend,
		risingZones: ["Gate B — East"],
	},
	model: "gemini-2.0-flash",
};

const ASSISTANT_BODY = { answer: "La Puerta A.", language: "Español", model: "gemini-2.0-flash" };

const WAYFINDING_BODY = { route, directions: "Follow signs to Gate A.", directionsAvailable: true, model: "gemini-2.0-flash" };

const ITINERARY_BODY = {
	itinerary: null,
	itineraryAvailable: false,
	language: "Français",
	plan: {
		district: {
			id: "secaucus",
			name: "Secaucus",
			transitMode: "rail",
			transitMinutes: 15,
			description: "Walking distance to Secaucus Junction.",
		},
		departureMinutesBeforeKickoff: 30,
		arrivalGate: "gate-a",
		route,
	},
	model: "gemini-2.0-flash",
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("fetchSnapshot", () => {
	/**
	 * The reference payload is the crowd model's own output, so this fails if
	 * the client's schema and the server's type ever drift apart.
	 */
	it("returns the parsed snapshot for a well-formed response", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(snapshot)));

		const data = expectOk(await fetchSnapshot(signal()));
		expect(data.zones.length).toBe(snapshot.zones.length);
		expect(data.phase).toBe(snapshot.phase);
		expect(data.frictionScore).toBe(snapshot.frictionScore);
	});

	it("requests the snapshot route uncached", async () => {
		const mock = stubFetch(() => Promise.resolve(jsonResponse(snapshot)));
		await fetchSnapshot(signal());

		expect(mock).toHaveBeenCalledTimes(1);
		expect(mock.mock.calls[0]?.[0]).toBe("/api/snapshot");
		const init: unknown = mock.mock.calls[0]?.[1];
		expect(init).toMatchObject({ method: "GET", cache: "no-store" });
	});

	/** A drifted server is a handled error here, not a crash three frames later. */
	it("returns a BAD_RESPONSE error when the payload fails the schema", async () => {
		stubFetch(() => Promise.resolve(jsonResponse({ ...snapshot, phase: "extra-time" })));
		expect(expectErr(await fetchSnapshot(signal())).code).toBe("BAD_RESPONSE");
	});

	it("returns a BAD_RESPONSE error when the body is not JSON", async () => {
		stubFetch(() => Promise.resolve(new Response("<!doctype html>", { status: 200 })));
		expect(expectErr(await fetchSnapshot(signal())).code).toBe("BAD_RESPONSE");
	});

	/** A transport fault must read as an outage the UI can name, not an exception. */
	it("returns a NETWORK_ERROR when the transport rejects", async () => {
		stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

		const error = expectErr(await fetchSnapshot(signal()));
		expect(error.code).toBe("NETWORK_ERROR");
		expect(error.message).toContain("connection");
	});

	/** An unmount is not an outage, and must not be reported to the fan as one. */
	it("reports ABORTED rather than NETWORK_ERROR when the caller cancelled", async () => {
		const controller = new AbortController();
		stubFetch(() => {
			controller.abort();
			return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
		});

		expect(expectErr(await fetchSnapshot(controller.signal)).code).toBe(ABORTED);
	});
});

describe("fetchAdvice", () => {
	it("returns the parsed advisor payload", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(ADVISOR_BODY)));

		const data = expectOk(await fetchAdvice("gate-a", "duty-manager", signal()));
		expect(data.actions).toBe(ADVISOR_BODY.actions);
		expect(data.snapshot.criticalZones).toEqual(["Gate A — North"]);
		expect(data.model).toBe("gemini-2.0-flash");
	});

	/**
	 * The panel renders the audience it was answered for rather than the one it
	 * currently has selected, so the echo has to survive the parse — a late reply
	 * must not be labelled with whatever the picker moved on to.
	 */
	it("returns the audience and the forecast the advice anticipated", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(ADVISOR_BODY)));

		const data = expectOk(await fetchAdvice("gate-a", "duty-manager", signal()));
		expect(data.audience).toBe("duty-manager");
		expect(data.forecast.horizonMinutes).toBe(FORECAST_HORIZON_MINUTES);
		expect(data.forecast.trend).toBe(snapshot.forecast.trend);
		expect(data.forecast.risingZones).toEqual(["Gate B — East"]);
	});

	/** An audience the server does not serve is a drifted contract, not a default. */
	it("returns BAD_RESPONSE when the echoed audience is not a known one", async () => {
		stubFetch(() => Promise.resolve(jsonResponse({ ...ADVISOR_BODY, audience: "mascot" })));
		expect(expectErr(await fetchAdvice("gate-a", "duty-manager", signal())).code).toBe("BAD_RESPONSE");
	});

	it("posts the focused zone id and the audience as JSON", async () => {
		const mock = stubFetch(() => Promise.resolve(jsonResponse(ADVISOR_BODY)));
		await fetchAdvice("medical-w", "duty-manager", signal());

		expect(mock.mock.calls[0]?.[0]).toBe("/api/advisor");
		const init: unknown = mock.mock.calls[0]?.[1];
		expect(init).toMatchObject({
			method: "POST",
			body: JSON.stringify({ zoneId: "medical-w", audience: "duty-manager" }),
		});
	});

	/** A steward briefing is about a post, so the post has to reach the server. */
	it("posts the steward audience alongside the post being briefed", async () => {
		const mock = stubFetch(() => Promise.resolve(jsonResponse({ ...ADVISOR_BODY, audience: "steward" })));
		await fetchAdvice("gate-b", "steward", signal());

		const init: unknown = mock.mock.calls[0]?.[1];
		expect(init).toMatchObject({ body: JSON.stringify({ zoneId: "gate-b", audience: "steward" }) });
	});

	/**
	 * The advisor schema rejects an explicit null, so an unfocused request must
	 * omit the key rather than send one the server would 422 — while still
	 * naming the audience, which is never optional from this client.
	 */
	it("omits zoneId entirely for an unfocused request", async () => {
		const mock = stubFetch(() => Promise.resolve(jsonResponse(ADVISOR_BODY)));
		await fetchAdvice(null, "duty-manager", signal());

		const init: unknown = mock.mock.calls[0]?.[1];
		expect(init).toMatchObject({ body: JSON.stringify({ audience: "duty-manager" }) });
	});

	/** The server's own code and message must survive to the UI verbatim. */
	it("surfaces the server's error code and message from a 503", async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonResponse({ error: { code: "AI_UNAVAILABLE", message: "Gemini is not configured." } }, 503),
			),
		);

		expect(expectErr(await fetchAdvice(null, "duty-manager", signal()))).toEqual({
			code: "AI_UNAVAILABLE",
			message: "Gemini is not configured.",
		});
	});

	/** A non-2xx without a usable envelope still has to name the status. */
	it("falls back to an HTTP_<status> code when the error body is not an envelope", async () => {
		stubFetch(() => Promise.resolve(jsonResponse({ oops: true }, 502)));

		const error = expectErr(await fetchAdvice(null, "duty-manager", signal()));
		expect(error.code).toBe("HTTP_502");
		expect(error.message.length).toBeGreaterThan(0);
	});

	it("returns BAD_RESPONSE when a 200 payload is missing a field", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(omit(ADVISOR_BODY, "model"))));
		expect(expectErr(await fetchAdvice(null, "duty-manager", signal())).code).toBe("BAD_RESPONSE");
	});

	it("returns NETWORK_ERROR when the transport rejects", async () => {
		stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
		expect(expectErr(await fetchAdvice(null, "duty-manager", signal())).code).toBe("NETWORK_ERROR");
	});
});

describe("fetchAssistantAnswer", () => {
	it("returns the answer and the language it was written in", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(ASSISTANT_BODY)));

		const data = expectOk(await fetchAssistantAnswer("¿Dónde está la puerta?", "Español", signal()));
		expect(data.answer).toBe("La Puerta A.");
		expect(data.language).toBe("Español");
	});

	it("posts the question and language to the assistant route", async () => {
		const mock = stubFetch(() => Promise.resolve(jsonResponse(ASSISTANT_BODY)));
		await fetchAssistantAnswer("¿Dónde está la puerta?", "Español", signal());

		expect(mock.mock.calls[0]?.[0]).toBe("/api/assistant");
		const init: unknown = mock.mock.calls[0]?.[1];
		expect(init).toMatchObject({
			body: JSON.stringify({ question: "¿Dónde está la puerta?", language: "Español" }),
		});
	});

	it("surfaces a 422 validation envelope as an error result", async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonResponse({ error: { code: "VALIDATION_ERROR", message: "The request body is invalid." } }, 422),
			),
		);
		expect(expectErr(await fetchAssistantAnswer("hi", "English", signal())).code).toBe("VALIDATION_ERROR");
	});

	it("returns BAD_RESPONSE when a field arrives with the wrong type", async () => {
		stubFetch(() => Promise.resolve(jsonResponse({ ...ASSISTANT_BODY, answer: 42 })));
		expect(expectErr(await fetchAssistantAnswer("hi there", "English", signal())).code).toBe("BAD_RESPONSE");
	});

	it("returns NETWORK_ERROR when the transport rejects", async () => {
		stubFetch(() => Promise.reject(new Error("socket hang up")));
		expect(expectErr(await fetchAssistantAnswer("hi there", "English", signal())).code).toBe("NETWORK_ERROR");
	});
});

describe("fetchRoute", () => {
	it("returns the route and its narration", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(WAYFINDING_BODY)));

		const data = expectOk(await fetchRoute("rail", "food-ne", false, signal()));
		expect(data.directionsAvailable).toBe(true);
		expect(data.route.path).toEqual(route?.path);
	});

	/** The degraded shape the server really sends on a model outage must parse. */
	it("accepts a route with null directions", async () => {
		stubFetch(() =>
			Promise.resolve(jsonResponse({ ...WAYFINDING_BODY, directions: null, directionsAvailable: false })),
		);

		const data = expectOk(await fetchRoute("rail", "food-ne", false, signal()));
		expect(data.directions).toBeNull();
		expect(data.directionsAvailable).toBe(false);
	});

	it("posts both endpoints and the step-free constraint", async () => {
		const mock = stubFetch(() => Promise.resolve(jsonResponse(WAYFINDING_BODY)));
		await fetchRoute("rail", "access-n", true, signal());

		expect(mock.mock.calls[0]?.[0]).toBe("/api/wayfinding");
		const init: unknown = mock.mock.calls[0]?.[1];
		expect(init).toMatchObject({
			body: JSON.stringify({ origin: "rail", destination: "access-n", stepFreeOnly: true }),
		});
	});

	it("surfaces a 404 NO_ROUTE envelope as an error result", async () => {
		stubFetch(() =>
			Promise.resolve(jsonResponse({ error: { code: "NO_ROUTE", message: "No step-free path exists." } }, 404)),
		);

		const error = expectErr(await fetchRoute("gate-a", "stand-n", true, signal()));
		expect(error.code).toBe("NO_ROUTE");
		expect(error.message).toBe("No step-free path exists.");
	});

	it("returns BAD_RESPONSE when the nested route is malformed", async () => {
		stubFetch(() => Promise.resolve(jsonResponse({ ...WAYFINDING_BODY, route: { path: ["rail"] } })));
		expect(expectErr(await fetchRoute("rail", "food-ne", false, signal())).code).toBe("BAD_RESPONSE");
	});

	it("returns NETWORK_ERROR when the transport rejects", async () => {
		stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
		expect(expectErr(await fetchRoute("rail", "food-ne", false, signal())).code).toBe("NETWORK_ERROR");
	});
});

describe("fetchItinerary", () => {
	it("returns the plan even when the narration is unavailable", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(ITINERARY_BODY)));

		const data = expectOk(await fetchItinerary("secaucus", ["Local food"], false, "Français", signal()));
		expect(data.itinerary).toBeNull();
		expect(data.itineraryAvailable).toBe(false);
		expect(data.plan.departureMinutesBeforeKickoff).toBe(30);
		expect(data.plan.district.transitMode).toBe("rail");
	});

	/**
	 * `ItineraryPlan.route` is a `Route`, not `Route | null` — the server never
	 * ships a plan it could not route, it fails instead. So a null route is a
	 * malformed payload, and the client must say so rather than hand a component
	 * a plan its own type says cannot exist.
	 */
	it("returns BAD_RESPONSE for a plan whose route is null", async () => {
		stubFetch(() =>
			Promise.resolve(jsonResponse({ ...ITINERARY_BODY, plan: { ...ITINERARY_BODY.plan, route: null } })),
		);

		expect(expectErr(await fetchItinerary("secaucus", ["Budget"], true, "English", signal())).code).toBe(
			"BAD_RESPONSE",
		);
	});

	it("posts the district, interests, access need and language", async () => {
		const mock = stubFetch(() => Promise.resolve(jsonResponse(ITINERARY_BODY)));
		await fetchItinerary("hoboken", ["Local food", "Nightlife"], true, "Deutsch", signal());

		expect(mock.mock.calls[0]?.[0]).toBe("/api/itinerary");
		const init: unknown = mock.mock.calls[0]?.[1];
		expect(init).toMatchObject({
			body: JSON.stringify({
				districtId: "hoboken",
				interests: ["Local food", "Nightlife"],
				stepFreeNeeded: true,
				language: "Deutsch",
			}),
		});
	});

	it("surfaces a 500 INTERNAL_ERROR envelope as an error result", async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonResponse({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }, 500),
			),
		);
		expect(expectErr(await fetchItinerary("secaucus", ["Budget"], false, "English", signal())).code).toBe(
			"INTERNAL_ERROR",
		);
	});

	it("returns BAD_RESPONSE when the plan is missing", async () => {
		stubFetch(() => Promise.resolve(jsonResponse(omit(ITINERARY_BODY, "plan"))));
		expect(expectErr(await fetchItinerary("secaucus", ["Budget"], false, "English", signal())).code).toBe(
			"BAD_RESPONSE",
		);
	});

	it("returns NETWORK_ERROR when the transport rejects", async () => {
		stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
		expect(expectErr(await fetchItinerary("secaucus", ["Budget"], false, "English", signal())).code).toBe(
			"NETWORK_ERROR",
		);
	});
});

describe("the client's no-throw contract", () => {
	/**
	 * Stated once, over every function and every hostile transport: a component
	 * must be able to await these without a try/catch, or the `ApiResult` type
	 * is a suggestion rather than a guarantee.
	 */
	it("resolves to an error result instead of throwing, for every function and fault", async () => {
		const faults: readonly (() => Promise<Response>)[] = [
			() => Promise.reject(new TypeError("Failed to fetch")),
			() => Promise.reject(new DOMException("aborted", "AbortError")),
			() => Promise.resolve(new Response("not json", { status: 200 })),
			() => Promise.resolve(jsonResponse({ wrong: "shape" })),
			() => Promise.resolve(jsonResponse({ error: { code: "BOOM", message: "boom" } }, 500)),
			() => Promise.resolve(new Response(null, { status: 204 })),
		];

		const calls: readonly (() => Promise<ApiResult<unknown>>)[] = [
			() => fetchSnapshot(signal()),
			() => fetchAdvice("gate-a", "duty-manager", signal()),
			() => fetchAssistantAnswer("Where is Gate A?", "English", signal()),
			() => fetchRoute("rail", "food-ne", false, signal()),
			() => fetchItinerary("secaucus", ["Budget"], false, "English", signal()),
		];

		for (const fault of faults) {
			stubFetch(fault);
			for (const call of calls) {
				const result = await call();
				expect(result.ok).toBe(false);
				if (result.ok) continue;
				expect(result.error.code.length).toBeGreaterThan(0);
				expect(result.error.message.length).toBeGreaterThan(0);
			}
		}
	});
});
