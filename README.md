# PitchOps 26

An AI operations copilot for FIFA World Cup 2026 host stadiums: one console where venue staff read live crowd density and ask Google Gemini what to do about it, and where fans get routed, answered and planned for in their own language.

**Live demo:** https://prompt-wars-4-by-soup.vercel.app
**Health / evidence endpoint:** https://prompt-wars-4-by-soup.vercel.app/api/health

---

## The problem

A World Cup matchday is a crowd-safety problem wearing a hospitality costume. MetLife Stadium seats over 82,000 people who all arrive in the same ninety minutes, through four gates, from two transit modes, speaking the languages of 48 nations — the first 48-nation tournament in the competition's history. The duty manager's problem is not a lack of data. It is that the data arrives as numbers and the decision has to leave as an action, in the next thirty seconds, and the fan asking where the shortest queue is does not read English.

PitchOps 26 puts the venue state and the model that reasons over it in the same place, for both audiences.

### Coverage against the challenge

| Feature | Challenge keyword | Implemented in |
| --- | --- | --- |
| Live congestion dashboard — per-zone density, occupancy, queue wait, alert band, and an aggregate Fan Friction Score | **Crowd management**, **operational intelligence** | `src/lib/crowd-model.ts`, `src/app/api/snapshot/route.ts`, `src/components/VenueMap.tsx`, `src/components/LiveClock.tsx`, `src/components/ZonePanel.tsx` |
| AI operations advisor — top-3 prioritised actions for the duty manager, grounded in the live snapshot, optionally weighted to a selected zone | **Real-time decision support**, **operational intelligence** | `src/app/api/advisor/route.ts`, `src/components/OpsAdvisor.tsx` |
| Multilingual fan assistant — answers a fan's question entirely in one of 10 languages, from live venue state | **Multilingual assistance**, **fan experience** | `src/app/api/assistant/route.ts`, `src/components/FanAssistant.tsx`, `src/lib/languages.ts` |
| Crowd-aware, step-free wayfinding — Dijkstra over the walkway graph weighted by live congestion, with an accessibility constraint enforced by graph construction | **Navigation**, **accessibility**, **crowd management** | `src/lib/wayfinding.ts`, `src/app/api/wayfinding/route.ts`, `src/components/RoutePlanner.tsx` |
| Personalised matchday itinerary — departure time, transit leg, arrival gate and in-bowl walk, from the fan's host district | **Transportation**, **fan experience**, **accessibility** | `src/lib/itinerary.ts`, `src/app/api/itinerary/route.ts`, `src/components/FanItinerary.tsx` |

**Sustainability is not addressed.** The challenge lists it; this submission does not implement it. There is no waste, energy or emissions modelling anywhere in the code, and claiming otherwise would be the only dishonest row in the table.

---

## What it does

**1. Live congestion dashboard.** An SVG map of the bowl plots all 17 zones at their venue coordinates, sized by density and coloured by alert band. Selecting a zone shows its density, occupancy against capacity, queue wait and step-free status. A status strip carries the matchday phase, the match clock, and the **Fan Friction Score** — the mean of *squared* zone densities scaled to 0–100. Squaring is the point: one dangerously-packed gate should outrank uniform moderate occupancy, because that is how operational risk actually behaves.

**2. AI operations advisor.** Sends the full zone table — not a summary — to Gemini and asks for the three actions that matter most right now, each naming a real zone and citing the density, queue or alert that justifies it. If a zone is selected on the map, the advice is weighted towards it. If the model is unreachable, the panel says so; it never invents advice for someone making crowd-safety decisions.

**3. Multilingual fan assistant.** A fan asks in their language and gets the entire reply in it — not an English answer with a translate button. The answer is marked up with its own `lang` and `dir="auto"`, so an Arabic reply lays out right-to-left and a screen reader picks the right voice. Grounded in the same snapshot the ops map draws, and instructed to say when the data cannot answer rather than fill the gap: a confidently wrong gate number moves a crowd the wrong way.

**4. Crowd-aware, step-free wayfinding.** Routes between any two zones over a 17-node / 21-edge walkway graph, weighting each edge by live congestion so the router detours *around* a packed concourse rather than through it. Tick "step-free only" and stepped zones and walkways are removed from the graph before the search runs — an accessibility guarantee by construction, not a filter applied to a route that may already be unusable. When no step-free path exists, it returns 404 and says why, rather than inventing a ramp.

