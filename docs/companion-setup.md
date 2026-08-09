# Dharma Companion — Setup & Operations

How to run, test, and deploy the transformed product. Companion to
`docs/current-system-audit.md` and `docs/transformation-plan.md`.

## Architecture at a glance

- **Next.js 16 web app** (Vercel): landing, guides, `/learn` public library, sitemap/robots, admin sign-in, private `/q` shares (noindexed).
- **Bridge daemon** (`bridge/`, runs on the BlueBubbles Mac): inbound iMessage handling (dedup → command router → onboarding v2 → RAG fallback) **and the global delivery dispatcher** (60 s tick over the Firestore `scheduledDeliveries` queue with transactional claiming, leases, staged retries, and lateness windows).
- **Firestore** is the system of record. New collections: `deliveryPreferences`, `scheduledDeliveries`, `enrollments`, `messageEvents`, `programs` (+`lessons`), `publicAnswers`. All are server-only per `firestore.rules`.
- **Program content** is versioned JSON in `content/programs/` — the bridge delivers lesson text verbatim from these reviewed files; the LLM never rewrites lessons. `content/daily-dharma.json` is the Daily Dharma starter rotation. `content/seo/hindu-question-seeds.json` seeds the SEO pipeline.

## Environment variables

See `.env.example` (root; the bridge loads the same root `.env`). New ones:

| Var | Purpose |
|---|---|
| `MESSAGING_SEND_ENABLED` | Must be exactly `true` for scheduled sends. Unset/false → all queue deliveries are suppressed (`send-guard-blocked`). |
| `MESSAGING_TEST_ALLOWLIST` | Comma-separated handles; when set, only these receive scheduled messages (all environments). |
| `DEFAULT_TIMEZONE` | Timezone offered at onboarding confirmation (default `America/Chicago`). |
| `PUBLIC_APP_URL` | Canonical origin for `/learn`, sitemap, robots. Falls back to legacy `APP_PUBLIC_URL`. |
| `ADMIN_EMAILS` | Existing admin allowlist for web sign-in. |

## Commands

```bash
npm test               # vitest — scheduling/DST, queue idempotency, commands, onboarding, risk, schema
npm run lint           # eslint
npx tsc --noEmit       # root typecheck; also run in bridge/
npm run dev            # web app
npm run bridge         # bridge daemon + dispatcher (on the BlueBubbles Mac)
npm run seed:programs  # push content/programs/*.json to Firestore (catalog/admin copies)
firebase deploy --only firestore   # rules + the new queue indexes (REQUIRED before first run)
```

## User-facing behavior

- **New users**: texting `guru` or `START` begins consent-first onboarding (explicit state machine: consent → name → goal → level → tradition → language → delivery time → timezone confirm → program choice → NOW/TOMORROW). Consent is recorded only on an affirmative reply; STOP works from any state.
- **Commands** (deterministic, matched before the LLM): START, START NOW, STOP, PAUSE, PAUSE N DAYS, RESUME, HELP, TIME, CHANGE TIME, PROGRAMS, MY PROGRAM, RESTART, SKIP, DEEPER, SIMPLE, KIDS, SOURCE, STORY, PRACTICE, SAVE, UNSAVE, SETTINGS, DELETE MY DATA.
- **Programs**: lessons deliver at the user's preferred local time (IANA timezone, DST-safe); each confirmed send advances the enrollment and schedules the next day; completion sends a recap. DEEPER/KIDS/SOURCE serve the reviewed per-lesson variants.
- **Free-form questions** still go to the RAG engine (with the new deterministic safety addendum on high-risk topics), during and after onboarding.
- **Existing users** keep working exactly as before until they opt into scheduling via START.

## Delivery guarantees

- Enqueue is idempotent (doc id = hash of `userId|type|enrollment|day|localDate|variant`).
- Claiming is a Firestore transaction with a 2-minute lease; crashed workers are recovered by the next tick.
- Retries: 1/5/15/60-minute backoff, max 5 attempts, per-type max lateness (Daily Dharma 3 h, lessons 6 h, recap 24 h) — after which the item is marked `skipped-late` rather than delivered absurdly late.
- Consent, pause, per-type enablement, and quiet hours are re-checked at send time; STOP suppresses everything including retries.

## SEO surfaces

- `/q/[id]` shares are now `noindex` and disallowed in `robots.txt`.
- `/learn` + `/learn/[slug]` render only `publicAnswers` docs with `reviewStatus == "published"`; sitemap includes only published+`indexingStatus=index` pages. Nothing auto-publishes: the pipeline stops at review states until a human approves (admin UI is the next phase; until then, publishing = setting `reviewStatus`/`indexingStatus` via script or console).

## Known limitations / next phase

- Web `/api/ask` still trusts `userId` from the body (pre-existing); harden with session checks.
- Structured-JSON answer engine (`lib/answers/schema.ts`) is validated and tested but the live paths still use the streaming markdown prompts with the safety addendum; full cutover is Phase 4 completion.
- Admin review UI, festival system, weekly recaps, analytics dashboards, entitlements enforcement: scaffolding/types exist, features are next.
- `DELETE MY DATA` marks the account and stops everything; the actual purge job is an operator action for now.
