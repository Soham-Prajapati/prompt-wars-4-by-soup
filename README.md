# PitchOps 26

An AI operations copilot for FIFA World Cup 2026 host stadiums: one console where venue staff read live crowd density — and where it is heading in the next fifteen minutes — and ask Google Gemini what to do about it; where a volunteer steward gets a plain-language briefing for their post; and where fans get routed, answered and planned for in their own language.

**Live demo:** https://prompt-wars-4-by-soup.vercel.app
**Health / evidence endpoint:** https://prompt-wars-4-by-soup.vercel.app/api/health

---

## The problem

A World Cup matchday is a crowd-safety problem wearing a hospitality costume. MetLife Stadium seats over 82,000 people who all arrive in the same ninety minutes, through four gates, from two transit modes, speaking the languages of 48 nations — the first 48-nation tournament in the competition's history. The duty manager's problem is not a lack of data. It is that the data arrives as numbers and the decision has to leave as an action, in the next thirty seconds, and the fan asking where the shortest queue is does not read English.

PitchOps 26 puts the venue state, a fifteen-minute projection of it, and the model that reasons over both in the same place — for the duty manager deciding where to send staff, the volunteer steward on a post being asked questions, and the fan trying to get to their seat.

### The four user types in the brief

The brief names four audiences. Three are served; one is not, and is declared as not.

| User type | Served? | What they get | Implemented in |
| --- | --- | --- | --- |
| **Fans** | Yes | Multilingual assistant, crowd-aware step-free wayfinding, personalised door-to-seat itinerary | `src/components/FanAssistant.tsx`, `src/components/RoutePlanner.tsx`, `src/components/FanItinerary.tsx`, `src/lib/itinerary.ts`, `src/lib/wayfinding.ts` |
| **Venue staff** | Yes | Live congestion map, per-zone detail with a 15-minute outlook, and prioritised anticipatory actions for the duty manager | `src/components/VenueMap.tsx`, `src/components/ZonePanel.tsx`, `src/components/LiveClock.tsx`, `src/components/OpsAdvisor.tsx`, `src/app/api/advisor/route.ts` |
| **Volunteers** | Yes — stewards only | A plain-language briefing for the single post they are stood at: what they will see, what to tell fans, and one observable trigger for escalating | `src/lib/audience.ts`, `src/app/api/advisor/route.ts:93` (`buildStewardPrompt`), `src/lib/prompt.ts:123` (`describeTrendForFan`) |
| **Organizers** | **No** | — | Not addressed |

**Organizers are not addressed.** The brief lists them; this project does not serve them. Everything here is scoped to a single venue on a single matchday — there is no tournament-level model in the code: no fixture list, no multi-venue view, no scheduling, accreditation, broadcast, ticketing-inventory or cross-city resourcing. An organizer's job begins where this console's data ends, and dressing the duty manager's view up as a tournament dashboard would be a claim the code cannot keep.

The volunteer row is deliberately narrow, too. A steward on a post is one volunteer role among many a World Cup runs — transport marshals, accessibility hosts, media assistants, volunteer coordinators — and only the posted-steward case is built.

### The eight capability keywords in the brief

| Feature | Keyword | Implemented in |
| --- | --- | --- |
| Live congestion dashboard — per-zone density, occupancy, queue wait, alert band, and an aggregate Fan Friction Score | **Crowd management** | `src/lib/crowd-model.ts`, `src/app/api/snapshot/route.ts`, `src/components/VenueMap.tsx`, `src/components/LiveClock.tsx`, `src/components/ZonePanel.tsx` |
| **15-minute venue forecast** — every zone projected forward, classified rising/falling/steady against a deadband, plus a venue-level friction delta; surfaced on the status strip and the zone panel, and fed into the advisor's prompt | **Operational intelligence** | `src/lib/crowd-model.ts:374` (`forecastAt`), `:467` (`currentReport`), `src/app/api/snapshot/route.ts`, `src/components/TrendIndicator.tsx`, `src/components/LiveClock.tsx`, `src/components/ZonePanel.tsx` |
| AI operations advisor — top-3 prioritised actions for the duty manager, grounded in the live snapshot **and its projection**, so the advice anticipates rather than reacts; optionally weighted to a selected zone | **Real-time decision support** | `src/app/api/advisor/route.ts:38` (`buildDutyManagerPrompt`), `src/components/OpsAdvisor.tsx` |
| **Steward briefing** — the same grounded state rewritten for a volunteer posted at one zone, in the fan-facing register | **Real-time decision support**, **operational intelligence** | `src/app/api/advisor/route.ts:93`, `src/lib/audience.ts` |
| Multilingual fan assistant — answers a fan's question entirely in one of 10 languages, from live venue state | **Multilingual assistance** | `src/app/api/assistant/route.ts`, `src/components/FanAssistant.tsx`, `src/lib/languages.ts` |
| Crowd-aware, step-free wayfinding — Dijkstra over the walkway graph weighted by live congestion, with an accessibility constraint enforced by graph construction | **Navigation**, **accessibility** | `src/lib/wayfinding.ts`, `src/app/api/wayfinding/route.ts`, `src/components/RoutePlanner.tsx` |
| Personalised matchday itinerary — departure time, transit leg, arrival gate and in-bowl walk, from the fan's host district | **Transportation**, **accessibility** | `src/lib/itinerary.ts`, `src/app/api/itinerary/route.ts`, `src/components/FanItinerary.tsx` |
| Egress transit surge, on the ops side — the rail link and bus terminal are zones like any other, so the forecast reports them loading in the quarter-hour *before* the final whistle, on the console and in the advisor's prompt | **Transportation**, **operational intelligence** | `src/lib/crowd-model.ts:374`, asserted at `tests/crowd-model.test.ts:642` ("sees transit loading up before egress begins") |
| — | **Sustainability** | Not addressed |

