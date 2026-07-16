/**
 * Correctness of the crowd-aware router.
 *
 * Three classes of property are covered: graph integrity (the returned path is
 * a real walk over real walkways, with no revisits), the accessibility
 * guarantee (step-free routing must never emit a stepped hop or a stepped
 * zone), and congestion awareness (density must actually change what the
 * router charges and, when it is bad enough, which way it sends people).
 *
 * Congestion tests use hand-built snapshots rather than `snapshotAt`, so the
 * density under test is stated explicitly and cannot drift with the model.
 */
import { describe, expect, it } from "vitest";

import { snapshotAt, alertFor, type VenueSnapshot, type ZoneReading } from "@/lib/crowd-model";
import { findRoute, type Route } from "@/lib/wayfinding";
import { WALKWAYS, ZONES, getZone } from "@/lib/venue";

/**
 * Build a snapshot with explicit per-zone densities.
 *
 * @param densities Zone id -> density. Unlisted zones default to `fallback`.
 * @param fallback Density used for every zone not named in `densities`.
 */
function makeSnapshot(densities: Readonly<Record<string, number>>, fallback = 0): VenueSnapshot {
	const zones: ZoneReading[] = ZONES.map((zone) => {
		const density = densities[zone.id] ?? fallback;
		return {
			zoneId: zone.id,
			name: zone.name,
			kind: zone.kind,
			x: zone.x,
			y: zone.y,
			density,
			occupancy: Math.round(density * zone.capacity),
			waitMinutes: 0,
			alert: alertFor(density),
		};
	});
	const mean = zones.reduce((sum, z) => sum + z.density, 0) / zones.length;
	const meanSquared = zones.reduce((sum, z) => sum + z.density * z.density, 0) / zones.length;
	return {
		clockMinutes: 0,
		phase: "pre-match",
		zones,
		meanDensity: mean,
		frictionScore: meanSquared * 100,
	};
}

/** An empty venue: every edge costs exactly its free-flow length. */
const CLEAR = makeSnapshot({});

/** Look up a walkway between two zones, in either direction. */
function walkwayBetween(a: string, b: string) {
	return WALKWAYS.find((w) => (w.from === a && w.to === b) || (w.from === b && w.to === a));
}

/** Assert a route is a real, non-repeating walk over declared walkways. */
function expectValidWalk(route: Route): void {
	expect(new Set(route.path).size, `duplicate zone in path ${route.path.join(" -> ")}`).toBe(route.path.length);

	for (let i = 0; i < route.path.length - 1; i += 1) {
		const from = route.path[i];
		const to = route.path[i + 1];
		expect(from).toBeDefined();
		expect(to).toBeDefined();
		if (from === undefined || to === undefined) continue;
		expect(walkwayBetween(from, to), `no walkway ${from} -> ${to}`).toBeDefined();
	}
}

describe("findRoute — basic routing", () => {
	it("routes from the rail link to the north stand", () => {
		const route = findRoute("rail", "stand-n", CLEAR, { stepFreeOnly: false });
		expect(route).not.toBeNull();
		if (route === null) return;

		expect(route.path[0]).toBe("rail");
		expect(route.path[route.path.length - 1]).toBe("stand-n");
		expect(route.path.length).toBeGreaterThan(1);
		expect(route.metres).toBeGreaterThan(0);
		expect(route.minutes).toBeGreaterThan(0);
		expectValidWalk(route);
	});

	/** Names are the human-facing labels and must stay aligned with the path. */
	it("returns names parallel to the path", () => {
		const route = findRoute("bus", "food-ne", CLEAR, { stepFreeOnly: false });
		expect(route).not.toBeNull();
		if (route === null) return;

		expect(route.names).toEqual(route.path.map((id) => getZone(id)?.name));
	});

	/** Total metres must equal the sum of the walkways actually traversed. */
	it("reports metres equal to the sum of the traversed walkways", () => {
		const route = findRoute("rail", "stand-s", CLEAR, { stepFreeOnly: false });
		expect(route).not.toBeNull();
		if (route === null) return;

		let expected = 0;
		for (let i = 0; i < route.path.length - 1; i += 1) {
			const from = route.path[i];
			const to = route.path[i + 1];
			if (from === undefined || to === undefined) continue;
			expected += walkwayBetween(from, to)?.metres ?? 0;
		}
		expect(route.metres).toBe(expected);
	});

	/** On an empty venue the router degenerates to shortest-distance. */
	it("picks the shortest-distance path when the venue is empty", () => {
		// rail -> gate-a -> conc-n -> stand-n is 420 m; the eastern detour via
		// gate-b -> conc-e -> stand-n is 460 m.
		const route = findRoute("rail", "stand-n", CLEAR, { stepFreeOnly: false });
		expect(route?.path).toEqual(["rail", "gate-a", "conc-n", "stand-n"]);
		expect(route?.metres).toBe(420);
	});
});

