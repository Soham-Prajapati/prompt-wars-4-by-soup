"use client";

import { useId, useState, type ReactElement } from "react";

import { useAsyncAction } from "@/hooks/use-async-action";
import { fetchItinerary, type ApiError, type ItineraryResponse } from "@/lib/client";
import { HOST_DISTRICTS, INTERESTS } from "@/lib/itinerary";
import { DEFAULT_LANGUAGE, LANGUAGES, tagFor } from "@/lib/languages";
import { getZone } from "@/lib/venue";
import { type Route } from "@/lib/wayfinding";

/** District selected before the fan picks one. */
const DEFAULT_DISTRICT = "manhattan-midtown";

/** Most interests the API will accept, per `itineraryRequestSchema`. */
const MAX_INTERESTS = 4;

/** Message for a failed itinerary request; an absent model key is named as such. */
function itineraryErrorMessage(error: ApiError): string {
	if (error.code === "AI_UNAVAILABLE") {
		return "Itinerary planner unavailable — GEMINI_API_KEY not configured on the server. Plans cannot be written until a model key is set.";
	}
	return error.message;
}

/** The computed in-bowl walk, rendered as the route it is. */
function PlanRoute({ route }: { readonly route: Route }): ReactElement {
	return (
		<div className="route">
			<div className="route__head">
				<span className={route.stepFree ? "badge badge--normal" : "badge badge--high"}>
					{route.stepFree ? "Step-free" : "Includes steps"}
				</span>
				<span className="route__metric">{route.metres} m</span>
				<span className="route__metric">{route.minutes} min walk</span>
			</div>
			<ol className="route__path">
				{route.names.map((name, index) => (
					<li key={route.path[index] ?? name} className="route__stop">
						{name}
					</li>
				))}
			</ol>
		</div>
	);
}

/**
 * A settled itinerary: the computed plan first, then the written version.
 *
 * The order is the point. The departure time, the gate and the walk come from
 * the venue model and are the part a fan can act on, so they render whether or
 * not the prose arrived; the itinerary is presented as narration of them.
 */
function PlanResult({ data }: { readonly data: ItineraryResponse }): ReactElement {
	const { plan, itinerary, language, model } = data;
	const gate = getZone(plan.arrivalGate);

	return (
		<div className="itinerary__plan">
			<dl className="itinerary__stats">
				<div className="stat">
					<dt className="stat__label">Leave your hotel</dt>
					<dd className="stat__value">
						{plan.departureMinutesBeforeKickoff}
						<span className="stat__unit"> min before kick-off</span>
					</dd>
				</div>
				<div className="stat">
					<dt className="stat__label">Travel</dt>
					<dd className="stat__value">
						{plan.district.transitMinutes}
						<span className="stat__unit"> min by {plan.district.transitMode}</span>
					</dd>
				</div>
				<div className="stat">
					<dt className="stat__label">Enter at</dt>
					<dd className="stat__value">{gate?.name ?? plan.arrivalGate}</dd>
				</div>
			</dl>

			{plan.route === null ? (
				<p className="notice notice--warn">
					No step-free walking path to the North Stand exists — the stand itself and both walkways into it have
					steps. Your departure time and gate above are unaffected; ask staff at the gate for accessible-seating
					assistance when you arrive.
				</p>
			) : (
				<PlanRoute route={plan.route} />
			)}

			{itinerary === null ? (
				<p className="notice notice--warn">
					Written itinerary unavailable — the AI plan could not be generated. The departure time, gate and route
					above are computed by the venue model and are unaffected.
				</p>
			) : (
				<>
					<p className="model-output" dir="auto" lang={tagFor(language)}>
						{itinerary}
					</p>
					<p className="attribution">
						Written in {language} by Google {model}. The departure time, gate and walking route are computed by
						the venue model, not by the model.
					</p>
				</>
			)}
		</div>
	);
}

/**
 * Personalised end-to-end matchday planning.
 *
 * Posts a district, interests, the accessibility constraint and a language to
 * `POST /api/itinerary`, which computes the departure time, the arrival gate and
 * the in-bowl walk before asking Gemini to arrange them into a timed plan in the
 * fan's own language.
 */
