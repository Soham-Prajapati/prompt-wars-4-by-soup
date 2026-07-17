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
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	FORECAST_HORIZON_MINUTES,
	MATCHDAY_MINUTES,
	TREND_DENSITY_DEADBAND,
	TREND_FRICTION_DEADBAND,
	alertFor,
	classifyTrend,
	clockFromWallTime,
	currentReport,
	currentSnapshot,
	forecastAt,
	phaseFor,
	readZone,
	snapshotAt,
	type MatchPhase,
	type Trend,
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

describe("classifyTrend — deadband boundaries", () => {
	/**
	 * The deadband is documented as an inclusive bound: exactly `deadband` is
	 * rising, exactly `-deadband` is falling. These are the edges an operator's
	 * "is this zone moving?" question turns on, so each is pinned rather than
	 * sampled near.
	 */
	it.each<readonly [number, Trend]>([
		[0.06, "rising"],
		[0.05, "rising"],
		[0.049, "steady"],
		[0, "steady"],
		[-0.049, "steady"],
		[-0.05, "falling"],
		[-0.06, "falling"],
	])("classifies a delta of %s against a 0.05 deadband as %s", (delta, expected) => {
		expect(classifyTrend(delta, 0.05)).toBe(expected);
	});

	/** The deadband is a parameter because the two callers use different scales. */
	it("scales with the deadband it is given", () => {
		expect(classifyTrend(3, TREND_DENSITY_DEADBAND)).toBe("rising");
		expect(classifyTrend(3, TREND_FRICTION_DEADBAND)).toBe("rising");
		expect(classifyTrend(1, TREND_FRICTION_DEADBAND)).toBe("steady");
		// The same 1.0 that is steady on the 0..100 friction scale is a landslide
		// on the 0..1 density scale — which is the whole reason for the parameter.
		expect(classifyTrend(1, TREND_DENSITY_DEADBAND)).toBe("rising");
	});

	/** Direction must be symmetric: nothing about falling is special. */
	it("mirrors rising and falling around zero", () => {
		for (let delta = 0; delta <= 1; delta += 0.01) {
			const up = classifyTrend(delta, TREND_DENSITY_DEADBAND);
			const down = classifyTrend(-delta, TREND_DENSITY_DEADBAND);
			const expected = up === "rising" ? "falling" : "steady";
			expect(down, `delta ${String(delta)}`).toBe(expected);
		}
	});
});

