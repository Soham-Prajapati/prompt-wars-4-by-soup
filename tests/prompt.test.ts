/**
 * Wording of the shared prompt fragments.
 *
 * These lines are the model's entire view of the venue, so the properties worth
 * asserting are the ones a wrong line would cost: that a reading's real numbers
 * survive into the text, that a zone is named exactly as the model is told to
 * name it back, that a queue is mentioned when there is one and not invented
 * when there is not, and that each audience gets the field it acts on — the
 * step-free status for a fan, the zone id and head count for a duty manager.
 *
 * Both renderings are driven from real snapshot readings rather than hand-built
 * objects: a fixture that cannot occur would let a formatting bug pass here and
 * fail in production.
 */
import { describe, expect, it } from "vitest";

import {
	FORECAST_HORIZON_MINUTES,
	MATCHDAY_MINUTES,
	forecastAt,
	snapshotAt,
	type TrendReading,
	type ZoneReading,
} from "@/lib/crowd-model";
import { describeTrendForFan, describeTrendForOps, describeZoneForFan, describeZoneForOps } from "@/lib/prompt";
import { ZONES, getZone } from "@/lib/venue";

/** Pre-match: gates and transit loaded, so queue lines are non-empty. */
const preMatch = snapshotAt(30);
/** Second half: gates near-empty, so the no-queue branch is exercised. */
const secondHalf = snapshotAt(120);

/** Every reading either phase produces, for properties that hold of all of them. */
const ALL_READINGS: readonly ZoneReading[] = [...preMatch.zones, ...secondHalf.zones];

/**
 * Every projection the matchday produces.
 *
 * Swept rather than sampled, because the branches these lines carry — a band
 * that changes, a queue that exists — are properties of the clock, and a fixture
 * at one minute would silently stop exercising half of them.
 */
const ALL_TRENDS: readonly TrendReading[] = Array.from({ length: MATCHDAY_MINUTES }, (_, minute) => minute).flatMap(
	(minute) => forecastAt(minute, FORECAST_HORIZON_MINUTES).zones,
);

/** The projection for one zone at one instant. */
function trendFor(clockMinutes: number, zoneId: string): TrendReading {
	const found = forecastAt(clockMinutes, FORECAST_HORIZON_MINUTES).zones.find((z) => z.zoneId === zoneId);
	if (found === undefined) throw new Error(`no trend for ${zoneId}`);
	return found;
}

/** The reading for a zone at a given instant. */
function reading(snapshot: typeof preMatch, zoneId: string): ZoneReading {
	const found = snapshot.zones.find((z) => z.zoneId === zoneId);
	if (found === undefined) throw new Error(`no reading for ${zoneId}`);
	return found;
}

