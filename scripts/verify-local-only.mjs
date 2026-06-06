#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'

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
    pattern: 'Sentry|sentry|sentry\\.io|ingest\\.us|@sentry/nextjs|captureException|captureRequestError|NEXT_PUBLIC_SENTRY',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests', 'next.config.mjs'],
  },
  {
    name: 'runtime ML references',
    pattern: 'onnx|ONNX|onnxruntime|MLInference|mlInference|MLScoreResult|mlEnabled|dwa-fp-filter|public/models|scripts/ml',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'runtime labeling/data-collection remnants',
    pattern: 'swipeLabeling|Swipe Labeling|useAdvisoryFeedback|falsePositiveIds|confirmedIds|onFalsePositive|onConfirmFeedback|isFalsePositive|isConfirmed|swipeHintStorage|dwa-swipe-hint-seen|useSwipeGesture|useSwipeHintState|swipe-peek|animate-swipe-peek|Swipe peek',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'stale startup/default sensitivity labels',
    pattern: "historical 25 dB|Default 25dB threshold|Default 25 dB threshold|fillText\\('25'",
    paths: ['app', 'components', 'hooks', 'lib/settings'],
  },
  {
    name: 'legacy v1 settings storage accessors',
    pattern: 'presetStorage|customDefaultsStorage|dwa-custom-presets|dwa-custom-defaults',
    paths: ['lib/storage/dwaStorage.ts'],
  },
  {
    name: 'persistent history/export/research remnants',
    pattern: 'FeedbackHistoryPanel|FeedbackHistoryActions|FeedbackHistoryArchiveSection|useFeedbackHistoryPanelState|useSessionHistory|sessionHistoryStorage|feedbackHistoryStorage|ArchivedSession|archiveSession|exportToCSV|exportToJSON|generatePdfReport|generateTxtReport|audit-prod|requestBulkAdvisories|security/advisories|autoresearch|/api/health|deployment health',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests', 'README.md', 'tests/README.md', 'package.json'],
  },
  {
    name: 'product shell bloat remnants',
    pattern: 'OnboardingOverlay|KeyboardShortcutsModal|HelpMenu|useServiceWorkerUpdate|useFullscreen|New version available|App Fullscreen|Reset panel layout',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests', 'next.config.mjs', 'tsconfig.json', 'package.json'],
  },
  {
    name: 'removed workflow references',
    pattern: 'RingOutWizard|ringOutFlow|useRingOut|RoomMeasurement|roomMeasurement|startRoomMeasurement|stopRoomMeasurement|CalibrationTab\\b|SessionExport|useCalibrationSession|useSetupTabExport|AutoDetectRoomSection|MeasurementInterpretationSection|MissedFeedbackButton',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'tests'],
  },
  {
    name: 'runtime ring-out mode references',
    pattern: 'ringOut|Ring Out|ring out|ring-out',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types'],
  },
  {
    name: 'config references to removed infrastructure',
    pattern: 'supabase/functions|companion-module|companion/extracted|@sentry|onnxruntime|@companion|ml-train|scripts/ml|public/models|api/v1/ingest|api/companion|api/geo|@serwist|\\bserwist\\b|public/sw\\.js',
    paths: ['package.json', 'next.config.mjs', 'tsconfig.json', 'eslint.config.mjs', 'pnpm-workspace.yaml', '.github'],
  },
  {
    name: 'third-party network primitives',
    pattern: 'XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\\.geolocation|navigator\\.sendBeacon|RTCPeerConnection|googletagmanager|google-analytics|www\\.google-analytics\\.com|next/font/google|fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|cdnjs|unpkg|jsdelivr',
    paths: ['app', 'components', 'contexts', 'hooks', 'lib', 'types', 'public/dwa-service-worker.js', 'next.config.mjs'],
  },
]

const forbiddenPaths = [
  '.github',
  'CHANGELOG_FUSION_FIXES.md',
  '.github/dependabot.yml',
  '.github/workflows/auto-version.yml',
  '.github/workflows/ml-train.yml',
  '.github/workflows/patch-on-push.yml',
  'COMPANION_CONVENTIONS.md',
  'EXISTING-MODULE-REFERENCE.md',
  'FUTURE-HARDWARE-PROMPT.md',
  'MIXER-PROFILES-REFERENCE.md',
  'VENU360-OSC-SPEC.md',
  'VENU360-PROFILE-PROMPT.md',
  'app/api/companion',
  'app/api/geo',
  'app/api/health',
  'app/api/sentry-example-api',
  'app/api/v1/ingest',
  'app/api/v1',
  'app/sentry-example-page',
  'app/.DS_Store',
  'autoresearch',
  'companion-module',
  'companion-module-dbx-driverack-pa2',
  'companion-module-dbx-driverack-pa2-v0.2.20260328.zip',
  'docs/archive',
  'docs/canvas',
  'docs/WIKI_SYNC.md',
  'donewell-companion-module-v0.93.0.zip',
  'donewell-companion-modules-v0.2.20260328.zip',
  'dwa-hardware-kit.zip',
  'dwa-venu360-patch.zip',
  'lib/companion',
  'lib/data',
  'lib/dsp/mlInference.ts',
  'lib/dsp/feedbackHistoryStorage.ts',
  'lib/export',
  'lib/storage/indexedDb.ts',
  'lib/storage/sessionHistoryStorage.ts',
  'osc-parser.js',
  'public/.DS_Store',
  'public/icon-generator.html',
  'public/logos',
  'public/models',
  'public/sw.js',
  'public/swe-worker.js',
  'public/placeholder-logo.png',
  'public/placeholder-logo.svg',
  'public/placeholder-user.jpg',
  'public/placeholder.jpg',
  'public/placeholder.svg',
  'public/rta-placeholder-dark.png',
  'public/rta-placeholder-light.png',
  'components/analyzer/HelpMenu.tsx',
  'components/analyzer/KeyboardShortcutsModal.tsx',
  'components/analyzer/OnboardingOverlay.tsx',
  'components/analyzer/help',
  'hooks/useFullscreen.ts',
  'hooks/useServiceWorkerUpdate.ts',
  'research',
  'scripts/audit-prod.mjs',
  'scripts/generate-companion-doc.mjs',
  'scripts/generate-rta-placeholder.py',
  'scripts/ml',
  'scripts/test-ingest.mjs',
  'scripts/test-pipeline.mjs',
  'supabase',
  'tests/autoresearch',
  'tests/scripts/auditProd.test.ts',
  'types/companion.ts',
  'types/data.ts',
  'types/export.ts',
  'types/onnxruntime-web.d.ts',
]

