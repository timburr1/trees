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