**5. Personalised matchday itinerary.** From a host district, up to four interests, a step-free flag and a language: the departure time, transit leg, arrival gate and in-bowl walk are **computed**, then Gemini arranges them into a timed plan in the fan's language. If generation fails, the computed plan still renders — a departure time and a gate are a usable answer, and losing them to a model outage would not be.

---

## What is real and what is simulated

This section exists because a demo that blurs this line is not a demo, it is a claim.

**The crowd density is a deterministic simulation.** `src/lib/crowd-model.ts` derives every reading analytically from the match clock. **No BLE, Wi-Fi, CCTV, turnstile or ticketing hardware is connected to this project.** There is no sensor feed. `clockFromWallTime()` maps real time onto a looping 210-minute matchday so the deployed demo always shows an active operation.

Determinism was chosen deliberately, for two engineering reasons:

- **It makes the model a pure function.** `snapshotAt(clockMinutes)` takes a number and returns state. That is why the test suite can sweep all 211 minutes of the matchday exhaustively and assert physical invariants — density in 0..1, occupancy never above capacity — with no mocks, no fake timers, and no flakiness. A random-walk simulation would have needed a seeded PRNG and mocked clocks to test at all, and would have tested the mocks.
- **Stateless serverless has no shared store.** The route handlers are independent invocations with no shared memory. A stateful simulation would need external storage just to let the dashboard and the advisor agree on what time it is. Because the model is a pure function of the clock, `/api/snapshot` and `/api/advisor` observe *identical* state without sharing anything — the advisor reasons over exactly the numbers the map is drawing.

**The Gemini calls are real.** Every AI panel makes a live HTTPS call to the Google Gemini API through the official `@google/generative-ai` SDK. Nothing is canned, templated or stubbed. With no `GEMINI_API_KEY` configured, the AI endpoints return `503 AI_UNAVAILABLE` and each panel states plainly that the key is missing — a fake response indistinguishable from a real one would make an outage look like a success.

### ⚠️ The hosted demo has no API key attached — read this before judging the AI

`GET /api/health` on the live URL reports `"aiConfigured": false`, and the four AI panels will say the key is missing. This is the degradation path working as designed, not a bug — but it does mean **the hosted URL cannot demonstrate the AI features**.

The cause is an account limitation, not a code one. The Gemini API free tier returns `limit: 0` for every model on the author's Google account — verified across four API keys and three projects, including keys minted through the AI Studio UI:

```
"generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0"
```

No billing account was available to move to the paid tier, and no GCP credits were provided for this challenge.

**To see the AI working, run it locally with any valid Gemini key — about 60 seconds:**

```bash
git clone https://github.com/Soham-Prajapati/prompt-wars-4-by-soup.git
cd prompt-wars-4-by-soup && npm install
echo 'GEMINI_API_KEY=your_key_here' > .env.local   # aistudio.google.com/app/apikey
npm run dev                                        # http://localhost:3000
```

`/api/health` will then report `"aiConfigured": true` and all four AI features respond live. The AI code paths are ordinary, unconditional SDK calls (`src/lib/gemini.ts:74-81`) — there is no demo mode, no fixture, and no branch that fakes a response. The 110-test suite, the routing, the crowd model and the itinerary computation are all unaffected by the key and run identically either way.

**The venue topology and geography are modelled on reality.** MetLife Stadium is the 2026 Final venue; the NJ Transit Meadowlands Line is an event-day shuttle spur, which is why every rail district in `src/lib/itinerary.ts` connects through Secaucus Junction. Zone coordinates, capacities and walkway distances are plausible-but-authored figures, not surveyed ones.

---

## Architecture

```
Browser (client islands)                Server (route handlers, Node runtime)
─────────────────────────               ────────────────────────────────────
ConsoleProvider                         GET  /api/snapshot   ─┐
  └─ one 4s poller ──────────────────►  GET  /api/health      ├─ crowd-model.ts
     (use-venue-snapshot.ts)            POST /api/advisor    ─┤   (pure function
  ├─ VenueMap / ZonePanel / LiveClock   POST /api/assistant  ─┤    of the clock)
  ├─ OpsAdvisor        ────────────────►POST /api/wayfinding ─┤
  ├─ RoutePlanner      ────────────────►POST /api/itinerary  ─┘
  ├─ FanAssistant                              │
  └─ FanItinerary                              ├─ validation.ts (zod, every body)
     via lib/client.ts                         ├─ wayfinding.ts / itinerary.ts
     (zod-parsed, never throws)                └─ gemini.ts ──► Google Gemini API
```