describe("findRoute — degenerate and invalid input", () => {
	/** Asking for a route to where you already stand is not an error. */
	it("returns a zero-length route when origin equals destination", () => {
		const route = findRoute("conc-n", "conc-n", CLEAR, { stepFreeOnly: false });
		expect(route).not.toBeNull();
		if (route === null) return;

		expect(route.path).toEqual(["conc-n"]);
		expect(route.names).toEqual(["North Concourse"]);
		expect(route.metres).toBe(0);
		expect(route.minutes).toBe(0);
		expect(route.meanDensity).toBe(0);
	});

	/** Unknown ids must be rejected up front, not routed to a phantom node. */
	it("returns null for an unknown origin", () => {
		expect(findRoute("gate-z", "stand-n", CLEAR, { stepFreeOnly: false })).toBeNull();
	});

	it("returns null for an unknown destination", () => {
		expect(findRoute("rail", "stand-z", CLEAR, { stepFreeOnly: false })).toBeNull();
	});

	it("returns null when both ids are unknown, even if they are equal", () => {
		expect(findRoute("nowhere", "nowhere", CLEAR, { stepFreeOnly: false })).toBeNull();
	});
});

describe("findRoute — step-free guarantee", () => {
	/**
	 * The north stand is itself stepped (`stepFree: false`), and both walkways
	 * reaching it from a concourse are stepped too. A step-free request must
	 * therefore fail rather than return a route a wheelchair user cannot use.
	 */
	it("returns null for a step-free route to a stepped zone", () => {
		expect(getZone("stand-n")?.stepFree).toBe(false);
		expect(findRoute("rail", "stand-n", CLEAR, { stepFreeOnly: true })).toBeNull();
		expect(findRoute("rail", "stand-s", CLEAR, { stepFreeOnly: true })).toBeNull();
	});

	/** A step-free route that exists must use only step-free zones and hops. */
	it("routes step-free from the rail link to the west medical post", () => {
		const route = findRoute("rail", "medical-w", CLEAR, { stepFreeOnly: true });
		expect(route).not.toBeNull();
		if (route === null) return;

		expect(route.stepFree).toBe(true);
		expect(route.path[0]).toBe("rail");
		expect(route.path[route.path.length - 1]).toBe("medical-w");
		expectValidWalk(route);

		for (const id of route.path) {
			expect(getZone(id)?.stepFree, `zone ${id} is not step-free`).toBe(true);
		}
		for (let i = 0; i < route.path.length - 1; i += 1) {
			const from = route.path[i];
			const to = route.path[i + 1];
			if (from === undefined || to === undefined) continue;
			expect(walkwayBetween(from, to)?.stepFree, `walkway ${from} -> ${to} is not step-free`).toBe(true);
		}
	});

	/**
	 * bus -> gate-c is the shortest hop out of the bus terminal (220 m) but the
	 * walkway is stepped. A step-free request must not use it; the step-free
	 * exit from the bus terminal is gate-d (280 m).
	 */
	it("excludes the stepped bus -> gate-c walkway from step-free routing", () => {
		expect(walkwayBetween("bus", "gate-c")?.stepFree).toBe(false);

		const stepped = findRoute("bus", "gate-c", CLEAR, { stepFreeOnly: false });
		expect(stepped?.path).toEqual(["bus", "gate-c"]);

		expect(findRoute("bus", "gate-c", CLEAR, { stepFreeOnly: true })).toBeNull();

		const stepFree = findRoute("bus", "gate-d", CLEAR, { stepFreeOnly: true });
		expect(stepFree).not.toBeNull();
		if (stepFree === null) return;

		expect(stepFree.path).toEqual(["bus", "gate-d"]);
		expect(stepFree.metres).toBe(280);
		expect(stepFree.path).not.toContain("gate-c");
		expectValidWalk(stepFree);
	});

	/** No step-free route may ever touch a stepped zone or a stepped walkway. */
	it("never emits a stepped hop for any step-free route in the venue", () => {
		for (const origin of ZONES) {
			for (const destination of ZONES) {
				if (origin.id === destination.id) continue;
				const route = findRoute(origin.id, destination.id, CLEAR, { stepFreeOnly: true });
				if (route === null) continue;

				for (const id of route.path) {
					expect(getZone(id)?.stepFree, `${origin.id}->${destination.id} touches stepped zone ${id}`).toBe(
						true,
					);
				}
				for (let i = 0; i < route.path.length - 1; i += 1) {
					const from = route.path[i];
					const to = route.path[i + 1];
					if (from === undefined || to === undefined) continue;
					expect(
						walkwayBetween(from, to)?.stepFree,
						`${origin.id}->${destination.id} uses stepped walkway ${from}->${to}`,
					).toBe(true);
				}
			}
		}
	});
});