describe("describeZoneForFan", () => {
	it("renders one line, prefixed for a list", () => {
		for (const zone of ALL_READINGS) {
			const line = describeZoneForFan(zone);
			expect(line.startsWith("- "), line).toBe(true);
			expect(line).not.toContain("\n");
		}
	});

	/** The model is told to reuse these names, so a mangled one is an invented zone. */
	it("names every zone exactly as the topology does", () => {
		for (const zone of ALL_READINGS) {
			expect(describeZoneForFan(zone), zone.zoneId).toContain(zone.name);
		}
	});

	it("reports the reading's own density as a whole percentage", () => {
		for (const zone of ALL_READINGS) {
			expect(describeZoneForFan(zone), zone.zoneId).toContain(`${String(Math.round(zone.density * 100))}% full`);
		}
	});

	it("reports the reading's own alert band", () => {
		for (const zone of ALL_READINGS) {
			expect(describeZoneForFan(zone), zone.zoneId).toContain(`alert ${zone.alert}`);
		}
	});

	/**
	 * A queue is named when there is one and omitted when there is not. Inventing
	 * "0 min queue" would be a fact the fan could act on and the model could
	 * repeat, and it is not one the crowd model asserts.
	 */
	it("states a queue only for a reading that has one", () => {
		for (const zone of ALL_READINGS) {
			const line = describeZoneForFan(zone);
			if (zone.waitMinutes > 0) {
				expect(line, zone.zoneId).toContain(`about ${String(zone.waitMinutes)} min queue`);
			} else {
				expect(line, zone.zoneId).not.toContain("queue");
			}
		}
	});

	it("exercises both the queue and the no-queue branch across the matchday", () => {
		expect(ALL_READINGS.some((z) => z.waitMinutes > 0)).toBe(true);
		expect(ALL_READINGS.some((z) => z.waitMinutes === 0)).toBe(true);
	});

	/** The field a fan needing level access acts on, taken from the topology. */
	it("reports each zone's step-free status as the topology declares it", () => {
		for (const zone of ALL_READINGS) {
			const expected = getZone(zone.zoneId)?.stepFree === true ? "step-free access" : "steps on approach";
			expect(describeZoneForFan(zone), zone.zoneId).toContain(expected);
		}
	});

	it("distinguishes a level gate from a stepped one", () => {
		expect(describeZoneForFan(reading(preMatch, "gate-a"))).toContain("step-free access");
		expect(describeZoneForFan(reading(preMatch, "gate-c"))).toContain("steps on approach");
	});

	/** A fan cannot act on a head count, and the id is not what they read on signage. */
	it("omits the operations-only fields", () => {
		const line = describeZoneForFan(reading(preMatch, "gate-a"));
		expect(line).not.toContain("id: ");
		expect(line).not.toContain("people");
	});
});

describe("describeZoneForOps", () => {
	it("renders one line, prefixed for a list", () => {
		for (const zone of ALL_READINGS) {
			const line = describeZoneForOps(zone);
			expect(line.startsWith("- "), line).toBe(true);
			expect(line).not.toContain("\n");
		}
	});

	/** Advice is only actionable if it names the zone the way the radio does. */
	it("carries every zone's name and id", () => {
		for (const zone of ALL_READINGS) {
			const line = describeZoneForOps(zone);
			expect(line, zone.zoneId).toContain(zone.name);
			expect(line, zone.zoneId).toContain(`id: ${zone.zoneId}`);
		}
	});

	it("reports the reading's own density, head count and alert band", () => {
		for (const zone of ALL_READINGS) {
			const line = describeZoneForOps(zone);
			expect(line, zone.zoneId).toContain(`${String(Math.round(zone.density * 100))}% full`);
			expect(line, zone.zoneId).toContain(`${String(zone.occupancy)} people`);
			expect(line, zone.zoneId).toContain(`alert ${zone.alert}`);
		}
	});

	it("states a queue only for a reading that has one", () => {
		for (const zone of ALL_READINGS) {
			const line = describeZoneForOps(zone);
			if (zone.waitMinutes > 0) {
				expect(line, zone.zoneId).toContain(`queue ${String(zone.waitMinutes)} min`);
			} else {
				expect(line, zone.zoneId).not.toContain("queue");
			}
		}
	});
});

