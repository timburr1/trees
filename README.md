# Trees
![](https://img.shields.io/github/repo-size/timburr1/trees)
![](https://img.shields.io/github/contributors/timburr1/trees)
![](https://img.shields.io/github/last-commit/timburr1/trees)

Trees is a Forest-style focus timer with no ads, no accounts, and no multiplayer: start a timer, a tree grows, leave and it dies. It is a React + Vite + TypeScript PWA deployed as a static site to Azure Static Web Apps (free tier). The architecture lives in `docs/design.md`.

```bash
npm install
npm run dev            # Vite dev server
npm run build          # tsc -b (the type-check gate), then vite build -> dist/
npm run preview        # serve dist/
npm run lint           # eslint, type-checked; no-floating-promises is an error
npm run format         # prettier --write (width 160); format:check is the CI form
npm test               # vitest run, TZ pinned to America/Denver
npm run test:watch
```
