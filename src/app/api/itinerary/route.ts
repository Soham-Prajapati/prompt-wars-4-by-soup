/**
 * `POST /api/itinerary` — a personalised end-to-end matchday plan.
 *
 * The split here mirrors `/api/wayfinding`, and for the same reason. Every fact
 * a fan could act on wrongly — when to leave, which gate, which walk — is
 * computed from the district catalogue, the live snapshot and the walkway graph
 * before Gemini is called at all. The model is handed those facts and asked to
 * arrange them into a plan in the fan's own language; it is not asked to know
 * them. A hallucinated departure time makes a fan miss kick-off.
 *
 * So generation is the last step and the only optional one: when it fails the
 * endpoint still returns the computed `plan` with `itinerary: null`. A departure
 * time and a gate are a usable answer; losing them to a model outage would not be.
 */
import { NextResponse, type NextRequest } from "next/server";

import { handle, jsonError, jsonOk, readJsonBody } from "@/lib/api";
import { currentSnapshot, type VenueSnapshot } from "@/lib/crowd-model";
import { MODEL_NAME, generateOptional } from "@/lib/gemini";
import { approachZones, arrivalGate, getDistrict, recommendedDepartureMinutes, type HostDistrict } from "@/lib/itinerary";
import { describeZoneForFan } from "@/lib/prompt";
import { itineraryRequestSchema } from "@/lib/validation";
import { getZone } from "@/lib/venue";
import { findRoute, type Route } from "@/lib/wayfinding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Choose the seating zone the plan routes to.
 *
 * The stepped bowl entrances are unusable for a fan who needs level access, so
 * a step-free plan is seated on the north accessible platform, which lifts
 * serve directly. Routing a wheelchair user to the standard stand and reporting
 * "no route" would be an accessibility failure dressed up as a computation.
 *
 * @param stepFreeNeeded Whether the fan requires level access throughout.
 */
function seatZoneFor(stepFreeNeeded: boolean): string {
	return stepFreeNeeded ? "access-n" : "stand-n";
}

/**
 * Describe the computed in-bowl walk to the model.
 *
 * @param route The walk from the arrival gate to the seat.
 * @returns Prompt lines naming the stops, the distance, the time and the access.
 */
function describeWalk(route: Route): readonly string[] {
	return [
		`Walk inside the venue: ${route.names.join(" -> ")}`,
		`That walk is ${String(route.metres)} m and about ${String(route.minutes)} min including congestion, and it is ${route.stepFree ? "step-free" : "not step-free (it includes steps)"}.`,
	];
}

/**
 * Compose the itinerary prompt from the computed plan and the live snapshot.
 *
 * @param district Where the fan is staying.
 * @param departureMinutes Computed lead time before kick-off.
 * @param gateId The gate the plan sends the fan to.
 * @param route The computed walk from that gate to the seat.
 * @param snapshot Live venue state the crowding lines are drawn from.
 * @param interests Catalogue interest tags steering the one suggestion.
 * @param stepFreeNeeded Whether the fan requires level access throughout.
 * @param language Catalogue endonym the reply must be written in.
 */
