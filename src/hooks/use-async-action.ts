"use client";

/**
 * State machine for a user-triggered API call.
 *
 * The advisor, the assistant and the route planner all do the same thing: fire
 * one request on demand, show a busy state, then show either a result or an
 * error. Expressing that once here keeps three panels from each inventing their
 * own idea of "loading", and puts the two easy-to-forget behaviours — cancelling
 * a superseded request, and cancelling on unmount — in a single place.
 *
 * The state is a discriminated union rather than parallel booleans, so an
 * impossible render (busy *and* holding a result) cannot be expressed.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type ApiError, type ApiResult } from "@/lib/client";

/** Lifecycle of a single request. */
export type AsyncState<T> =
	| { readonly status: "idle" }
	| { readonly status: "loading" }
	| { readonly status: "ok"; readonly data: T }
	| { readonly status: "error"; readonly error: ApiError };

/** A request runner plus the state of its most recent invocation. */
export interface AsyncAction<T> {
	readonly state: AsyncState<T>;
	/**
	 * Start a request, cancelling any still in flight.
	 *
	 * @param call Performs the request; must honour the supplied `AbortSignal`.
	 */
	readonly run: (call: (signal: AbortSignal) => Promise<ApiResult<T>>) => void;
}

/** Track one on-demand API call. */
export function useAsyncAction<T>(): AsyncAction<T> {
	const [state, setState] = useState<AsyncState<T>>({ status: "idle" });
	const controllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		return (): void => {
			controllerRef.current?.abort();
		};
	}, []);

	const run = useCallback((call: (signal: AbortSignal) => Promise<ApiResult<T>>): void => {
		controllerRef.current?.abort();
		const controller = new AbortController();
		controllerRef.current = controller;
		setState({ status: "loading" });

		const execute = async (): Promise<void> => {
			const result = await call(controller.signal);
			// A superseded or unmounted request must not overwrite newer state.
			if (controller.signal.aborted) return;
			setState(result.ok ? { status: "ok", data: result.data } : { status: "error", error: result.error });
		};

		void execute();
	}, []);

	return { state, run };
}
