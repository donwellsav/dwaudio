# Development

How to set up, run, test, and validate DoneWell Audio. See also the repo root
[`AGENTS.md`](../AGENTS.md) for environment notes (it is the canonical source for
cloud/CI specifics — this doc does not duplicate it).

## Prerequisites

- **Node 22** (`.nvmrc` pins `22`).
- **pnpm** (`package.json` pins `pnpm@10.30.1`).

```bash
pnpm install
pnpm dev      # serves http://127.0.0.1:3000 (webpack dev server)
```

The dev and build scripts use the Next.js **Webpack** compiler (`next dev --webpack` /
`next build --webpack`). The only running service is the Next.js dev server — there is no
backend to start.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server (webpack) at `http://127.0.0.1:3000` |
| `pnpm build` | Production build (webpack) |
| `pnpm start` | Serve a production build |
| `pnpm lint` | ESLint (`eslint .`) |
| `pnpm test` | Run the Vitest suite once |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Vitest with V8 coverage |
| `pnpm verify:local-only` | CI gate enforcing the local-only constraint (see below) |
| `pnpm build:dmg` | Package a macOS DMG — **macOS toolchain only**, not runnable on Linux |

## Testing strategy

Tests use [Vitest](https://vitest.dev/) (`vitest.config.ts`):

- **Environment:** `node` (with a jsdom URL of `http://localhost/`). `tests/setup.ts`
  installs an in-memory `localStorage` shim so settings/storage code runs under Node.
- **Locations:** `lib/**/__tests__/`, `hooks/__tests__/`, `components/**/__tests__/`,
  `contexts/__tests__/`, `app/**/__tests__/`, and the cross-cutting `tests/` tree
  (`tests/dsp/`, `tests/integration/`, `tests/helpers/`).
- **Coverage thresholds:** lines/functions 80%, branches 70% (V8 provider). `dspWorker.ts`
  and `PortalContainerContext.tsx` are excluded from coverage.
- **End-to-end reference:** `tests/integration/workerPipeline.test.ts` exercises the worker
  message protocol and per-peak pipeline; it is the best place to see how the engine is
  driven programmatically.

Run the full suite before opening a PR:

```bash
pnpm lint && pnpm test && pnpm verify:local-only
```

### Exercising live analysis in a browser

Live detection needs a real microphone (`getUserMedia`). In a headless/cloud browser there
is no audio device, so "ENGAGE" reports "No microphone found" by default. Launch Chrome with
a synthetic mic to test the pipeline end-to-end:

```
--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
```

These flags only take effect on a **fresh** Chrome launch — see [`AGENTS.md`](../AGENTS.md)
for the full procedure (it uses a fixed `--user-data-dir`, so any running Chrome must be
fully closed first).

## verify:local-only runbook

`scripts/verify-local-only.mjs` (run via `pnpm verify:local-only`) is the CI gate that keeps
the app backend-free. It fails the build if reintroduced code would break the local-only
guarantee.

**What it checks** (all via `ripgrep` and path existence):

- **Network primitives** — `fetch` is not the focus; it flags `XMLHttpRequest`, `WebSocket`,
  `EventSource`, `sendBeacon`, geolocation, `RTCPeerConnection`, remote fonts/CDNs, etc.
- **Removed integrations** — Supabase, Sentry, ONNX/ML runtimes, "Companion" mixer control,
  and data-collection/labeling remnants.
- **Removed workflows / product bloat** — references to deleted flows (ring-out wizard, room
  measurement, session export, onboarding/help overlays, service-worker update prompts, …).
- **Forbidden paths** — a list of files/dirs that must not exist (API routes, `lib/companion`,
  `lib/export`, `public/models`, `docs/archive`, `docs/canvas`, `docs/WIKI_SYNC.md`, …).
- **Generated-output hygiene** — `out/` and `dist/` must be git-ignored and free of
  fake/demo/model residue.

**Scope:** it scans `app/ components/ contexts/ hooks/ lib/ types/ tests/` plus a few named
files (`README.md`, `tests/README.md`, `package.json`, `next.config.mjs`, `tsconfig.json`,
`eslint.config.mjs`, `pnpm-workspace.yaml`, `.github`). It does **not** scan a general
`docs/` directory (only the three forbidden `docs/*` paths above are checked).

**Reading a failure:** each check prints `PASS <name>` or `FAIL <name>` followed by the
offending file:line matches (or the offending paths). To fix a `FAIL`, remove the flagged
code/path, or — if the match is a legitimate false positive — adjust the pattern in
`scripts/verify-local-only.mjs` deliberately and explain why in the PR.

> **Doc caveat:** because `README.md` (and `package.json`) are scanned by the
> "persistent history/export/research" check, avoid using the specific forbidden tokens
> (e.g. the literal names of removed panels/exporters) in those files. The pages under
> `docs/` are not scanned, but they must still describe only real, current behavior.

## Troubleshooting

Microphone error messages are mapped to user-facing guidance by
`getAudioAnalyzerErrorGuidance` (`lib/analyzer/audioAnalyzerErrorGuidance.ts`):

| Condition | Guidance shown |
| --- | --- |
| Non-HTTPS, non-local origin | Microphone requires a secure (HTTPS) connection |
| Permission / "not allowed" | Allow access via the address-bar mic icon or OS privacy settings |
| Aborted | Request was cancelled — click Start to retry |
| "not found" / "no microphone" | No microphone detected — connect one and retry |
| "in use" / "not readable" | Another app is using the mic — close it and retry |
| Overconstrained | Device doesn't support the requested format — try another device |
| Suspend / resume | Audio interrupted (tab backgrounded) — click Start to resume |

Non-fatal **worker** errors surface separately as an amber `workerError` warning while the
worker recovers (see [crash recovery](./dsp-pipeline.md#backpressure-and-crash-recovery)).

## Pitfalls

- **`next-env.d.ts`** is tracked but Next.js may rewrite it on `pnpm dev` / `pnpm build`.
  Do not commit incidental changes to it.
- **`pnpm build:dmg`** requires a macOS toolchain and cannot run on Linux.
- **Fake-mic flags only apply to a fresh Chrome launch** — close all Chrome instances first.
- **Worker code cannot touch the DOM.** Everything under the worker entry (`dspWorker.ts`
  and the modules it imports) runs off the main thread.
- **Coding conventions (enforced by repo rules):** keep `import`s at the top of the module
  (no inline imports), and use a `never` check in the `default` case of `switch` statements
  over discriminated unions/enums so new variants fail to compile until handled.