describe("forecastAt — determinism and the horizon", () => {
	/**
	 * The forecast has to be as reproducible as the snapshot it projects, and for
	 * the same reason: the console and the advisor read it independently and must
	 * agree without sharing storage.
	 */
	it("returns deep-equal forecasts for repeated calls at the same clock", () => {
		for (const minute of ALL_MINUTES) {
			expect(forecastAt(minute, FORECAST_HORIZON_MINUTES), `clock ${String(minute)}`).toEqual(
				forecastAt(minute, FORECAST_HORIZON_MINUTES),
			);
		}
	});

	/**
	 * The projection is the model read at `clock + horizon` — not a curve fitted
	 * to it. This is the property that makes the whole forecast trustworthy, so
	 * it is asserted against `snapshotAt` rather than against the implementation.
	 */
	it("projects exactly the snapshot at clock + horizon, for every minute", () => {
		for (const minute of ALL_MINUTES) {
			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			const future = snapshotAt(minute + FORECAST_HORIZON_MINUTES);

			for (const trend of forecast.zones) {
				const projected = future.zones.find((z) => z.zoneId === trend.zoneId);
				expect(projected, `${trend.zoneId} @ ${String(minute)}`).toBeDefined();
				if (projected === undefined) continue;
				expect(trend.projectedDensity, `${trend.zoneId} @ ${String(minute)}`).toBe(projected.density);
				expect(trend.projectedAlert, `${trend.zoneId} @ ${String(minute)}`).toBe(projected.alert);
				expect(trend.projectedWaitMinutes, `${trend.zoneId} @ ${String(minute)}`).toBe(projected.waitMinutes);
			}
		}
	});

	/** The "now" half must equally be the snapshot the console is showing. */
	it("reports the present exactly as the snapshot at the same clock does", () => {
		for (const minute of ALL_MINUTES) {
			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			const now = snapshotAt(minute);

			for (const trend of forecast.zones) {
				const reading = now.zones.find((z) => z.zoneId === trend.zoneId);
				expect(reading, trend.zoneId).toBeDefined();
				if (reading === undefined) continue;
				expect(trend.density, `${trend.zoneId} @ ${String(minute)}`).toBe(reading.density);
				expect(trend.alert, `${trend.zoneId} @ ${String(minute)}`).toBe(reading.alert);
				expect(trend.waitMinutes, `${trend.zoneId} @ ${String(minute)}`).toBe(reading.waitMinutes);
			}
		}
	});

	/**
	 * The matchday loops, so a forecast made in the last quarter-hour must read
	 * into the start of the next matchday rather than off the end of the clock.
	 * At clock 200 a 15-minute horizon lands at minute 5, not minute 215.
	 */
	it("wraps the horizon around the end of the matchday", () => {
		const forecast = forecastAt(MATCHDAY_MINUTES - 10, FORECAST_HORIZON_MINUTES);
		expect(forecast.clockMinutes).toBe(MATCHDAY_MINUTES - 10);
		expect(forecast.horizonClockMinutes).toBe(5);
		expect(forecast.horizonPhase).toBe(phaseFor(5));
	});

	it("wraps both ends when the origin clock is itself out of range", () => {
		expect(forecastAt(MATCHDAY_MINUTES + 10, 5)).toEqual(forecastAt(10, 5));
		expect(forecastAt(-10, 5).clockMinutes).toBe(MATCHDAY_MINUTES - 10);
		expect(forecastAt(-10, 5).horizonClockMinutes).toBe(MATCHDAY_MINUTES - 5);
	});

	/** The wrapped horizon must still be a real minute of a real phase. */
	it("keeps the horizon clock inside the matchday for every minute", () => {
		for (const minute of ALL_MINUTES) {
			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			expect(forecast.horizonClockMinutes, `clock ${String(minute)}`).toBeGreaterThanOrEqual(0);
			expect(forecast.horizonClockMinutes, `clock ${String(minute)}`).toBeLessThan(MATCHDAY_MINUTES);
			expect(forecast.horizonPhase, `clock ${String(minute)}`).toBe(phaseFor(forecast.horizonClockMinutes));
		}
	});

	/** A zero horizon is a forecast of the present: nothing moves, by definition. */
	it("reports every zone steady and no friction delta at a zero horizon", () => {
		const forecast = forecastAt(60, 0);
		expect(forecast.frictionDelta).toBe(0);
		expect(forecast.trend).toBe("steady");
		for (const zone of forecast.zones) {
			expect(zone.densityDelta, zone.zoneId).toBe(0);
			expect(zone.trend, zone.zoneId).toBe("steady");
			expect(zone.projectedDensity, zone.zoneId).toBe(zone.density);
		}
	});

	it("reports the horizon it was asked for", () => {
		for (const horizon of [0, 5, 15, 45, 200]) {
			expect(forecastAt(30, horizon).horizonMinutes).toBe(horizon);
		}
	});

	/**
	 * The horizon is documented as being no longer than the shortest phase, so a
	 * projection can never skip one entirely. That claim is load-bearing — it is
	 * the reason the number is 15 — so it is checked against `phaseFor` rather
	 * than trusted.
	 */
	it("never skips a phase, because the horizon fits inside the shortest one", () => {
		const lengths = new Map<MatchPhase, number>();
		for (const minute of ALL_MINUTES.slice(0, MATCHDAY_MINUTES)) {
			const phase = phaseFor(minute);
			lengths.set(phase, (lengths.get(phase) ?? 0) + 1);
		}
		const shortest = Math.min(...lengths.values());
		expect(FORECAST_HORIZON_MINUTES).toBeLessThanOrEqual(shortest);
	});
});

