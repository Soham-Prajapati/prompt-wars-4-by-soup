"use client";

import { type ReactElement } from "react";

import { useConsole } from "@/components/ConsoleProvider";
import { TrendIndicator } from "@/components/TrendIndicator";
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
 *
 * The outlook row is the one the map cannot show at all. A marker can only draw
 * the present; whether this zone is filling or emptying is what decides whether
 * an operator acts on it now or watches it, and there is nowhere on a static
 * plot to put that.
 */
export function ZonePanel(): ReactElement {
	const { snapshot, selectedZoneId } = useConsole();

	const reading = snapshot?.zones.find((zone) => zone.zoneId === selectedZoneId) ?? null;
	const zone = selectedZoneId === null ? undefined : getZone(selectedZoneId);

	// Held together rather than read separately, so the horizon rendered in the
	// label is the horizon the trend beside it was actually computed over.
	const forecast = snapshot?.forecast ?? null;
	const trend = forecast?.zones.find((zone) => zone.zoneId === selectedZoneId) ?? null;

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
				{trend !== null && forecast !== null && (
					<div className="stat stat--wide">
						<dt className="stat__label">
							{trend.projectedAlert === reading.alert ? "Outlook" : "Outlook — alert band changes"}
						</dt>
						<dd className="stat__value stat__value--trend">
							<TrendIndicator
								trend={trend.trend}
								detail={
									// The band transition is named only when there is one: an
									// operator scanning for the zone about to go critical should
									// not have to read past fifteen zones restating the band
									// they are already in.
									trend.projectedAlert === reading.alert
										? `${String(Math.round(trend.projectedDensity * 100))}% in ${String(forecast.horizonMinutes)} min`
										: `${String(Math.round(trend.projectedDensity * 100))}% and ${trend.projectedAlert} in ${String(forecast.horizonMinutes)} min`
								}
							/>
						</dd>
					</div>
				)}
			</dl>

			<p className={zone.stepFree ? "access access--step-free" : "access access--stepped"}>
				{zone.stepFree
					? "Step-free: this zone is reachable without stairs or escalators."
					: "Not step-free: the approach to this zone includes stairs or escalators."}
			</p>
		</div>
	);
}
