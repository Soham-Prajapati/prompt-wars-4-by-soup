import { type ReactElement, type ReactNode } from "react";

import { type Route } from "@/lib/wayfinding";

/** Props for {@link RouteSummary}. */
interface RouteSummaryProps {
	/** The computed walk to render: its access status, its cost and its stops. */
	readonly route: Route;
	/**
	 * Whether to show the mean congestion along the route.
	 *
	 * Off by default, because only the operator-facing planner has a reason to
	 * show it: there the density is the point — it explains why the router chose
	 * a longer path — while a fan reading an itinerary is being told where to
	 * walk, not being asked to audit the routing decision.
	 *
	 * Optional and never explicitly `undefined`: `exactOptionalPropertyTypes` is
	 * on, so the prop is either passed or absent, and "absent" is the default
	 * rather than a value a caller has to spell out.
	 */
	readonly showDensity?: boolean;
	/**
	 * Content rendered inside the route block, after the stop list.
	 *
	 * The narration hangs here rather than being a prop of its own. Both panels
	 * pair the computed walk with model prose, but they disagree on where it
	 * belongs — the planner keeps its directions inside the route block, the
	 * itinerary sets its prose outside — and that is a layout decision each panel
	 * should keep making for itself. Passing it as children lets the planner nest
	 * its directions without this component knowing what narration is.
	 */
	readonly children?: ReactNode;
}

/**
 * A computed walk, rendered as the route it is.
 *
 * The one place the walkway router's output becomes markup. Both panels that
 * show a route show the same three things about it — whether it is step-free,
 * what it costs, and which stops it passes — because those are the properties
 * the router computes, not a presentation choice either panel gets to make.
 *
 * Nothing here is generated. Every value rendered is computed by the venue
 * model, which is what lets both callers keep showing it when the model prose
 * that usually accompanies it fails to arrive.
 */
export function RouteSummary({ route, showDensity = false, children }: RouteSummaryProps): ReactElement {
	return (
		<div className="route">
			<div className="route__head">
				<span className={route.stepFree ? "badge badge--normal" : "badge badge--high"}>
					{route.stepFree ? "Step-free" : "Includes steps"}
				</span>
				<span className="route__metric">{route.metres} m</span>
				<span className="route__metric">{route.minutes} min walk</span>
				{showDensity && <span className="route__metric">{Math.round(route.meanDensity * 100)}% mean density</span>}
			</div>

			<ol className="route__path">
				{route.names.map((name, index) => (
					<li key={route.path[index] ?? name} className="route__stop">
						{name}
					</li>
				))}
			</ol>

			{children}
		</div>
	);
}
