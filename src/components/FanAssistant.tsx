"use client";

import { useId, useState, type ReactElement } from "react";

import { useAsyncAction } from "@/hooks/use-async-action";
import { fetchAssistantAnswer, type ApiError, type AssistantResponse } from "@/lib/client";
import { DEFAULT_LANGUAGE, LANGUAGES, tagFor } from "@/lib/languages";

/** Shortest question the API will accept, per `assistantRequestSchema`. */
const MIN_QUESTION_LENGTH = 3;
/** Longest question the API will accept, per `assistantRequestSchema`. */
const MAX_QUESTION_LENGTH = 500;

/** Message for a failed assistant request; an absent model key is named as such. */
function assistantErrorMessage(error: ApiError): string {
	if (error.code === "AI_UNAVAILABLE") {
		return "Fan assistant unavailable — GEMINI_API_KEY not configured on the server. Questions cannot be answered until a model key is set.";
	}
	return error.message;
}

/**
 * Multilingual fan-facing question answering.
 *
 * Posts a question and a target language to `POST /api/assistant`, which
 * answers from the live snapshot in the requested language. The answer carries
 * its own `lang` and `dir="auto"`, so a right-to-left reply lays out correctly
 * and a screen reader switches to the right voice instead of reading Arabic
 * with an English one.
 */
export function FanAssistant(): ReactElement {
	const questionId = useId();
	const languageId = useId();
	const hintId = useId();

	const [question, setQuestion] = useState("");
	const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
	const { state, run } = useAsyncAction<AssistantResponse>();

	const busy = state.status === "loading";
	const tooShort = question.trim().length < MIN_QUESTION_LENGTH;

	const submit = (): void => {
		if (tooShort || busy) return;
		run((signal) => fetchAssistantAnswer(question.trim(), language, signal));
	};

	return (
		<div className="assistant">
			<form
				className="form"
				onSubmit={(event): void => {
					event.preventDefault();
					submit();
				}}
			>
				<div className="field">
					<label className="field__label" htmlFor={questionId}>
						Fan question
					</label>
					<textarea
						id={questionId}
						className="field__control field__control--textarea"
						value={question}
						onChange={(event): void => {
							setQuestion(event.target.value);
						}}
						rows={3}
						maxLength={MAX_QUESTION_LENGTH}
						aria-describedby={hintId}
						placeholder="Which gate has the shortest queue right now?"
					/>
					<p className="field__hint" id={hintId}>
						{MIN_QUESTION_LENGTH}–{MAX_QUESTION_LENGTH} characters. Answers are drawn from the live simulated
						venue state only.
					</p>
				</div>

				<div className="field">
					<label className="field__label" htmlFor={languageId}>
						Answer language
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

				<button type="submit" className="button button--primary" disabled={tooShort || busy}>
					{busy ? "Asking…" : "Ask the assistant"}
				</button>
			</form>

			<div className="result" aria-busy={busy} aria-live="polite">
				{state.status === "loading" && <p className="result__pending">Composing an answer…</p>}

				{state.status === "error" && (
					<p className="notice notice--error" role="alert">
						{assistantErrorMessage(state.error)}
					</p>
				)}

				{state.status === "ok" && (
					<>
						<p className="model-output" dir="auto" lang={tagFor(state.data.language)}>
							{state.data.answer}
						</p>
						<p className="attribution">
							Answered in {state.data.language} by Google {state.data.model}, grounded in the live snapshot.
						</p>
					</>
				)}
			</div>
		</div>
	);
}
