#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const checks = [
  {
    name: 'runtime companion/control references',
    pattern: 'Companion|companion|@companion-module|send to mixer|sendToMixer|relay|pairingCode',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'runtime data sharing references',
    pattern: 'DataCollection|dataCollection|useDataCollection|SnapshotBatch|snapshotCollector|Supabase|supabase|ingest|/api/geo|geo/route|consent-to-upload',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'runtime telemetry references',
    pattern: 'Sentry|sentry|@sentry/nextjs|captureException|captureRequestError|NEXT_PUBLIC_SENTRY',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests', 'next.config.mjs'],
  },
  {
    name: 'runtime ML references',
    pattern: 'onnx|ONNX|onnxruntime|MLInference|mlInference|MLScoreResult|mlEnabled|dwa-fp-filter|public/models|scripts/ml',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'removed workflow references',
    pattern: 'RingOutWizard|ringOutFlow|useRingOut|RoomMeasurement|roomMeasurement|startRoomMeasurement|stopRoomMeasurement|CalibrationTab|SessionExport',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
]

let failed = false

for (const check of checks) {
  const args = [
    '-n',
    '--glob',
    '!docs/superpowers/**',
    check.pattern,
    ...check.paths,
  ]
  const command = [
    'rg',
    ...args.map((arg) => arg.includes(' ') ? JSON.stringify(arg) : arg),
  ].join(' ')
  const result = spawnSync('rg', args, { encoding: 'utf8' })

  if (result.status === 1) {
    console.log(`PASS ${check.name}`)
    continue
  }

  if (result.status !== 0) {
    throw new Error(`${command}\n${result.stderr}`)
  }

  const output = result.stdout

  failed = true
  console.error(`FAIL ${check.name}`)
  console.error(output.trim())
}

if (failed) {
  process.exit(1)
}
