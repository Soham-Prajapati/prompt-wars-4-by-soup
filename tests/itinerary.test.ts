/**
 * Correctness of the matchday itinerary domain.
 *
 * These are the facts the AI layer is forbidden from deriving, so they have to
 * be right here or they are right nowhere. Three classes of property are
 * covered: the departure model (lead time must actually respond to journey
 * length and to accessibility, in the right direction), the gate mapping (every
 * district must land on a real zone that is physically joined to the transit
 * link its mode uses), and catalogue integrity.
 *
 * The gate assertions check `WALKWAYS` rather than a hard-coded gate list: a
 * test that only restates `arrivalGate`'s own table would pass even if the
 * venue graph moved out from under it, which is the failure worth catching.
 */
import { describe, expect, it } from "vitest";

import {
	HOST_DISTRICTS,
	INTERESTS,
	approachZones,
	arrivalGate,
	getDistrict,
	isKnownDistrict,
	recommendedDepartureMinutes,
	transitZone,
	type HostDistrict,
	type TransitMode,
} from "@/lib/itinerary";
import { WALKWAYS, isKnownZone } from "@/lib/venue";

/** The transit zone each mode's fans arrive into, per the venue topology. */
const TRANSIT_ZONE_FOR_MODE: Readonly<Record<TransitMode, string>> = {
	rail: "rail",
	bus: "bus",
};

/** Zone ids directly joined to `zoneId` by a declared walkway, in either direction. */
function neighboursOf(zoneId: string): readonly string[] {
	return WALKWAYS.filter((w) => w.from === zoneId || w.to === zoneId).map((w) => (w.from === zoneId ? w.to : w.from));
}

/** A district that is deliberately not in the catalogue, for boundary checks. */
function syntheticDistrict(transitMinutes: number, transitMode: TransitMode = "rail"): HostDistrict {
	return {
		id: `synthetic-${String(transitMinutes)}`,
		name: "Synthetic",
		transitMode,
		transitMinutes,
		description: "Not in the catalogue.",
	};
}

