/**
 * Structural invariants of the venue topology.
 *
 * These are data-integrity tests: the graph is hand-authored, so the failure
 * modes are typos in zone ids, coordinates drifting outside the normalised
 * plane, and — most damaging — a zone becoming unreachable, which would make
 * the router silently return `null` for legitimate journeys.
 */
import { describe, expect, it } from "vitest";

import { WALKWAYS, ZONES, getZone, isKnownZone } from "@/lib/venue";

describe("ZONES", () => {
	/** Ids are the routing graph's primary key; a duplicate would shadow a zone. */
	it("has unique zone ids", () => {
		const ids = ZONES.map((z) => z.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	/** Coordinates are documented as normalised to a 0..100 unit square. */
	it("places every zone inside the 0..100 normalised plane", () => {
		for (const zone of ZONES) {
			expect(zone.x, `${zone.id}.x`).toBeGreaterThanOrEqual(0);
			expect(zone.x, `${zone.id}.x`).toBeLessThanOrEqual(100);
			expect(zone.y, `${zone.id}.y`).toBeGreaterThanOrEqual(0);
			expect(zone.y, `${zone.id}.y`).toBeLessThanOrEqual(100);
		}
	});

	/** Capacity is the divisor in `density = occupancy / capacity`. */
	it("gives every zone a strictly positive capacity", () => {
		for (const zone of ZONES) {
			expect(zone.capacity, `${zone.id}.capacity`).toBeGreaterThan(0);
		}
	});
});

describe("getZone / isKnownZone", () => {
	/** The lookup map must agree with the source array it was built from. */
	it("resolves every declared zone and agrees with isKnownZone", () => {
		for (const zone of ZONES) {
			expect(getZone(zone.id)).toEqual(zone);
			expect(isKnownZone(zone.id)).toBe(true);
		}
	});

	it("returns undefined and false for an id that is not a zone", () => {
		expect(getZone("gate-z")).toBeUndefined();
		expect(isKnownZone("gate-z")).toBe(false);
	});
});

describe("WALKWAYS", () => {
	/**
	 * Referential integrity: an edge naming a nonexistent zone is a dead edge
	 * that `buildGraph` would happily insert and Dijkstra would never resolve.
	 */
	it("only references zone ids that exist in ZONES", () => {
		for (const walkway of WALKWAYS) {
			expect(isKnownZone(walkway.from), `walkway from '${walkway.from}'`).toBe(true);
			expect(isKnownZone(walkway.to), `walkway to '${walkway.to}'`).toBe(true);
		}
	});

	/** A zero or negative edge length would break Dijkstra's cost ordering. */
	it("gives every walkway a strictly positive length", () => {
		for (const walkway of WALKWAYS) {
			expect(walkway.metres, `${walkway.from}->${walkway.to}`).toBeGreaterThan(0);
		}
	});

	/** A self-loop contributes nothing and can only be an authoring mistake. */
	it("has no self-loops", () => {
		for (const walkway of WALKWAYS) {
			expect(walkway.from).not.toBe(walkway.to);
		}
	});
});

describe("venue graph connectivity", () => {
	/**
	 * Every zone must be reachable from every other zone over the undirected
	 * walkway graph. If this fails, `findRoute` returns null for a pair of real
	 * zones — an outage that looks like a bad request.
	 */
	it("is fully connected when step-free constraints are ignored", () => {
		const adjacency = new Map<string, string[]>();
		for (const zone of ZONES) adjacency.set(zone.id, []);
		for (const walkway of WALKWAYS) {
			adjacency.get(walkway.from)?.push(walkway.to);
			adjacency.get(walkway.to)?.push(walkway.from);
		}

		const first = ZONES[0];
		expect(first).toBeDefined();
		if (first === undefined) return;

		const seen = new Set<string>([first.id]);
		const queue: string[] = [first.id];
		while (queue.length > 0) {
			const current = queue.shift();
			if (current === undefined) break;
			for (const neighbour of adjacency.get(current) ?? []) {
				if (seen.has(neighbour)) continue;
				seen.add(neighbour);
				queue.push(neighbour);
			}
		}

		const unreachable = ZONES.filter((z) => !seen.has(z.id)).map((z) => z.id);
		expect(unreachable).toEqual([]);
		expect(seen.size).toBe(ZONES.length);
	});
});
