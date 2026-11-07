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
| Charts | A table with CSS bars (SVG is only for trees) |

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

**Reducer result and rejections.** `sessionReduce(state, action)` returns `{ state, finished, rejection }`. `finished` is the session that finished during the call, whether the clock settled it or the action did, so the UI plays the chime and shows the result without diffing states. `rejection` is one of `session-already-active`, `no-active-session`, `already-paused`, `pause-used`, `not-paused`, `unknown-tag`, `species-not-owned`: races a user causes by acting on a stale screen. Programming mistakes throw a plain `Error` (Stop on a countdown, a countdown outside the timer range, which the UI clamps). When the clock had already finished the session, the action is moot: the result carries `finished` and no rejection, and the UI shows the result screen. A rejection therefore always means "nothing happened". Handling in the UI: a race code is logged to the console and ignored; `unknown-tag` raises a status warning and clears the tag picker. A finished record's `endedAt` is never later than the real `now` (a clock set back shrinks `pausedMs` so active time stays non-negative instead of moving `endedAt` into the future). `sessionStart` also checks that the species is owned (`species-not-owned`; an id the catalog lacks is never owned), after the running-session and tag checks.

**Accepted risks.** A relaxed stopwatch abandoned for days still records a 3-hour completion; the cap only bounds it. A clock set back during a pause stretches the real pause past `sessionPauseMaxMs`. A session started while the clock is far ahead keeps running until given up, and its record carries the clock's date.

**Requirement on the store.** While `guard.corrupt.sessions` is set, the store must stop dispatching session actions and show a blocking status: a clock-driven finish would otherwise make `storageSave` throw on every tick.

There is one 1 s interval, not a separate heartbeat. Writing about 200 bytes a second is nothing.

### 5.3 State and persistence flow

State lives in a small store held outside React render (`lib/store-app.ts`: `getState`, `subscribe`, and one internal `commit` path that every write goes through; React reads it with `useSyncExternalStore`). `useReducer` is not used because saves must be synchronous with the action, not an effect that runs after render.

```
event → dispatch(action) → next = reduce(current, action)
                          → persist changed slices, synchronously, in fixed order
                          → notify subscribers
```

Rules:

- **Baseline versus state.** The store keeps what is known to be on disk (`baseline`) apart from what the user sees. A failed save advances the in-memory state but not the baseline, so the next commit rewrites the slices that failed.
- **Per-slice writes.** `persist(prev, next)` compares slice references and writes only the changed ones. A tick writes only `active`.
- **Finishing is ordered.** When an action finishes a session, write `sessions` first, then remove `active`. If the page dies in between, hydration sees an `active` whose id is already in `sessions` and drops it. No duplicate, no lost session.
- **Give-up, completion, and failure save synchronously** inside `dispatch`, so a kill right after the click cannot resurrect a given-up session.
- **Ids and time come in the action payload** (`id`, `now`), supplied by the caller, so the reducer is deterministic.

After a session finishes the UI shows a result screen until dismissed. `lastAcknowledgedId` is persisted (section 6), so reopening the app does not replay it.

### 5.4 One owner tab

Two tabs on the same origin would each run a tick, hold stale state, and overwrite each other: a given-up session coming back to life from a stale `active`, a finished session erased by a stale `sessions` array, a completion recorded twice and paid twice. So exactly one tab runs the app.

