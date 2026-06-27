# AGENTS.md

## Cursor Cloud specific instructions

DoneWell Audio is a single Next.js 16 (App Router) + React 19 + TypeScript app. It is
**local-only**: there is no backend, database, or external service. All audio analysis runs
client-side in the browser via the Web Audio API and the DSP code under `lib/`. The
`pnpm verify:local-only` script is a CI gate that fails the build if any network/backend
code (Supabase, Sentry, fetch/XHR/WebSocket, API routes, etc.) is reintroduced — keep the app
local-only. Note: `.env.example` lists Sentry/Supabase vars, but these are legacy and are NOT
used (and are forbidden) by the current runtime; no env vars are needed to run or test.

Toolchain: Node 22 (`.nvmrc`) and pnpm (pinned `pnpm@10.30.1`) are pre-installed. The only
service is the Next.js dev server.

Standard commands (see `package.json` / `README.md`):
- Run (dev): `pnpm dev` → serves at `http://127.0.0.1:3000` (uses the Webpack dev server).
- Lint: `pnpm lint` · Test: `pnpm test` (Vitest) · Build: `pnpm build` · Local-only gate: `pnpm verify:local-only`.

### Testing the core feature in the cloud browser (non-obvious)
The core feature requires microphone input via `getUserMedia`, but the cloud VM has **no real
audio device**, so clicking "ENGAGE" shows a "No microphone found" error by default. To
exercise live analysis, Chrome must be launched with a synthetic mic:
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (the latter also
auto-grants the mic permission). These flags only take effect on a **fresh** Chrome launch —
the launcher uses a fixed `--user-data-dir`, so any already-running Chrome instance must be
fully closed first (otherwise new launches join the existing instance and ignore the flags).

### Notes
- `next-env.d.ts` is tracked but Next.js may rewrite it on `pnpm dev`/`pnpm build`; do not
  commit incidental changes to it.
- `pnpm build:dmg` (macOS DMG packaging) requires a macOS toolchain and is not runnable in this Linux VM.
