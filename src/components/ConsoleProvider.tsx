"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";

import { useVenueSnapshot, type SnapshotState } from "@/hooks/use-venue-snapshot";

/** The two pieces of state every console panel shares. */
interface ConsoleContextValue extends SnapshotState {
	/** Zone the operator has selected, or `null` when the whole venue is in view. */
	readonly selectedZoneId: string | null;
	/** Select a zone, or pass `null` to clear the selection. */
	readonly selectZone: (zoneId: string | null) => void;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

/**
 * Shared state for the operations console.
 *
 * Holds the single snapshot poller and the operator's zone selection, so the
 * map, the zone panel and the advisor all describe the same zone at the same
 * instant. This exists as a provider rather than as props from the page because
 * the page itself is a server component: the state has to start at the first
 * client boundary, and lifting it here keeps every panel below it independently
 * mountable.
 */
export function ConsoleProvider({ children }: { readonly children: ReactNode }): ReactElement {
	const snapshotState = useVenueSnapshot();
	const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

	const selectZone = useCallback((zoneId: string | null): void => {
		setSelectedZoneId(zoneId);
	}, []);

	const value = useMemo<ConsoleContextValue>(
		() => ({ ...snapshotState, selectedZoneId, selectZone }),
		[snapshotState, selectedZoneId, selectZone],
	);

	return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

/**
 * Read the shared console state.
 *
 * @throws When called outside a {@link ConsoleProvider}, which is a wiring bug
 * rather than a runtime condition worth rendering around.
 */
export function useConsole(): ConsoleContextValue {
	const value = useContext(ConsoleContext);
	if (value === null) throw new Error("useConsole must be called within a ConsoleProvider.");
	return value;
}
