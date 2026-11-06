# Trees: architecture for the initial prototype

Trees is a focus timer in the style of [Forest](https://www.forestapp.cc/), minus ads, accounts, and multiplayer. You pick a duration, a tree grows while you stay on the page, and it dies if you leave. Finished trees accumulate into a forest, earn coins, and unlock new species.

This document covers the first functional prototype, plus a sketch of phase 2 (sync). Where it states a decision, it gives the reason, so a later change can weigh the reason and not just the decision.

Sources for Forest's behavior: the [Forest homepage and FAQ](https://www.forestapp.cc/). That is marketing copy, not documentation. It gives no timer limits, no coin rates, and no species costs, so those numbers here are ours.

## 1. Goals and non-goals

### Goals

- A static site on the Azure Static Web Apps free plan, with no API and no database in the prototype.
- Works offline and installs to a phone home screen (PWA).
- The core loop feels right: start, watch the tree grow, finish or fail, see it in the forest.
- No tracking: no analytics, no third-party scripts, no third-party fonts, nothing phoning home.
- Logic that matters (session rules, coins, stats) is pure, takes its clock and ids as inputs, and is unit tested.

### Non-goals for the prototype

- Accounts, sync between devices, any server code (phase 2, section 13).
- Multiplayer ("Plant Together"), friends, leaderboards.
- Ads, subscriptions, tiers. Every feature is free.
- Real-tree planting. It needs a partner and money, not code.
- Blocking other apps. A web page cannot do this (section 3).
- Notifications. See section 3, item 3.

## 2. Feature scope

Forest's feature set as the site describes it, against what the prototype does.

| Forest feature | Prototype | Notes |
| --- | --- | --- |
| Countdown focus timer | Yes | Range and step are named constants (default 10 to 180 min, 5 min step). |
| Stopwatch mode | Yes | Open-ended; you stop it. Section 5.1. |
| Tree grows in real time | Yes | Growth stage is a pure function of elapsed fraction. |
| Tree dies if you leave | Yes | Strict or relaxed (section 5). |
| Dead trees stay in the forest | Yes | Rendered as withered trees. |
| Pause | Yes, free | One pause per session, up to `sessionPauseMaxMs` (5 min). Forest locks pause behind a subscription. |
| Focus tags | Yes | User-created, free. Forest gates custom tags behind Plus. |
| Forest view | Yes | One tile per session. |
| Stats by day, week, month, tag | Yes | Streaks included. |
| Coins and species shop | Yes | Section 7. |
| Seasonal species, daily and monthly missions | No | Content treadmill. |
| Deep Focus, app allowlist, Time Guard | No | Not possible on the web. |
| End-of-session notification | No | Section 3, item 3. A chime plays instead. |
| Ambient sounds | Later | Needs licensed audio assets. |
| Plant Together | No | Out of scope by decision. |
| Real-tree planting | No | Out of scope. |
| Backup | Yes | JSON export and import. Not a Forest feature, but required here (section 6). |

## 3. What the web cannot do

These shape the design more than anything else.

1. **No app blocking, and "leaving" is only a guess.** A page cannot see or stop other apps. It can know that it was hidden: tab switched, window minimized, phone screen locked, browser backgrounded (`visibilitychange`). That signal is not reliable. It does not fire when a process is killed, and a laptop lid closing on a visible page may not fire it. So the design never depends on the event alone: it detects absence from a persisted `lastSeenAt` timestamp (section 5.2). Chrome on desktop also reports a window **fully covered** by another window as hidden, so a maximized app over the browser kills the tree, while a second monitor or a partly covered window does not. The UI says so.
2. **No honest enforcement.** All state lives on the client, so devtools can cheat. This is a personal tool with no leaderboard, so we do not defend against it.
3. **No push when closed.** Without a server, a suspended PWA cannot notify you. The timer is computed from timestamps, so the result is correct when you return, but the alert arrives late. Notifications are cut from the prototype: in strict mode a backgrounded tab is already a dead tree, so a notification only helps relaxed mode, and it costs a lot (`new Notification()` throws on Android Chrome and needs `registration.showNotification`; iOS needs an installed PWA and a user gesture). A chime plays on completion. The `AudioContext` is created or resumed inside the Start click handler, or autoplay policy blocks it.
4. **Timers lie in background tabs.** Browsers throttle timers in hidden tabs (about once a second, and about once a minute under intensive throttling) and suspend them on mobile. Never count ticks. Store `startedAt` and compute from timestamps.
5. **Storage can vanish.** Safari deletes site storage after about 7 days of Safari use without interaction with the site unless the site is installed to the home screen. Other browsers evict under disk pressure unless storage is persistent. Mitigation: call `navigator.storage.persist()` once, and make export one tap (section 6). We do not promise in the UI that persistence protects against Safari's cap; that is unverified.
6. **Safari and the installed app have separate storage on iOS.** A forest built in Safari is not visible in the home-screen app. So the install prompt comes **before the first session**, and moving data between the two goes through export and import with explicit copy.
7. **Screen lock counts as leaving**, since it hides the page. The Wake Lock API keeps the screen on while a session runs, at some battery cost. It does not keep a backgrounded page alive, and the lock is released whenever the page hides, so the app re-acquires it on becoming visible and listens for the lock's `release` event. Wake Lock in iOS home-screen apps has been unreliable on older iOS versions; **verify on a real device** before promising it.

## 4. Stack

Same tooling as [mello](https://github.com/timburr1/mello), so conventions and CI carry over.

| Concern | Choice |
| --- | --- |
| Language | TypeScript, `strict: true` |
| UI | React 19, function components, hooks |
| Build | Vite, `tsc -b` as the type-check gate |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite` |
| PWA | `vite-plugin-pwa` (Workbox), `registerType: 'prompt'`, app-shell caching only |
| Tests | Vitest, `TZ=America/Denver` pinned |
| Lint | ESLint flat config, `typescript-eslint`, `react-hooks`, `react-refresh`, `no-floating-promises` as an error |
| Hosting | Azure Static Web Apps, Free plan, GitHub Actions |
| State | A small store (section 5.3) exposed through context. No Redux, no router library. |
| Persistence | `localStorage`, validated on read |
| Charts | Hand-rolled SVG |

Versions: scaffold with current releases and pin whatever resolves. Mello has no formatter, but CLAUDE.md calls one non-negotiable, so this project adds Prettier at print width 160 alongside ESLint. Tree art is procedural SVG driven by species data (section 8), so there are no image assets to license or load.

`registerType: 'prompt'` matters: with `autoUpdate`, a new service worker reloads the page, and a reload landing in a hidden tab can fall outside the grace window. Updates apply only while no session is running.

## 5. Session logic (the core)

### 5.1 Model

An **active session** is the one running timer. At most one exists.

```ts
type SessionActive = {
  readonly id: string;
  readonly startedAt: number;       // epoch ms
  readonly mode: SessionMode;
  readonly tagId: string | undefined;
  readonly speciesId: string;
  readonly strictness: Strictness;  // snapshot at start
  readonly lastSeenAt: number;      // last moment the page was known visible
  readonly pausedMs: number;        // total time spent in finished pauses
  readonly pausedAt: number | undefined; // set while paused
};

type SessionMode = { kind: 'countdown'; plannedMs: number } | { kind: 'stopwatch' };
type Strictness = 'strict' | 'relaxed';
```

A **finished session** is immutable:

```ts
type SessionFinished = {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly mode: SessionMode;
  readonly pausedMs: number;
  readonly tagId: string | undefined;
  readonly speciesId: string;
  readonly outcome: { kind: 'completed' } | { kind: 'failed'; reason: 'gave-up' | 'left' };
};
```

`strict` fails the session when the page is away longer than `sessionGraceMs` (a named constant, 15 s). `relaxed` fails only on an explicit give-up. Strict is the default. The product is desktop-first; phones work best in relaxed mode (open question 1).

**Stopwatch** sessions have no planned end. They complete through a `sessionStop` action, or by themselves after `timerMaxMs` of active time (3 hours), so an abandoned relaxed stopwatch cannot bank unbounded focus time. Strict absence still fails them. Growth is `elapsed / stopwatchFullMs` (a named constant, default 60 min) capped at fully grown, and coins use elapsed active time. **Pause** is allowed once per session. `sessionPause` sets `pausedAt` and `lastSeenAt = now` (the user just acted); a touch is ignored while paused; `sessionResume` adds the pause length to `pausedMs` (at least 1 ms, so `pausedMs > 0` always marks the pause as used, even after a backward clock), clears `pausedAt`, and sets `lastSeenAt = now`. While paused the clock is frozen and absence is ignored. A pause that outlasts `sessionPauseMaxMs` auto-resumes at `pausedAt + sessionPauseMaxMs` with `lastSeenAt` set to that instant, so the normal absence rule then fails a strict session whose user never came back.

### 5.2 Detecting absence

The app persists one field, `lastSeenAt`. The pure resolver:

```ts
type SessionResolution =
  | { kind: 'running' }
  | { kind: 'completed'; at: number }
  | { kind: 'failed'; at: number; reason: 'left' };

// Takes the raw stored session, expires an over-long pause itself, and returns the expired session with the resolution.
function sessionResolve(raw: SessionActive, now: number): { active: SessionActive; resolution: SessionResolution } {
  const active = sessionPauseExpire(raw, now);
  if (active.pausedAt !== undefined) {
    return { active, resolution: { kind: 'running' } };
  }
  const endsAt = sessionEndsAt(active); // countdown: startedAt + plannedMs + pausedMs; stopwatch: startedAt + timerMaxMs + pausedMs
  const failsAt = active.lastSeenAt + sessionGraceMs;
  if (active.strictness === 'strict' && failsAt < endsAt && now > failsAt) {
    return { active, resolution: { kind: 'failed', at: failsAt, reason: 'left' } };
  }
  if (now >= endsAt) {
    return { active, resolution: { kind: 'completed', at: endsAt } };
  }
  return { active, resolution: { kind: 'running' } };
}
```

`sessionPauseExpire` is the pure auto-resume described above: if `pausedAt + pauseMaxMs <= now`, it returns the session resumed at that instant, with `lastSeenAt = max(lastSeenAt, thatInstant)`. It returns the same object when nothing expired. `sessionElapsedMs(active, now)` (active time, excluding pauses, clamped at 0) and `sessionRemainingMs(active, now)` (what a countdown displays; frozen while paused) are exported so the countdown, the title, and tree growth never re-derive the formula. `sessionEndsAt(active)` is the wall-clock end if no pause starts; it ignores an open pause, so it is not for display. The constants (`sessionGraceMs`, `sessionPauseMaxMs`, `timerMaxMs`) are imported from config directly: there is one value of each, so an injected rules object would add nothing.

Why this shape:

- One comparison covers every way of leaving: tab switch, screen lock, browser kill, tab discard, crash, sleep. In all of them `lastSeenAt` stops advancing, and the gap shows at the next resolve.
- Leaving within the grace period of the planned end completes the session (`failsAt >= endsAt`).
- The grace period is many times the tick interval. A main thread blocked longer than the grace period would fail a session; accepted.
- A wall-clock jump forward of more than the grace period while visible (NTP correction, the user editing the system time) would fail a strict session falsely. Accepted and documented. A jump backward leaves `lastSeenAt` in the future until the next seen touch, which sets it to `now` (not `max`) so the correction takes effect at once; elapsed time clamps at zero. A forward jump over the grace period while a pause is open expires the pause early and fails a present strict user, which is the same accepted risk.

**The ordering rule that makes this correct.** Updating `lastSeenAt` before resolving erases the gap it is meant to reveal (a laptop wakes, a heartbeat fires first, and an hour of sleep vanishes). So there is exactly one action that touches the clock, and it always resolves first:

```ts
type ActionSessionTouch = { kind: 'sessionTouch'; now: number; seen: boolean };
```

`sessionTouch` resolves the active session at `now`. Only if the result is still `running` **and** `seen` is true does it set `lastSeenAt = now`. Every event source dispatches only this:

| Source | `seen` |
| --- | --- |
| 1 s interval tick | `document.visibilityState === 'visible'` |
| `visibilitychange` to hidden | `true` (the page was visible until this instant; the resolve-first rule catches a hidden event that arrives late after sleep) |
| `visibilitychange` to visible, `pageshow`, `resume`, `focus`, initial load | `document.visibilityState === 'visible'` |
| `pagehide` | `true`, then a final synchronous save |

A page that loads hidden (session restore, background tab) resolves but does not touch.

Every other session action (`sessionStart`, `sessionGiveUp`, `sessionPause`, `sessionResume`, `sessionStop`) also runs `sessionResolve(now)` first. A Give Up pressed 500 ms after the planned end records a completion, not a give-up; one pressed on a restored stale page records `left`.

**Reducer result and rejections.** `sessionReduce(state, action)` returns `{ state, finished, rejection }`. `finished` is the session that finished during the call, whether the clock settled it or the action did, so the UI plays the chime and shows the result without diffing states. `rejection` is one of `session-already-active`, `no-active-session`, `already-paused`, `pause-used`, `not-paused`, `unknown-tag`: races a user causes by acting on a stale screen. Programming mistakes throw a plain `Error` (Stop on a countdown, a countdown outside the timer range, which the UI clamps). When the clock had already finished the session, the action is moot: the result carries `finished` and no rejection, and the UI shows the result screen. A rejection therefore always means "nothing happened". Handling in the UI: a race code is logged to the console and ignored; `unknown-tag` raises a status warning and clears the tag picker. A finished record's `endedAt` is never later than the real `now` (a clock set back shrinks `pausedMs` so active time stays non-negative instead of moving `endedAt` into the future). Species ownership is checked when coins arrive (step 7).

**Accepted risks.** A relaxed stopwatch abandoned for days still records a 3-hour completion; the cap only bounds it. A clock set back during a pause stretches the real pause past `sessionPauseMaxMs`. A session started while the clock is far ahead keeps running until given up, and its record carries the clock's date.

**Requirement on the store.** While `guard.corrupt.sessions` is set, the store must stop dispatching session actions and show a blocking status: a clock-driven finish would otherwise make `storageSave` throw on every tick.

There is one 1 s interval, not a separate heartbeat. Writing about 200 bytes a second is nothing.

### 5.3 State and persistence flow

State lives in a small store held outside React render (a ref plus subscribers, exposed by `AppProvider`). `useReducer` is not used because saves must be synchronous with the action, not an effect that runs after render.

```
event → dispatch(action) → next = reduce(current, action)
                          → persist changed slices, synchronously, in fixed order
                          → notify subscribers
```

Rules:

- **Per-slice writes.** `persist(prev, next)` compares slice references and writes only the changed ones. A tick writes only `active`.
- **Finishing is ordered.** When an action finishes a session, write `sessions` first, then remove `active`. If the page dies in between, hydration sees an `active` whose id is already in `sessions` and drops it. No duplicate, no lost session.
- **Give-up, completion, and failure save synchronously** inside `dispatch`, so a kill right after the click cannot resurrect a given-up session.
- **Ids and time come in the action payload** (`id`, `now`), supplied by the caller, so the reducer is deterministic.

After a session finishes the UI shows a result screen until dismissed. `lastAcknowledgedId` is persisted (section 6), so reopening the app does not replay it.

### 5.4 One owner tab

Two tabs on the same origin would each run a tick, hold stale state, and overwrite each other: a given-up session coming back to life from a stale `active`, a finished session erased by a stale `sessions` array, a completion recorded twice and paid twice. So exactly one tab runs the app.

- On load, the tab requests `navigator.locks.request('trees:owner', { ifAvailable: true }, ...)` and holds it for the page's lifetime.
- A tab that does not get the lock renders a "Trees is open in another tab" screen with a **Use here** button, which requests the lock with `steal: true` and hydrates fresh from storage.
- A tab that loses the lock to a steal drops to the same screen and discards its in-memory state.
- Defense in depth: `sessions` is deduplicated by id on every read.

A held Web Lock may keep a page out of the back/forward cache in some browsers; check during the manual smoke.

### 5.5 Browser wiring

`useSessionRunner` is plumbing: it registers the interval and event listeners from the table above, maps them to `sessionTouch`, manages Wake Lock (acquire on start and on becoming visible, listen for `release`), plays the chime, and updates `document.title` with the countdown. It has no injected effect sources and no unit tests; the logic it forwards to is covered in the reducer, and the rest is covered by the manual smoke (section 14).

## 6. Persistence

`localStorage`, one key per collection, under a `trees:v1:` prefix. The version lives in the prefix and in the export file. A migration framework is added when v2 exists, not before.

| Key | Contents | Written |
| --- | --- | --- |
| `trees:v1:active` | `SessionActive` or absent | each tick while visible |
| `trees:v1:sessions` | `SessionFinished[]` | on session end |
| `trees:v1:tags` | `Tag[]` | on tag create or archive |
| `trees:v1:purchases` | `Purchase[]` | on purchase |
| `trees:v1:settings` | `Settings` | on settings edit |
| `trees:v1:ui` | `{ lastAcknowledgedId, lastExportedAt }` | on dismiss or export |

`active` has its own key so a tick rewrites 200 bytes and never the session history. The storage code takes a `Storage` (the DOM interface) as a parameter; tests pass a `Map`-backed fake.

**Size.** A finished session is about 200 bytes. At ten a day that is under 1 MB per year against a roughly 5 MB quota. If it ever binds, move `sessions` to IndexedDB; only the storage module changes.

**Validation.** Everything read goes through `coerce*` functions at the boundary and downstream code trusts the types. Validation is **per record**: one bad session is rejected and counted, and the rest load. The count is reported in the status area, not hidden. Rejected records are **kept**: the loader hands them to every later save, which appends them unchanged to their slice, so a validator tightened in a later release never deletes data. Settings are validated for type only; the UI clamps values to the current timer range, so a release that narrows the range cannot lock a user out of their own settings.

**Errors have a channel.** The app state carries a `status` list rendered by `StatusBanner`, and every entry is also logged to the console. Error classes, category first: `ErrorStorageCorrupt`, `ErrorStorageQuota` (a `setItem` that throws `QuotaExceededError`), `ErrorImportInvalid`. Wake Lock failures (`NotAllowedError` when hidden or on battery saver) and `AudioContext` failures surface as warnings through the same channel, with a hint.

**Corrupt data stays put.** If a key cannot be parsed at all (not a bad record, but unreadable), the app marks that slice corrupt in state, **skips saving that key** while it is corrupt, disables the actions that need it, and offers to export the raw string. Without this, the first save would overwrite the evidence. A corrupt `active` alone drops the session with a visible warning and does not block the app. Saving refuses to remove the active session while `sessions` is corrupt, because the finished record could not be written; the caller must block finishing a session in that state. If a save throws partway (for example on quota), the caller keeps its previous baseline and retries; rewriting a slice is idempotent. When hydration drops an `active` whose id is already in `sessions`, it also removes that key from disk, so the orphan cannot return as a second record.

**Hydration.** Persistence is gated on a `hydrated` flag so the first render cannot write empty state over stored data. Hydration drops an `active` whose id is already in `sessions`.

**Backup.** Settings has Export (one JSON file with all collections and a `schemaVersion`) and Import (validated through the same `coerce*` functions, preview of counts, replace after confirmation, never a partial apply). The export is also the way out of the app. On iOS an installed PWA, a plain `a[download]` blob link historically opened a viewer or failed; use `navigator.share({ files })` where available and **verify on a real device**. Import and Reset are blocked while a session is running.

## 7. Economy

Balance is **derived**: `coinsBalance = sum(earned over completed sessions) - sum(purchase costs)`. A stored balance can drift; a derived one cannot.

- `coinsEarned(session)`: zero for failed sessions; for completed, `floor(activeMs / coinsPeriodMs)` with `coinsPeriodMs` of 5 minutes (tune by feel), where `activeMs` is the planned time for a countdown and `endedAt - startedAt - pausedMs` for a stopwatch.
- A purchase is `{ speciesId, at, cost }`, append-only, with the cost recorded at purchase time so re-pricing never rewrites history.
- The reducer **rejects** buying an already owned species and buying with insufficient balance, so a double tap cannot charge twice.
- One species costs 0 and is owned from the start. "Owned" means "free or has a purchase". Planting an unowned species is rejected by the reducer as well as blocked in the UI.

No streak bonus, daily mission, or decay. Those drive engagement, not focus.

## 8. Trees and the forest

### 8.1 Species as data

`species-catalog.ts` is a typed array. A species is parameters for one procedural SVG renderer:

```ts
type Species = {
  readonly id: string;
  readonly name: string;                       // plain tree name
  readonly cost: number;
  readonly shape: 'round' | 'cone' | 'tiered';
  readonly trunkColor: string;
  readonly leafColors: readonly string[];      // one per growth stage
};
```

A catalog test enforces unique ids, nonnegative costs, exactly one free species, and `leafColors.length === STAGE_COUNT`. The prototype ships about five species. No flavor text is written.

**Catalog entries are never deleted.** Old sessions and purchases reference ids forever, and that is a written rule, since no test can enforce it across versions. An unknown id still renders as a generic tree and raises a status warning, so a mistake degrades instead of crashing.

### 8.2 Growth

`growthStage(progress, STAGE_COUNT)` maps elapsed fraction in [0, 1] to a stage: seed, sprout, sapling, young tree, full tree. The renderer applies a short CSS transition. A dead tree is the same shape withered: bare trunk, desaturated canopy.

### 8.3 Forest view

One `ForestTile` per finished session in a CSS grid, chronological, grouped under day headings, with a period switch (today, week, month). Placement is by order, so the forest never reshuffles. A tile opens details: start time, duration, tag, outcome. Isometric land, terrain, and animation beyond growth are out of scope. The art is the weakest part of the prototype and the easiest to improve without touching logic.

## 9. Stats

Pure functions over `SessionFinished[]`, in `stats-*.ts`:

- `statsBucket(sessions, granularity, range)`: focused minutes and completed or failed counts per day, week, or month.
- `statsTag(sessions, range)`: minutes per tag.
- `statsStreak(sessions, today)`: current and longest runs of consecutive days with a completed session. **The current streak counts a run ending today or yesterday**, or it reads 0 every morning until the first session.

Only completed sessions count as focused time. "Today" is derived from an injected clock at render, and the Forest and Stats screens re-render once a minute, so a tab left open overnight rolls over.

**Day bucketing uses local-time date parts only.** Never add 24 h of milliseconds to a date: it works until a daylight-saving change, then the boundary moves by an hour (mello's recurrence code documents the same hazard). A session belongs to the local day it started in. Week start is a Sunday or Monday setting, default Sunday; there is no locale detection (the needed `Intl` week info is not in every browser). Tests run under `TZ=America/Denver` across both DST transitions.

## 10. UI

Five screens in a bottom tab bar (mobile) or side rail (desktop). Tab state is in memory; there is no router. The SWA fallback rule still serves `index.html` for any path.

| Screen | Contents |
| --- | --- |
| Focus | Idle: duration dial, tag picker, species picker, Start. Running: growing tree, countdown, Give Up (confirmed). Result: outcome and coins earned. Install prompt before the first session on iOS. |
| Forest | Section 8.3. |
| Stats | Period switch, totals, per-tag breakdown, streaks. |
| Shop | Species grid with cost and owned state, coin balance. |
| Settings | Strictness, default duration, sound, week start, tag management, export, import, reset. |

A `StatusBanner` shows storage and platform warnings (section 6). Component names are category first: `ForestGrid`, `ForestTile`, `StatsBars`, `StatsSummary`, `TreeSprite`, `TimerDial`, `TimerCountdown`, `ShopCard`.

Dark and light via `prefers-color-scheme`. Keyboard operable, visible focus, enough contrast. The countdown is not announced every second to screen readers; announce start, halfway, and finish. The UI states what "leaving" means (including fully covered windows on desktop, section 3).

## 11. Module map

```
index.html
src/
  main.tsx
  App.tsx
  lib/                          pure: no DOM, no Date.now(), no randomness, no storage
    types.ts                    data model
    config.ts                   named constants, category first: timerMinMs, timerMaxMs, timerDefaultMs, sessionGraceMs, sessionPauseMaxMs so far; each later step adds the ones it uses
    session-reduce.ts           reducer; every session action resolves first
    session-resolve.ts          section 5.2: sessionResolve, sessionPauseExpire, sessionEndsAt, sessionElapsedMs, SessionRules
    coins-balance.ts
    species-catalog.ts          data
    growth-stage.ts
    stats-bucket.ts
    stats-tag.ts
    stats-streak.ts
    time-local.ts               local date-part helpers (added with the stats in step 8)
    storage-coerce.ts           validators; the trust boundary
    storage-slices.ts           slice names and write order, storage keys, StorageLike, StorageGuard
    storage-load.ts             storageLoad(storage): data, problems, guard; hydration rules
    storage-save.ts             storageSave(prev, next, storage, guard): ordered per-slice writes
    backup-export.ts
    backup-import.ts
    errors.ts                   ErrorStorageCorrupt, ErrorStorageQuota, ErrorImportInvalid
  platform/                     thin browser wrappers
    id.ts                       crypto.randomUUID
    lock-owner.ts               Web Lock ownership (section 5.4)
    wake-lock.ts
    chime.ts
  hooks/
    AppProvider.tsx             store, hydration, dispatch wrapper
    useSessionRunner.ts         section 5.5
    useApp.ts
  components/                   section 10
public/
  favicon.svg
  icons/                        192, 512, maskable
  staticwebapp.config.json
.github/workflows/azure-static-web-apps.yml
docs/design.md
```

Dependencies point one way: `components → hooks → lib`, and `hooks → platform`. `lib` imports nothing from the other layers.

## 12. Deployment

Azure Static Web Apps, Free plan, deployed from GitHub Actions on every push to `main`, with preview environments for PRs. The free plan limits how many preview environments can exist at once (I believe three; check), so close PRs promptly. There is no `api/` directory in the prototype.

- The workflow runs `npm ci`, lint, test, build, then uploads `dist/`. It mirrors mello's workflow minus the Functions build.
- `public/staticwebapp.config.json` is copied to `dist/` by Vite. It sets `navigationFallback` to `/index.html`, and its `exclude` list must cover `/manifest.webmanifest`, `/icons/*`, `/favicon.svg`, `sw.js`, and `workbox-*.js` (mello's CLAUDE.md warns about exactly this). It also sets a `Content-Security-Policy` of `default-src 'self'` plus whatever the build proves necessary: register the service worker as a script (`injectRegister: 'script'` or the virtual module), not inline, and add `img-src` exceptions only if some SVG or image uses `data:` or `blob:` URLs. It sets `X-Content-Type-Options` and `Referrer-Policy`. No auth section.
- The service worker caches the app shell only.
- Free-plan bandwidth, storage, and domain limits are far above a small static bundle's needs. Check the current numbers before relying on any.

## 13. Phase 2: sync (not built)

Goal: the same forest on phone and laptop, built after the local prototype works. Mello already runs this pattern as a static app with a managed Functions API in the same Static Web Apps resource, so the hosting model does not change. Reuse mello's `api/` project and client sync code as the starting point.

What the data model already gives:

- Finished sessions, purchases, and tag creations are **append-only and immutable**. Merging two devices is a union by `id`, with no last-write-wins and no tombstones for those collections.
- Mutable data is limited to tag archive and settings. Add `updatedAt` to those at that point (not before) and reuse mello's last-write-wins rule.

Changes from mello:

- **Database:** a separate `trees` database in mello's existing Cosmos account. The free tier allows one account per subscription, so a second account would bill. Throughput is 400 RU/s shared at the database level, never dedicated to a container (dedicated throughput is what makes a free account billable). Together with mello's 400, that is 800 RU/s, under the free 1000. Keep mello's account-wide throughput limit.
- **Auth:** SWA's built-in GitHub sign-in, with `userId` taken from `x-ms-client-principal`, never from the request body.
- **Local-first stays:** `localStorage` remains the working copy. Sync is a debounced background push and a pull on open.
- **Running trees on a second device:** push the active session once, at start. The second device draws growth from `startedAt` and `plannedMs` with no live feed (a per-second write to Cosmos would waste RUs). Its limit is that only the running device knows the page was hidden, and a suspended phone cannot reliably push a failure. The second device may show a living tree until the planned end and then correct itself on the next sync. Active sessions are otherwise never merged; a running timer belongs to one device.
- **Owner tab (5.4)** still applies per device. Sync pulls go through the same dispatch path as local actions.

## 14. Testing

Unit tests (Vitest, beside the module) target the seams where bugs are silent. The session rules are written first and shown failing before the implementation.

| Subject | Cases |
| --- | --- |
| `sessionResolve` | Visible throughout; away less than grace; away more than grace; away longer than the whole session; leaves within the grace window of the end (completes); relaxed never fails on absence; exact boundaries (`now == failsAt`, `now == endsAt`); resume long after the end. |
| `sessionReduce` touch ordering | Hidden event arriving after a long sleep does not erase the gap; a tick before the resolving event does not erase it; `seen: false` never moves `lastSeenAt`; load while hidden resolves without touching. |
| `sessionReduce` actions | Start rejects a second active session; completion and failure each append one finished session and clear `active`; give-up after `endsAt` records a completion; give-up on a stale session records `left`; stale actions after finishing are no-ops. |
| `storageSave` and hydration | `sessions` written before `active` removed; hydration drops an `active` whose id is in `sessions`; per-slice writes (a tick does not touch `sessions`); a corrupt slice is not overwritten; a quota error is reported. |
| Tab ownership reducer rules | Duplicate ids in `sessions` are deduplicated on read. (The lock itself is covered by manual smoke.) |
| `coinsBalance` and purchases | Failed sessions earn nothing; balance matches purchases; re-pricing does not change history; double purchase and insufficient balance are rejected. |
| `growthStage` | Monotonic; endpoints; clamps out-of-range input; stopwatch progress caps at fully grown. |
| Pause and stopwatch | Pause freezes the clock and ignores absence; resume extends `endsAt` by the pause length; a second pause is rejected; a pause past `sessionPauseMaxMs` auto-resumes and then fails a strict session whose user stayed away; a stopwatch completes on stop or at `timerMaxMs` of active time, and still fails on absence; stopwatch coins use elapsed active time. |
| `statsBucket`, `statsStreak` | Both DST transitions in `America/Denver`; 23:30 and 00:30 local sessions; week start; empty input; a streak with no session yet today still counts through yesterday. A guard test fails if `TZ` stops being pinned. |
| `storageCoerce` | Valid, missing fields, wrong types, hand-edited garbage; one bad record rejects only that record; each failure yields a specific error. |
| Backup | Round-trip; invalid files rejected with a specific error; import never partially applies; `lastAcknowledgedId` survives a reload. |
| Catalog | Unique ids, nonnegative costs, exactly one free species, `leafColors.length === STAGE_COUNT`. |

Not unit-tested, and reported as such: SVG rendering, layout, Web Locks, Wake Lock, audio, and the `useSessionRunner` wiring. These get a written manual smoke checklist run on a real phone and a desktop: start; switch tabs under and over the grace period; cover the window fully; lock the phone; close the laptop lid and reopen; kill and reopen mid-session; open a second tab and use "Use here"; install the PWA; go offline; export on iOS standalone. A Playwright test using its fake clock for one end-to-end timer run is a reasonable follow-up.

## 15. Implementation sequence

Each step is one commit (or a short series) that builds and passes the suite on its own.

1. Scaffold: Vite, TypeScript, React, Tailwind, ESLint, formatter, Vitest; CI workflow; an empty app that deploys.
2. Types, errors, `storage-coerce`, `storage-load`, `storage-save`, and tests. (`time-local` moves to step 8 with its first user.)
3. `session-resolve` and `session-reduce`, tests first.
4. Store, `AppProvider`, owner lock, Focus screen, `useSessionRunner`, with a placeholder tree.
5. Species catalog, growth stages, `TreeSprite`.
6. Forest screen.
7. Coins, purchases, Shop.
8. Stats.
9. Settings, backup export and import, `StatusBanner`.
10. PWA manifest, icons, service worker, SWA and CSP config.

**Before step 4 finishes, test strict mode on a real phone** (open question 1).

## 16. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Strict mode on phones: pressing power kills the tree, the opposite of Forest's put-the-phone-down use | The core promise feels broken on mobile | Open question 1; real-device test early; Wake Lock; relaxed mode |
| Wake Lock unsupported, denied, or unreliable in iOS standalone | Screen locks mid-session | Feature-detect; warn through `StatusBanner`; verify on device |
| Safari evicts storage; iOS Safari and the installed app are separate stores | User loses or never sees their forest | Install prompt before the first session; one-tap export; `lastExportedAt` shown in Settings |
| Two tabs corrupt data | Resurrected or duplicated sessions | Owner lock, dedupe by id, write ordering (sections 5.3, 5.4) |
| Absence erased by event ordering | A tree survives sleep it should not | Single `sessionTouch` action, resolve first (section 5.2) |
| Clock changes (manual edit, NTP, DST, travel) | Wrong elapsed time | Epoch ms is immune to DST and zone; a forward jump over the grace period while visible fails a strict session, which is accepted; day bucketing uses the zone at read time, so travel reshuffles past days, also accepted |
| Procedural SVG trees look flat | The app feels cheap | Isolated behind `TreeSprite` and species data |

## 17. Decisions and open questions

Decided:

- **Desktop-first is acceptable.** Strict stays the default with a 15 s grace period and a relaxed option. If real-device testing shows phones are unusable in strict mode, the remaining choices are relaxed by default on touch devices or a first-run choice (open question 1).
- **Stopwatch mode and one free pause per session are in the prototype** (section 5.1).
- **Formatter: Prettier at width 160** alongside ESLint.
- **Sync is phase 2** (section 13).

Still open, each with the default the design assumes:

1. **Phone default.** Decide after the real-device test in section 15.
2. **App and repo name.** Assumed "Trees".
3. **Changelog.** Assumed none until the first deployed release.
4. **Sounds.** Assumed one synthesized chime (Web Audio, no asset files) and nothing else.
