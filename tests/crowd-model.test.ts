/**
 * Properties of the deterministic crowd model.
 *
 * The model is a pure function of the match clock, so it can be swept
 * exhaustively rather than sampled. These tests assert the three things that
 * actually matter operationally: the output range is always physically
 * meaningful, the classification bands sit exactly where they are documented,
 * and the model's crowd behaviour matches matchday reality (gates before
 * kick-off, stands during play, concessions at half-time).
 */
import { describe, expect, it } from "vitest";

import {
	MATCHDAY_MINUTES,
	alertFor,
	clockFromWallTime,
	phaseFor,
	readZone,
	snapshotAt,
	type MatchPhase,
	type ZoneReading,
} from "@/lib/crowd-model";
import { ZONES, getZone, type ZoneKind } from "@/lib/venue";

/** Every minute of the simulated matchday, 0..MATCHDAY_MINUTES inclusive. */
const ALL_MINUTES: readonly number[] = Array.from({ length: MATCHDAY_MINUTES + 1 }, (_, i) => i);

/** Mean density of all zones of one kind, averaged over a span of the clock. */
function meanDensityOfKind(kind: ZoneKind, minutes: readonly number[]): number {
	const zones = ZONES.filter((z) => z.kind === kind);
	expect(zones.length, `no zones of kind '${kind}'`).toBeGreaterThan(0);

	let total = 0;
	let count = 0;
	for (const minute of minutes) {
		for (const reading of snapshotAt(minute).zones) {
			if (reading.kind !== kind) continue;
			total += reading.density;
			count += 1;
		}
	}
	expect(count).toBeGreaterThan(0);
	return total / count;
}

