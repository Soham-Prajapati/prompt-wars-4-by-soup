"use client";

import { type ReactElement } from "react";

import { useConsole } from "@/components/ConsoleProvider";
import { type ZoneKind, getZone } from "@/lib/venue";

/** Operator-facing names for the zone categories in the venue topology. */
const KIND_LABELS: Readonly<Record<ZoneKind, string>> = {
	gate: "Entry gate",
	concourse: "Concourse",
	stand: "Seating stand",
	concession: "Concessions",
	transit: "Transit link",
	medical: "Medical post",
};

/**
 * Detail readout for the zone selected on the map.
 *
 * Restates the marker's reading as text — density, occupancy, queue and
 * step-free status — because the map communicates shape and severity, and an
 * operator acting on it needs the numbers behind the colour.
 */
export function ZonePanel(): ReactElement {
	const { snapshot, selectedZoneId } = useConsole();

	const reading = snapshot?.zones.find((zone) => zone.zoneId === selectedZoneId) ?? null;
	const zone = selectedZoneId === null ? undefined : getZone(selectedZoneId);

	if (reading === null || zone === undefined) {
		return (
			<p className="panel-placeholder">
				No zone selected. Choose a marker on the map to see its density, queue and access detail.
			</p>
		);
	}

	return (
		<div className="zone-detail">
			<div className="zone-detail__head">
				<h3 className="zone-detail__name">{reading.name}</h3>
				<span className={`badge badge--${reading.alert}`}>{reading.alert}</span>
			</div>

			<dl className="zone-detail__stats">
				<div className="stat">
					<dt className="stat__label">Density</dt>
					<dd className="stat__value">{Math.round(reading.density * 100)}%</dd>
				</div>
				<div className="stat">
					<dt className="stat__label">Occupancy</dt>
					<dd className="stat__value">
						{reading.occupancy.toLocaleString("en")}
						<span className="stat__unit"> of {zone.capacity.toLocaleString("en")}</span>
					</dd>
				</div>
				<div className="stat">
					<dt className="stat__label">Queue wait</dt>
					<dd className="stat__value">
						{reading.waitMinutes > 0 ? `${String(reading.waitMinutes)} min` : "No queue"}
					</dd>
				</div>
				<div className="stat">
					<dt className="stat__label">Zone type</dt>
					<dd className="stat__value">{KIND_LABELS[reading.kind]}</dd>
				</div>
			</dl>

			<p className={zone.stepFree ? "access access--step-free" : "access access--stepped"}>
				{zone.stepFree
					? "Step-free: this zone is reachable without stairs or escalators."
					: "Not step-free: the approach to this zone includes stairs or escalators."}
			</p>
		</div>
	);
}