export function FanItinerary(): ReactElement {
	const districtId = useId();
	const languageId = useId();
	const stepFreeId = useId();
	const interestsId = useId();
	const interestsHintId = useId();

	const [district, setDistrict] = useState(DEFAULT_DISTRICT);
	const [interests, setInterests] = useState<readonly string[]>([]);
	const [stepFreeNeeded, setStepFreeNeeded] = useState(false);
	const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
	const { state, run } = useAsyncAction<ItineraryResponse>();

	const busy = state.status === "loading";
	const noInterests = interests.length === 0;
	const atInterestLimit = interests.length >= MAX_INTERESTS;

	const toggleInterest = (interest: string): void => {
		setInterests((current) => {
			if (current.includes(interest)) return current.filter((i) => i !== interest);
			if (current.length >= MAX_INTERESTS) return current;
			return [...current, interest];
		});
	};

	const submit = (): void => {
		if (noInterests || busy) return;
		run((signal) => fetchItinerary(district, interests, stepFreeNeeded, language, signal));
	};

	return (
		<div className="itinerary">
			<form
				className="form"
				onSubmit={(event): void => {
					event.preventDefault();
					submit();
				}}
			>
				<div className="field">
					<label className="field__label" htmlFor={districtId}>
						Where are you staying?
					</label>
					<select
						id={districtId}
						className="field__control"
						value={district}
						onChange={(event): void => {
							setDistrict(event.target.value);
						}}
					>
						{HOST_DISTRICTS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.name} — {option.transitMinutes} min by {option.transitMode}
							</option>
						))}
					</select>
				</div>

				<fieldset className="field itinerary__fieldset">
					<legend className="field__label">What do you enjoy?</legend>
					<p className="field__hint" id={interestsHintId}>
						Choose 1–{MAX_INTERESTS}. These steer the pre-match suggestion only — the timings and the route are
						computed from live venue data either way.
					</p>
					<div className="itinerary__options">
						{INTERESTS.map((interest) => {
							const checked = interests.includes(interest);
							return (
								<div className="itinerary__option" key={interest}>
									<input
										id={`${interestsId}-${interest}`}
										className="field__checkbox"
										type="checkbox"
										checked={checked}
										disabled={!checked && atInterestLimit}
										aria-describedby={interestsHintId}
										onChange={(): void => {
											toggleInterest(interest);
										}}
									/>
									<label
										className="field__label field__label--inline"
										htmlFor={`${interestsId}-${interest}`}
									>
										{interest}
									</label>
								</div>
							);
						})}
					</div>
				</fieldset>

				<div className="field field--checkbox">
					<input
						id={stepFreeId}
						className="field__checkbox"
						type="checkbox"
						checked={stepFreeNeeded}
						onChange={(event): void => {
							setStepFreeNeeded(event.target.checked);
						}}
					/>
					<label className="field__label field__label--inline" htmlFor={stepFreeId}>
						I need step-free access
					</label>
				</div>

				<div className="field">
					<label className="field__label" htmlFor={languageId}>
						Itinerary language
					</label>
					<select
						id={languageId}
						className="field__control"
						value={language}
						onChange={(event): void => {
							setLanguage(event.target.value);
						}}
					>
						{LANGUAGES.map((option) => (
							<option key={option.tag} value={option.label} lang={option.tag}>
								{option.label}
							</option>
						))}
					</select>
				</div>

				<button type="submit" className="button button--primary" disabled={noInterests || busy}>
					{busy ? "Planning…" : "Plan my matchday"}
				</button>
			</form>

			<div className="result" aria-busy={busy} aria-live="polite">
				{state.status === "loading" && <p className="result__pending">Building your matchday plan…</p>}

				{state.status === "error" && (
					<p className="notice notice--error" role="alert">
						{itineraryErrorMessage(state.error)}
					</p>
				)}

				{state.status === "ok" && <PlanResult data={state.data} />}
			</div>
		</div>
	);
}
