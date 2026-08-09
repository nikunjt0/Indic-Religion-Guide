# Transformation Plan — Hindu Dharma Companion

Companion to `docs/current-system-audit.md`. This is the implementation plan for turning the scripture Q&A bot into a daily learning/practice product with scheduled delivery, programs, safer answers, and a reviewed public SEO library.

## Major architectural decisions

1. **The global scheduler runs inside the bridge process, not Firebase Functions.**
   The repo has zero Cloud Functions infrastructure, and outbound iMessage delivery requires the BlueBubbles Mac to be online anyway — a cloud scheduler would still dead-end at that Mac. The dispatcher is a 60-second loop co-located with the provider, operating on a **Firestore-backed delivery queue** (`scheduledDeliveries`) with transactional claiming, leases, and idempotent workers. Because all state is in Firestore and the dispatcher is a pure module (`lib/scheduling/`), it can be lifted into a Cloud Function later without data-model changes. There is exactly one dispatcher, never one cron per user.
2. **Shared domain code lives in root `lib/` and is imported by both the Next.js app and the bridge** (the bridge already imports `lib/firebase/admin` this way). New modules: `lib/messaging/`, `lib/scheduling/`, `lib/commands/`, `lib/programs/`, `lib/onboarding/`, `lib/answers/`.
3. **Provider abstraction.** `MessagingProvider` interface (`sendTextMessage`, `normalizeRecipient`, `healthCheck`, `parseInboundEvent`, …) with two implementations: `BlueBubblesMessagingProvider` (REST, timeouts, bounded retries, error categories) and `FakeMessagingProvider` (tests/dev). Program/scheduling code never touches BlueBubbles directly.
4. **Inbound remains the BlueBubbles WebSocket** (its native push mechanism for a same-host consumer), hardened with: GUID-based deduplication persisted in `messageEvents`, persist-before-process, and safe handling of non-message events. An HTTPS webhook endpoint can be added later behind the same `parseInboundEvent` seam.
5. **`imessageUsers` stays the system of record for messaging users** (doc ID = stable opaque handleId). We add fields (consent, onboarding v2 state, streaks) rather than migrating to a new collection. Web `users` remains admin-only. A future account-linking step can join the two.
6. **Timezones via `luxon`.** Store `timezone` (IANA), `preferredLocalTime` ("07:30"), `scheduledLocalDate` (YYYY-MM-DD), and `nextDeliveryAt`/`scheduledAt` as UTC Timestamps. Next-occurrence math handles DST gaps (skip forward) and repeats (first occurrence).
7. **Deterministic command router before any LLM.** STOP/START/PAUSE/DELETE MY DATA etc. are exact/regex matches, case- and punctuation-insensitive. The LLM never handles opt-out.
8. **Preapproved lesson content.** Programs/lessons are versioned JSON under `content/programs/`, seeded to Firestore with `reviewStatus`. Delivery renders stored text; the LLM personalizes only greeting/depth on follow-ups, never the theological content.
9. **Idempotency everywhere.** Delivery dedup key `userId+enrollmentId+lessonId+scheduledLocalDate+variant` checked at claim and send; inbound dedup by provider GUID; per-delivery-type max-lateness windows (Daily Dharma 3 h, program lesson 6 h, recap 24 h).
10. **Answer engine returns schema-validated JSON** (zod): directAnswer, perspectives, consensusLevel, practicalTakeaway, sources, safetyFlags, childVersion, shortTextVersion. Deterministic high-risk topic detection routes to enhanced prompts and blocks public-page eligibility. The "prescriptive Guru" persona is replaced with answer-first, tradition-aware framing.
11. **Send safeguards.** `MESSAGING_SEND_ENABLED` (default off outside production) and `MESSAGING_TEST_ALLOWLIST` enforced inside the provider layer, so no code path can accidentally text real users from dev.
12. **SEO.** `/q/[id]` becomes noindexed immediately (robots meta + robots.txt), stays reachable privately. New reviewed `publicAnswers` collection powers `/learn/...` readable slugs with canonical URLs, sitemap, and hub linking. Publication requires human-approved status; nothing auto-publishes. Seed library `content/seo/hindu-question-seeds.json`.