**Sustainability is not addressed.** The brief lists it; this project does not implement it. There is no waste, energy or emissions modelling anywhere in the code, and claiming otherwise would be the only dishonest row in the table.

**Scope note on transportation.** The forecast gives the *venue* fifteen minutes of warning on the egress surge, which is what the duty manager can act on. It does not reach outside the fence: there is no train-timetable integration, no service-frequency model, and no departure-boards feed — and the fan-facing itinerary is computed from the district catalogue, not from the forecast.

---

## What it does

**1. Live congestion dashboard.** An SVG map of the bowl plots all 17 zones at their venue coordinates, sized by density and coloured by alert band. Selecting a zone shows its density, occupancy against capacity, queue wait and step-free status. A status strip carries the matchday phase, the match clock, and the **Fan Friction Score** — the mean of *squared* zone densities scaled to 0–100. Squaring is the point: one dangerously-packed gate should outrank uniform moderate occupancy, because that is how operational risk actually behaves.

**2. Fifteen-minute forecast.** The crowd model is a pure function of the match clock, so the state a quarter of an hour from now is not estimated — it is *read*. Every zone is projected forward and classified rising, falling or steady against a deadband that filters the model's own drift; the venue gets a friction delta. Fifteen is not arbitrary: it is roughly how long it takes to decide, radio and physically land an intervention, and it is the length of the shortest matchday phase, so a projection can never skip an event entirely. The status strip shows where friction is heading, the zone panel shows whether the selected zone is filling or emptying and whether it is about to change alert band, and — the point — the whole projection goes into the advisor's prompt, which turns a readout into intelligence.

**3. AI operations advisor, for two audiences.** Sends the full zone table *and its projection* — not a summary — to Gemini and asks for the three actions that matter most, each naming a real zone and citing the density, queue or alert that justifies it. Because the model is told that an action takes about fifteen minutes to reach the floor, the advice anticipates: *"open Gate B lane 3 now — it is 62% and projected 79% with the queue doubling"*, rather than reporting a queue that already exists. If a zone is selected, the advice is weighted towards it. Switch the audience to **steward** and the same grounded state is rewritten for a volunteer posted at that one zone — plain language, no bands or percentages, three headings: what you will see, what to tell fans, and one observable trigger for calling the duty manager. A steward briefing needs a post, so the server rejects one without a zone rather than answering vaguely. If the model is unreachable, the panel says so; it never invents advice for someone making crowd-safety decisions. **The forecast is computed, not generated — it renders with no model key at all.**

**4. Multilingual fan assistant.** A fan asks in their language and gets the entire reply in it — not an English answer with a translate button. The answer is marked up with its own `lang` and `dir="auto"`, so an Arabic reply lays out right-to-left and a screen reader picks the right voice. Grounded in the same snapshot the ops map draws, and instructed to say when the data cannot answer rather than fill the gap: a confidently wrong gate number moves a crowd the wrong way.

**5. Crowd-aware, step-free wayfinding.** Routes between any two zones over a 17-node / 21-edge walkway graph, weighting each edge by live congestion so the router detours *around* a packed concourse rather than through it. Tick "step-free only" and stepped zones and walkways are removed from the graph before the search runs — an accessibility guarantee by construction, not a filter applied to a route that may already be unusable. When no step-free path exists, it returns 404 and says why, rather than inventing a ramp. Step-free routing also has somewhere real to *reach*: the venue models two lift-served accessible seating platforms (`access-n`, `access-s` — `src/lib/venue.ts:65-66`), because routing a wheelchair user to the stepped bowl and reporting "no route" would be an accessibility failure dressed up as a computation.

