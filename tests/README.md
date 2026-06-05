# DoneWell Audio Test Suite

## Run

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
npx tsc --noEmit
```

Repo gate:

```bash
npx tsc --noEmit && pnpm test
```

## Structure

```text
components/**/__tests__/   UI regression tests
contexts/__tests__/        Context/provider tests
hooks/__tests__/           Hook and worker lifecycle tests
lib/**/__tests__/          DSP, storage, export, and utility unit tests
tests/dsp/                 Scenario-style DSP and fusion tests
tests/integration/         Cross-module behavior tests
```

## What Matters Most

- Hot-path DSP changes should land with targeted regression coverage near the affected module.
- UI and settings changes should prefer behavior tests over broad snapshots.
- Fusion and classifier tuning should be validated with local synthetic scenarios and deterministic unit coverage.