## What can be reused

- Firebase admin/client setup, session-cookie auth, admin allowlist.
- The whole RAG stack (chunks, vector search, domain classifier, ritual guides, ingestion) — retrieval is unchanged; only prompting/output change.
- Bridge media pipeline (images/video/audio) as-is.
- Handle normalization + opaque handleId scheme.
- Existing onboarding persistence pattern (extended to the new consent-first flow).
- `shares`/`/q/[id]` as the private-share mechanism (noindexed).

## What needs to be refactored

- `bridge/src/bluebubbles.ts` → thin transport behind `BlueBubblesMessagingProvider` (timeouts, retry categories, no secrets in logs).
- `bridge/src/index.ts` inbound path → dedup + persist + command router before RAG.
- `bridge/src/onboarding.ts` → consent-first state machine with delivery time/timezone/program selection.
- `lib/rag/prompt.ts` → new answer-first prompt + structured output; SMS renderer from `shortTextVersion`.
- `/q/[id]` → noindex; link to canonical public answer when one exists.

## What needs to be newly built

Messaging provider layer; delivery queue + dispatcher + worker + retry/lateness; delivery preferences; command router; program engine + enrollments; Hinduism 101 (21 days) + 7-day program seeds; Daily Dharma rotation; structured answer engine + risk detection; publicAnswers + review workflow + `/learn` pages + sitemap/robots; admin queue/health views; analytics events; entitlement service; tests for all of it.

## Data migration approach

Additive only — no existing data is deleted or rewritten in place:

- `imessageUsers`: new optional fields (`consentStatus`, `onboardingV2State`, `timezone`, …). Old docs behave as "no consent recorded → no proactive messages", which is correct.
- New collections (`scheduledDeliveries`, `messageEvents`, `programs`, `enrollments`, `deliveryPreferences`, `publicAnswers`) start empty.
- `shares` untouched; only page metadata changes.
- Migration scripts live in `scripts/` and are idempotent (safe to re-run).

## Implementation order

Phases 1–8 as specified in the master prompt (foundation → scheduling → programs → answer engine → Daily Dharma → SEO → family/festival → analytics/conversion), with tests and typecheck at each phase boundary. Phase 1–3 are the critical path to the Definition-of-Done flow.

## Risks

- **Single-Mac delivery dependency:** if the BlueBubbles Mac sleeps, nothing sends. Mitigated by queue persistence + lateness windows + health monitoring; not fully solvable without a second provider (Twilio adapter is why the interface exists).
- **Apple rate limits / spam heuristics** on bulk morning sends; mitigated by batch caps and per-send spacing.
- **Content risk:** theological content must not auto-publish; review gates are enforced in code (`reviewStatus`), but reviewing is a human process the operator must actually do.
- **`/api/ask` auth hole** (userId trusted from body) predates this work; flagged for hardening.
- **Firestore vector + queue costs** grow with users; queue queries are index-backed and batch-limited.

## Credentials / infrastructure you must configure manually

- `ADMIN_USER_IDS`/`ADMIN_EMAILS` for admin access (already used for web sign-in).
- `MESSAGING_SEND_ENABLED=true` + production `BB_URL`/`BB_PASSWORD` on the bridge Mac.
- `MESSAGING_TEST_ALLOWLIST` (comma-separated handles) anywhere that is not production.
- `PUBLIC_APP_URL` (canonical origin for SEO pages and share links; supersedes `APP_PUBLIC_URL`, which remains supported).
- `DEFAULT_TIMEZONE` (fallback, e.g. `America/Chicago`).
- Firestore composite indexes: `firebase deploy --only firestore:indexes` after pulling this branch.
- Google Search Console verification + sitemap submission (once `/learn` ships).

## Deploy commands

- Web: `npm run build` → deploy via Vercel git integration (or `vercel deploy`).
- Firestore rules/indexes: `firebase deploy --only firestore`.
- Bridge (on the BlueBubbles Mac): `npm install && npm run bridge` (env in root `.env`).
- Seeds: `npm run seed:guides`, `npm run seed:programs` (new), `npm run ingest -- --all` for corpus.
- Tests: `npm test` (vitest).