describe("forecastAt — physical invariants", () => {
	it("reports exactly one trend per declared zone, mirroring the topology", () => {
		const forecast = forecastAt(30, FORECAST_HORIZON_MINUTES);
		expect(forecast.zones).toHaveLength(ZONES.length);
		expect(forecast.zones.map((z) => z.zoneId).sort()).toEqual(ZONES.map((z) => z.id).sort());

		for (const trend of forecast.zones) {
			const zone = getZone(trend.zoneId);
			expect(zone, trend.zoneId).toBeDefined();
			expect(trend.name).toBe(zone?.name);
			expect(trend.kind).toBe(zone?.kind);
		}
	});

	/** Both ends are densities, so both obey the density contract. */
	it("keeps projected densities within 0..1 and friction within 0..100", () => {
		for (const minute of ALL_MINUTES) {
			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			expect(forecast.projectedFrictionScore, `clock ${String(minute)}`).toBeGreaterThanOrEqual(0);
			expect(forecast.projectedFrictionScore, `clock ${String(minute)}`).toBeLessThanOrEqual(100);

			for (const zone of forecast.zones) {
				expect(zone.projectedDensity, `${zone.zoneId} @ ${String(minute)}`).toBeGreaterThanOrEqual(0);
				expect(zone.projectedDensity, `${zone.zoneId} @ ${String(minute)}`).toBeLessThanOrEqual(1);
			}
		}
	});

	/**
	 * The delta is published beside the two figures it claims to be the
	 * difference of. Floating-point subtraction of two rounded values does not
	 * give a rounded result, so without the model rounding it the console would
	 * print `62% → 79%, +0.16999999999999998`.
	 */
	it("publishes a density delta that is exactly the difference it claims", () => {
		for (const minute of ALL_MINUTES) {
			for (const zone of forecastAt(minute, FORECAST_HORIZON_MINUTES).zones) {
				const label = `${zone.zoneId} @ ${String(minute)}`;
				expect(zone.densityDelta, label).toBeCloseTo(zone.projectedDensity - zone.density, 10);
				expect(Math.round(zone.densityDelta * 1000), label).toBe(zone.densityDelta * 1000);
			}
		}
	});

	/**
	 * A trend must be the band its own published delta maps to. The same defect
	 * class as the density/alert inconsistency this suite already guards: a
	 * record that contradicts itself is one the AI advisor is told to trust.
	 */
	it("publishes a trend consistent with the delta it publishes", () => {
		const inconsistent: string[] = [];
		for (const minute of ALL_MINUTES) {
			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			for (const zone of forecast.zones) {
				const implied = classifyTrend(zone.densityDelta, TREND_DENSITY_DEADBAND);
				if (implied !== zone.trend) {
					inconsistent.push(`${zone.zoneId} @ ${String(minute)}: delta ${String(zone.densityDelta)} implies '${implied}' but trend is '${zone.trend}'`);
				}
			}
			const impliedVenue = classifyTrend(forecast.frictionDelta, TREND_FRICTION_DEADBAND);
			if (impliedVenue !== forecast.trend) {
				inconsistent.push(`venue @ ${String(minute)}: delta ${String(forecast.frictionDelta)} implies '${impliedVenue}' but trend is '${forecast.trend}'`);
			}
		}
		expect(inconsistent).toEqual([]);
	});

	/**
	 * The venue-level delta is the difference between the projected friction and
	 * the friction the console is showing right now. If it were measured against
	 * anything else, every arrow on the status strip would point off a number the
	 * operator was never shown.
	 */
	it("measures the friction delta against the live snapshot's own score", () => {
		for (const minute of ALL_MINUTES) {
			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			const now = snapshotAt(minute).frictionScore;
			const later = snapshotAt(minute + FORECAST_HORIZON_MINUTES).frictionScore;

			expect(forecast.projectedFrictionScore, `clock ${String(minute)}`).toBe(later);
			expect(forecast.frictionDelta, `clock ${String(minute)}`).toBeCloseTo(later - now, 10);
		}
	});
});

