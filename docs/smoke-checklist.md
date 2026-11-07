# Manual smoke checklist

The unit tests cover the logic and the races (against fakes). They cannot cover real browser behavior: Web Locks, Wake Lock, audio, visibility, layout. Run this on a desktop and a phone before calling a step done. Mark what you ran in the PR or commit message; anything not run is unverified.

## Setup

- **Desktop:** `npm run dev` and `npm run preview` (after `npm run build`). Run the checklist on both. `dev` uses StrictMode (double mounts), `preview` does not.
- **Phone:** needs HTTPS. A plain-HTTP LAN address has no `crypto.randomUUID`, Web Locks, or Wake Lock, so Start is disabled. Use a tunnel to the dev server, `preview` behind HTTPS, or the Azure SWA preview environment.
- Shorten sessions by setting `timerMinMs` temporarily in [config.ts](../src/lib/config.ts) if waiting 10 minutes is a drag. Revert before committing.
- DevTools > Application > Local Storage shows the `trees:v1:*` keys.

## Session basics (desktop and phone)

- [ ] Start a countdown. The tree placeholder grows, the clock counts down, the tab title shows the clock.
- [ ] Let it finish. Result screen says "Tree grown", the chime plays once, Done returns to Focus.
- [ ] Start a stopwatch. Clock counts up. Stop ends it as completed.
- [ ] Give Up asks for confirmation. "Keep going" cancels. "Yes, give up" shows the failed result.
- [ ] Pause freezes the clock. Resume continues from the same value. After one pause the button reads "Pause used" and is disabled.
- [ ] Leave a pause alone for 5 minutes. The session resumes by itself and the pause is used.
- [ ] Reload mid-session. The clock continues from the right value, no result screen replays.
- [ ] Reload after the session finished and Done was pressed. No result screen.

## Leaving the page (strict)

- [ ] Switch to another tab for under 15 seconds and return. Session continues.
- [ ] Switch away for over 15 seconds and return. Result says "You left the page".
- [ ] Cover the window with another full-screen app on desktop. Document what happens (design section 3 expects this may count as present).
- [ ] Phone: lock the screen mid-session. With Wake Lock working, the screen should not lock by itself. Press the power button, wait over 15 seconds, unlock: strict session has failed.
- [ ] Phone: switch to another app for over 15 seconds. Strict session has failed on return.

## Relaxed

- [ ] Tick Relaxed before Start. Switch tabs for a minute. Session continues and the title clock keeps updating in the background tab.
- [ ] Background the tab past the planned end. The chime plays within about a minute and the result shows when you return.
- [ ] Phone: same, with the browser in the background.

## Closing and reopening

- [ ] Close the tab mid-session, reopen within 15 seconds. Strict session continues.
- [ ] Close the tab, reopen after the planned end (relaxed). The result screen shows, with **no chime** (it is a stale completion).
- [ ] Reload mid-session, tap or click once anywhere, then let it finish without touching the page. The chime plays. Without that tap, a blocked-sound warning appears instead, which is also correct. Repeat on the phone (touch).
- [ ] Phone: lock and unlock the screen mid-session, then let it finish. Note whether the chime plays after iOS suspends audio.
- [ ] Close the laptop lid mid relaxed session, reopen after the end. Result shows, no crash.

## Two tabs

- [ ] Open a second tab on the same origin. It shows "Trees is open in another tab".
- [ ] Press **Use here** in the second tab. It becomes the app; the first tab drops to the same screen.
- [ ] With a session running in tab A, background tab A, steal in tab B, then return to tab A. Tab A shows the other-tab screen, and tab A's stale state did not overwrite tab B's data (check the keys in DevTools).
- [ ] Back/forward cache: navigate away and back (DevTools > Application > Back/forward cache > Test). The app recovers, either as owner or on the other-tab screen. If the page is not eligible for bfcache, note why.

## Trees

- [ ] Start a 25-minute countdown. The tree grows through five stages (seed, then a change about every 6 minutes, and the full tree only at the end), with a short grow-in each time, and "More than halfway" is announced once to a screen reader.
- [ ] Start a stopwatch. The tree grows over an hour, and no "halfway" is announced.
- [ ] Stop a stopwatch at a few seconds. The result shows a seed with "Tree grown" (a known gap, design open question 5).
- [ ] Let a countdown finish: the result shows a full grown live tree. Give up halfway: a dead tree at the stage reached, never a speck.
- [ ] Temporarily swap `speciesStarter` use in [FocusSetup.tsx](../src/components/FocusSetup.tsx) for each catalog species (`speciesCatalog[1]` to `[4]`) and check each at every stage, alive and dead. Look for canopies cut off at the edge, trunks floating above the ground, and a baseline that jumps between stages.
- [ ] Same species at about 48 px (browser zoom, or a temporary small wrapper): alive and dead should both read clearly.
- [ ] Light and dark mode: every species, including the pale Birch trunk and the dark Spruce, stays visible against the ground patch.
- [ ] Reduced motion on: no grow-in animation.
- [ ] Seed an old session with an unknown species id (for example `placeholder-tree`) in DevTools: a generic grey-green tree and exactly one "Species this version does not know" warning.