describe("describeTrendForOps", () => {
	it("renders one line, prefixed for a list", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForOps(trend);
			expect(line.startsWith("- "), line).toBe(true);
			expect(line).not.toContain("\n");
		}
	});

	/** The advisor is told to name zones exactly as the prompt does. */
	it("carries every zone's name and id", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForOps(trend);
			expect(line, trend.zoneId).toContain(trend.name);
			expect(line, trend.zoneId).toContain(`id: ${trend.zoneId}`);
		}
	});

	/**
	 * Both endpoints, always. "Rising" alone is not an action — the level it is
	 * rising to is what decides whether the duty manager staffs the zone or
	 * watches it, and the model can only cite a figure it was given.
	 */
	it("states both the present and the projected density", () => {
		for (const trend of ALL_TRENDS) {
			const now = Math.round(trend.density * 100);
			const then = Math.round(trend.projectedDensity * 100);
			expect(describeTrendForOps(trend), trend.zoneId).toContain(`${String(now)}% → ${String(then)}%`);
		}
	});

	it("reports the reading's own trend classification", () => {
		for (const trend of ALL_TRENDS) {
			expect(describeTrendForOps(trend), trend.zoneId).toContain(`, ${trend.trend})`);
		}
	});

	/** A delta printed bare reads as a level; the sign is what makes it a movement. */
	it("signs the delta explicitly and derives it from the two figures it prints", () => {
		for (const trend of ALL_TRENDS) {
			const now = Math.round(trend.density * 100);
			const then = Math.round(trend.projectedDensity * 100);
			const delta = then - now;
			const expected = delta > 0 ? `+${String(delta)} pts` : `${String(delta)} pts`;
			expect(describeTrendForOps(trend), trend.zoneId).toContain(expected);
		}
	});

	/**
	 * The band transition is the event worth acting on, so it is stated when it
	 * happens and omitted when it does not — fifteen zones restating the band
	 * they are already in would bury the one that is about to go critical.
	 */
	it("names the alert transition only for a zone whose band actually changes", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForOps(trend);
			if (trend.projectedAlert === trend.alert) {
				expect(line, trend.zoneId).not.toContain("alert ");
			} else {
				expect(line, trend.zoneId).toContain(`alert ${trend.alert} → ${trend.projectedAlert}`);
			}
		}
	});

	it("states a queue transition only for a zone that has a queue at either end", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForOps(trend);
			if (trend.waitMinutes > 0 || trend.projectedWaitMinutes > 0) {
				expect(line, trend.zoneId).toContain(
					`queue ${String(trend.waitMinutes)} → ${String(trend.projectedWaitMinutes)} min`,
				);
			} else {
				expect(line, trend.zoneId).not.toContain("queue");
			}
		}
	});

	/** Both branches of each optional clause must actually occur in a real matchday. */
	it("exercises the changing and unchanging branch of both optional clauses", () => {
		expect(ALL_TRENDS.some((t) => t.projectedAlert !== t.alert)).toBe(true);
		expect(ALL_TRENDS.some((t) => t.projectedAlert === t.alert)).toBe(true);
		expect(ALL_TRENDS.some((t) => t.waitMinutes > 0 || t.projectedWaitMinutes > 0)).toBe(true);
		expect(ALL_TRENDS.some((t) => t.waitMinutes === 0 && t.projectedWaitMinutes === 0)).toBe(true);
	});
});

describe("describeTrendForFan", () => {
	it("renders one line, prefixed for a list", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForFan(trend);
			expect(line.startsWith("- "), line).toBe(true);
			expect(line).not.toContain("\n");
		}
	});

	/**
	 * A steward is briefed in words, not bands. An alert name, a zone id or a
	 * percentage-point delta is vocabulary the volunteer would have to be trained
	 * to read — and the model is told to reuse the terms it is given.
	 *
	 * The zone id is checked via the `id: ` label rather than by searching for
	 * the bare id: several ids are ordinary English substrings (`bus` occurs in
	 * "busy"), so a raw substring sweep would fail on text that is perfectly
	 * fine. The pinned `food-ne` case below covers genuine id leakage.
	 */
	it("carries no operations vocabulary a volunteer would not know", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForFan(trend);
			expect(line, trend.zoneId).not.toContain("alert");
			expect(line, trend.zoneId).not.toContain("id: ");
			expect(line, trend.zoneId).not.toContain("pts");
			// The post is "this post" — a steward is stood at it and does not need
			// it named the way the radio names it.
			expect(line, trend.zoneId).not.toContain(trend.name);
		}
	});

	/** The direction has to be the reading's own, stated as a plain movement. */
	it("states the direction the reading classifies, in words", () => {
		const phrases: Readonly<Record<TrendReading["trend"], string>> = {
			rising: "getting busier",
			falling: "getting quieter",
			steady: "staying about as busy as it is now",
		};
		for (const trend of ALL_TRENDS) {
			expect(describeTrendForFan(trend), trend.zoneId).toContain(phrases[trend.trend]);
		}
	});

	/**
	 * The horizon is deliberately not written into this line — it would be a
	 * second, unchecked copy of `FORECAST_HORIZON_MINUTES`, and the prompt header
	 * already states it. This is the assertion that keeps it that way.
	 *
	 * The property is "describes a movement, not a duration", so it is asserted
	 * as the absence of a duration phrase rather than of the digits "15": the
	 * queue clause legitimately prints figures like `15.2 min`, and a bare digit
	 * sweep would fail on those while still passing a hard-coded "quarter of an
	 * hour".
	 */
	it("describes a movement without restating the forecast horizon", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForFan(trend);
			expect(line, trend.zoneId).not.toContain("minutes");
			expect(line, trend.zoneId).not.toContain("hour");
			expect(line, trend.zoneId).not.toContain("next");
		}
	});

	it("states the projected queue only for a post that will have one", () => {
		for (const trend of ALL_TRENDS) {
			const line = describeTrendForFan(trend);
			if (trend.projectedWaitMinutes > 0) {
				expect(line, trend.zoneId).toContain(`about a ${String(trend.projectedWaitMinutes)} min queue`);
			} else {
				expect(line, trend.zoneId).not.toContain("queue");
			}
		}
	});

	it("reports the projected density as a whole percentage", () => {
		for (const trend of ALL_TRENDS) {
			expect(describeTrendForFan(trend), trend.zoneId).toContain(
				`about ${String(Math.round(trend.projectedDensity * 100))}% full`,
			);
		}
	});
});