describe("findRoute — graph integrity", () => {
	/**
	 * Dijkstra must never revisit a settled node. A duplicate in the path would
	 * mean the predecessor chain contains a cycle.
	 */
	it("returns a non-repeating walk over declared walkways for every zone pair", () => {
		for (const origin of ZONES) {
			for (const destination of ZONES) {
				const route = findRoute(origin.id, destination.id, snapshotAt(95), { stepFreeOnly: false });
				expect(route, `${origin.id} -> ${destination.id}`).not.toBeNull();
				if (route === null) continue;

				expect(route.path[0]).toBe(origin.id);
				expect(route.path[route.path.length - 1]).toBe(destination.id);
				expectValidWalk(route);
			}
		}
	});

	/** Walkways are bidirectional, so distance must be symmetric. */
	it("reports the same distance in both directions for every zone pair", () => {
		for (const origin of ZONES) {
			for (const destination of ZONES) {
				const there = findRoute(origin.id, destination.id, CLEAR, { stepFreeOnly: false });
				const back = findRoute(destination.id, origin.id, CLEAR, { stepFreeOnly: false });
				expect(there?.metres, `${origin.id} <-> ${destination.id}`).toBe(back?.metres);
			}
		}
	});
});

describe("findRoute — congestion awareness", () => {
	/**
	 * Congestion must be priced into the walking estimate: the *same* physical
	 * route has to cost more minutes when the venue is packed than when it is
	 * clear.
	 *
	 * Density is applied uniformly so the congestion factor scales every edge
	 * equally and the shortest path is provably unchanged — which isolates the
	 * cost effect from the routing effect (covered by the detour test below).
	 */
	it("charges more minutes for an identical route when the venue is packed", () => {
		const clear = findRoute("rail", "stand-n", makeSnapshot({}, 0), { stepFreeOnly: false });
		const packed = findRoute("rail", "stand-n", makeSnapshot({}, 1), { stepFreeOnly: false });

		expect(clear).not.toBeNull();
		expect(packed).not.toBeNull();
		if (clear === null || packed === null) return;

		expect(packed.path).toEqual(clear.path);
		expect(packed.metres).toBe(clear.metres);
		expect(packed.minutes).toBeGreaterThan(clear.minutes);
		// congestionFactor(1) === 1 + 3*1*1 === 4, so every hop costs 4x free flow.
		expect(packed.minutes).toBeCloseTo(clear.minutes * 4, 1);
	});

	/**
	 * A packed destination must make its own approach dearer. gate-a is a leaf
	 * off the rail link only via conc-n, so pricing is observable on the
	 * shortest hop while the detour test covers the re-routing behaviour.
	 */
	it("prices the congestion of the zone being entered, not just distance", () => {
		const clear = findRoute("conc-w", "medical-w", makeSnapshot({ "medical-w": 0 }), { stepFreeOnly: false });
		const packed = findRoute("conc-w", "medical-w", makeSnapshot({ "medical-w": 1 }), { stepFreeOnly: false });

		expect(clear).not.toBeNull();
		expect(packed).not.toBeNull();
		if (clear === null || packed === null) return;

		// medical-w has exactly one walkway, so the path cannot change.
		expect(clear.path).toEqual(["conc-w", "medical-w"]);
		expect(packed.path).toEqual(clear.path);
		expect(packed.metres).toBe(clear.metres);
		expect(packed.minutes).toBeCloseTo(clear.minutes * 4, 1);
	});

	/**
	 * Beyond pricing, congestion must change the decision: a packed north
	 * concourse has to push the router onto the physically longer eastern
	 * approach to the north stand.
	 */
	it("detours around a packed concourse even when the alternative is longer", () => {
		const viaNorth = findRoute("rail", "stand-n", CLEAR, { stepFreeOnly: false });
		expect(viaNorth?.path).toEqual(["rail", "gate-a", "conc-n", "stand-n"]);

		const detour = findRoute("rail", "stand-n", makeSnapshot({ "conc-n": 1 }), { stepFreeOnly: false });
		expect(detour).not.toBeNull();
		if (detour === null || viaNorth === null) return;

		expect(detour.path).not.toEqual(viaNorth.path);
		expect(detour.path).not.toContain("conc-n");
		expect(detour.path).toEqual(["rail", "gate-b", "conc-e", "stand-n"]);
		// The detour is physically longer but operationally cheaper.
		expect(detour.metres).toBeGreaterThan(viaNorth.metres);
		expectValidWalk(detour);
	});

	/** meanDensity must reflect the zones the route actually passes through. */
	it("reports the mean density of the zones on the chosen path", () => {
		const snapshot = makeSnapshot({ "conc-n": 0.5 }, 0.25);
		const route = findRoute("rail", "stand-n", snapshot, { stepFreeOnly: false });
		expect(route).not.toBeNull();
		if (route === null) return;

		const byId = new Map(snapshot.zones.map((z) => [z.zoneId, z.density]));
		const expected = route.path.reduce((sum, id) => sum + (byId.get(id) ?? 0), 0) / route.path.length;
		expect(route.meanDensity).toBeCloseTo(expected, 3);
	});

	/** A uniformly busier venue can never be quicker to cross. */
	it("never estimates a busy venue as quicker to cross than an empty one", () => {
		const busy = makeSnapshot({}, 0.8);
		for (const origin of ZONES) {
			for (const destination of ZONES) {
				const clearRoute = findRoute(origin.id, destination.id, CLEAR, { stepFreeOnly: false });
				const busyRoute = findRoute(origin.id, destination.id, busy, { stepFreeOnly: false });
				if (clearRoute === null || busyRoute === null) continue;
				expect(busyRoute.minutes, `${origin.id} -> ${destination.id}`).toBeGreaterThanOrEqual(
					clearRoute.minutes,
				);
			}
		}
	});
});