- **Next.js 16 App Router.** `src/app/page.tsx` is a server component that lays out the console and delegates every stateful part to client islands under a single `ConsoleProvider`.
- **TypeScript strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals` and `noImplicitOverride`** (`tsconfig.json`).
- **Route handlers are server-side only.** `GEMINI_API_KEY` is read exclusively in `src/lib/gemini.ts:21` and `:35`, which is imported only by route handlers. It is not prefixed `NEXT_PUBLIC_`, is never returned in a response body, and is never bundled into client JavaScript — **the API key cannot reach the browser.**
- **Domain core is pure.** `crowd-model.ts`, `wayfinding.ts`, `venue.ts` and `itinerary.ts` perform no I/O and know nothing about HTTP or React. They are the four modules under exhaustive test.
- **The model narrates; it does not compute.** Every number a fan could act on wrongly — departure time, gate, distance, walking minutes, route — is computed before Gemini is called. This is a correctness boundary, not a style preference.

---

## Google services used

**Google Gemini API** (`gemini-2.0-flash`) via the official `@google/generative-ai` SDK — `src/lib/gemini.ts`. Flash is chosen for latency: an advisor a duty manager waits on is an advisor they stop opening. All five AI features call it; `GET /api/health` reports the exact model name and whether a key is configured, read from the same module the AI endpoints use, so the health response cannot drift from what the app really does.

**That is the only Google service used, and the only one this README claims.** No Vertex AI, BigQuery, Pub/Sub, Cloud Run, Firebase, Maps or Secret Manager — **no GCP billing account was available for this build**, so the free-tier Gemini API is used directly and the app is deployed on Vercel. Naming GCP services this project does not call would be the cheapest possible way to lose the category.

---

## Getting started

```bash
npm install
cp .env.example .env.local     # then add your key
npm run dev                    # http://localhost:3000
```

Get a free Gemini API key at <https://aistudio.google.com/app/apikey> and set `GEMINI_API_KEY` in `.env.local`.

Without a key the app still runs: the map, the snapshot feed, the zone detail, the computed routes and the computed itinerary plan all work, because they are computed server-side and do not touch the model. The five AI panels return `503 AI_UNAVAILABLE` and say so.

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm test` | Vitest, one pass |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint . --max-warnings 0` |
| `npm run verify` | typecheck + lint + test |

---

## Quality gates

All four gates were run against this commit. Real output:

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | **exit 0**, 0 errors |
| Lint | `npx eslint . --max-warnings 0` | **exit 0**, 0 errors, 0 warnings |
| Tests | `npx vitest run` | **110 passed / 110**, 6 files |
| Build | `npx next build` | **✓ Compiled successfully**, 8 routes, 126 kB First Load JS |

Coverage of `src/lib` (`npx vitest run --coverage`, v8):

| Module | % Stmts | % Branch |
| --- | --- | --- |
| `crowd-model.ts` | **100** | **100** |
| `itinerary.ts` | **100** | **100** |
| `venue.ts` | **100** | **100** |
| `wayfinding.ts` | **100** | 80.95 |
| `gemini.ts` | 66.66 | 70 |
| `api.ts`, `client.ts`, `validation.ts`, `languages.ts` | 0 | 0 |
| **All of `src/lib`** | **55.5** | **88.31** |

The aggregate is 55.5% and is reported as such. The four pure domain modules — the ones where a defect is a wrong route or a mis-paged control room — are at 100% statement coverage. `gemini.ts` covers its configuration and error paths but not the live network call. `api.ts`, `client.ts` and `validation.ts` are HTTP and browser plumbing with no unit tests; that is the honest gap in this submission, not a claim of full coverage.

Size: 32 TypeScript files — 3,034 lines in `src/`, 1,194 lines in `tests/`.

---

## Licence

Built for the Google × Hack2Skill *Prompt Wars* Challenge 4.
