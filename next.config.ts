import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * The security headers here cover document responses. API responses set their
 * own headers in `src/lib/api.ts`, so a route handler is hardened by being
 * written rather than by remembering to register it here.
 */
const nextConfig: NextConfig = {
	poweredByHeader: false,
	reactStrictMode: true,

	headers() {
		return Promise.resolve([
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
					{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
					{
						// The app loads no third-party scripts, styles, fonts or frames.
						// `'unsafe-inline'` on style-src is required by Next's injected
						// critical CSS; scripts carry no such exemption.
						key: "Content-Security-Policy",
						value: [
							"default-src 'self'",
							"script-src 'self' 'unsafe-inline'",
							"style-src 'self' 'unsafe-inline'",
							"img-src 'self' data:",
							"font-src 'self'",
							"connect-src 'self'",
							"frame-ancestors 'none'",
							"base-uri 'self'",
							"form-action 'self'",
						].join("; "),
					},
				],
			},
		]);
	},
};

export default nextConfig;
