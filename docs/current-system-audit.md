# Current System Audit

Date: 2026-07-30. Audited before the Hindu Dharma Companion transformation. File references are to this repo at commit `687eaa7`.

## Application framework and version

- **Web app:** Next.js **16.2.4** (App Router) with **Cache Components enabled** (`cacheComponents: true` in `next.config.ts`), React 19.2.4, TypeScript strict mode, Tailwind CSS 4. Version-matched Next docs ship in `node_modules/next/dist/docs/` and are the source of truth (see `AGENTS.md`).
  - Dynamic route `params`/`searchParams` are **Promises** and must be awaited.
  - Server components that read uncached data (session, Firestore) must be wrapped in `<Suspense>` (see `app/ask/page.tsx`).
- **Bridge:** a separate long-running Node process in `bridge/` (`npm run bridge`, runs via `tsx --env-file=../.env`). It imports root `lib/` modules directly via relative paths (e.g. `bridge/src/firestore.ts` imports `../../lib/firebase/admin.ts`), so web app and bridge share one code tree and one Firestore.
- **Deployment:** No CI, no `vercel.json`, no Firebase Hosting/Functions. Web app is deployed Vercel-style (`next build` / git integration). `firebase.json` covers only Firestore rules/indexes and Storage rules, deployed manually with the Firebase CLI. The bridge runs on the Mac that hosts the BlueBubbles server.

## Current page routes

| Route | Access | Notes |
|---|---|---|
| `/` | public | Landing page, "Text GURU" CTA |
| `/sign-in` | public | Firebase Auth (email/password + Google); web is **admin-only** via `ADMIN_EMAILS` allowlist |
| `/guides`, `/guides/[slug]` | public | Curated ritual guides from `ritualGuides` collection |
| `/q/[id]` | public | Shared Q&A pages (random short IDs from `shares`); **indexable — no noindex, no canonical, in no sitemap** |
| `/ask`, `/chats`, `/chats/[id]`, `/profile` | session-gated | Admin-only in practice (allowlist) |
| `/api/ask` (POST) | open (userId in body) | SSE streaming RAG answer |
| `/api/session` (POST/DELETE) | open | Mints/clears 5-day `__session` cookie via Admin SDK |
| `/api/transcribe` (POST) | open | gpt-4o-transcribe proxy |
| `/api/geocode` (GET) | open | Nominatim proxy for city picker |

## Current Firestore collections

| Collection | Owner | Contents |
|---|---|---|
| `users/{uid}` | web client (owner-only rules) | Profile: displayName, lastName, cities/regions, languages (+legacy `language`), sect, traditions (+legacy `traditionPreference`), experienceLevel, deityPreference, additionalInfo, timestamps |
| `users/{uid}/chats/{chatId}` | web client | Full chat transcripts (messages array with sources/citations/media) |
| `imessageUsers/{handleId}` | bridge (Admin SDK) | handleId = 24-char SHA1 prefix of normalized handle; raw `handle`, `chatGuid`, onboarding state, profile fields |
| `imessageUsers/{handleId}/chats/imessage` | bridge | iMessage history (last 8 turns loaded per reply) |
| `chunks` | ingest script | RAG chunks with 1536-dim `FieldValue.vector` embeddings; ~600-token chunks, 60-token overlap, chapter/verse/page metadata |
| `sources` | ingest script | Ingested PDF metadata (title, tradition, text_type, translator, fileHash, chunkCount) |
| `ritualGuides` | seed script | 10 curated procedural guides (JSON in `data/ritual-guides/`) with sect/region variants and citations |
| `queries` | `/api/ask` + bridge (fire-and-forget) | Q&A audit log: question, retrieved chunk IDs, answer, model, latency |
| `shares` | bridge | Public share docs behind `/q/{id}` |

**Security rules** (`firestore.rules`): users own their doc + chats; `ritualGuides`/`sources` readable by any signed-in user; `chunks`/`queries` server-only. `storage.rules`: owner-only `users/{uid}/chat-media/**`, 10 MB, images only.

**Indexes** (`firestore.indexes.json`): vector index on `chunks.embedding` (COSINE, 1536), composite `text_type`+embedding, `ritualGuides` tradition+tags and tradition+deities. **No indexes exist for any queue/scheduling pattern.**

## Firebase Authentication setup

Client Web SDK sign-in (email/password, Google popup) → POST `/api/session` exchanges the ID token for a 5-day httpOnly `__session` cookie → `getSessionUser()` (`lib/auth/session.ts`) verifies with Admin SDK **and rejects any email not in `ADMIN_EMAILS`**. There is no end-user web account today; end users exist only as `imessageUsers` reached through the bridge. There is no roles system beyond the allowlist.

## Existing server functions

None. No Cloud Functions, no cron of any kind, no task queues. All server work happens in Next route handlers and in the bridge process.

## Existing BlueBubbles integration

All in `bridge/src/`:

- **Inbound: WebSocket, not webhooks.** `socket.io-client` connects to the BlueBubbles server (`BB_URL`, default `http://localhost:1234`) with the password passed as the `guid` query param, and listens for `new-message` events (`bridge/src/bluebubbles.ts:30-54`).
- Filtering: drops `isFromMe`, non-1:1 chats (`chat.style !== 45`), empty messages, missing handles (`bridge/src/index.ts:58-78`).
- **No deduplication** of message GUIDs — a re-emitted event is processed twice.
- Per-handle serialization via a promise-chain map (`runSerial`), so one user's messages process in order while users are concurrent.
- **Outbound:** `POST {BB_URL}/api/v1/message/text?password=…` with `{ chatGuid, tempGuid, message, method: "apple-script" }`; attachments via `GET /api/v1/attachment/{guid}/download?password=…`. Single attempt, **no timeout, no retries, errors swallowed** (logged only). Long replies are split into ≤1500-char segments sent 250 ms apart.
- **Media:** images normalized via ffmpeg/sips (HEIC→JPEG, ≤1568px), video keyframes (4–16) + audio track transcription (gpt-4o-transcribe, ≤13 min), audio transcription. Size caps 25 MB/200 MB/100 MB. Failures degrade gracefully.
- **Onboarding:** a real state machine already exists (`bridge/src/onboarding.ts`): intro → ask_name → ask_city → ask_languages → ask_additional → complete, persisted on the `imessageUsers` doc. **No consent step, no delivery-time step, no timezone, no program selection.**
- Trigger word "guru" (`config.triggerWord`) starts onboarding for unknown handles.

## How phone numbers / handles are stored

`normalizeHandle()` (`bridge/src/handle.ts`): emails lowercased; 10-digit numbers assumed US (`+1` prefixed); otherwise digits with `+`. Doc ID is an opaque SHA1-prefix `handleId`; the raw normalized handle is stored in the doc. `chatGuid` is captured lazily from the first inbound message.

## Current AI provider and model

OpenAI (`lib/openai.ts`): **gpt-4.1** for chat and vision (temperature 0.3), **text-embedding-3-small** (1536 dims), **gpt-4o-transcribe** for audio. No structured output — the model emits markdown parsed by string convention.

## Current RAG implementation

- Retrieval (`lib/rag/retrieve.ts`): embed query → Firestore `findNearest` (COSINE, ~80 candidates) → dedupe → **domain-weighted re-rank** → top 8, plus up to 2 "supplemental" devotional poems within a 0.08 relevance margin, plus up to 3 matched ritual guides (keyword/tag scoring).
- Domain classifier (`lib/rag/domain.ts`): regex-based `wellness` / `custom` / `dharma`, adjusting text_type weights (e.g. Ayurveda boosted for wellness, strongly demoted otherwise).
- Prompts (`lib/rag/prompt.ts`, ~291 lines): **v9-guru** (web) and **v4-sms-guru** (iMessage). Persona is a *prescriptive Guru*: imperative mood mandated, output format `### PRACTICE` then `### SOURCE 1..N`, concrete Ayurvedic remedies required (herb, part, preparation, quantity, anupana), community-specific rulings required, hedging ("follow your local customs") explicitly forbidden.
  - This is the exact style the transformation targets: quotation-heavy, single-answer authoritative, willing to turn historical prescription into personal command, and thin on multi-tradition framing and medical qualification.
- Multi-turn: prior assistant turns compressed to their PRACTICE section (≤1800 chars).

## Current source-document storage

PDFs live locally in `/manuscripts` (not committed); the manifest mapping filename → {title, text_type (17 values incl. veda/upanishad/gita/smriti/ayurveda/poetry), translator, tags} is **hardcoded** in `scripts/lib/manifest.ts`. `npm run ingest` chunks, embeds, and writes `chunks` + `sources`. There is no license metadata, no review status, no authority-limitations field.

## Existing public answer pages / random question-link format

`shares/{shortId}` (6 random bytes base64url, created by the bridge) rendered at `/q/[id]` with generateMetadata (title/description/OG). **Risk: these are private Q&A conversations that are publicly reachable and indexable, with no noindex, no robots.txt, no sitemap, no access control, and no PII scrubbing.**

## Existing admin tools

CLI scripts only: `npm run ingest`, `npm run seed:guides`, cleanup scripts. No admin UI, no review workflow, no queue/health views.

## Existing analytics

`queries` collection log per LLM call (fire-and-forget). No product analytics, no third-party trackers, no dashboards.

## Existing subscription or payment implementation

None. No entitlement concept anywhere.

## Current deployment process

- Web: `npm run build` → Vercel (implied; no config file committed).
- Firestore rules/indexes: `firebase deploy --only firestore` (manual).
- Bridge: run manually on the BlueBubbles Mac (`npm run bridge`).

## Security weaknesses

1. `/q/[id]` exposes private conversations publicly and indexably (see above).
2. BlueBubbles password in query strings (both REST and socket auth) — it is the documented BlueBubbles auth mechanism, but URLs must never be logged; today the base URL is logged at startup (`bridge/src/index.ts`).
3. `/api/ask` trusts `userId` from the request body — no session check; anyone can consume OpenAI quota and read/write chats under an arbitrary uid path via the API's own writes.
4. No rate limiting on any API route.
5. No message dedup, no idempotency anywhere in the bridge.
6. No outbound-send safeguard: any code path that calls `sendText` sends a real iMessage; no dev allowlist or kill switch.
7. Fire-and-forget logging swallows failures; silent data loss possible.
8. No data deletion/export workflow (privacy/GDPR gap); chat history retained indefinitely.

## Missing indexes

Everything the delivery queue needs (`status + nextAttemptAt`, lease scans), plus any future `publicAnswers`/`enrollments` queries. Tracked in the transformation plan.

## Existing tests

**None.** No test runner was configured before this transformation (vitest is being added).

## Current failure points

- BlueBubbles server down → socket reconnects, but outbound sends fail silently and are lost (no queue, no retry, no alerting).
- Bridge process crash mid-conversation → in-flight replies lost (no persistence of pending work).
- Duplicate socket events → duplicate history entries and double replies.
- No timeouts → a hung BlueBubbles REST call stalls a user's serial queue indefinitely.
- OpenAI failures inside `/api/ask` stream → error event sent, but no retry/backoff.
- Any Firestore contention or quota issue in fire-and-forget writes is invisible.
