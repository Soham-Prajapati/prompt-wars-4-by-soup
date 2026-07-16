/**
 * Request-body schemas for the API surface.
 *
 * Every route handler parses its body through one of these schemas before
 * touching the crowd model or Gemini. Validation lives here rather than inline
 * so the accepted shape of a request is stated once and the inferred types stay
 * the single source of truth for both the handlers and their callers.
 *
 * Zone ids are checked against the venue topology, not merely against `string`:
 * an unknown zone is a client error worth a 422, and catching it here keeps
 * unresolvable ids out of the router and out of model prompts.
 */
import { z } from "zod";

import { isKnownDistrict } from "@/lib/itinerary";
import { isKnownZone } from "@/lib/venue";

/** A zone id that exists in the venue topology. */
const zoneId = z.string().refine(isKnownZone, { message: "Unknown zone id." });

/** A district id that exists in the host-district catalogue. */
const districtId = z.string().refine(isKnownDistrict, { message: "Unknown district id." });

/** Body of `POST /api/advisor`: an optional zone to focus the advice on. */
export const advisorRequestSchema = z.object({
	zoneId: zoneId.optional(),
});

/** Body of `POST /api/assistant`: a fan question and the language to answer in. */
export const assistantRequestSchema = z.object({
	question: z.string().min(3).max(500),
	language: z.string().min(2).max(40),
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
	interests: z.array(z.string().min(1).max(40)).min(1).max(4),
	stepFreeNeeded: z.boolean(),
	language: z.string().min(2).max(40),
});

/** Validated body of `POST /api/advisor`. */
export type AdvisorRequest = z.infer<typeof advisorRequestSchema>;

/** Validated body of `POST /api/assistant`. */
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/** Validated body of `POST /api/wayfinding`. */
export type WayfindingRequest = z.infer<typeof wayfindingRequestSchema>;

/** Validated body of `POST /api/itinerary`. */
export type ItineraryRequest = z.infer<typeof itineraryRequestSchema>;