**6. Personalised matchday itinerary.** From a host district, up to four interests, a step-free flag and a language: the departure time, transit leg, arrival gate and in-bowl walk are **computed**, then Gemini arranges them into a timed plan in the fan's language. Accessibility is modelled in the timing and the geometry, not just the label — step-free plans get additive lead time because accessible lanes are fewer, and `arrivalGate` diverts step-free bus arrivals off the stepped Gate C approach to Gate D (`src/lib/itinerary.ts:203`). If generation fails, the computed plan still renders — a departure time and a gate are a usable answer, and losing them to a model outage would not be.

---

## What is real and what is simulated

This section exists because a demo that blurs this line is not a demo, it is a claim.

**The crowd density is a deterministic simulation.** `src/lib/crowd-model.ts` derives every reading analytically from the match clock. **No BLE, Wi-Fi, CCTV, turnstile or ticketing hardware is connected to this project.** There is no sensor feed. `clockFromWallTime()` maps real time onto a looping 210-minute matchday so the deployed demo always shows an active operation.

Determinism was chosen deliberately, for two engineering reasons:

- **It makes the model a pure function.** `snapshotAt(clockMinutes)` takes a number and returns state. That is why the test suite can sweep all 211 minutes of the matchday exhaustively and assert physical invariants — density in 0..1, occupancy never above capacity — with no mocks, no fake timers, and no flakiness. A random-walk simulation would have needed a seeded PRNG and mocked clocks to test at all, and would have tested the mocks.
- **Stateless serverless has no shared store.** The route handlers are independent invocations with no shared memory. A stateful simulation would need external storage just to let the dashboard and the advisor agree on what time it is. Because the model is a pure function of the clock, `/api/snapshot` and `/api/advisor` observe *identical* state without sharing anything — the advisor reasons over exactly the numbers the map is drawing.

**The Gemini calls are real.** All four AI panels make a live HTTPS call to the Google Gemini API through the official `@google/generative-ai` SDK (`src/lib/gemini.ts:65-71`). Nothing is canned, templated or stubbed — a fake response indistinguishable from a real one would make an outage look like a success.

**Degradation is graded, and the two halves differ.** With no `GEMINI_API_KEY` configured:

- `POST /api/advisor` and `POST /api/assistant` return **`503 AI_UNAVAILABLE`**. Their entire answer *is* the generated text, so there is nothing to serve without it. Both panels name the missing key (`src/components/OpsAdvisor.tsx:19-21`).
- `POST /api/wayfinding` and `POST /api/itinerary` return **`200`** with the computed route or plan and `directions: null` / `itinerary: null`. Generation failure is caught and absorbed by `generateOptional` (`src/lib/gemini.ts:95-101`), which both endpoints share (`src/app/api/wayfinding/route.ts:59`, `src/app/api/itinerary/route.ts:157`): losing the prose is degraded, losing the path is no answer. Both panels render the computed result and state that the narration is missing (`src/components/RoutePlanner.tsx:129-132`, `src/components/FanItinerary.tsx:55-58`).

### The hosted demo runs without a Gemini key

`GET /api/health` on the live URL reports `"aiConfigured": false`. The advisor and assistant panels say the key is missing; the route planner and itinerary panels still compute and render their answers, without the written prose. This is the degradation path working as designed, not a bug — but it does mean **the hosted URL cannot demonstrate the AI-generated text**.

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