/** Inclusive range of clock minutes. */
function span(from: number, to: number): readonly number[] {
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

describe("snapshotAt — determinism", () => {
	/**
	 * The model is documented as a pure function so the dashboard and the AI
	 * advisor observe identical state without shared storage. Any hidden clock
	 * read or PRNG state would break this.
	 */
	it("returns deep-equal snapshots for repeated calls at the same clock", () => {
		expect(snapshotAt(60)).toEqual(snapshotAt(60));
	});

	it("stays deterministic across the whole matchday", () => {
		for (const minute of ALL_MINUTES) {
			expect(snapshotAt(minute), `clock ${String(minute)}`).toEqual(snapshotAt(minute));
		}
	});
});

describe("snapshotAt — clock wrapping", () => {
	/** The matchday loops, so an over-run clock must fold back to the start. */
	it("wraps a clock past the end of the matchday", () => {
		expect(snapshotAt(MATCHDAY_MINUTES + 10)).toEqual(snapshotAt(10));
		expect(snapshotAt(MATCHDAY_MINUTES)).toEqual(snapshotAt(0));
	});

	/** JS `%` is remainder, not modulo; negatives must still land in 0..209. */
	it("wraps a negative clock to the tail of the matchday", () => {
		expect(snapshotAt(-10)).toEqual(snapshotAt(MATCHDAY_MINUTES - 10));
		expect(snapshotAt(-1).clockMinutes).toBe(MATCHDAY_MINUTES - 1);
	});

	it("reports the wrapped clock, never the raw input", () => {
		expect(snapshotAt(MATCHDAY_MINUTES + 10).clockMinutes).toBe(10);
		expect(snapshotAt(-10).clockMinutes).toBe(MATCHDAY_MINUTES - 10);
	});
});

describe("snapshotAt — physical invariants", () => {
	/**
	 * Density is defined as a clamped occupancy ratio. A value outside 0..1
	 * would render off the heatmap scale and mis-classify the alert band.
	 */
	it("keeps every zone density within 0..1 for every minute of the matchday", () => {
		for (const minute of ALL_MINUTES) {
			for (const reading of snapshotAt(minute).zones) {
				expect(reading.density, `${reading.zoneId} @ ${String(minute)}`).toBeGreaterThanOrEqual(0);
				expect(reading.density, `${reading.zoneId} @ ${String(minute)}`).toBeLessThanOrEqual(1);
			}
		}
	});

	/** Occupancy is derived from capacity and must never oversubscribe a zone. */
	it("never reports occupancy above a zone's capacity", () => {
		for (const minute of ALL_MINUTES) {
			for (const reading of snapshotAt(minute).zones) {
				const zone = getZone(reading.zoneId);
				expect(zone, reading.zoneId).toBeDefined();
				if (zone === undefined) continue;
				expect(reading.occupancy, `${reading.zoneId} @ ${String(minute)}`).toBeGreaterThanOrEqual(0);
				expect(reading.occupancy, `${reading.zoneId} @ ${String(minute)}`).toBeLessThanOrEqual(zone.capacity);
			}
		}
	});

	/** Friction is a 0..100 index; it is surfaced directly as a gauge. */
	it("keeps frictionScore within 0..100 for every minute of the matchday", () => {
		for (const minute of ALL_MINUTES) {
			const { frictionScore } = snapshotAt(minute);
			expect(frictionScore, `clock ${String(minute)}`).toBeGreaterThanOrEqual(0);
			expect(frictionScore, `clock ${String(minute)}`).toBeLessThanOrEqual(100);
		}
	});

	it("keeps meanDensity within 0..1 for every minute of the matchday", () => {
		for (const minute of ALL_MINUTES) {
			const { meanDensity } = snapshotAt(minute);
			expect(meanDensity, `clock ${String(minute)}`).toBeGreaterThanOrEqual(0);
			expect(meanDensity, `clock ${String(minute)}`).toBeLessThanOrEqual(1);
		}
	});

	/** A dropped or duplicated zone would silently shrink the ops picture. */
	it("reports exactly one reading per declared zone", () => {
		const snapshot = snapshotAt(70);
		expect(snapshot.zones).toHaveLength(ZONES.length);
		expect(snapshot.zones.map((z) => z.zoneId).sort()).toEqual(ZONES.map((z) => z.id).sort());
	});

	/** The snapshot's phase must agree with the standalone classifier. */
	it("labels each snapshot with the phase of its wrapped clock", () => {
		for (const minute of ALL_MINUTES) {
			const snapshot = snapshotAt(minute);
			expect(snapshot.phase, `clock ${String(minute)}`).toBe(phaseFor(snapshot.clockMinutes));
		}
	});

	/**
	 * A reading must be internally consistent: the `alert` it publishes has to
	 * be the band that the `density` it publishes maps to.
	 *
	 * `readZone` rounds `density` to 3dp for display but classifies `alert` from
	 * the *unrounded* value, so a density that rounds up across a threshold is
	 * published with the band of the value below it. Consumers — including the
	 * AI advisor, which is instructed to base every statement strictly on this
	 * data — then receive a record that contradicts itself.
	 */
	it("publishes an alert band consistent with the density it publishes", () => {
		const inconsistent: string[] = [];
		for (const minute of ALL_MINUTES) {
			for (const reading of snapshotAt(minute).zones) {
				const implied = alertFor(reading.density);
				if (implied !== reading.alert) {
					inconsistent.push(
						`${reading.zoneId} @ ${String(minute)}: density ${String(reading.density)} implies '${implied}' but alert is '${reading.alert}'`,
					);
				}
			}
		}
		expect(inconsistent).toEqual([]);
	});
});

describe("alertFor — band boundaries", () => {
	/**
	 * The thresholds are inclusive lower bounds (0.4 / 0.65 / 0.85). Off-by-one
	 * here would mis-page the control room, so each edge is pinned exactly.
	 */
	it.each<readonly [number, string]>([
		[0, "normal"],
		[0.39, "normal"],
		[0.4, "elevated"],
		[0.64, "elevated"],
		[0.65, "high"],
		[0.84, "high"],
		[0.85, "critical"],
		[1, "critical"],
	])("classifies density %s as %s", (density, expected) => {
		expect(alertFor(density)).toBe(expected);
	});

	/** Severity must be monotonic in density — never soften as a zone fills. */
	it("never downgrades severity as density rises", () => {
		const rank: Record<string, number> = { normal: 0, elevated: 1, high: 2, critical: 3 };
		let previous = -1;
		for (let d = 0; d <= 1.0001; d += 0.005) {
			const current = rank[alertFor(d)];
			expect(current, `density ${String(d)}`).toBeDefined();
			if (current === undefined) continue;
			expect(current, `density ${String(d)}`).toBeGreaterThanOrEqual(previous);
			previous = current;
		}
	});
});

describe("phaseFor — phase boundaries", () => {
	/** Boundaries are exclusive upper bounds at 45 / 90 / 105 / 150. */
	it.each<readonly [number, MatchPhase]>([
		[0, "pre-match"],
		[44, "pre-match"],
		[45, "first-half"],
		[89, "first-half"],
		[90, "half-time"],
		[104, "half-time"],
		[105, "second-half"],
		[149, "second-half"],
		[150, "egress"],
		[209, "egress"],
	])("maps clock minute %i to %s", (minute, expected) => {
		expect(phaseFor(minute)).toBe(expected);
	});

	/** Every minute of the matchday must land in exactly one known phase. */
	it("assigns a phase to every minute of the matchday", () => {
		const known: readonly MatchPhase[] = ["pre-match", "first-half", "half-time", "second-half", "egress"];
		for (const minute of ALL_MINUTES) {
			expect(known, `clock ${String(minute)}`).toContain(phaseFor(minute));
		}
	});
});

describe("crowd behaviour", () => {
	const PRE_MATCH = span(0, 44);
	const FIRST_HALF = span(45, 89);
	const HALF_TIME = span(90, 104);
	const SECOND_HALF = span(105, 149);
	const EGRESS = span(150, 209);

	/** Fans are in their seats during play, not while still arriving. */
	it("packs the stands more densely during play than before kick-off", () => {
		const preMatch = meanDensityOfKind("stand", PRE_MATCH);
		expect(meanDensityOfKind("stand", FIRST_HALF)).toBeGreaterThan(preMatch);
		expect(meanDensityOfKind("stand", SECOND_HALF)).toBeGreaterThan(preMatch);
	});

	/** The half-time rush is the defining concessions load event. */
	it("peaks concessions at half-time relative to the first half", () => {
		expect(meanDensityOfKind("concession", HALF_TIME)).toBeGreaterThan(
			meanDensityOfKind("concession", FIRST_HALF),
		);
	});

	/** Gates saturate on ingress and drain once everyone is inside. */
	it("keeps gates busier before kick-off than during the first half", () => {
		expect(meanDensityOfKind("gate", PRE_MATCH)).toBeGreaterThan(meanDensityOfKind("gate", FIRST_HALF));
	});

	/** Transit demand is highest on the way out, when everyone leaves at once. */
	it("loads transit more heavily at egress than during the first half", () => {
		expect(meanDensityOfKind("transit", EGRESS)).toBeGreaterThan(meanDensityOfKind("transit", FIRST_HALF));
	});

	/** Medical posts are staffed reserve capacity, never a crowd sink. */
	it("keeps medical posts below the elevated band across the whole matchday", () => {
		for (const minute of ALL_MINUTES) {
			for (const reading of snapshotAt(minute).zones) {
				if (reading.kind !== "medical") continue;
				expect(reading.alert, `${reading.zoneId} @ ${String(minute)}`).toBe("normal");
			}
		}
	});
});

describe("waitMinutes", () => {
	/** Stands, concourses and medical posts have no queue to wait in. */
	it("is zero for every non-queueing zone across the whole matchday", () => {
		const nonQueueing: readonly ZoneKind[] = ["stand", "concourse", "medical"];
		for (const minute of ALL_MINUTES) {
			for (const reading of snapshotAt(minute).zones) {
				if (!nonQueueing.includes(reading.kind)) continue;
				expect(reading.waitMinutes, `${reading.zoneId} @ ${String(minute)}`).toBe(0);
			}
		}
	});

	/** Gates queue hard on ingress; a zero wait there would be a dead model. */
	it("is positive for every gate during the pre-match ingress", () => {
		const gates = snapshotAt(20).zones.filter((z) => z.kind === "gate");
		expect(gates.length).toBe(ZONES.filter((z) => z.kind === "gate").length);
		for (const gate of gates) {
			expect(gate.waitMinutes, gate.zoneId).toBeGreaterThan(0);
		}
	});

	/**
	 * Wait grows super-linearly with density (quadratic), so a busier gate must
	 * always out-wait a quieter one.
	 */
	it("orders gate waits by density", () => {
		const busy = snapshotAt(20).zones.filter((z) => z.kind === "gate");
		const quiet = snapshotAt(70).zones.filter((z) => z.kind === "gate");

		for (const gate of busy) {
			const counterpart = quiet.find((z) => z.zoneId === gate.zoneId);
			expect(counterpart, gate.zoneId).toBeDefined();
			if (counterpart === undefined) continue;
			expect(gate.density, gate.zoneId).toBeGreaterThan(counterpart.density);
			expect(gate.waitMinutes, gate.zoneId).toBeGreaterThan(counterpart.waitMinutes);
		}
	});
});

describe("readZone", () => {
	/** A reading must carry the geometry of the zone it describes, unaltered. */
	it("mirrors the source zone's identity and position", () => {
		for (const zone of ZONES) {
			const reading: ZoneReading = readZone(zone, 30);
			expect(reading.zoneId).toBe(zone.id);
			expect(reading.name).toBe(zone.name);
			expect(reading.kind).toBe(zone.kind);
			expect(reading.x).toBe(zone.x);
			expect(reading.y).toBe(zone.y);
		}
	});

	/** readZone is the primitive snapshotAt composes; they must not diverge. */
	it("agrees with the corresponding entry in a full snapshot", () => {
		const snapshot = snapshotAt(120);
		for (const zone of ZONES) {
			const fromSnapshot = snapshot.zones.find((z) => z.zoneId === zone.id);
			expect(fromSnapshot, zone.id).toBeDefined();
			if (fromSnapshot === undefined) continue;
			expect(readZone(zone, 120)).toEqual(fromSnapshot);
		}
	});
});

describe("clockFromWallTime", () => {
	/** The demo loops forever, so any epoch must map onto a valid clock. */
	it("maps wall-clock milliseconds into 0..MATCHDAY_MINUTES", () => {
		const samples = [0, 1, 1_000, 1_700_000_000_000, Date.now(), 4_102_444_800_000];
		for (const now of samples) {
			const clock = clockFromWallTime(now);
			expect(clock, `now=${String(now)}`).toBeGreaterThanOrEqual(0);
			expect(clock, `now=${String(now)}`).toBeLessThan(MATCHDAY_MINUTES);
			expect(Number.isInteger(clock), `now=${String(now)}`).toBe(true);
		}
	});

	/** The clock must advance with wall time and wrap at the matchday length. */
	it("advances one clock minute per four real seconds and wraps at the end", () => {
		expect(clockFromWallTime(0)).toBe(0);
		expect(clockFromWallTime(4_000)).toBe(1);
		expect(clockFromWallTime(3_999)).toBe(0);
		expect(clockFromWallTime(4_000 * MATCHDAY_MINUTES)).toBe(0);
		expect(clockFromWallTime(4_000 * (MATCHDAY_MINUTES + 3))).toBe(3);
	});
});