- At page load, **outside React**, the app controller (`platform/app-controller.ts`) requests `navigator.locks.request('trees:owner', { ifAvailable: true }, ...)` and holds it for the page's lifetime. It must not live in an effect: a Web Lock cannot be released synchronously, so StrictMode's double mount would lose the lock to itself. The store is created only after the lock is won.
- A tab that does not get the lock renders a "Trees is open in another tab" screen with a **Use here** button, which requests the lock with `steal: true` and builds a fresh store from storage.
- A tab that loses the lock to a steal (its request rejects with `AbortError`) drops to the same screen and discards its store.
- **Write fence.** A tab may not hear it lost the lock before it writes (frozen or backgrounded tab, `pagehide` of a closing tab). So the store writes `trees:v1:owner = <tabId>` on creation and checks the key still equals its id before every write. A mismatch refuses the write, kills the store permanently, and drops the controller to the "other tab" screen. A `storage` event on the owner key runs the same check at once, so a tab learns it lost ownership without waiting for its next write. This narrows the window but is not a mutex: browsers deliver other tabs' localStorage writes asynchronously, so a frozen tab that wakes can still slip one write in before it hears. The lock is the primary guard and the fence is the backstop.
- Without Web Locks (insecure context, old browser) the app proceeds as owner and shows a warning; only the fence guards the data, and it is weaker there.
- Defense in depth: `sessions` is deduplicated by id on every read.
- **Back/forward cache.** On `pagehide` with `persisted`, the controller releases the lock and drops the store; on `pageshow` with `persisted` it starts again from storage. The session survives through its timestamps.

A held Web Lock may keep a page out of the back/forward cache in some browsers; check during the manual smoke.

### 5.5 Browser wiring

`useSessionRunner` is plumbing: it registers the interval and event listeners from the table above, maps them to `sessionTouch`, plays the chime, and updates `document.title` with the countdown. It has no injected effect sources and no unit tests; the logic it forwards to is covered in the reducer, and the rest is covered by the manual smoke (section 14). Its callbacks read `store.getState()` when they run, and its effect depends on the session id only, so a tick does not tear down and re-register listeners.

