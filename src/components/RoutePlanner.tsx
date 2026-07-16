"use client";

import { useId, useState, type ReactElement } from "react";

import { useAsyncAction } from "@/hooks/use-async-action";
import { fetchRoute, type WayfindingResponse } from "@/lib/client";
import { ZONES } from "@/lib/venue";

/** Default origin: the rail link, where most fans arrive. */
const DEFAULT_ORIGIN = "rail";
/** Default destination: the north stand, the busiest seated zone. */
const DEFAULT_DESTINATION = "stand-n";

/**
 * Crowd-aware accessible route planning.
 *
 * Posts two zones and the step-free constraint to `POST /api/wayfinding`, which
 * runs Dijkstra over the walkway graph weighted by live congestion and then has
 * Gemini narrate the result. The path is the product; the narration is a bonus.
 * So when `directionsAvailable` is false the route still renders in full, with
 * the missing narration stated rather than papered over.
 */
export function RoutePlanner(): ReactElement {
	const originId = useId();
	const destinationId = useId();
	const stepFreeId = useId();

	const [origin, setOrigin] = useState(DEFAULT_ORIGIN);
	const [destination, setDestination] = useState(DEFAULT_DESTINATION);
	const [stepFreeOnly, setStepFreeOnly] = useState(false);
	const { state, run } = useAsyncAction<WayfindingResponse>();

	const busy = state.status === "loading";

	const submit = (): void => {
		if (busy) return;
		run((signal) => fetchRoute(origin, destination, stepFreeOnly, signal));
	};

	return (
		<div className="planner">
			<form
				className="form form--inline"
				onSubmit={(event): void => {
					event.preventDefault();
					submit();
				}}
			>
				<div className="field">
					<label className="field__label" htmlFor={originId}>
						From
					</label>
					<select
						id={originId}
						className="field__control"
						value={origin}
						onChange={(event): void => {
							setOrigin(event.target.value);
						}}
					>
						{ZONES.map((zone) => (
							<option key={zone.id} value={zone.id}>
								{zone.name}
							</option>
						))}
					</select>
				</div>

				<div className="field">
					<label className="field__label" htmlFor={destinationId}>
						To
					</label>
					<select
						id={destinationId}
						className="field__control"
						value={destination}
						onChange={(event): void => {
							setDestination(event.target.value);
						}}
					>
						{ZONES.map((zone) => (
							<option key={zone.id} value={zone.id}>
								{zone.name}
							</option>
						))}
					</select>
				</div>

				<div className="field field--checkbox">
					<input
						id={stepFreeId}
						className="field__checkbox"
						type="checkbox"
						checked={stepFreeOnly}
						onChange={(event): void => {
							setStepFreeOnly(event.target.checked);
						}}
					/>
					<label className="field__label field__label--inline" htmlFor={stepFreeId}>
						Step-free route only
					</label>
				</div>

				<button type="submit" className="button button--primary" disabled={busy}>
					{busy ? "Planning…" : "Plan route"}
				</button>
			</form>

			<div className="result" aria-busy={busy} aria-live="polite">
				{state.status === "loading" && <p className="result__pending">Computing the least-congested path…</p>}

				{/*
				 * The server's own message is rendered verbatim. It already
				 * distinguishes "no step-free path exists" from "no path exists" and
				 * names the fallback, and it describes the request that was actually
				 * sent — re-deriving the wording from the checkbox would misreport
				 * the result if the operator toggled it after asking.
				 */}
				{state.status === "error" && (
					<p className="notice notice--error" role="alert">
						{state.error.message}
					</p>
				)}

				{state.status === "ok" && (
					<div className="route">
						<div className="route__head">
							<span className={state.data.route.stepFree ? "badge badge--normal" : "badge badge--high"}>
								{state.data.route.stepFree ? "Step-free" : "Includes steps"}
							</span>
							<span className="route__metric">{state.data.route.metres} m</span>
							<span className="route__metric">{state.data.route.minutes} min walk</span>
							<span className="route__metric">
								{Math.round(state.data.route.meanDensity * 100)}% mean density
							</span>
						</div>

						<ol className="route__path">
							{state.data.route.names.map((name, index) => (
								<li key={state.data.route.path[index] ?? name} className="route__stop">
									{name}
								</li>
							))}
						</ol>

						{state.data.directions === null ? (
							<p className="notice notice--warn">
								Turn-by-turn directions unavailable — the AI narration could not be generated. The route
								above is computed by the venue router and is unaffected.
							</p>
						) : (
							<>
								<p className="model-output">{state.data.directions}</p>
								<p className="attribution">
									Directions written by Google {state.data.model}; the path itself is computed by the
									venue router, not the model.
								</p>
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