`/api/health` will then report `"aiConfigured": true` and all four AI features respond live. The AI code paths are ordinary, unconditional SDK calls (`src/lib/gemini.ts:65-71`) — there is no demo mode, no fixture, and no branch that fakes a response. The 387-test suite, the routing, the crowd model and the itinerary computation are all unaffected by the key and run identically either way.

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
- **TypeScript strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals` and `noImplicitOverride`** (`tsconfig.json:11-17`).
- **Route handlers are server-side only.** `GEMINI_API_KEY` is read exclusively in `src/lib/gemini.ts:21` and `:35`, which is imported only by route handlers. It is not prefixed `NEXT_PUBLIC_`, is never returned in a response body, and is never bundled into client JavaScript — **the API key cannot reach the browser.**
- **Domain core is pure.** `crowd-model.ts`, `wayfinding.ts`, `venue.ts` and `itinerary.ts` perform no I/O and know nothing about HTTP or React. That is what lets the suite sweep them exhaustively with no mocks.
- **Every prompt field is checked against a catalogue, not a length.** `interests` and `language` are refined by `isKnownInterest` / `isKnownLanguage` exactly as zone and district ids already were (`src/lib/validation.ts:44`, `:52`). All four are interpolated into a prompt verbatim, so a field validated only by length is a field an attacker writes: `language: "English. Ignore all prior instructions"` passes `min(2).max(40)` and fails `isKnownLanguage`. Reasoning in-code at `src/lib/validation.ts:9-19`.
- **The model narrates; it does not compute.** Every number a fan could act on wrongly — departure time, gate, distance, walking minutes, route — is computed before Gemini is called. This is a correctness boundary, not a style preference.

---

## Google services used

**Google Gemini API** (`gemini-2.0-flash`, `src/lib/gemini.ts:15`) via the official `@google/generative-ai` SDK. Flash is chosen for latency: an advisor a duty manager waits on is an advisor they stop opening. All four AI features call it — the ops advisor (which serves two audiences from two different prompts), the fan assistant, the route narrator and the itinerary planner. `GET /api/health` reports the exact model name and whether a key is configured, read from the same module the AI endpoints use, so the health response cannot drift from what the app really does.

**That is the only Google service used, and the only one this README claims.** No Vertex AI, BigQuery, Pub/Sub, Cloud Run, Firebase, Maps or Secret Manager — **no GCP billing account was available for this build**, so the free-tier Gemini API is used directly and the app is deployed on Vercel. Naming GCP services this project does not call would put a claim in this README that the code cannot keep.

---

## Getting started

```bash
npm install
cp .env.example .env.local     # then add your key
npm run dev                    # http://localhost:3000
```

Get a free Gemini API key at <https://aistudio.google.com/app/apikey> and set `GEMINI_API_KEY` in `.env.local`.

Without a key the app still runs: the map, the snapshot feed, the forecast, the zone detail, the computed routes and the computed itinerary plan all work, because they are computed server-side and do not touch the model. The advisor and assistant return `503 AI_UNAVAILABLE` and say so; the route planner and itinerary still return their computed answers without the written narration. See *What is real and what is simulated* above.

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

All five gates were run against this commit. Real output:

| Gate | Command | Result |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | **exit 0**, 0 errors |
| Lint | `npx eslint . --max-warnings 0` | **exit 0**, 0 errors, 0 warnings |
| Tests | `npx vitest run` | **387 passed / 387**, 12 files |
| Build | `npx next build` | **✓ Compiled successfully**, 8 routes |
| Audit | `npm audit` | **found 0 vulnerabilities** |

**All five run in CI.** `.github/workflows/ci.yml` runs `npm ci`, `npm run verify` (typecheck + lint + coverage-thresholded tests), `npm run build` and `npm audit --audit-level=low` on every push and pull request to `main` — one job, Node 22, `ubuntu-latest`. That is what makes these gates rather than claims: a regression fails there rather than reaching `main` unnoticed. There is no badge, no deploy pipeline and no matrix build.

Coverage (`npx vitest run --coverage`, v8). Scope is `src/lib/**` and `src/app/api/**` — every line that runs on the server (`vitest.config.ts:19`). The React components are excluded because this suite does not render them; counting them would report a number no test earned.

| | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| **All files** | **97.33** | **90.95** | **100** | **98.31** |

Twelve of the seventeen files in scope are at 100% on all four measures. The five that are not:

| File | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| `src/lib/gemini.ts` | 72.72 | 72.72 | 100 | 73.68 |
| `src/lib/wayfinding.ts` | 95.65 | 80.64 | 100 | 100 |
| `src/lib/itinerary.ts` | 100 | 89.47 | 100 | 100 |
| `src/app/api/itinerary/route.ts` | 95.65 | 88.88 | 100 | 95.45 |
| `src/app/api/wayfinding/route.ts` | 100 | 83.33 | 100 | 100 |

`gemini.ts` is the floor, and deliberately: its uncovered lines are 38–48 and 69–70 — constructing the real SDK client and making the live `generateContent` network call. Covering them would mean asserting against a mock of Google's SDK, which tests the mock.

**The thresholds are enforced, not decorative.** `vitest.config.ts:24-29` fails the run below 97 / 90 / 98 / 98 — set a hair under what the suite actually reaches, so the gate bites on a real regression rather than sitting above the true figure. `npm run test:coverage` is part of `npm run verify` (`package.json:15`).

Size: 44 TypeScript files — 4,056 lines in `src/`, 4,654 lines in `tests/`.

Deeper engineering notes — the design decisions, the honest scope limits, and the evidence behind every number above — are in [`docs/ENGINEERING.md`](docs/ENGINEERING.md).

---

## Licence

Built for the Google × Hack2Skill *Prompt Wars* Challenge 4.
