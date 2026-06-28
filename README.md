# DoneWell Audio

Local-only acoustic feedback detection and EQ advisory for live sound engineers.

The app analyzes microphone input in the browser, flags likely feedback or ringing, and suggests practical EQ moves. It is built as a Next.js app and can also be packaged as a macOS DMG.

## Develop

```bash
pnpm install
pnpm dev
```

## Check

```bash
pnpm lint
pnpm test
pnpm verify:local-only
```

## Build

```bash
pnpm build
pnpm build:dmg
```

The DMG build writes to `dist/dwaudio.dmg`.

## Documentation

Engineering docs live in [`docs/`](docs/README.md):

- [Architecture](docs/architecture.md) — system overview, threading model, data flow.
- [DSP pipeline](docs/dsp-pipeline.md) — detection algorithms, fusion, advisory lifecycle.
- [Settings model](docs/settings.md) — layered settings, modes, and derivation.
- [Development](docs/development.md) — setup, testing, and the local-only CI gate.

The app is local-only: all analysis runs client-side and `pnpm verify:local-only` keeps it
that way. See [`AGENTS.md`](AGENTS.md) for environment specifics.
