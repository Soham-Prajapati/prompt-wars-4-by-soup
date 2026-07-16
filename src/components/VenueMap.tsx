"use client";

import { type KeyboardEvent, type ReactElement } from "react";

import { useConsole } from "@/components/ConsoleProvider";
import { type AlertLevel, type ZoneReading } from "@/lib/crowd-model";

/** Radius of a zone marker at 0% density, in viewBox units. */
const RADIUS_MIN = 2.6;
/** Radius of a zone marker at 100% density, in viewBox units. */
const RADIUS_MAX = 7.2;

/** Alert bands in descending severity, used for the legend and the summary. */
const ALERT_ORDER: readonly AlertLevel[] = ["critical", "high", "elevated", "normal"];

/** Human-readable band names and the density range each covers. */
const ALERT_LEGEND: Readonly<Record<AlertLevel, string>> = {
	critical: "Critical — 85% or more",
	high: "High — 65% to 84%",
	elevated: "Elevated — 40% to 64%",
	normal: "Normal — under 40%",
};

/** Marker radius for a density, so that a fuller zone reads as a larger blob. */
function radiusFor(density: number): number {
	return RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * Math.min(1, Math.max(0, density));
}

/** Density as a whole-number percentage. */
function percent(density: number): number {
	return Math.round(density * 100);
}

/**
 * One-sentence description of the whole map for assistive technology.
 *
 * The map's meaning is the distribution of alert levels, so that is what the
 * label states — a screen-reader user should not have to walk fifteen markers
 * to learn whether anything is wrong.
 */
function summarise(zones: readonly ZoneReading[]): string {
	const counts = ALERT_ORDER.map((level) => ({
		level,
		count: zones.filter((zone) => zone.alert === level).length,
	})).filter((entry) => entry.count > 0);

	const breakdown = counts.map((entry) => `${String(entry.count)} ${entry.level}`).join(", ");
	return `Stadium zone map. ${String(zones.length)} zones: ${breakdown}. Select a zone for detail.`;
}

/**
 * Interactive SVG map of the stadium bowl.
 *
 * Each zone is plotted at its normalised venue coordinate, sized by density and
 * coloured by alert band, and is operable by pointer or keyboard. Colour is
 * never the only channel: size carries density too, and every marker exposes
 * its reading in its accessible name, so the map is usable without colour
 * vision and without sight.
 */
export function VenueMap(): ReactElement {
	const { snapshot, selectedZoneId, selectZone } = useConsole();

	if (snapshot === null) {
		return <p className="panel-placeholder">Waiting for the first sensor snapshot…</p>;
	}

	const onZoneKeyDown = (event: KeyboardEvent<SVGGElement>, zoneId: string): void => {
		if (event.key !== "Enter" && event.key !== " ") return;
		// Space would otherwise scroll the console while a marker has focus.
		event.preventDefault();
		selectZone(zoneId);
	};

	return (
		<div className="venue-map">
			{/*
			 * `role="group"`, not `role="img"`: an `img` makes its whole subtree
			 * presentational, which would silently drop the focusable zone markers
			 * from the accessibility tree (axe flags exactly this as
			 * `nested-interactive`). `group` carries the same summarising label —
			 * announced on entry — while keeping the markers reachable.
			 */}
			<svg className="venue-map__svg" viewBox="0 0 100 100" role="group" aria-label={summarise(snapshot.zones)}>
				<rect className="venue-map__bowl" x="18" y="14" width="64" height="72" rx="30" />
				<rect className="venue-map__pitch" x="34" y="38" width="32" height="24" rx="2" />
				<line className="venue-map__pitch-line" x1="50" y1="38" x2="50" y2="62" />
				<circle className="venue-map__pitch-line" cx="50" cy="50" r="4" />

				{snapshot.zones.map((zone) => {
					const selected = zone.zoneId === selectedZoneId;
					const label = `${zone.name}, ${String(percent(zone.density))}% full, ${zone.alert}`;

					return (
						<g
							key={zone.zoneId}
							role="button"
							tabIndex={0}
							aria-label={label}
							aria-pressed={selected}
							className={selected ? "zone zone--selected" : "zone"}
							onClick={(): void => {
								selectZone(zone.zoneId);
							}}
							onKeyDown={(event): void => {
								onZoneKeyDown(event, zone.zoneId);
							}}
						>
							<circle className="zone__ring" cx={zone.x} cy={zone.y} r={radiusFor(zone.density) + 1.8} />
							<circle
								className={`zone__blob zone__blob--${zone.alert}`}
								cx={zone.x}
								cy={zone.y}
								r={radiusFor(zone.density)}
							/>
							<circle className="zone__core" cx={zone.x} cy={zone.y} r={1} />
						</g>
					);
				})}
			</svg>

			<ul className="legend">
				{ALERT_ORDER.map((level) => (
					<li key={level} className="legend__item">
						<span className={`legend__swatch legend__swatch--${level}`} aria-hidden="true" />
						{ALERT_LEGEND[level]}
					</li>
				))}
				<li className="legend__item legend__item--note">Marker size grows with zone density.</li>
			</ul>
		</div>
	);
}
