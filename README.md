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