describe("the trend renderings", () => {
	/** They exist as two functions because they say different things. */
	it("differ for every zone", () => {
		for (const trend of forecastAt(30, FORECAST_HORIZON_MINUTES).zones) {
			expect(describeTrendForFan(trend), trend.zoneId).not.toBe(describeTrendForOps(trend));
		}
	});

	/**
	 * Whatever else differs, the projection must not: the steward at Gate A and
	 * the duty manager watching Gate A are looking at the same gate, and a
	 * briefing that disagreed with the control room about which way it is heading
	 * is worse than no briefing.
	 */
	it("agree on the projected density and the direction they report", () => {
		for (const trend of forecastAt(30, FORECAST_HORIZON_MINUTES).zones) {
			const pct = String(Math.round(trend.projectedDensity * 100));
			expect(describeTrendForOps(trend), trend.zoneId).toContain(`→ ${pct}%`);
			expect(describeTrendForFan(trend), trend.zoneId).toContain(`about ${pct}% full`);
		}
	});

	/** A concrete pair, pinned: the half-time rush as each audience is told it. */
	it("describe the concessions rush in each audience's own register", () => {
		const trend = trendFor(80, "food-ne");
		expect(trend.trend).toBe("rising");

		expect(describeTrendForOps(trend)).toContain("id: food-ne");
		expect(describeTrendForOps(trend)).toContain("rising");
		expect(describeTrendForFan(trend)).toContain("getting busier");
		expect(describeTrendForFan(trend)).not.toContain("food-ne");
	});
});

describe("the two renderings", () => {
	/** They exist as two functions because they say different things. */
	it("differ for every zone", () => {
		for (const zone of preMatch.zones) {
			expect(describeZoneForFan(zone), zone.zoneId).not.toBe(describeZoneForOps(zone));
		}
	});

	/**
	 * Whatever else differs, the numbers must not: the fan panel and the ops
	 * console are documented as reading the same venue, and a density that
	 * disagreed between them would make one of them a liar.
	 */
	it("agree on the density and alert they report", () => {
		for (const zone of preMatch.zones) {
			const pct = `${String(Math.round(zone.density * 100))}% full`;
			expect(describeZoneForFan(zone)).toContain(pct);
			expect(describeZoneForOps(zone)).toContain(pct);
			expect(describeZoneForFan(zone)).toContain(`alert ${zone.alert}`);
			expect(describeZoneForOps(zone)).toContain(`alert ${zone.alert}`);
		}
	});

	it("cover the whole topology", () => {
		expect(preMatch.zones.length).toBe(ZONES.length);
	});
});