- **Presence.** The interval and `pageshow`, `focus`, and `resume` report `seen: visible`. `visibilitychange` (either direction) and `pagehide` report `seen: true`: hiding records when the user left, and showing runs after settling, so a strict session that overstayed the grace period has already failed.
- **Wake Lock** (`platform/wake-lock.ts`, with a small fake-driven test) is held for the whole session, **pauses included**, so a phone does not lock mid-pause and fail a strict session on return. A sentinel that arrives after `stop` is released at once; the lock is requested again whenever the page becomes visible; a warning appears only when the lock is released while the page is visible (the system took it, for example battery saver), never for the normal release at hide.
- **Chime.** It plays only when a runner-dispatched touch returns a `finished` completion whose `endedAt` is under 90 s old (a hidden tab's timer can be throttled to once a minute). So there is no chime for the settle at page load, for a manual Stop or Give Up, or for a completion found after waking from sleep. The `AudioContext` is unlocked after a successful Start (audio is optional and must never block a session) and on every `click`, `pointerup`, or `keydown`, because a reload mid-session has no Start click and `pointerdown` does not count as user activation on touch; a chime due while the context is suspended tries `resume()` first; `navigator.audioSession.type = 'playback'` is set where it exists so iOS does not mute it under the ringer switch. A still-suspended context at chime time becomes a warning.
- **Render clock.** Components take `now` from `useClock` and display from `sessionResolve(active, now).active`, so an expired pause never reads as paused.

**Errors reach the user.** Save failures become `StatusBanner` entries and log lines, never rethrows from a timer. Entries are keyed by `code`, so a full disk shows one entry and not one per second, and a successful save clears it. The window `error` and `unhandledrejection` events route to the store's status when one exists and to an alert region in `index.html` otherwise. React's `onUncaughtError` always uses the alert region, because an uncaught render error unmounts the tree and a store banner would never show; `onRecoverableError` is only logged. A status entry that repeats unchanged keeps its identity, and one the user dismissed stays hidden until its condition clears.

**Secure context.** `crypto.randomUUID`, Web Locks, and Wake Lock exist only over HTTPS or on localhost. Testing on a phone against a plain-HTTP LAN address cannot start a session; use a tunnel, the `preview` build behind HTTPS, or the SWA preview environment.

## 6. Persistence

`localStorage`, one key per collection, under a `trees:v1:` prefix. The version lives in the prefix and in the export file. A migration framework is added when v2 exists, not before.

| Key | Contents | Written |
| --- | --- | --- |
| `trees:v1:active` | `SessionActive` or absent | each tick while visible |
| `trees:v1:sessions` | `SessionFinished[]` | on session end |
| `trees:v1:tags` | `Tag[]` | on tag create or archive |
| `trees:v1:purchases` | `Purchase[]` (`id`, `speciesId`, `at`, whole-number `cost`; deduplicated by `id` on load) | on purchase |
| `trees:v1:settings` | `Settings` | on settings edit |
| `trees:v1:ui` | `{ lastAcknowledgedId, lastExportedAt }` | on dismiss or export |

`active` has its own key so a tick rewrites 200 bytes and never the session history. The storage code takes a `Storage` (the DOM interface) as a parameter; tests pass a `Map`-backed fake.

**Size.** A finished session is about 200 bytes. At ten a day that is under 1 MB per year against a roughly 5 MB quota. If it ever binds, move `sessions` to IndexedDB; only the storage module changes.

**Validation.** Everything read goes through `coerce*` functions at the boundary and downstream code trusts the types. Validation is **per record**: one bad session is rejected and counted, and the rest load. The count is reported in the status area, not hidden. Rejected records are **kept**: the loader hands them to every later save, which appends them unchanged to their slice, so a validator tightened in a later release never deletes data. Settings are validated for type only; the UI clamps values to the current timer range, so a release that narrows the range cannot lock a user out of their own settings.

**Errors have a channel.** The app state carries a `status` list rendered by `StatusBanner`, and every entry is also logged to the console. Error classes, category first: `ErrorStorageCorrupt`, `ErrorStorageQuota` (a `setItem` that throws `QuotaExceededError`), `ErrorImportInvalid`. Wake Lock failures (`NotAllowedError` when hidden or on battery saver) and `AudioContext` failures surface as warnings through the same channel, with a hint.

**Corrupt data stays put.** If a key cannot be parsed at all (not a bad record, but unreadable), the app marks that slice corrupt in state, **skips saving that key** while it is corrupt, disables the actions that need it, and offers to export the raw string. Without this, the first save would overwrite the evidence. A corrupt `active` alone drops the session with a visible warning and does not block the app. Saving refuses to remove the active session while `sessions` is corrupt, because the finished record could not be written; the caller must block finishing a session in that state. If a save throws partway (for example on quota), the caller keeps its previous baseline and retries; rewriting a slice is idempotent. When hydration drops an `active` whose id is already in `sessions`, it also removes that key from disk, so the orphan cannot return as a second record.

**Hydration.** Persistence is gated on a `hydrated` flag so the first render cannot write empty state over stored data. Hydration drops an `active` whose id is already in `sessions`.

**Backup.** Settings has Export, Import, and Reset (`SettingsData`). The file is `{ app: 'trees', schemaVersion, exportedAt, sessions, tags, purchases, settings }`; the running session and `ui` stay out. **Rejected records are written back into their lists as they are on disk**, so export then import loses nothing, and **export is off while a slice is unreadable** (its fallback would be written as real data); the raw text of an unreadable slice shows with a Copy button instead.

**Import is load.** `backupParse` checks the envelope (`app`, `schemaVersion`; a newer version has its own message), requires all four slices (a missing one means a cut-short file, and defaulting it would wipe real data), and hands the file's slices to `storageLoad`, so bad records, duplicates, and conflicts behave exactly as they do from disk: bad records are kept (shown as a count), and a slice that comes back unreadable fails the import with its name. The preview shows counts, then replaces after confirmation. A replace has nothing to merge, so the earliest-purchase rule of section 13 does not apply to it.

**Replacing (`dataReplace`, `storageReplace`).** Import and Reset share one store method, `dataReplace(loaded, kind)`. It refuses while a session runs, except when the history is unreadable (a stored session beside it can never finish, and replacing is the way out; Import and Reset also appear on that blocked screen). It writes every slice over unreadable text, because the user confirmed. If a write throws, every key is removed first (which frees space) and then put back as it was, so a failed import never leaves a mix. If even that fails, `ErrorStorageRollback` stops the store with a blocking entry. Disk may then be incomplete, but the page still holds the previous data, so the entry tells the user to export a backup from Settings (Export reads the in-memory state), then reload and import it. After a replace the load-derived status entries (exactly the codes the previous load produced) are rebuilt from the new data and only their dismissals are forgotten. `settingsSet` and `uiExported` do nothing while their slice is unreadable, as tag and purchase changes do. An import acknowledges its last session, so it does not appear as a waiting result, and keeps `lastExportedAt`; Reset forgets it.

**Saving the file.** A Blob download everywhere except an installed standalone app, where iOS opens a viewer or fails on one; there `navigator.share({ files })` is used. Desktop browsers can share files too, but the share sheet is the wrong tool for them. **Verify the installed-app path on a real device.**

## 7. Economy

Balance is **derived**: `coinsBalance = sum(earned over completed sessions) - sum(purchase costs)`. A stored balance can drift; a derived one cannot.

- `coinsEarned(session)`: zero for failed sessions; for completed, `floor(activeMs / coinsPeriodMs)` with `coinsPeriodMs` of 5 minutes (tune by feel), where `activeMs` is the planned time for a countdown and `endedAt - startedAt - pausedMs` for a stopwatch.
- A purchase is `{ id, speciesId, at, cost }`, append-only, with the cost recorded at purchase time so re-pricing never rewrites history. The `id` exists so phase 2 can merge (section 13), and `cost` must be a whole number so a balance is never fractional; both are validated per record at load.
- `purchaseBuy` (pure, `purchase-buy.ts`) **rejects** an unknown species, buying an already owned one, and buying with insufficient balance, so a double tap cannot charge twice. The store's `purchaseBuy` does nothing, and the Shop says why, whenever the session history or the `purchases` slice is unreadable or has a rejected record (`selectPurchasesBlock`): a rejected Pine record is kept on disk but not counted, so Pine would look unowned and a second purchase could charge twice once a later release accepts the old record. A record whose id duplicates a different one is kept as rejected for the same reason; an identical duplicate is dropped with a problem entry. An unreadable `purchases` slice also raises a blocking `purchases-corrupt` status.
- One species costs 0 and is owned from the start. "Owned" means "in the catalog, and free or has a purchase"; an id the catalog lacks is never owned. Planting an unowned species is rejected by `sessionReduce` (`species-not-owned`) as well as left out of the UI.
- **The balance can be wrong in both directions on damaged data.** A rejected session record (kept on disk, not counted) removes coins whose purchases still count, so the balance can go negative; it is shown as is, never clamped. A rejected purchase record removes a cost, which is why buying is blocked in that state.
- **Farming.** A forward clock completes a countdown early and pays its planned coins, and an abandoned relaxed stopwatch pays 36 coins at the 3-hour cap. Both fall under "no honest enforcement" (section 3).

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
  readonly leafColors: Readonly<Record<'sprout' | 'sapling' | 'young' | 'full', string>>;   // the seed is a mound and has no leaves
};
```

A catalog test enforces unique kebab-case ids, nonnegative integer costs, exactly one free species, and valid hex for the trunk and every leaf stage. The prototype ships five species (Oak free, Pine, Birch, Spruce, Maple), with plain tree names and no flavor text. Species colors are hex data. Every trunk, leaf, and the seed's soil keeps at least 2:1 contrast against both page backgrounds (a luminance window of roughly 0.085 to 0.36), and every trunk keeps at least 1.5:1 against the ground patch, which uses a theme token (`--color-ground`) defined for light and dark. A test reads the real tokens from `index.css` and enforces all of this, so a palette or theme change that breaks it fails the suite. `speciesStarter` is the one free species and the default tree; the Focus screen offers every owned species (a picker appears once there is more than one).

**Catalog entries are never deleted.** Old sessions and purchases reference ids forever, and that is a written rule, since no test can enforce it across versions. An unknown id renders as `speciesFallback`, a generic tree kept outside the catalog (so the catalog invariants hold) and never persisted. The store counts unknown ids at load and shows one non-blocking `species-unknown` warning with the count, so a mistake or newer-version data degrades instead of crashing. In a release this fires only for a bug or data from a newer version.

SVGs use flat fills only, with no `id`s or gradients: many trees share one page, and ids share one namespace.

### 8.2 Growth

`growthStage(progress)` maps progress to one of five stages: seed, sprout, sapling, and young take a quarter each, and full is reserved for progress of 1, so finishing a session is visible in the picture. The stages are a closed union, not a count: the geometry draws exactly those five looks. Out-of-range progress clamps (a stopwatch runs past its span); NaN throws.

- **Progress.** A countdown grows over its planned time. A stopwatch has no planned length, so it grows over `growthStopwatchMs` (60 minutes, tune by feel). `sessionProgress` computes both.
- **Finished trees show what was reached** (`growthFinished`): a completed countdown is full grown; a failed session shows the stage it reached, dead; a completed stopwatch shows the stage it reached. The forest (step 6) calls the same function.
- **Dead.** A dead tree is drawn at least as a sapling (`treeStageDrawn`, which the label shares), with a canopy 60% the live size and its species colors pulled toward gray, so it stays visible at forest-tile size and a forest of failures still shows which species died.
- **Animation.** The geometry is discrete, so it cannot transition. The running tree is wrapped in an element keyed on the stage, which replays a short grow-in (removed under reduced motion). The sprite itself is static so forest tiles and shop cards do not replay it.
- **Accepted cost.** The picture changes about every 6 minutes for a 25-minute countdown, every 15 minutes for a stopwatch, and every 45 for a 3-hour countdown, and there is no progress bar. Countdowns have the clock; a stopwatch loses "how grown".
- **Accessibility.** `treeLabel` names a tree ("Oak, sapling", "Dead oak, young tree"). `TreeSprite` can be decorative, for places that carry their own label.

A stopwatch can be stopped at 0:03 and counts as completed, so its result shows a seed. That is a session-rules gap the tree makes visible (open question 5).

### 8.3 Forest view

One `ForestTile` per finished session, grouped under day headings (newest day first), with a period switch (day, week, month) and previous and next buttons. The period is a half-open range `[start, end)` from `timePeriodRange`; previous is the range containing `start - 1`, next the one containing `end`, and next is disabled on the current period. With no navigation the view follows the clock, so "this week" rolls over without a click. Within a day, trees keep array (finish) order, not `startedAt` order, so a clock change never reshuffles the forest. A tile is a button; it opens a details panel directly under its day (start time, focused minutes, outcome, and the tag if it still resolves) and moves focus to the panel's heading. Isometric land, terrain, and animation beyond growth are out of scope. The art is the weakest part of the prototype and the easiest to improve without touching logic.

Forest and Stats share one `usePeriodView` hook and `PeriodNav` component, so the period rules (following the clock, stepping, Next disabled unless the next period has begun) live in one place.

`AppReady` selects only what the frame needs (status, blocked state, and two booleans for the nav). The Focus screen selects the whole state itself because it changes every second; the Forest selects `sessions`, `tags`, and `weekStart` and re-renders once a minute. Tiles and day groups are `memo`'d, so selecting a tile redraws two groups at most; the minute tick regroups the current period (new group objects), which redraws its day sections but not their tiles. There is no virtualization (a month is a few thousand SVG nodes). A corrupt `sessions` slice hides the nav along with every screen, so an empty Forest never reads as lost data.

## 9. Stats

Pure functions over `SessionFinished[]`, in `stats-*.ts`:

- `statsBucket(sessions, range, now)`: one bucket per local day in the range (`{ dayStart, focusedMs, completed, failed }`); a week is seven and a month 28 to 31, so there is no granularity argument. `statsTotal` sums them. Both it and `forestGroup` use `timeRangeDay` for which day a session falls on, so the screens cannot disagree; `now` only needs to be real, and the screens pass `Math.min(now, range.end)` so a past period's memoized result does not change with the clock tick.
- `statsTag(sessions, tags, range, now)`: focused time and completed count per tag, as `tag`, `untagged`, and `unknown` rows (completed sessions only, same day rule). Every tag id that matches no stored tag collapses into one `unknown` row, so a rejected tag record or newer-version data cannot add a row per id. Rows with no focus time are left out, largest first, ties by kind and name. The screen hides the breakdown when the only row is untagged.
- `statsStreak(sessions, today)` (`today` is a day start): current and longest runs of consecutive days that each have at least `timerMinMs` of completed focus, so a stopwatch stopped after seconds cannot keep a streak alive (open question 5 stays open for the session rules). **The current streak counts a run ending today or yesterday**, or it reads 0 every morning until the first session. A session dated after today counts as today, so it can bridge a gap today and stop bridging it tomorrow (a test pins this). Streaks cover the whole history, so the screen shows them apart from the period summary.

Only completed sessions count as focused time. "Today" is derived from an injected clock at render, and the Forest and Stats screens re-render once a minute, so a tab left open overnight rolls over.

**Day bucketing uses local-time date parts only.** Never add 24 h of milliseconds to a date: it works until a daylight-saving change, then the boundary moves by an hour (mello's recurrence code documents the same hazard). A session belongs to the local day it started in, so one running 23:40 to 00:20 sits under the earlier day (accepted: a start-day rule is simple and stable). A session dated after the clock (a clock set forward once) counts as starting now, so it stays in the current period; `timeStartEffective` implements this and stats must reuse it. Tradeoff: such a tile sits under today and moves with the clock until real time passes its date, and a past period no longer shows it. `time-local` owns the period concept (`TimePeriod`, `timePeriodRange`), shared by the Forest and Stats. Week start is a Sunday or Monday setting, default Sunday; there is no locale detection (the needed `Intl` week info is not in every browser). Tests run under `TZ=America/Denver` across both DST transitions.

## 10. UI

Five screens in a bottom tab bar (a side rail on desktop is not built; the bar serves all widths). Tab state is in memory; there is no router. Steps 6 to 9 ship Focus, Forest, Shop, Stats, and Settings. The tabs never shrink below their text (`min-w-fit`) and wrap to a second row when text is large, so they cannot overflow. Settings is a gear icon with an accessible name, since a fifth text tab does not fit one row at 320 px; the nav's side padding is trimmed to make room. The Focus button says "(running)" or "(result ready)" when it applies, because the chime can sound on another screen. Setup choices (mode, duration, species, tag) live in `AppReady` and survive a screen switch and the end of a session (they no longer reset to the default duration after each result). The duration stays `undefined` until the slider moves, so it follows the default in Settings. Screens unmount when inactive. The SWA fallback rule still serves `index.html` for any path.

| Screen | Contents |
| --- | --- |
| Focus | Idle: duration dial, tag picker, species picker, Start. Running: growing tree, countdown, Give Up (confirmed). Result: outcome and coins earned. Install prompt before the first session on iOS (arrives with the PWA, step 10). Shipped: mode switch, duration slider, a Relaxed checkbox so relaxed mode can be tried on a phone, a species picker once more than one is owned, a tag picker once a tag exists, and coins earned on the result. |
| Forest | Section 8.3. |
| Stats | Period switch, totals, per-day table, per-tag table (once a tag is used), streaks. |
| Shop | Species grid with cost and owned state, coin balance. |
| Settings | Strictness, default duration, sound (read when a session finishes), week start, tag management (create, archive; names are NFC-normalized and unique across archived tags too), export, import, reset. |

A `StatusBanner` shows storage and platform warnings (section 6). Component names are category first: `ForestDay`, `ForestTile`, `StatsBars`, `StatsSummary`, `TreeSprite`, `TimerDial`, `TimerCountdown`, `ShopCard`.

Dark and light via `prefers-color-scheme`. Keyboard operable, visible focus, enough contrast. The countdown is not announced every second to screen readers; announce start, halfway (countdowns only; a stopwatch has no end to be halfway to), and finish. The UI states what "leaving" means (including fully covered windows on desktop, section 3).

## 11. Module map

```
index.html
src/
  main.tsx
  App.tsx
  lib/                          pure: no DOM, no Date.now(), no randomness, no storage
    types.ts                    data model
    config.ts                   named constants, category first: timerMinMs, timerMaxMs, timerStepMs, timerDefaultMs, sessionGraceMs, sessionPauseMaxMs so far; each later step adds the ones it uses
    store-app.ts                the store (section 5.3), write fence, status entries, selectResultPending
    clock-format.ts             clockFormatRemaining (rounds up), clockFormatElapsed (rounds down)
    duration-clamp.ts           durationClamp: every UI path to sessionStart goes through it
    session-reduce.ts           reducer; every session action resolves first
    session-resolve.ts          section 5.2: sessionResolve, sessionPauseExpire, sessionEndsAt, sessionElapsedMs, SessionRules
    coins.ts                    coinsEarned, coinsBalance (derived)
    purchase-buy.ts             purchaseBuy, PurchaseRejection
    species-owned.ts            speciesOwned
    species-catalog.ts          species data, speciesResolve, speciesStarter, speciesFallback
    growth-stage.ts             GrowthStage union, growthStage
    session-growth.ts           sessionProgress, growthFinished, sessionFinishedActiveMs
    tree-geometry.ts            treeGeometry: a tree as flat shapes in a fixed viewBox
    tree-label.ts               accessible name of a tree
    stats-bucket.ts             statsBucket, statsTotal
    stats-tag.ts                statsTag
    stats-streak.ts             statsStreak
    duration-format.ts          durationFormat: "2 h 35 min"
    time-local.ts               local date-part helpers, TimePeriod, timePeriodRange (half-open), timeRangeDay (the day-assignment rule Forest and Stats share)
    forest-group.ts             forestGroup: sessions in a range, grouped by start day
    storage-coerce.ts           validators; the trust boundary
    storage-slices.ts           slice names and write order, storage keys, StorageLike, StorageGuard
    storage-load.ts             storageLoad(storage): data, problems, guard; hydration rules
    storage-save.ts             storageSave(prev, next, storage, guard): ordered per-slice writes; storageReplace: write everything, or put everything back
    tag-edit.ts                 tagCreate, tagArchive, tagsActive, tagChosenEffective
    backup.ts                   backupSerialize, backupParse (import is storageLoad over the file)
    errors.ts                   ErrorStorageCorrupt, ErrorStorageQuota, ErrorPlatformUnsupported, ErrorImportInvalid, ErrorStorageRollback
  platform/                     thin browser wrappers
    id.ts                       crypto.randomUUID, secure context only
    file-save.ts                fileSave: Blob download, or the share sheet in an installed app
    owner-lock.ts               ownerLockAcquire, ownerLockSteal (section 5.4)
    app-controller.ts           owner lock, store lifetime, bfcache, storage-unavailable (section 5.4)
    wake-lock.ts                wakeLockMake (section 5.5)
    chime.ts
  hooks/
    useApp.ts                   controller status via useSyncExternalStore
    useStore.ts                 select from the store
    useClock.ts                 render clock
    usePeriodView.ts            period, range, and navigation shared by Forest and Stats; owns the minute clock
    useSessionRunner.ts         section 5.5
  components/                   section 10 (PeriodNav is the switch and previous/next shared by Forest and Stats)
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
- **Purchases need one more rule.** Two devices that each buy Pine create two different ids, and a plain union would charge twice. The merge keeps only the earliest purchase per species and drops later ones. It belongs to the merge alone: a backup import replaces everything and loads like storage, so it has nothing to merge. Define the rule with the merge code, before either exists.
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
| `coinsEarned`, `coinsBalance` | Failed sessions earn nothing; a countdown pays its plan and a stopwatch its unpaused time; floor at the period boundary; balance matches purchases, uses the cost recorded on each purchase rather than the catalog, and can go negative. |
| `purchaseBuy`, `speciesOwned` | One record with catalog cost, id, and time; exact balance succeeds; one short, double purchase, free species, and unknown species are rejected with the state unchanged; the store ignores a buy when the sessions or purchases slice is unreadable, a purchase record was rejected, or the tab is fenced, and writes only the `purchases` key. |
| `growthStage` | Monotonic; endpoints; clamps out-of-range input; stopwatch progress caps at fully grown. |
| Pause and stopwatch | Pause freezes the clock and ignores absence; resume extends `endsAt` by the pause length; a second pause is rejected; a pause past `sessionPauseMaxMs` auto-resumes and then fails a strict session whose user stayed away; a stopwatch completes on stop or at `timerMaxMs` of active time, and still fails on absence; stopwatch coins use elapsed active time. |
| `time-local`, `forestGroup` | Both DST transitions in `America/Denver` with expected values as ISO strings with explicit offsets; 23:30 and 00:30; the repeated 01:30; Sunday and Monday week starts across month and year boundaries; ranges tile with no gap or overlap; half-open boundaries; start-day grouping; future-dated sessions; array order within a day. |
| `statsBucket`, `statsStreak` | Both DST transitions in `America/Denver` (23- and 25-hour days, runs across both); 23:30 and 00:30 local sessions; a session crossing a month boundary stays in its start month; empty input; the minimum-focus rule at its boundary; a streak with no session yet today still counts through yesterday; a future-dated session. A guard test fails if `TZ` stops being pinned. |
| `storageCoerce` | Valid, missing fields, wrong types, hand-edited garbage; one bad record rejects only that record; each failure yields a specific error. |
| Backup | Round-trip; invalid files rejected with a specific error; import never partially applies; `lastAcknowledgedId` survives a reload. |
| Catalog | Unique ids, nonnegative costs, exactly one free species, valid hex colors for every stage. |
| Tree geometry | Every shape inside the viewBox, canopy overlapping and centered on the trunk, tiers stacked, sprout leaves on the stem, one ground line, a visible dead tree at every stage, palette contrast against the real theme tokens. |