describe("forecast behaviour", () => {
	/**
	 * The behavioural test that matters, and the reason the forecast is not just
	 * arithmetic: it must anticipate the half-time concessions rush *before* it
	 * arrives. Kick-off is at 45 and half-time at 90, so a forecast made in the
	 * quarter-hour before 90 is exactly the warning a duty manager acts on — it
	 * is the window in which extra tills can still be opened in time.
	 *
	 * Asserted against the model's own readings rather than restating the
	 * baseline table: whatever the numbers are, concessions must be *reported as
	 * rising* while the rush is still ahead.
	 */
	it("sees the half-time concessions rush coming before it starts", () => {
		// Every minute from which a 15-minute horizon lands inside half-time while
		// the present is still the first half.
		for (let minute = 75; minute < 90; minute += 1) {
			expect(phaseFor(minute), `clock ${String(minute)}`).toBe("first-half");
			expect(phaseFor(minute + FORECAST_HORIZON_MINUTES), `clock ${String(minute)}`).toBe("half-time");

			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			const concessions = forecast.zones.filter((z) => z.kind === "concession");
			expect(concessions.length).toBeGreaterThan(0);

			for (const zone of concessions) {
				expect(zone.trend, `${zone.zoneId} @ ${String(minute)} should be rising into half-time`).toBe("rising");
				expect(zone.projectedDensity, `${zone.zoneId} @ ${String(minute)}`).toBeGreaterThan(zone.density);
			}
		}
	});

	/**
	 * The mirror image: once the match is underway the gates are draining, and
	 * the forecast has to say so. An advisor told the gates are merely "busy"
	 * would hold staff on a queue that is dissolving on its own.
	 */
	it("sees the gates draining once the match is under way", () => {
		// Every minute from which a 15-minute horizon lands after kick-off while
		// the present is still pre-match ingress.
		for (let minute = 30; minute < 45; minute += 1) {
			expect(phaseFor(minute), `clock ${String(minute)}`).toBe("pre-match");
			expect(phaseFor(minute + FORECAST_HORIZON_MINUTES), `clock ${String(minute)}`).toBe("first-half");

			const forecast = forecastAt(minute, FORECAST_HORIZON_MINUTES);
			const gates = forecast.zones.filter((z) => z.kind === "gate");
			expect(gates.length).toBe(ZONES.filter((z) => z.kind === "gate").length);

			for (const zone of gates) {
				expect(zone.trend, `${zone.zoneId} @ ${String(minute)} should be falling after kick-off`).toBe("falling");
				expect(zone.projectedWaitMinutes, `${zone.zoneId} @ ${String(minute)}`).toBeLessThan(zone.waitMinutes);
			}
		}
	});

	/**
	 * Transit is the egress story. The final whistle empties the bowl into the
	 * rail link and the bus terminal at once, and a venue that learns this when
	 * the platform is already full has learned it too late.
	 */
	it("sees transit loading up before egress begins", () => {
		for (let minute = 135; minute < 150; minute += 1) {
			expect(phaseFor(minute), `clock ${String(minute)}`).toBe("second-half");
			expect(phaseFor(minute + FORECAST_HORIZON_MINUTES), `clock ${String(minute)}`).toBe("egress");

			for (const zone of forecastAt(minute, FORECAST_HORIZON_MINUTES).zones) {
				if (zone.kind !== "transit") continue;
				expect(zone.trend, `${zone.zoneId} @ ${String(minute)} should be rising into egress`).toBe("rising");
			}
		}
	});

	/**
	 * Medical posts are staffed reserve, never a crowd sink — so nothing about
	 * the projection should ever suggest deploying against them.
	 */
	it("never projects a medical post out of the normal band", () => {
		for (const minute of ALL_MINUTES) {
			for (const zone of forecastAt(minute, FORECAST_HORIZON_MINUTES).zones) {
				if (zone.kind !== "medical") continue;
				expect(zone.projectedAlert, `${zone.zoneId} @ ${String(minute)}`).toBe("normal");
			}
		}
	});

	/**
	 * The deadband has to actually earn its place. If every zone were always
	 * "steady" the forecast would be decoration; if none ever were, the deadband
	 * would not be filtering the model's drift and jitter as documented.
	 */
	it("produces all three classifications across the matchday", () => {
		const seen = new Set<Trend>();
		for (const minute of ALL_MINUTES) {
			for (const zone of forecastAt(minute, FORECAST_HORIZON_MINUTES).zones) seen.add(zone.trend);
		}
		expect(seen).toEqual(new Set<Trend>(["rising", "falling", "steady"]));
	});

	/** The venue-level trend must move too, or the status strip is a constant. */
	it("produces a rising and a falling venue trend across the matchday", () => {
		const seen = new Set<Trend>();
		for (const minute of ALL_MINUTES) seen.add(forecastAt(minute, FORECAST_HORIZON_MINUTES).trend);
		expect(seen).toContain("rising");
		expect(seen).toContain("falling");
	});
});

