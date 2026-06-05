/**
 * Detection Constants — Algorithm Tuning & Gate Parameters
 *
 * Severity thresholds, classifier weights, MSD settings, persistence scoring,
 * signal gate, mains hum gate, phase/spectral/comb/compression settings,
 * temporal envelope, hysteresis, hotspot cooldowns, and early warning.
 *
 * @see DAFx-16 — MSD algorithm
 * @see KU Leuven — Phase coherence
 * @see DBX whitepaper — Comb pattern detection
 * @see Van Waterschoot & Moonen (2011) — PHPR
 */

// Severity thresholds - tuned for PA system feedback detection
export const SEVERITY_THRESHOLDS = {
  RUNAWAY_VELOCITY: 8, // dB/sec growth rate for runaway (lower = catch faster)
  GROWING_VELOCITY: 2, // dB/sec for growing (more sensitive)
  HIGH_Q: 40, // Q value indicating narrow resonance (lower = catch more)
  PERSISTENCE_MS: 400, // ms for resonance classification (faster detection)
} as const

// Classification weights - optimized for PA feedback detection
// Base feature weights sum to 1.0; classifier also applies contextual deltas
// (Q factor, persistence, growth, and source-shape gates) that shift probabilities further.
export const CLASSIFIER_WEIGHTS = {
  // Stationarity (low pitch variation = feedback) - primary indicator
  STABILITY_FEEDBACK: 0.28,
  STABILITY_THRESHOLD_CENTS: 12, // tighter threshold for feedback detection

  // Harmonicity (coherent harmonics = instrument)
  HARMONICITY_INSTRUMENT: 0.22,
  HARMONICITY_THRESHOLD: 0.65, // higher threshold = less false instrument classification

  // Modulation (vibrato = whistle)
  MODULATION_WHISTLE: 0.18,
  MODULATION_THRESHOLD: 0.45, // slightly higher threshold

  // Sideband noise (breath = whistle)
  SIDEBAND_WHISTLE: 0.09,
  SIDEBAND_THRESHOLD: 0.35, // slightly higher threshold

  // Runaway growth (high velocity = feedback) - strong indicator
  GROWTH_FEEDBACK: 0.23,
  GROWTH_THRESHOLD: 4, // lower threshold = catch feedback growth earlier

  // Classification thresholds - more conservative for PA use
  CLASSIFICATION_THRESHOLD: 0.45, // lower = more likely to flag as potential issue
  WHISTLE_THRESHOLD: 0.65, // higher = less false whistle classification
  INSTRUMENT_THRESHOLD: 0.60, // higher = less false instrument classification
} as const

// PHPR (Peak-to-Harmonic Power Ratio) settings
// Van Waterschoot & Moonen (2011): feedback is sinusoidal (no harmonics),
// music/speech always has harmonics. High PHPR = likely feedback.
export const PHPR_SETTINGS = {
  /** Number of harmonics to check (2nd, 3rd, 4th) */
  NUM_HARMONICS: 3,
  /** Bin tolerance for FFT leakage (±1 bin around harmonic) */
  BIN_TOLERANCE: 1,
  /** PHPR above this (dB) → boost feedback confidence */
  FEEDBACK_THRESHOLD_DB: 15,
  /** PHPR below this (dB) → penalize feedback confidence */
  MUSIC_THRESHOLD_DB: 8,
  /** Confidence boost for high PHPR (pure tone) */
  CONFIDENCE_BOOST: 0.10,
  /** Confidence penalty for low PHPR (rich harmonics) */
  CONFIDENCE_PENALTY: 0.10,
} as const

// Vocal ring assist mode settings - optimized for speech/corporate PA
export const VOCAL_RING_SETTINGS = {
  BASELINE_EMA_ALPHA: 0.02, // Slow LTAS baseline adaptation
  RING_THRESHOLD_DB: 4, // Lower threshold for earlier ring detection
  RING_PERSISTENCE_MS: 150, // Faster confirmation for speech dynamics
  VOICE_FREQ_LOW: 200, // Hz - vocal-focused lower bound
  VOICE_FREQ_HIGH: 8000, // Hz - extended for speech sibilance
  SUGGESTED_CUT_MIN: -2, // dB
  SUGGESTED_CUT_MAX: -6, // dB
} as const

