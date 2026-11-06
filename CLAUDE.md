# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Trees is a Forest-style focus timer with no ads, no accounts, and no multiplayer: start a timer, a tree grows, leave and it dies. It is a React + Vite + TypeScript PWA deployed as a static site to Azure Static Web Apps (free tier). The architecture lives in `docs/design.md`; read it before changing structure, and update it when a decision in it changes.

Status: design only, no code yet. When the project is scaffolded, add the build, lint, and test commands here.

## Working agreements

These conventions apply to new and modified code. Don't mass-rename or reformat existing code to match them.

### Interaction

- **Answer questions before coding.** When asked a question, give an actual answer first. Don't leap straight to writing code.
- **Never commit unless explicitly told to.** Leave finished work uncommitted in the working tree. Only `git commit` when the current request explicitly asks for it ("commit this"); a phrase like "let's make that a separate checkin" describes how the work should eventually be grouped, not permission to commit, and permission for one task never carries over to the next.
- **Split significant work into small self-contained commits** (when told to commit). Split along seams that carry meaning, each with a one-sentence story, never mechanically per-file or per-layer. A pure refactor that the feature merely motivated lands as its own commit *before* the feature. A pre-existing bug fixed along the way is its own commit. A behavior change to an existing system is separate from both the refactor that enabled it and the feature that exposed it. A vendored third-party drop stands alone. Keep together what only works together (the halves of a feature that can't be exercised separately, data plus the code that loads it). Tests go in the commit that makes them meaningful. Every commit must build and pass the suite on its own. Late fixes (review feedback included) are folded into the commit they belong to via fixup/autosquash, not appended as cleanup commits. When the work stays uncommitted, still build it as one unit, but at the end point out that it's a good candidate for splitting and propose the commit sequence.
- **Evaluate, don't assume.** "Why don't we X?" is a request for evaluation, not a suggestion to do X. Explain the tradeoffs and potential issues.
- **Debug by evidence, not by guess.** For a bug you don't fully understand, prefer diagnostic instrumentation or focused questions over speculative changes. A confident theory backed by reading the code is fine to act on; a vibe is not. If a fix doesn't solve the problem, the theory was wrong: gather more data before trying again. Two consecutive failed fixes mean stop guessing, pause, instrument, and ask.
- **Err on the side of more diagnostic data.** When you ask the user to run something, the round trip is the expensive part. Instrument generously: log every variable that could plausibly disambiguate the bug, exercise the endpoints of the parameter space, and include both the suspected-correct prediction and the alternatives so residuals are immediately visible.
- **Don't write creative human-facing text unless told to** (dialogue, flavor text, story text). Use obvious placeholders like `[Greeting]`. Utilitarian copy (error messages, labels, log text) is fine.
- **Waiting on background work is not a tool call.** If you've backgrounded a long command and have nothing else to do, end the turn; the completion notification re-invokes you. Don't emit no-op commands to stay "active". If a command fits the foreground timeout, run it in the foreground.
- **Updates are short.** Match response length to the task. A simple question gets a direct answer, not headers and sections. End-of-turn summaries are one or two sentences: what changed and what's next. State results and decisions directly.

### Workflow

1. **Plan.** Enter plan mode (the actual `EnterPlanMode` tool) and produce a plan. Skippable for trivial changes (under about a dozen lines). Include unit tests in the plan whenever plausible; UI generally can't be tested.
2. **Hostile-review the plan.** Before leaving plan mode, spawn a hostile-review agent on Opus (`model: "opus"`). Brief it like a design reviewer: explain the problem, point it at CLAUDE.md and the tree, give it the plan, and do not justify the plan's choices. Give it room to push back on the approach. Fold valid objections into the plan, then exit plan mode.
3. **Tests first (when applicable).** For bugfixes, or any feature whose tests can sensibly be written first, write them and verify they fail, then implement.
4. **Run all tests.** Always, even when the change seems unrelated. If anything breaks, return to step 3, or step 1 if the fix needs significant redesign. For UI changes that can't be unit-tested, say so rather than claiming success. A failing test is not a veto: a test that pins behavior the change deliberately replaced gets updated alongside the code. Fall back to step 3 or 1 only when the failure exposes a real regression.
5. **Update the CHANGELOG** (only if the project keeps one). Every even-slightly-user-facing change gets an entry under `[unreleased]` (Added / Breaking / Improved / Fixed). Purely internal cleanup can be skipped. When in doubt, add the entry.
6. **Hostile review.** Spawn a hostile-review agent on Opus. Brief it like a PR reviewer: explain the problem and point it at CLAUDE.md and the tree, but do not explain or justify the implementation. Ask it explicitly to review the general architecture too (does the approach fit the surrounding code, are there cleaner factorings, do any abstractions fail to pay rent), with enough room to cover both. Fix valid objections (significant redesign goes back to step 1, code changes to step 3). If you disagree, push back once; if it still objects and you're still confident, surface the disagreement to the user instead of looping. Either way, give the user a quick summary of the review at the end.

### Executing actions with care

Local, reversible actions (editing files, running tests, ephemeral scripts) are fine to take freely. Confirm first for anything destructive (deleting files or branches, `rm -rf`, overwriting uncommitted changes), hard to reverse (force-push, `git reset --hard`, amending published commits, dependency downgrades, CI/CD changes), visible to others (pushing, creating or closing PRs and issues, sending messages), or uploading content to third-party tools (it may be cached or indexed even if deleted). Don't use destructive actions as a shortcut around an obstacle; find the root cause. Don't bypass safety checks (`--no-verify`, `--no-gpg-sign`) unless asked. Investigate unexpected state (unfamiliar files, branches, locks) before deleting it; it may be in-progress work.

### Coding

- **KISS / YAGNI / MVP.** Write the simplest code that solves the current problem. No speculative abstractions or features. Three similar lines beat a premature abstraction.
- **No backwards compatibility for its own sake.** Delete unused or replaced code outright: no shims, `_unused` renames, `// removed` comments, or compatibility re-exports. Git history is the backwards compatibility. (Re-validating *persisted data* that an older app version wrote is a real requirement and not covered by this.)
- **Error handling.** Don't add excessive or preemptive handling; trust internal code and framework guarantees, and validate only at system boundaries (user input, external APIs, storage, the network). Silent error handling is banned: report failures through the project's logging or status facility, or throw. For user-facing services, distinguish bugs from user mistakes: bad input gets a specific, helpful error, and "internal error" is reserved for real bugs and infrastructure failures. Ask of any new feature: "can a user trigger this exception through normal usage?"
- **Don't hand-wrap lines.** One thought, one line, however long. Exceptions: distinct comment paragraphs (separated by a blank line) and structurally aligned expressions (one argument or chained call per line). A multi-sentence single-thought comment is still one line.
- **Composition over inheritance.** Build behavior from small composable pieces (functions, components, hooks, modules).
- **Data-driven where it pays.** For open-ended categories (content, configuration, variants), prefer data files and a small interpreter over hardcoded paths. For closed categories, write the code.
- **Use absolute paths** in file operations.

### Commenting

A comment earns its place by saying something the code cannot: a non-obvious "why", a subtle constraint, a surprising tradeoff, or a one-line signpost in a long linear process. Don't restate what a name or a single line already makes plain.

- **Write for a reader who never saw the old code.** Don't write comments that exist only by contrast with a previous version ("no longer does X", "now done differently"). State what is true now. The exception is history that guards against a real regression ("don't revert this to the double-precision form; it loses the low bits").
- **Adding: be conservative, but signpost freely.** Reach first for self-explanatory code. Keep a "why" tight; one good line beats a paragraph. Don't reference the current task, fix, or callers ("used by X", "added for the Y flow"); that belongs in the commit message.
- **Removing: be generous about keeping.** Fix or remove existing comments that are out of date or misleading; otherwise leave them alone.

### Naming

- Standard TypeScript conventions: camelCase for functions, variables, and properties; PascalCase for types, classes, components, and enums; SCREAMING_SNAKE_CASE only for true module-level constants. No `I` prefix on interfaces.
- File names are kebab-case and named for what the file exports; component files are PascalCase.
- **Category-instance prefix.** When a name combines a category with an instance, put the category first so related names group alphabetically: `SpawnerBurst`, `ShapeRadial`, `attackStart()`, not `BurstSpawner`, `RadialShape`, `startAttack()`. Applies to types, functions, files, and config keys.
- Node builtins are imported with the `node:` prefix.

### TypeScript

- `strict: true`, always. No `any`; use `unknown` at a boundary and narrow it. No `as` casts except immediately after validation at a boundary, and no non-null `!` except where a same-line comment states the invariant. `@ts-expect-error` with a reason where the compiler is genuinely wrong; never `@ts-ignore`.
- Boundaries are process arguments, subprocess output, files, JSON, IPC messages, storage, and the network. Parse and validate there once into a typed value; downstream code trusts the type.
- Model variants as discriminated unions and exhaust them with a `switch` whose `default` asserts `never`. Prefer string-literal unions to `enum`.
- `undefined` is the absent value; `null` only where an external API demands it. Mark data that isn't meant to be mutated `readonly`.
- Always use braces on `if`, `else`, `for`, and `while` bodies, even single-line ones.
- `function` declarations for named module-level functions; arrow functions for callbacks and inline closures.
- ES modules only. Named exports; a default export only where a framework demands one.
- `const` by default; `let` only when reassigned; never `var`.
- `async`/`await` throughout; no callback style and no `.then` chains where `await` reads linearly. Sequential awaits are correct when operations must be sequential; use `Promise.all` only for genuinely independent work. Use `AbortSignal` only where a caller actually needs to cancel.
- A formatter and a linter are non-negotiable and their defaults win over taste. Set the line width wide (160 or more) so the formatter never hand-wraps.

**Parameters.** The deciding axis is the nature of the parameter, not the mechanism.

- A new parameter the function genuinely needs is mandatory: no `?`, no default, update the call sites. Don't make every new parameter optional just to avoid touching callers.
- A default value is for a conceptually optional parameter with a principled "absent" value (an optional callback, a natural identity like `steepness = 1`). It is not for an arbitrary tuning constant that suits most callers; make that mandatory or a named constant.
- An options object is not an escape hatch: a field the function needs is a required field of the options type.
- Overload signatures are for genuinely different shapes. An overload pair differing only by a trailing optional argument should be a default.
- A behavior-switching bool may be a default-`false` parameter only as a rider on the same operation (same kind of result, a side aspect tweaked, almost always off). When the flag changes what the function fundamentally means, make it a separate, differently-named function (category first) or handle it at the call site.

**Errors.**

- An empty `catch {}` is a bug, and so is `.catch(() => {})`. Report via the project's logging facility or rethrow.
- Every promise is awaited, returned, or explicitly handled. A floating promise is a swallowed error; treat the lint rule against it as an error, not a warning.
- Turning an error into a default value with `??` or `||` is a silent swallow.
- Throw `Error` subclasses for failures a caller or user must distinguish, named category first (`ErrorStorageCorrupt`); plain `Error` is for bugs. Never throw strings or bare objects. Set `cause` when wrapping.

**Composition and dependency injection.**

- Prefer modules of functions over classes, and plain data over class instances. A class earns its place when it owns a resource with a lifecycle (a child process, socket, or lock). No inheritance hierarchies, abstract base classes, decorators, or DI containers.
- Pass external effects (clock, storage, notifications, wake lock) as parameters at module boundaries; production code wires in the real implementations at the entry point and tests pass fakes. Don't read `Date.now()` or touch `localStorage` inside logic code, which destroys the testable seam.
- Browser code never imports Node modules.

### Testing

- Run the full suite on every change, not just the related tests. A watch mode or fast subset is fine in the inner loop, but the final step is the full run.
- Write tests against the seam you want to defend (pure functions, deterministic state machines, parsers, classifiers). Don't retrofit unit tests around UI, rendering, or orchestration with no testable seam; say so explicitly when reporting status and rely on a manual smoke instead of pretending coverage.
- Integration tests against real dependencies are usually worth the slowness over mocks. When mocking is unavoidable, mock at the outermost boundary you reasonably can. Mark slow real-dependency tests so the default suite stays fast.
- Test files sit beside the module they test (`stack.ts`, `stack.test.ts`). Put shared fakes and fixtures in a common support directory and extend those.
- **Don't pin user-facing copy in tests.** Assert relations between outputs (non-empty, distinct across states that should read differently, equal across states that should read the same), with exact match only for sentinels like `""`. Exact-match assertions are correct when the exact output is the contract (serialization, parsers, formatters) or the string is fixture data the test itself authored. Don't mass-convert existing tests unless asked.