describe("HOST_DISTRICTS — catalogue integrity", () => {
	/** A duplicate id would make `getDistrict` silently shadow a district. */
	it("has unique ids", () => {
		const ids = HOST_DISTRICTS.map((d) => d.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("has unique names, so the picker cannot show two identical options", () => {
		const names = HOST_DISTRICTS.map((d) => d.name);
		expect(new Set(names).size).toBe(names.length);
	});

	/** A non-positive journey would let a fan leave at or after kick-off. */
	it("gives every district a positive journey time", () => {
		expect(HOST_DISTRICTS.length).toBeGreaterThan(0);
		for (const district of HOST_DISTRICTS) {
			expect(district.transitMinutes, `${district.id} has a non-positive journey`).toBeGreaterThan(0);
		}
	});

	it("gives every district a non-empty name and description", () => {
		for (const district of HOST_DISTRICTS) {
			expect(district.name.length, `${district.id} has no name`).toBeGreaterThan(0);
			expect(district.description.length, `${district.id} has no description`).toBeGreaterThan(0);
		}
	});

	/** Both modes must be exercised, or the gate mapping is half-untested. */
	it("covers both transit modes", () => {
		const modes = new Set(HOST_DISTRICTS.map((d) => d.transitMode));
		expect(modes).toEqual(new Set<TransitMode>(["rail", "bus"]));
	});

	it("resolves every catalogue id and rejects unknown ones", () => {
		for (const district of HOST_DISTRICTS) {
			expect(isKnownDistrict(district.id)).toBe(true);
			expect(getDistrict(district.id)).toEqual(district);
		}
		expect(isKnownDistrict("atlantis")).toBe(false);
		expect(getDistrict("atlantis")).toBeUndefined();
	});
});

describe("INTERESTS", () => {
	it("are unique", () => {
		expect(new Set(INTERESTS).size).toBe(INTERESTS.length);
	});

	it("are all non-empty", () => {
		expect(INTERESTS.length).toBeGreaterThan(0);
		for (const interest of INTERESTS) {
			expect(interest.trim().length, `"${interest}" is blank`).toBeGreaterThan(0);
		}
	});

	/**
	 * Interests are sent to an API that caps each tag at 40 characters, so a tag
	 * longer than that would be offered in the UI and rejected on submit.
	 */
	it("all fit within the length the API accepts", () => {
		for (const interest of INTERESTS) {
			expect(interest.length, `"${interest}" exceeds the API's 40-character cap`).toBeLessThanOrEqual(40);
		}
	});
});

describe("recommendedDepartureMinutes — journey length", () => {
	/**
	 * The whole point of a per-district lead time: a fan further out must be told
	 * to leave earlier. Asserted over every ordered pair in the catalogue, so a
	 * constant — or a table that got a row wrong — cannot pass.
	 */
	it("is strictly increasing in journey time across every district pair", () => {
		for (const stepFree of [false, true]) {
			for (const a of HOST_DISTRICTS) {
				for (const b of HOST_DISTRICTS) {
					if (a.transitMinutes >= b.transitMinutes) continue;
					expect(
						recommendedDepartureMinutes(a, stepFree),
						`${a.id} (${String(a.transitMinutes)} min) must leave later than ${b.id} (${String(b.transitMinutes)} min)`,
					).toBeLessThan(recommendedDepartureMinutes(b, stepFree));
				}
			}
		}
	});

	/** Monotonic beyond the catalogue too: one extra minute of travel, at least one extra minute of lead. */
	it("is strictly increasing in journey time for arbitrary journeys", () => {
		for (let minutes = 1; minutes < 120; minutes += 1) {
			const shorter = recommendedDepartureMinutes(syntheticDistrict(minutes), false);
			const longer = recommendedDepartureMinutes(syntheticDistrict(minutes + 1), false);
			expect(longer, `journey ${String(minutes + 1)} min must beat ${String(minutes)} min`).toBeGreaterThan(
				shorter,
			);
		}
	});

	/**
	 * The lead time must exceed the journey itself: a fan told to leave exactly
	 * `transitMinutes` before kick-off arrives with zero time to clear security.
	 */
	it("always leaves entry buffer on top of the journey", () => {
		for (const district of HOST_DISTRICTS) {
			for (const stepFree of [false, true]) {
				expect(
					recommendedDepartureMinutes(district, stepFree),
					`${district.id} has no entry buffer`,
				).toBeGreaterThan(district.transitMinutes);
			}
		}
	});
});

describe("recommendedDepartureMinutes — step-free access", () => {
	/** Accessible lanes are fewer, so a step-free fan must always be given more lead. */
	it("always adds strictly more lead time than a non-step-free plan for the same district", () => {
		for (const district of HOST_DISTRICTS) {
			expect(
				recommendedDepartureMinutes(district, true),
				`${district.id} gives step-free no extra lead`,
			).toBeGreaterThan(recommendedDepartureMinutes(district, false));
		}
	});

	/** The step-free premium is about the gate, not the train, so it must not scale with the journey. */
	it("applies the same step-free premium regardless of journey length", () => {
		const premiums = HOST_DISTRICTS.map(
			(d) => recommendedDepartureMinutes(d, true) - recommendedDepartureMinutes(d, false),
		);
		expect(new Set(premiums).size).toBe(1);
	});
});

describe("arrivalGate", () => {
	/** A gate that is not a real zone cannot be routed from, and would reach the model as an invented gate. */
	it("returns a known zone id for every district", () => {
		for (const district of HOST_DISTRICTS) {
			const gate = arrivalGate(district);
			expect(isKnownZone(gate), `${district.id} -> ${gate} is not a venue zone`).toBe(true);
		}
	});

	it("is deterministic", () => {
		for (const district of HOST_DISTRICTS) {
			expect(arrivalGate(district)).toBe(arrivalGate(district));
		}
	});

	/**
	 * The load-bearing property: the gate must be physically joined to the transit
	 * link the district's mode actually arrives at. Checked against `WALKWAYS`, so
	 * moving a walkway in the venue topology without updating the gate table fails
	 * here rather than stranding a fan at a gate their train does not reach.
	 */
	it("lands every district at a gate connected to its own transit zone", () => {
		for (const district of HOST_DISTRICTS) {
			const gate = arrivalGate(district);
			const expected = TRANSIT_ZONE_FOR_MODE[district.transitMode];
			expect(
				neighboursOf(gate),
				`${district.id} (${district.transitMode}) -> ${gate}, which has no walkway to ${expected}`,
			).toContain(expected);
		}
	});

	/** A rail district must never be sent to a bus gate, nor the reverse. */
	it("never lands a district at a gate serving the other transit mode", () => {
		for (const district of HOST_DISTRICTS) {
			const gate = arrivalGate(district);
			const other = district.transitMode === "rail" ? "bus" : "rail";
			expect(neighboursOf(gate), `${district.id} -> ${gate} is served by the ${other} link`).not.toContain(other);
		}
	});

	/**
	 * Arrivals are meant to be spread across both gates a mode's link feeds, not
	 * piled onto one. Rail has enough districts for that to be observable.
	 */
	it("spreads rail districts across more than one gate", () => {
		const railDistricts = HOST_DISTRICTS.filter((d) => d.transitMode === "rail");
		expect(railDistricts.length).toBeGreaterThan(1);
		const gates = new Set(railDistricts.map((d) => arrivalGate(d)));
		expect(gates.size).toBeGreaterThan(1);
	});

	/** A district outside the catalogue must still get a real gate for its mode. */
	it("returns a mode-appropriate known gate for an uncatalogued district", () => {
		for (const mode of ["rail", "bus"] as const) {
			const gate = arrivalGate(syntheticDistrict(20, mode));
			expect(isKnownZone(gate)).toBe(true);
			expect(neighboursOf(gate)).toContain(TRANSIT_ZONE_FOR_MODE[mode]);
		}
	});
});

describe("transitZone and approachZones", () => {
	it("maps each mode to a known transit zone", () => {
		for (const mode of ["rail", "bus"] as const) {
			expect(isKnownZone(transitZone(mode))).toBe(true);
			expect(transitZone(mode)).toBe(TRANSIT_ZONE_FOR_MODE[mode]);
		}
	});

	/**
	 * These zones select the congestion readings put in front of the model. An
	 * unknown id would silently match nothing, quietly stripping the live crowding
	 * out of the prompt.
	 */
	it("reports the district's transit zone and gate, both known and adjacent", () => {
		for (const district of HOST_DISTRICTS) {
			const zones = approachZones(district);
			expect(zones).toEqual([transitZone(district.transitMode), arrivalGate(district)]);
			for (const id of zones) {
				expect(isKnownZone(id), `${district.id} approaches unknown zone ${id}`).toBe(true);
			}
			expect(neighboursOf(zones[0] ?? "")).toContain(zones[1]);
		}
	});
});