// Spectral trend monitor settings
export const SPECTRAL_TRENDS = {
  LOW_RUMBLE_THRESHOLD_HZ: 80,
  LOW_RUMBLE_EXCESS_DB: 6,
  MUD_FREQ_LOW: 200,
  MUD_FREQ_HIGH: 400,
  MUD_EXCESS_DB: 4,
  HARSH_FREQ_LOW: 6000,
  HARSH_FREQ_HIGH: 10000,
  HARSH_EXCESS_DB: 5,
  /**
   * Shelf flatness guard: minimum peak-to-mean energy ratio within a shelf region.
   * When the ratio of the peak bin energy to the mean bin energy in the region
   * is below this threshold, the spectral shape is too flat (broadband) for a
   * shelf to be effective — energy is spread uniformly rather than tilted.
   * In that case, skip the shelf recommendation.
   *
   * Value of 1.5 means the loudest bin must be at least 1.5× (~1.8 dB above)
   * the region mean. Below that, a shelf cut just lowers overall level without
   * targeting the concentration.
   */
  SHELF_FLATNESS_PEAK_TO_MEAN_MIN: 1.5,
} as const

// Track history settings
export const TRACK_SETTINGS = {
  HISTORY_SIZE: 128, // Ring buffer size for track history
  ASSOCIATION_TOLERANCE_CENTS: 100, // Max cents difference to associate peak to track (1 semitone — synced with peakMergeCents)
  MAX_TRACKS: 64, // Maximum simultaneous tracks
  TRACK_TIMEOUT_MS: 1000, // Remove track after this inactive time
} as const

// Harmonic detection settings
export const HARMONIC_SETTINGS = {
  MAX_HARMONIC: 8, // Check overtones up to this partial (2nd–8th)
  TOLERANCE_CENTS: 200, // ±200 cents = whole tone; 2× ASSOCIATION_TOLERANCE_CENTS — wider for inharmonic overtones
  // Sub-harmonic check: if new peak F and an active track is near F*k, new peak may be the fundamental
  CHECK_SUB_HARMONICS: true,
} as const

// Band cooldown — suppresses re-triggering the same GEQ band after an advisory is explicitly cleared
export const BAND_COOLDOWN_MS = 500

// Memory management — bounds for long-running sessions (live gigs run hours)
export const MEMORY_LIMITS = {
  /** Maximum advisories in the worker Map before pruning oldest entries */
  MAX_ADVISORIES: 200,
  /** TTL for recentDecays entries (ms) — entries older than this are pruned unconditionally */
  DECAY_HISTORY_TTL_MS: 30_000,
} as const

// ── MSD (Magnitude Slope Deviation) from DAFx-16 paper ──────────────────────

export const MSD_SETTINGS = {
  /** Default MSD threshold (dB²/frame²) - values below indicate feedback
   *  DAFx-16 paper gives 1.0 dB²/frame² for 16-frame window.
   *  After normalizing by numTerms (frameCount - 2), threshold ≈ 1.0/14 ≈ 0.071.
   *  We use 0.1 (slightly loose) for robustness. */
  THRESHOLD: 0.1,
  /** MSD below this → flag as feedback howl */
  HOWL_THRESHOLD: 0.1,
  /** MSD below this threshold on consecutive frames → fast-confirm feedback */
  FAST_CONFIRM_THRESHOLD: 0.15,
  /** Number of consecutive frames below FAST_CONFIRM_THRESHOLD to confirm */
  FAST_CONFIRM_FRAMES: 3,
  /** Minimum frames for speech detection (100% accuracy per paper) */
  MIN_FRAMES_SPEECH: 7,
  /** Minimum frames for classical music (100% accuracy per paper) */
  MIN_FRAMES_MUSIC: 13,
  /** Default minimum frames */
  DEFAULT_MIN_FRAMES: 12, // ~200ms at 60fps — balanced between early detection and statistical confidence
  /** Maximum frames — must match HISTORY_SIZE so both MSD paths use the same depth */
  MAX_FRAMES: 64,
  /** Ring buffer size for MSD magnitude history per bin */
  HISTORY_SIZE: 64,
  /** Minimum energy above noise floor (dB) required to run MSD analysis on a bin */
  MIN_ENERGY_ABOVE_NOISE_DB: 6,
  /** Threshold reduction (dB) when MSD confirms howl pattern — lets quiet feedback through earlier */
  THRESHOLD_REDUCTION_DB: 4,
  /** Max concurrent bins with MSD history (pool slots).
   *  256 covers even worst-case dense-harmonic content with margin.
   *  Memory: 256 × 64 × 4 = 64KB (vs 1MB for dense 4096-bin allocation). */
  POOL_SIZE: 256,
} as const

/**
 * Convenience alias for MSD algorithm thresholds — used by fusionEngine and tests.
 * Derived from MSD_SETTINGS. Previously in msdAnalysis.ts (deprecated).
 */
export const MSD_CONSTANTS = {
  THRESHOLD: MSD_SETTINGS.THRESHOLD,
  SILENCE_FLOOR_DB: -70,
  MIN_FRAMES_SPEECH: MSD_SETTINGS.MIN_FRAMES_SPEECH,
  MIN_FRAMES_MUSIC: MSD_SETTINGS.MIN_FRAMES_MUSIC,
  DEFAULT_FRAMES: MSD_SETTINGS.MIN_FRAMES_SPEECH,
  MAX_FRAMES: MSD_SETTINGS.MAX_FRAMES,
} as const

