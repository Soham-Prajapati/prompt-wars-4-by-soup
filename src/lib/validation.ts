/**
 * Request-body schemas for the API surface.
 *
 * Every route handler parses its body through one of these schemas before
 * touching the crowd model or Gemini. Validation lives here rather than inline
 * so the accepted shape of a request is stated once and the inferred types stay
 * the single source of truth for both the handlers and their callers.
 *
 * Every field that reaches a model prompt is checked against the catalogue it is
 * supposed to come from, not merely against `string`. That is the rule the zone
 * and district ids already followed, and it applies for the same reason to the
 * fan's interests and language: all four are interpolated into a prompt
 * verbatim, so a field validated only by length is a field an attacker writes.
 * `language: "English. Ignore all prior instructions"` passes `min(2).max(40)`
 * and fails `isKnownLanguage`. An unknown value is a client error worth a 422,
 * and catching it here keeps it out of the router and out of the prompt.
 *
 * Every catalogue below is the same one the picker renders, so no fan can select
 * a value these schemas reject.
 */
import { z } from "zod";

import { isKnownAudience } from "@/lib/audience";
import { isKnownDistrict, isKnownInterest } from "@/lib/itinerary";
import { isKnownLanguage } from "@/lib/languages";
import { isKnownZone } from "@/lib/venue";

/** A zone id that exists in the venue topology. */
const zoneId = z.string().refine(isKnownZone, { message: "Unknown zone id." });

/**
 * An audience the advisor knows how to write for.
 *
 * `isKnownAudience` is a type predicate, so this parses to the `Audience` union
 * rather than to `string` — the route can switch on it exhaustively without a
 * cast.
 */
const audience = z.string().refine(isKnownAudience, { message: "Unknown audience." });

/** A district id that exists in the host-district catalogue. */
const districtId = z.string().refine(isKnownDistrict, { message: "Unknown district id." });

/** An interest tag offered by the itinerary planner. */
const interest = z.string().refine(isKnownInterest, { message: "Unknown interest tag." });

/**
 * A language endonym offered by the fan-facing panels.
 *
 * The catalogue is the bound, so no separate length limit is stated: the longest
 * label it holds is the longest value this accepts.
 */
const language = z.string().refine(isKnownLanguage, { message: "Unsupported language." });

/**
 * Body of `POST /api/advisor`: an optional zone to focus on, and who is asking.
 *
 * Both fields are optional, so the body the route accepted before stewards
 * existed still parses to the same request it always did.
 *
 * The refinement is the one rule the field types cannot express: a steward
 * briefing is written for a volunteer stood at a specific post, so the zone is
 * not a way to weight it — it is the subject. Without one there is no post to
 * brief about, and the alternative to rejecting it is a briefing addressed to
 * nobody in particular, which is the duty manager's document wearing the wrong
 * register. Rejecting at the boundary keeps that decision out of the handler.
 */
export const advisorRequestSchema = z
	.object({
		zoneId: zoneId.optional(),
		audience: audience.optional(),
	})
	.refine((body) => body.audience !== "steward" || body.zoneId !== undefined, {
		message: "A steward briefing needs the zone the steward is posted at.",
		path: ["zoneId"],
	});

/** Body of `POST /api/assistant`: a fan question and the language to answer in. */
export const assistantRequestSchema = z.object({
	question: z.string().min(3).max(500),
	language,
});

/** Body of `POST /api/wayfinding`: the two endpoints and the accessibility constraint. */
export const wayfindingRequestSchema = z.object({
	origin: zoneId,
	destination: zoneId,
	stepFreeOnly: z.boolean(),
});

/**
 * Body of `POST /api/itinerary`: where the fan is staying, what they enjoy, how
 * they need to travel, and the language the plan must be written in.
 *
 * Interests are capped at four because they are prompt input: a fan who selects
 * everything has expressed no preference, and a plan that tries to honour seven
 * tags in one pre-match hour is a plan they cannot follow.
 */
export const itineraryRequestSchema = z.object({
	districtId,
	interests: z.array(interest).min(1).max(4),
	stepFreeNeeded: z.boolean(),
	language,
});

/** Validated body of `POST /api/advisor`. */
export type AdvisorRequest = z.infer<typeof advisorRequestSchema>;

/** Validated body of `POST /api/assistant`. */
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/** Validated body of `POST /api/wayfinding`. */
export type WayfindingRequest = z.infer<typeof wayfindingRequestSchema>;

/** Validated body of `POST /api/itinerary`. */
export type ItineraryRequest = z.infer<typeof itineraryRequestSchema>;