const generatedOutputDirs = [
  'out',
  'dist/dwaudio/dwaudio.app/Contents/Resources/out',
]

const runtimePathScanRoots = [
  'app',
  'components',
  'contexts',
  'hooks',
  'lib',
  'public',
]

const generatedForbiddenPathPatterns = [
  /(^|\/)\.DS_Store$/i,
  /(^|\/)icon-generator\.html$/i,
  /(^|\/)logos(\/|$)/i,
  /(^|\/)models(\/|$)/i,
  /(^|\/)placeholder(?:-[^/]+)?\.(?:png|svg|jpe?g)$/i,
  /(^|\/)rta-placeholder-[^/]+\.(?:png|svg|jpe?g)$/i,
  /(?:^|\/).*\.onnx$/i,
  /(?:^|\/).*companion.*$/i,
  /(?:^|\/).*(?:demo|mock|fake).*$/i,
]

const runtimeForbiddenPathPatterns = [
  /(^|\/)\.DS_Store$/i,
  /(^|\/)sentry-example[^/]*(\/|$)/i,
  /(^|\/)[^/]*(?:demo|mock|fake|example|placeholder)[^/]*(\/|$)/i,
]

let failed = false

function listFiles(root) {
  const files = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !existsSync(current)) continue

    const stat = statSync(current)
    if (stat.isFile()) {
      files.push(current)
      continue
    }
    if (!stat.isDirectory()) continue

    for (const entry of readdirSync(current)) {
      stack.push(`${current}/${entry}`)
    }
  }

  return files
}

function listPaths(root) {
  const paths = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !existsSync(current)) continue

    paths.push(current)

    const stat = statSync(current)
    if (!stat.isDirectory()) continue

    for (const entry of readdirSync(current)) {
      stack.push(`${current}/${entry}`)
    }
  }

  return paths
}

function checkIgnoredPath(path) {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', path], { encoding: 'utf8' }).status === 0
}

function isIgnoredFinderMetadata(path) {
  return /(^|\/)\.DS_Store$/i.test(path) && checkIgnoredPath(path)
}

const existingForbiddenPaths = forbiddenPaths.filter((path) => existsSync(path))
if (existingForbiddenPaths.length > 0) {
  failed = true
  console.error('FAIL removed local-only bloat paths')
  console.error(existingForbiddenPaths.join('\n'))
} else {
  console.log('PASS removed local-only bloat paths')
}

const unignoredGeneratedDirs = ['out/', 'dist/'].filter((path) => !checkIgnoredPath(path))
if (unignoredGeneratedDirs.length > 0) {
  failed = true
  console.error('FAIL generated package output is ignored')
  console.error(unignoredGeneratedDirs.join('\n'))
} else {
  console.log('PASS generated package output is ignored')
}

const generatedForbiddenFiles = generatedOutputDirs
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => listFiles(dir))
  .filter((path) => generatedForbiddenPathPatterns.some((pattern) => pattern.test(path)))

if (generatedForbiddenFiles.length > 0) {
  failed = true
  console.error('FAIL generated package fake/demo/model residue')
  console.error(generatedForbiddenFiles.join('\n'))
} else {
  console.log('PASS generated package fake/demo/model residue')
}

const runtimeForbiddenPaths = runtimePathScanRoots
  .filter((dir) => existsSync(dir))
  .flatMap((dir) => listPaths(dir))
  .filter((path) => runtimeForbiddenPathPatterns.some((pattern) => pattern.test(path)))
  .filter((path) => !isIgnoredFinderMetadata(path))

if (runtimeForbiddenPaths.length > 0) {
  failed = true
  console.error('FAIL runtime fake/demo/example/placeholder paths')
  console.error(runtimeForbiddenPaths.join('\n'))
} else {
  console.log('PASS runtime fake/demo/example/placeholder paths')
}

for (const check of checks) {
  const paths = check.paths.filter((path) => existsSync(path))
  if (paths.length === 0) {
    console.log(`PASS ${check.name}`)
    continue
  }

  const args = ['-n', check.pattern, ...paths]
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
