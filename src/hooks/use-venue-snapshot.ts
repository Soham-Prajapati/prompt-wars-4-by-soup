"use client";

/**
 * Polling hook for the live venue snapshot.
 *
 * The crowd model advances with wall-clock time, so the console re-reads
 * `GET /api/snapshot` on a fixed interval. The hook is deliberately the *only*
 * poller in the app: it is consumed once, by `ConsoleProvider`, and every panel
 * reads the result from context. A per-component poller would multiply requests
 * and let two panels disagree about the same instant.
 *
 * A failed poll keeps the last good snapshot on screen and surfaces the error
 * alongside it, because a stale-but-labelled reading is more useful to a duty
 * manager than an empty map.
 */
import { useEffect, useState } from "react";

import { fetchSnapshot, type ApiError } from "@/lib/client";
import { type VenueSnapshot } from "@/lib/crowd-model";

/** Interval between snapshot polls, in milliseconds. */
export const SNAPSHOT_POLL_MS = 4000;

/** Reactive state of the snapshot feed. */
export interface SnapshotState {
	/** Most recent successful snapshot, or `null` before the first response. */
	readonly snapshot: VenueSnapshot | null;
	/** Error from the most recent poll, or `null` when it succeeded. */
	readonly error: ApiError | null;
	/** True until the first poll settles. */
	readonly loading: boolean;
}

/** Subscribe to the venue snapshot feed, polling every {@link SNAPSHOT_POLL_MS}. */
export function useVenueSnapshot(): SnapshotState {
	const [state, setState] = useState<SnapshotState>({ snapshot: null, error: null, loading: true });

	useEffect(() => {
		const controller = new AbortController();

		const poll = async (): Promise<void> => {
			const result = await fetchSnapshot(controller.signal);
			if (controller.signal.aborted) return;

			setState((previous) =>
				result.ok
					? { snapshot: result.data, error: null, loading: false }
					: { snapshot: previous.snapshot, error: result.error, loading: false },
			);
		};

		void poll();
		const timer = setInterval(() => {
			void poll();
		}, SNAPSHOT_POLL_MS);

		return (): void => {
			clearInterval(timer);
			controller.abort();
		};
	}, []);

	return state;
}