// ── Persistence Scoring ─────────────────────────────────────────────────────

// Peak Persistence Scoring — frame-rate-independent (ms → frames at runtime)
// Feedback is persistent over time, transients are short-lived.
// Thresholds are in milliseconds — frame equivalents computed at runtime
// from analysisIntervalMs so behaviour is identical at 25fps, 50fps, 60fps.
export const PERSISTENCE_SCORING = {
  /** Maximum persistence tracking window (ms) — runtime frames = ceil(ms / interval) */
  HISTORY_MS: 640,
  /** dB tolerance for counting a frame as "same peak still present" */
  AMPLITUDE_TOLERANCE_DB: 6,
  /** Minimum persistence time to consider a peak persistent (ms) */
  MIN_PERSISTENCE_MS: 100,
  /** Time for high persistence classification (ms) */
  HIGH_PERSISTENCE_MS: 300,
  /** Time for very high persistence classification (ms) */
  VERY_HIGH_PERSISTENCE_MS: 600,
  /** Confidence boost for minimally persistent peaks */
  MIN_PERSISTENCE_BOOST: 0.05,
  /** Confidence boost for highly persistent peaks */
  HIGH_PERSISTENCE_BOOST: 0.12,
  /** Confidence boost for very highly persistent peaks */
  VERY_HIGH_PERSISTENCE_BOOST: 0.20,
  /** Time below which a penalty is applied — transient peak (ms) */
  LOW_PERSISTENCE_MS: 60,
  /** Confidence penalty for transient peaks */
  LOW_PERSISTENCE_PENALTY: 0.05,
} as const

/**
 * Per-mode persistence thresholds. Music modes use higher thresholds because
 * instruments sustain 1-5s naturally — using 300ms would false-boost sustained notes.
 * Monitor mode uses lower thresholds for faster detection.
 * Falls back to PERSISTENCE_SCORING.HIGH_PERSISTENCE_MS (300ms) for unlisted modes.
 */
export const MODE_PERSISTENCE_HIGH_MS: Partial<Record<string, number>> = {
  speech: 300,     // Current default — plosive/transient safe
  broadcast: 300,  // Studio — same as speech
  theater: 300,    // Drama — same as speech
  worship: 500,    // Reverberant — instruments sustain longer
  liveMusic: 500,  // Dense harmonics — sustained notes are normal
  outdoor: 500,    // Festivals — wind/reverb cause sustained energy
  monitors: 150,   // Stage wedges — fastest detection needed
} as const

// ── Signal & Noise Gates ────────────────────────────────────────────────────

// Signal presence gate — prevents auto-gain from amplifying silence into phantom peaks
export const SIGNAL_GATE = {
  /** Default silence threshold in dBFS (pre-gain). Below this, no detection runs. */
  DEFAULT_SILENCE_THRESHOLD_DB: -65,
  /** Per-mode overrides — restored to baseline sensitivity */
  MODE_SILENCE_THRESHOLDS: {
    speech: -65,
    worship: -58,
    liveMusic: -45,
    theater: -58,
    monitors: -45,
    broadcast: -70,    // studio is very quiet
    outdoor: -45,
  } as Record<string, number>,
} as const

/**
 * Mains hum gate — suppress HVAC/electrical equipment false positives.
 * Electrical hum from AC-powered equipment creates exact harmonic series
 * at integer multiples of the mains frequency: 60n Hz or 50n Hz.
 * Auto-detects 50 vs 60 Hz from active peak pattern.
 * @see classifier.ts detectMainsHum()
 */
export const MAINS_HUM_GATE = {
  /** Mains fundamental frequencies to check (auto-detect which matches best) */
  FUNDAMENTALS: [50, 60] as readonly number[],
  /** Maximum harmonic order to check (60×8 = 480 Hz covers primary HVAC range) */
  MAX_HARMONIC: 8,
  /** Frequency tolerance in Hz for matching a mains harmonic */
  TOLERANCE_HZ: 2,
  /** Minimum corroborating peaks on the same mains series to trigger gate */
  MIN_CORROBORATING_PEAKS: 2,
  /** Phase coherence threshold — mains hum is AC-locked, so coherence is high */
  PHASE_COHERENCE_THRESHOLD: 0.70,
  /** Gate multiplier when mains hum detected (60% reduction) */
  GATE_MULTIPLIER: 0.40,
} as const

/**
 * Temporal envelope analysis — speech vs music discrimination via energy dynamics.
 * Speech has silence gaps between words (high variance, many quiet frames).
 * Music fills continuously (low variance, few quiet frames).
 * @see feedbackDetector.ts _computeTemporalMetrics()
 */
