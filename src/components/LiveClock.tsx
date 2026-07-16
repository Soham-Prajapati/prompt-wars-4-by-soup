"use client";

import { type ReactElement } from "react";

import { useConsole } from "@/components/ConsoleProvider";
import { SNAPSHOT_POLL_MS } from "@/hooks/use-venue-snapshot";
import { type MatchPhase } from "@/lib/crowd-model";

/** Operator-facing names for the matchday phases. */
const PHASE_LABELS: Readonly<Record<MatchPhase, string>> = {
	"pre-match": "Pre-match",
	"first-half": "First half",
	"half-time": "Half-time",
	"second-half": "Second half",
	egress: "Egress",
};

/** Seconds between polls, for the on-screen cadence note. */
const POLL_SECONDS = SNAPSHOT_POLL_MS / 1000;

/**
 * Matchday status strip: phase, Fan Friction Score and mean density.
 *
 * Renders the shared snapshot feed that `ConsoleProvider` polls every four
 * seconds. It is not wired with `aria-live`: the values change on every poll,
 * and announcing them continuously would bury the results a user actually asked
 * for. The panels that answer a request announce themselves instead.
 */
export function LiveClock(): ReactElement {
	const { snapshot, error, loading } = useConsole();

	return (
		<div className="clock">
			{snapshot === null ? (
				<p className="clock__pending">{loading ? "Reading venue state…" : "Venue state unavailable."}</p>
			) : (
				<dl className="clock__stats">
					<div className="clock__stat">
						<dt className="clock__label">Phase</dt>
						<dd className="clock__value">{PHASE_LABELS[snapshot.phase]}</dd>
					</div>
					<div className="clock__stat">
						<dt className="clock__label">Match clock</dt>
						<dd className="clock__value">
							{snapshot.clockMinutes}
							<span className="clock__unit"> min since gates</span>
						</dd>
					</div>
					<div className="clock__stat">
						<dt className="clock__label">Fan Friction Score</dt>
						<dd className="clock__value">
							{snapshot.frictionScore}
							<span className="clock__unit"> / 100 — lower is better</span>
						</dd>
					</div>
					<div className="clock__stat">
						<dt className="clock__label">Mean density</dt>
						<dd className="clock__value">{Math.round(snapshot.meanDensity * 100)}%</dd>
					</div>
				</dl>
			)}

			<p className="clock__source">
				Simulated sensor feed — deterministic model, no live hardware. Refreshed every {POLL_SECONDS}s.
			</p>

			{error !== null && (
				<p className="notice notice--warn" role="status">
					Snapshot refresh failed: {error.message}
					{snapshot !== null && " Showing the last reading received."}
				</p>
			)}
		</div>
	);
}