function buildPrompt(
	district: HostDistrict,
	departureMinutes: number,
	gateId: string,
	route: Route,
	snapshot: VenueSnapshot,
	interests: readonly string[],
	stepFreeNeeded: boolean,
	language: string,
): string {
	const gateName = getZone(gateId)?.name ?? gateId;

	// The flag has to be threaded through: the model is told below to cite the
	// queue at the named gate, so the crowding lines must be for the gate the plan
	// actually names. Reading the gate unflagged here would quote Gate C's queue
	// under Gate D's name for a step-free bus arrival.
	const relevant = new Set(approachZones(district, stepFreeNeeded));
	const nearby = snapshot.zones.filter((z) => relevant.has(z.zoneId));

	const leg =
		district.transitMode === "rail"
			? "NJ Transit to Secaucus Junction, then the Meadowlands Line shuttle to the stadium"
			: "local shuttle bus direct to the Meadowlands complex";

	return [
		"These are the only facts you may use. Every number below is already computed; do not change or recompute any of them.",
		"",
		`The fan is staying in: ${district.name}. ${district.description}`,
		`Travel leg: ${leg}. Journey time about ${String(district.transitMinutes)} min.`,
		`They arrive at: ${district.transitMode === "rail" ? "the Meadowlands rail platform" : "the bus terminal"}, and enter the venue at ${gateName}.`,
		`They must leave their accommodation ${String(departureMinutes)} minutes before kick-off (${String(district.transitMinutes)} min travel + entry buffer${stepFreeNeeded ? " + extra time because accessible entry lanes are fewer" : ""}).`,
		`Step-free access needed: ${stepFreeNeeded ? "YES" : "no"}.`,
		`Their interests: ${interests.join(", ")}.`,
		"",
		`Matchday phase right now: ${snapshot.phase} (clock ${String(snapshot.clockMinutes)} min since gates opened).`,
		"Live crowding on their arrival zones:",
		...nearby.map(describeZoneForFan),
		"",
		...describeWalk(route),
		"",
		"Write a personalised matchday itinerary for this fan as a short timed plan, with one line per step, each starting with its time relative to kick-off (for example \"KO-95\"). Cover, in order:",
		"1. Leaving the accommodation, at exactly the minutes-before-kick-off given above.",
		"2. The transit leg named above.",
		"3. Arrival and entry at the named gate, mentioning its live queue if one was given.",
		"4. ONE pre-match food or activity suggestion that matches their interests. This one line may draw on your general knowledge of the area — say plainly that it is a suggestion, and never attach a made-up opening time, price or address to it.",
		"5. Getting to the seat inside the venue, using only the walk described above.",
		"6. Leaving after the final whistle, noting that transit zones are at their busiest during egress.",
		"",
		`Write your ENTIRE reply in ${language} — every word, including any zone or gate names, which you should translate or transliterate. Do not add an English version.`,
		"Keep the whole reply under 180 words. Use only the gates, zones, times and distances supplied above; never invent a gate, a platform, a wait time or a distance.",
	].join("\n");
}

/** Build a grounded matchday plan and have Gemini narrate it when possible. */
export async function POST(request: NextRequest): Promise<NextResponse> {
	return handle(async () => {
		const { districtId, interests, stepFreeNeeded, language } = itineraryRequestSchema.parse(
			await readJsonBody(request),
		);

		// `districtId` is refined against the catalogue by the schema above, so an
		// unknown id is rejected as a 422 before reaching here. The lookup is
		// still fallible in the type system; treat a miss as a validation failure
		// rather than reaching for a non-null assertion.
		const district = getDistrict(districtId);
		if (district === undefined) {
			return jsonError(422, "UNKNOWN_DISTRICT", "That district is not in the host-district catalogue.");
		}

		const departureMinutesBeforeKickoff = recommendedDepartureMinutes(district, stepFreeNeeded);
		const gate = arrivalGate(district, stepFreeNeeded);
		const snapshot = currentSnapshot();
		const route = findRoute(gate, seatZoneFor(stepFreeNeeded), snapshot, { stepFreeOnly: stepFreeNeeded });

		// Every district-and-flag combination the catalogue permits has a walk from
		// its arrival gate to its seat — `arrivalGate` only hands back gates a fan
		// can enter, and the accessible platforms are lift-served from the
		// concourse ring. So this is an invariant of the venue graph, asserted
		// exhaustively in tests/itinerary.test.ts, and reaching it means the graph
		// changed underneath the plan. The response type promises a route; the
		// honest move is to fail rather than serve a plan that contradicts it.
		if (route === null) {
			return jsonError(
				500,
				"NO_ROUTE",
				"A walking route from your gate to your seat could not be computed. Your departure time and gate are still correct — ask staff at the gate for directions.",
			);
		}

		const itinerary = await generateOptional(
			buildPrompt(
				district,
				departureMinutesBeforeKickoff,
				gate,
				route,
				snapshot,
				interests,
				stepFreeNeeded,
				language,
			),
		);

		return jsonOk({
			itinerary,
			itineraryAvailable: itinerary !== null,
			// Echoed like `/api/assistant` does, so the client marks the prose up with
			// the language it was actually written in rather than whatever the picker
			// happens to show by the time the reply lands.
			language,
			plan: {
				district,
				departureMinutesBeforeKickoff,
				arrivalGate: gate,
				route,
			},
			model: MODEL_NAME,
		});
	});
}
