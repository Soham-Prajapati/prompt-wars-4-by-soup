import { type ReactElement } from "react";

import { ConsoleProvider } from "@/components/ConsoleProvider";
import { FanAssistant } from "@/components/FanAssistant";
import { FanItinerary } from "@/components/FanItinerary";
import { LiveClock } from "@/components/LiveClock";
import { OpsAdvisor } from "@/components/OpsAdvisor";
import { RoutePlanner } from "@/components/RoutePlanner";
import { VenueMap } from "@/components/VenueMap";
import { ZonePanel } from "@/components/ZonePanel";

/**
 * The operations console.
 *
 * A server component that lays out the page and delegates every stateful part
 * to client islands beneath a single `ConsoleProvider`. The structure is the
 * shift itself: read the venue state, look at the map, ask the model what to do
 * about it, then route a fan through it.
 */
export default function ConsolePage(): ReactElement {
	return (
		<ConsoleProvider>
			<header className="app-header">
				<div className="app-header__brand">
					<h1 className="app-header__title">PitchOps 26</h1>
					<p className="app-header__subtitle">
						Stadium operations copilot — MetLife Stadium, FIFA World Cup 2026
					</p>
				</div>
				<LiveClock />
			</header>

			<main className="app-main" id="main-content" tabIndex={-1}>
				<div className="console-grid">
					<section className="panel panel--map" aria-labelledby="map-heading">
						<h2 className="panel__title" id="map-heading">
							Venue map
						</h2>
						<p className="panel__lede">
							Every zone of the bowl, sized by density and coloured by alert band. Select one to read its
							detail and to focus the AI advisor on it.
						</p>
						<VenueMap />
					</section>

					<section className="panel panel--zone" aria-labelledby="zone-heading">
						<h2 className="panel__title" id="zone-heading">
							Zone detail
						</h2>
						<ZonePanel />
					</section>
				</div>

				<section className="panel" aria-labelledby="advisor-heading">
					<h2 className="panel__title" id="advisor-heading">
						Operations advisor
					</h2>
					<p className="panel__lede">
						Asks Google Gemini for the three actions that matter most right now, grounded in the same
						snapshot the map is drawing.
					</p>
					<OpsAdvisor />
				</section>

				<section className="panel" aria-labelledby="planner-heading">
					<h2 className="panel__title" id="planner-heading">
						Accessible route planner
					</h2>
					<p className="panel__lede">
						Routes around congestion rather than straight through it, and can guarantee a step-free path by
						excluding stepped walkways from the graph outright.
					</p>
					<RoutePlanner />
				</section>

				<section className="panel" aria-labelledby="assistant-heading">
					<h2 className="panel__title" id="assistant-heading">
						Multilingual fan assistant
					</h2>
					<p className="panel__lede">
						Answers a fan&rsquo;s question in their own language, from live venue state — for the first
						48-nation World Cup.
					</p>
					<FanAssistant />
				</section>

				<section className="panel" aria-labelledby="itinerary-heading">
					<h2 className="panel__title" id="itinerary-heading">
						Personalised matchday itinerary
					</h2>
					<p className="panel__lede">
						Turns where a fan is staying and what they enjoy into a timed plan — hotel to seat and back. The
						departure time, gate and walking route are computed from the venue model; Gemini only writes them
						up, in the fan&rsquo;s own language.
					</p>
					<FanItinerary />
				</section>
			</main>

			<footer className="app-footer">
				<p>
					Crowd readings are produced by a deterministic simulation of a matchday at MetLife Stadium. No
					sensor, camera or ticketing hardware is connected. AI panels call Google Gemini live and state it
					plainly when the model is unreachable or unconfigured.
				</p>
			</footer>
		</ConsoleProvider>
	);
}
