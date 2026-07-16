import { type Metadata } from "next";
import { type ReactElement, type ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
	title: "PitchOps 26 — Stadium Operations Copilot",
	description:
		"AI operations copilot for FIFA World Cup 2026 host stadiums: live crowd-density readings, prioritised actions for venue staff, crowd-aware step-free wayfinding and a multilingual fan assistant.",
	applicationName: "PitchOps 26",
};

/**
 * Root document shell.
 *
 * Declares the document language — assistive technology needs it to choose a
 * voice — and puts a skip link ahead of everything else, so a keyboard user is
 * one Tab away from the console instead of walking the header on every load.
 */
export default function RootLayout({ children }: { readonly children: ReactNode }): ReactElement {
	return (
		<html lang="en">
			<body>
				<a className="skip-link" href="#main-content">
					Skip to main content
				</a>
				{children}
			</body>
		</html>
	);
}
