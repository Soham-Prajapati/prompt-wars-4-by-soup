/**
 * Browser-side API client.
 *
 * Every network call the dashboard makes goes through here, for two reasons.
 *
 * First, shape safety: a route handler's JSON arrives as `unknown`, and casting
 * it to a nice interface would only be a promise the browser cannot keep. Each
 * response is parsed with a Zod schema that is *typed against the server's own
 * exported model types* (`z.ZodType<VenueSnapshot>` and friends), so a drift
 * between the API and this client is a compile error here, and a malformed
 * payload at runtime is a handled error rather than a crash mid-render.
 *
 * Second, error discipline: these functions never throw. They return an
 * `ApiResult`, so a component must acknowledge the failure branch to reach the
 * data — which is what keeps the UI honest about outages instead of rendering
 * a blank panel.
 */
import { z } from "zod";

import { type MatchPhase, type VenueSnapshot } from "@/lib/crowd-model";
import { type HostDistrict } from "@/lib/itinerary";
import { type Route } from "@/lib/wayfinding";

/** A client-safe failure: either the server's error envelope or a transport fault. */
export interface ApiError {
	/** Stable machine-readable code, e.g. `AI_UNAVAILABLE`, `NO_ROUTE`. */
	readonly code: string;
	/** Human-readable explanation, safe to display verbatim. */
	readonly message: string;
}

/** The outcome of an API call. Callers must narrow on `ok` to read the data. */
export type ApiResult<T> =
	| { readonly ok: true; readonly data: T }
	| { readonly ok: false; readonly error: ApiError };

/** Advisor payload: prioritised actions plus the state they were derived from. */
export interface AdvisorResponse {
	/** Model-generated prioritised actions, as written by the model. */
	readonly actions: string;
	readonly snapshot: {
		readonly phase: MatchPhase;
		readonly frictionScore: number;
		readonly criticalZones: readonly string[];
	};
	/** The exact Gemini model that produced `actions`. */
	readonly model: string;
}

/** Fan-assistant payload: the answer, in the language it was requested in. */
export interface AssistantResponse {
	readonly answer: string;
	readonly language: string;
	readonly model: string;
}

/** Wayfinding payload: a computed route, optionally narrated. */
export interface WayfindingResponse {
	readonly route: Route;
	/** Model narration, or `null` when generation was unavailable. */
	readonly directions: string | null;
	readonly directionsAvailable: boolean;
	readonly model: string;
}

/** The deterministic half of an itinerary: computed, never model-authored. */
export interface ItineraryPlan {
	readonly district: HostDistrict;
	/** How long before kick-off the fan should leave their accommodation. */
	readonly departureMinutesBeforeKickoff: number;
	/** Zone id of the gate the fan's transit mode lands at. */
	readonly arrivalGate: string;
	/** The walk from that gate to the seat, or `null` when no path satisfies the request. */
	readonly route: Route | null;
}

/** Matchday-itinerary payload: a computed plan, optionally narrated. */
export interface ItineraryResponse {
	/** Model-written itinerary, or `null` when generation was unavailable. */
	readonly itinerary: string | null;
	readonly itineraryAvailable: boolean;
	/** The language `itinerary` was written in, as requested. */
	readonly language: string;
	readonly plan: ItineraryPlan;
	readonly model: string;
}

const phaseSchema = z.enum(["pre-match", "first-half", "half-time", "second-half", "egress"]);
const alertSchema = z.enum(["normal", "elevated", "high", "critical"]);
const kindSchema = z.enum(["gate", "concourse", "stand", "concession", "transit", "medical"]);

const zoneReadingSchema = z.object({
	zoneId: z.string(),
	name: z.string(),
	kind: kindSchema,
	x: z.number(),
	y: z.number(),
	density: z.number(),
	occupancy: z.number(),
	waitMinutes: z.number(),
	alert: alertSchema,
});

const snapshotSchema: z.ZodType<VenueSnapshot> = z.object({
	clockMinutes: z.number(),
	phase: phaseSchema,
	zones: z.array(zoneReadingSchema),
	meanDensity: z.number(),
	frictionScore: z.number(),
});

const advisorResponseSchema: z.ZodType<AdvisorResponse> = z.object({
	actions: z.string(),
	snapshot: z.object({
		phase: phaseSchema,
		frictionScore: z.number(),
		criticalZones: z.array(z.string()),
	}),
	model: z.string(),
});

const assistantResponseSchema: z.ZodType<AssistantResponse> = z.object({
	answer: z.string(),
	language: z.string(),
	model: z.string(),
});

const routeSchema: z.ZodType<Route> = z.object({
	path: z.array(z.string()),
	names: z.array(z.string()),
	metres: z.number(),
	minutes: z.number(),
	stepFree: z.boolean(),
	meanDensity: z.number(),
});

const wayfindingResponseSchema: z.ZodType<WayfindingResponse> = z.object({
	route: routeSchema,
	directions: z.string().nullable(),
	directionsAvailable: z.boolean(),
	model: z.string(),
});

const hostDistrictSchema: z.ZodType<HostDistrict> = z.object({
	id: z.string(),
	name: z.string(),
	transitMode: z.enum(["rail", "bus"]),
	transitMinutes: z.number(),
	description: z.string(),
});

