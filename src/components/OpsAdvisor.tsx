"use client";

import { useId, useState, type ReactElement } from "react";

import { useConsole } from "@/components/ConsoleProvider";
import { useAsyncAction } from "@/hooks/use-async-action";
import { AUDIENCES, AUDIENCE_LABELS, DEFAULT_AUDIENCE, isKnownAudience, type Audience } from "@/lib/audience";
import { fetchAdvice, type AdvisorResponse, type ApiError } from "@/lib/client";
import { getZone } from "@/lib/venue";

/**
 * Message for a failed advice request.
 *
 * `AI_UNAVAILABLE` is called out by name because it is not a fault the operator
 * can retry away — it means the deployment has no model key — and saying so is
 * the only honest option. Inventing plausible actions to fill the panel would
 * put unattributed text in front of someone making crowd-safety decisions.
 */
function adviceErrorMessage(error: ApiError): string {
	if (error.code === "AI_UNAVAILABLE") {
		return "AI advisor unavailable — GEMINI_API_KEY not configured on the server. No recommendations can be generated; the zone readings and the outlook above are unaffected.";
	}
	return error.message;
}

/** Button text per audience, naming the document that is about to be produced. */
const SUBMIT_LABELS: Readonly<Record<Audience, string>> = {
	"duty-manager": "Get AI recommendations",
	steward: "Brief the steward",
};

/** Pending text per audience; a steward is not waiting on "prioritised actions". */
const PENDING_LABELS: Readonly<Record<Audience, string>> = {
	"duty-manager": "Generating prioritised actions…",
	steward: "Writing the post briefing…",
};

/**
 * AI decision support for the people on shift.
 *
 * Sends the operator's current focus zone and the chosen audience to
 * `POST /api/advisor`, which grounds a Gemini prompt in the same snapshot the
 * map is drawing — and the same forecast the status strip is showing — then
 * renders the returned text verbatim. Nothing in this panel is generated
 * client-side: if the model does not answer, the panel says why.
 *
 * The audience control is here rather than in a separate panel because the two
 * documents answer the same question from the same data; only the reader
 * changes. A steward briefing needs a post to be about, so the zone selection
 * stops being an optional weighting and becomes required — which the panel says
 * plainly instead of letting the server reject the request.
 */
export function OpsAdvisor(): ReactElement {
	const { selectedZoneId } = useConsole();
	const { state, run } = useAsyncAction<AdvisorResponse>();
	const audienceId = useId();

	const [audience, setAudience] = useState<Audience>(DEFAULT_AUDIENCE);

	const focusZone = selectedZoneId === null ? undefined : getZone(selectedZoneId);
	const busy = state.status === "loading";

	// A steward is briefed about the post they are stood at, so without a zone
	// there is nothing to brief. The server enforces this; disabling the control
	// means the operator learns it before spending a request on it.
	const needsZone = audience === "steward" && selectedZoneId === null;

	return (
		<div className="advisor">
			<div className="advisor__controls">
				<div className="field">
					<label className="field__label" htmlFor={audienceId}>
						Write for
					</label>
					<select
						id={audienceId}
						className="field__control"
						value={audience}
						onChange={(event): void => {
							// The catalogue is the source of both the options and this check,
							// so the state can only ever hold an audience the API accepts —
							// without asserting the cast the DOM's `string` would need.
							const chosen = event.target.value;
							if (isKnownAudience(chosen)) setAudience(chosen);
						}}
					>
						{AUDIENCES.map((option) => (
							<option key={option} value={option}>
								{AUDIENCE_LABELS[option]}
							</option>
						))}
					</select>
				</div>

				<button
					type="button"
					className="button button--primary"
					onClick={(): void => {
						run((signal) => fetchAdvice(selectedZoneId, audience, signal));
					}}
					disabled={busy || needsZone}
				>
					{busy ? "Consulting the model…" : SUBMIT_LABELS[audience]}
				</button>

				<p className="advisor__focus">
					{audience === "steward"
						? focusZone === undefined
							? "Select a zone on the map to brief a steward posted there."
							: `Briefing a steward posted at ${focusZone.name}, in plain language.`
						: focusZone === undefined
							? "Advising across the whole venue. Select a zone on the map to weight the advice towards it."
							: `Advice will be weighted towards ${focusZone.name}.`}
				</p>
			</div>

			<div className="result" aria-busy={busy} aria-live="polite">
				{state.status === "loading" && <p className="result__pending">{PENDING_LABELS[audience]}</p>}

				{state.status === "error" && (
					<p className="notice notice--error" role="alert">
						{adviceErrorMessage(state.error)}
					</p>
				)}

				{state.status === "ok" && (
					<>
						<p className="model-output">{state.data.actions}</p>
						<p className="attribution">
							Generated by Google {state.data.model} for the{" "}
							{state.data.audience === "steward" ? "steward" : "duty manager"}, from the snapshot at Fan
							Friction Score {state.data.snapshot.frictionScore}/100, projected{" "}
							{state.data.forecast.projectedFrictionScore}/100 in {state.data.forecast.horizonMinutes} min.
							{state.data.snapshot.criticalZones.length > 0
								? ` Critical zones at that instant: ${state.data.snapshot.criticalZones.join(", ")}.`
								: " No zones were critical at that instant."}
						</p>
					</>
				)}
			</div>
		</div>
	);
}