Not unit-tested, and reported as such: SVG rendering, layout, the real Web Locks, Wake Lock, and audio implementations, and the `useSessionRunner` wiring. The races around them (owner lock, wake-lock controller, app controller, store fence) are tested against fakes. The rest gets a written manual smoke checklist (`docs/smoke-checklist.md`) run on a real phone and a desktop: start; switch tabs under and over the grace period; cover the window fully; lock the phone; close the laptop lid and reopen; kill and reopen mid-session; open a second tab and use "Use here"; install the PWA; go offline; export on iOS standalone. A Playwright test using its fake clock for one end-to-end timer run is a reasonable follow-up.

## 15. Implementation sequence

Each step is one commit (or a short series) that builds and passes the suite on its own.

1. Scaffold: Vite, TypeScript, React, Tailwind, ESLint, formatter, Vitest; CI workflow; an empty app that deploys.
2. Types, errors, `storage-coerce`, `storage-load`, `storage-save`, and tests. (`time-local` moved to step 6 with its first user.)
3. `session-resolve` and `session-reduce`, tests first.
4. Store, app controller and owner lock, Focus screen, `useSessionRunner`, `StatusBanner`, with a placeholder tree.
5. Species catalog, growth stages, `TreeSprite`.
6. Forest screen.
7. Coins, purchases, Shop.
8. Stats (without the per-tag breakdown).
9. Settings, tag management, `statsTag` and its breakdown, backup export and import (done).
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
| Clock changes (manual edit, NTP, DST, travel) | Wrong elapsed time | Epoch ms is immune to DST and zone; a forward jump over the grace period while visible fails a strict session, which is accepted; day bucketing uses the zone at read time, so travel reshuffles past days and can break or extend a streak, also accepted |
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
5. **Stopwatch minimum.** Stop currently completes a session at any length, so a 3-second stopwatch records a completed seed. Options: reject Stop under `timerMinMs`, count it as failed, or accept it. Assumed accept until decided.
