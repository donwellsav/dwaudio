# CLAUDE.md - DoneWell Audio Local-Only Fork

This file is intentionally short. Older project memory described Companion,
Sentry, Supabase ingest, ONNX models, ML training, room measurement, ring-out,
and mixer automation. Those directions are not part of this fork.

## Current Goal

Keep DoneWell Audio as a local-only feedback analysis app:

- live spectrum
- detected feedback issues
- recommended local EQ actions
- expert deterministic settings

No analyzer data should leave the browser. No external service, companion
module, cloud database, telemetry provider, or ML model should be required.

## Do Not Reintroduce

- Companion modules, relay/proxy APIs, pairing codes, OSC/mixer control
- Supabase, ingest routes, geo lookup, consent-to-upload, snapshot upload
- Sentry or other external telemetry/error reporting
- ONNX, `onnxruntime-web`, shipped models, ML training/export scripts
- Ring-out wizard, room measurement flow, calibration/session export
- GitHub automation that trains models or creates commits/PRs without user action

## Commands

```bash
pnpm dev
pnpm verify:local-only
npx tsc --noEmit
pnpm lint
pnpm test
pnpm build
git diff --check
```

Use `pnpm verify:local-only` as the first line of defense, then run the standard
type/lint/test/build gates. For UI work, verify the local browser route as well.

## Isolation

This is an experimental fork. Do not push, fetch, create PRs, or otherwise touch
GitHub unless the user explicitly asks for that specific action.