export const TEMPORAL_ENVELOPE = {
  /** Ring buffer size in frames. At 50fps, 50 frames = 1 second of history. */
  BUFFER_SIZE: 50,
  /** Minimum frames before temporal metrics are considered reliable. */
  MIN_FRAMES: 25,
  /** Total weight for temporal features in detectContentType scoring (0–1). */
  WEIGHT: 0.40,
  /** Speech thresholds — high energy variance indicates dynamic amplitude (pauses). */
  SPEECH_VARIANCE_HIGH: 20,
  SPEECH_VARIANCE_MED: 12,
  /** Speech silence gap ratio — fraction of frames below silence threshold. */
  SPEECH_GAP_HIGH: 0.20,
  SPEECH_GAP_MED: 0.10,
  /** Music thresholds — low energy variance indicates continuous signal. */
  MUSIC_VARIANCE_LOW: 6,
  MUSIC_VARIANCE_MED: 10,
  /** Music silence gap ratio — very few frames below threshold. */
  MUSIC_GAP_LOW: 0.03,
  MUSIC_GAP_MED: 0.08,
} as const

// ── Hysteresis & Cooldowns ──────────────────────────────────────────────────

// Hysteresis for peak re-detection — prevents on-off-on flickering
export const HYSTERESIS = {
  /** Extra dB above threshold required to re-trigger a recently cleared peak */
  RE_TRIGGER_DB: 1.5,
} as const

// Hotspot event cooldown — prevents inflated occurrence counts from rapid re-triggers
export const HOTSPOT_COOLDOWN_MS = 3000

/**
 * Per-mode hotspot cooldown durations (ms).
 * Monitors need fastest re-detection; liveMusic needs longest to avoid
 * counting musical content as repeat offenders.
 */
export const HOTSPOT_COOLDOWN_BY_MODE: Record<string, number> = {
  monitors: 1000,
  broadcast: 2000,
  theater: 2000,
  speech: 3000,
  worship: 3000,
  outdoor: 3000,
  liveMusic: 5000,
}

/**
 * Post-cut cooldown override (ms).
 * After a user confirms/applies an EQ cut on a frequency, the hotspot cooldown
 * for that frequency is shortened to this value.
 */
export const POST_CUT_COOLDOWN_MS = 500

// ── Algorithm-Specific Settings ─────────────────────────────────────────────

// Phase coherence from KU Leuven/Nyquist analysis
export const PHASE_SETTINGS = {
  /** High coherence indicates feedback (pure tone maintains phase) */
  HIGH_COHERENCE: 0.85,
  /** Medium coherence is uncertain */
  MEDIUM_COHERENCE: 0.65,
  /** Low coherence indicates music/noise */
  LOW_COHERENCE: 0.4,
  /** Minimum samples for reliable analysis */
  MIN_SAMPLES: 5,
} as const

// Spectral flatness thresholds
export const SPECTRAL_FLATNESS_SETTINGS = {
  /** Pure tone (feedback) has very low flatness */
  PURE_TONE: 0.05,
  /** Speech has moderate flatness */
  SPEECH: 0.15,
  /** Music has higher flatness */
  MUSIC: 0.3,
  /** High kurtosis indicates peaky distribution */
  HIGH_KURTOSIS: 10,
  /** Bandwidth around peak to analyze (bins) */
  ANALYSIS_BANDWIDTH: 10,
} as const

// Comb filter pattern detection from DBX paper
export const COMB_PATTERN_SETTINGS = {
  /** Speed of sound (m/s) */
  SPEED_OF_SOUND: 343,
  /** Minimum peaks to establish pattern */
  MIN_PEAKS: 3,
  /** Tolerance for frequency spacing (fraction) */
  SPACING_TOLERANCE: 0.05,
  /** Maximum path length (meters) */
  MAX_PATH_LENGTH: 50,
} as const

// Compression detection thresholds
export const COMPRESSION_SETTINGS = {
  /** Normal crest factor for uncompressed audio (dB) */
  NORMAL_CREST_FACTOR: 12,
  /** Heavy compression crest factor (dB) */
  COMPRESSED_CREST_FACTOR: 6,
  /** Minimum dynamic range for detection (dB) */
  MIN_DYNAMIC_RANGE: 20,
  /** Compressed dynamic range (dB) */
  COMPRESSED_DYNAMIC_RANGE: 8,
} as const

// Early-Warning dP/dt annotation constants (metadata only, no advisory creation)
export const EARLY_WARNING = {
  DPDT_EMA_ALPHA: 0.35,
  BUILDING_DPDT_THRESHOLD: 0.05,
  BUILDING_PROBABILITY_THRESHOLD: 0.3,
  GROWING_DPDT_THRESHOLD: 0.15,
  GROWING_PROBABILITY_THRESHOLD: 0.5,
  CLEAR_DPDT_THRESHOLD: 0.02,
  CLEAR_FRAME_COUNT: 3,
} as const