## Forest and navigation

UI is not unit-tested; this is the only coverage. Seed sessions through DevTools (`trees:v1:sessions`) where noted.

- [ ] Start a session, switch to Forest and back. The timer, title, and wake lock continue, and the Focus button reads "(running)" while away.
- [ ] Let a session finish while on Forest. The Focus button reads "(result ready)", and the chime plays. Open Focus, dismiss the result, and the suffix clears.
- [ ] On Setup, pick Stopwatch and a different duration, go to Forest and back: both choices are kept.
- [ ] With sessions on several days: Day, Week, and Month show the right trees under day headings, newest day first. Previous and Next step by one period, and Next is disabled on the current one.
- [ ] A session that ran across midnight sits under the day it started.
- [ ] Set `settings.weekStart` to `monday` in storage and reload: the week view begins on Monday.
- [ ] Seed about 300 sessions: the Forest stays responsive, and with a session running, the Focus screen re-renders each second and the Forest does not (React Profiler on each). On Forest, clicking a tile re-renders at most two day groups.
- [ ] Tab to a tile and press Enter or Space: a details panel opens under that day and focus moves to its heading. Pressing the tile again closes it. `aria-expanded` follows.
- [ ] Details show start time, focused minutes, and the outcome (Completed, Gave up, Left the page). Seed a `tagId` that exists in `tags` and the name appears.
- [ ] Live and dead trees are distinguishable at tile size, in light and dark mode.
- [ ] An empty period shows the empty text.
- [ ] Leave the Forest open past midnight: "today" moves on within a minute.
- [ ] Nav at 320 px and 1280 px: the last tile row and Give Up are never covered. On a phone with a notch, the bar clears the home indicator.
- [ ] Corrupt `trees:v1:sessions`: the blocked screen appears and no nav does.

## Shop and coins

UI is not unit-tested; this is the only coverage. Seed `trees:v1:sessions` and `trees:v1:purchases` in DevTools to reach a price. A 25-minute completed countdown earns 5 coins, and Pine costs 25.

- [ ] Finish a short session. The result shows "+N coins" (none for a give-up), and the Shop balance rises by N.
- [ ] Shop with too few coins: each paid card has a Buy button marked `aria-disabled` with "N more coins" text. Tab to it, press Enter: nothing happens, and a screen reader reads the shortfall.
- [ ] Buy at exactly the price: the card turns to "Owned", the balance drops by the cost, the status line says "Bought" with the name, and keyboard focus lands on that card's name (not the page top).
- [ ] Double-click Buy: one charge, no error message.
- [ ] Reload: owned species and the balance persist.
- [ ] Focus Setup shows the Tree picker only after the first purchase, with arrow keys moving between options. Choose the bought species, start: the Setup preview, the running tree, the result, and the Forest tile all show it.
- [ ] Switch to the Shop during a running session and back: the session is unaffected, and the Shop does not re-render each second (React Profiler).
- [ ] Set `trees:v1:purchases` to `{`: a blocking "purchases could not be read" entry, and the Shop shows only the explanation (no balance, no Buy). The key text is untouched.
- [ ] Set `trees:v1:purchases` to `[{"cost":1.5}]`: the Shop explains that buying is off and shows no balance. The key text is untouched after any other action.
- [ ] Open the app over plain HTTP from another device: the Shop shows the secure-page note once, under the balance.
- [ ] Nav at 320 px with a running session (Focus shows a dot) and with a result waiting (Focus shows a mark): all three tabs stay on one line. A screen reader reads "Focus (running)" and "Focus (result ready)". Shop grid at 320 px: two cards per row without overflow.
- [ ] Open a second tab and use "Use here": the first tab cannot buy (it is fenced).

## Warnings and errors

- [ ] Ten tab switches in a relaxed session produce no repeated or stacking warnings.
- [ ] Battery saver on (phone): a Wake Lock warning appears at most once and can be dismissed.
- [ ] iOS: with the ringer switch off, the chime still plays after Start (audio session set to playback). Note the result.
- [ ] Fill storage (write a large junk key in DevTools until `setItem` throws): a single "Storage is full" entry appears, not one per second. Free the space; the entry clears on the next save.
- [ ] Seed corrupt data: set `trees:v1:settings` to `{`. A warning appears, defaults are used, the Relaxed checkbox is disabled, and the stored text is untouched.
- [ ] Seed corrupt data: set `trees:v1:sessions` to `{`. A blocking error and the raw text appear, session actions are unavailable, the key is untouched.
- [ ] Block site data in the browser (private window in a strict browser, or "Block all cookies"). "Trees cannot save data in this browser" appears.
- [ ] Open the app over plain HTTP from another device. Start is disabled with an explanation, and a warning explains the missing tab protection.
- [ ] Move the system clock forward one minute while a session runs and visible. Document the effect (design section 5.2 lists clock changes as an accepted risk).

## Not verifiable until later steps

- Wake Lock behavior in an installed iOS PWA (step 10).
- Install prompt, offline, service worker (step 10).