/**
 * `currentReport` is the second impure entry point in this module, and it exists
 * for exactly one property: both halves are anchored to a single reading of the
 * wall clock. Two independent reads could straddle a tick and describe different
 * minutes, so that is what these pin.
 */
describe("currentReport", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns the snapshot and forecast for the current wall-clock instant", () => {
		vi.useFakeTimers({ toFake: ["Date"] });

		for (const clock of [0, 30, 100, MATCHDAY_MINUTES - 1]) {
			vi.setSystemTime(clock * 4 * 1000);
			const report = currentReport();
			expect(report.snapshot, `clock=${String(clock)}`).toEqual(snapshotAt(clock));
			expect(report.forecast, `clock=${String(clock)}`).toEqual(forecastAt(clock, FORECAST_HORIZON_MINUTES));
		}
	});

	/**
	 * The anchoring property itself. The forecast projects *from* the instant the
	 * snapshot describes — if these two disagreed, every delta on the console
	 * would be measured against a state the operator was never shown.
	 */
	it("anchors the forecast to the same clock minute as the snapshot", () => {
		vi.useFakeTimers({ toFake: ["Date"] });

		for (const clock of [0, 44, 89, 149, MATCHDAY_MINUTES - 1]) {
			vi.setSystemTime(clock * 4 * 1000);
			const { snapshot, forecast } = currentReport();
			expect(forecast.clockMinutes, `clock=${String(clock)}`).toBe(snapshot.clockMinutes);
			expect(forecast.zones.map((z) => z.density), `clock=${String(clock)}`).toEqual(
				snapshot.zones.map((z) => z.density),
			);
		}
	});

	it("projects the documented horizon", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(30 * 4 * 1000);

		const { forecast } = currentReport();
		expect(forecast.horizonMinutes).toBe(FORECAST_HORIZON_MINUTES);
		expect(forecast.horizonClockMinutes).toBe(30 + FORECAST_HORIZON_MINUTES);
	});

	it("agrees with currentSnapshot on the present", () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(70 * 4 * 1000);
		expect(currentReport().snapshot).toEqual(currentSnapshot());
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

/**
 * `currentSnapshot` is the one impure entry point in this module, and six route
 * handlers now depend on it reading the same clock they used to spell out by
 * hand. So the properties are: it composes the two documented functions and
 * nothing else, and it genuinely follows wall time rather than pinning to
 * whatever instant the module was first imported at.
 */
describe("currentSnapshot", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	/** Pinning to import time is the failure a cached snapshot would produce. */
	it("returns the snapshot for the current wall-clock instant", () => {
		vi.useFakeTimers({ toFake: ["Date"] });

		for (const clock of [0, 30, 100, MATCHDAY_MINUTES - 1]) {
			vi.setSystemTime(clock * 4 * 1000);
			expect(currentSnapshot(), `clock=${String(clock)}`).toEqual(snapshotAt(clock));
			expect(currentSnapshot().clockMinutes, `clock=${String(clock)}`).toBe(clock);
		}
	});

	/** The phase must follow the clock, or every handler reports a stale matchday. */
	it("advances with wall-clock time", () => {
		vi.useFakeTimers({ toFake: ["Date"] });

		vi.setSystemTime(30 * 4 * 1000);
		expect(currentSnapshot().phase).toBe("pre-match");

		vi.setSystemTime(160 * 4 * 1000);
		expect(currentSnapshot().phase).toBe("egress");
	});

	/** It is the composition it claims to be, at an arbitrary real instant. */
	it("agrees with snapshotAt(clockFromWallTime(Date.now())) on the real clock", () => {
		const now = Date.now();
		expect(currentSnapshot()).toEqual(snapshotAt(clockFromWallTime(now)));
	});

	it("reports every zone in the topology", () => {
		expect(currentSnapshot().zones.length).toBe(ZONES.length);
	});
});