const itineraryPlanSchema: z.ZodType<ItineraryPlan> = z.object({
	district: hostDistrictSchema,
	departureMinutesBeforeKickoff: z.number(),
	arrivalGate: z.string(),
	route: routeSchema.nullable(),
});

const itineraryResponseSchema: z.ZodType<ItineraryResponse> = z.object({
	itinerary: z.string().nullable(),
	itineraryAvailable: z.boolean(),
	language: z.string(),
	plan: itineraryPlanSchema,
	model: z.string(),
});

/** The error envelope every route handler emits on failure. */
const errorEnvelopeSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
	}),
});

/** Code reported when a request was cancelled, e.g. by component unmount. */
export const ABORTED = "ABORTED";

const ABORT_ERROR: ApiError = {
	code: ABORTED,
	message: "The request was cancelled.",
};

const NETWORK_ERROR: ApiError = {
	code: "NETWORK_ERROR",
	message: "Could not reach the PitchOps server. Check the connection and try again.",
};

const BAD_RESPONSE_ERROR: ApiError = {
	code: "BAD_RESPONSE",
	message: "The server returned a response in an unexpected format.",
};

/**
 * Turn a settled `Response` into a typed result.
 *
 * A non-2xx body is read through the error envelope so the server's own code
 * and message survive to the UI; anything that fails to match either schema
 * degrades to a generic, non-leaking message.
 */
async function toResult<T>(response: Response, schema: z.ZodType<T>): Promise<ApiResult<T>> {
	let body: unknown;
	try {
		body = (await response.json()) as unknown;
	} catch {
		return { ok: false, error: BAD_RESPONSE_ERROR };
	}

	if (!response.ok) {
		const envelope = errorEnvelopeSchema.safeParse(body);
		if (envelope.success) return { ok: false, error: envelope.data.error };
		return {
			ok: false,
			error: { code: `HTTP_${String(response.status)}`, message: "The server rejected the request." },
		};
	}

	const parsed = schema.safeParse(body);
	if (!parsed.success) return { ok: false, error: BAD_RESPONSE_ERROR };
	return { ok: true, data: parsed.data };
}

/** Issue a request and parse it, converting every throw into an `ApiResult`. */
async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<ApiResult<T>> {
	try {
		const response = await fetch(path, init);
		return await toResult(response, schema);
	} catch {
		return { ok: false, error: init.signal?.aborted === true ? ABORT_ERROR : NETWORK_ERROR };
	}
}

/** POST a JSON body to an API route. */
async function postJson<T>(
	path: string,
	body: unknown,
	schema: z.ZodType<T>,
	signal: AbortSignal,
): Promise<ApiResult<T>> {
	return request(
		path,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
			cache: "no-store",
		},
		schema,
	);
}

/**
 * Fetch the live venue snapshot.
 *
 * @param signal Aborts the in-flight request, e.g. when the poller unmounts.
 */
export async function fetchSnapshot(signal: AbortSignal): Promise<ApiResult<VenueSnapshot>> {
	return request("/api/snapshot", { method: "GET", signal, cache: "no-store" }, snapshotSchema);
}

/**
 * Ask the AI advisor for prioritised operational actions.
 *
 * @param zoneId Zone to weight the advice towards, or `null` for the whole venue.
 * @param signal Aborts the in-flight request.
 */
export async function fetchAdvice(zoneId: string | null, signal: AbortSignal): Promise<ApiResult<AdvisorResponse>> {
	// The schema treats `zoneId` as optional, so an unfocused request omits the
	// key entirely rather than sending an explicit null it would reject.
	const body = zoneId === null ? {} : { zoneId };
	return postJson("/api/advisor", body, advisorResponseSchema, signal);
}

/**
 * Ask the multilingual fan assistant a question.
 *
 * @param question The fan's question, 3–500 characters.
 * @param language Language name the answer must be written in.
 * @param signal Aborts the in-flight request.
 */
export async function fetchAssistantAnswer(
	question: string,
	language: string,
	signal: AbortSignal,
): Promise<ApiResult<AssistantResponse>> {
	return postJson("/api/assistant", { question, language }, assistantResponseSchema, signal);
}

/**
 * Plan a congestion-aware walking route between two zones.
 *
 * @param origin Zone id to start from.
 * @param destination Zone id to finish at.
 * @param stepFreeOnly When true, only level or ramped zones and walkways are used.
 * @param signal Aborts the in-flight request.
 */
export async function fetchRoute(
	origin: string,
	destination: string,
	stepFreeOnly: boolean,
	signal: AbortSignal,
): Promise<ApiResult<WayfindingResponse>> {
	return postJson("/api/wayfinding", { origin, destination, stepFreeOnly }, wayfindingResponseSchema, signal);
}

/**
 * Build a personalised matchday itinerary from a fan's district and interests.
 *
 * @param districtId Host district the fan is staying in.
 * @param interests One to four interest tags steering the suggestions.
 * @param stepFreeNeeded When true, the plan is routed and timed for step-free access.
 * @param language Language name the itinerary must be written in.
 * @param signal Aborts the in-flight request.
 */
export async function fetchItinerary(
	districtId: string,
	interests: readonly string[],
	stepFreeNeeded: boolean,
	language: string,
	signal: AbortSignal,
): Promise<ApiResult<ItineraryResponse>> {
	return postJson("/api/itinerary", { districtId, interests, stepFreeNeeded, language }, itineraryResponseSchema, signal);
}
