/**
 * Belt geometry confirmed against real, working factories.
 *
 * The game files carry no port data, so every entry here was measured by
 * `derivePorts` on blueprints a player actually built and ran. `source` says
 * where it came from and `samples` how many instances backed it — nothing in
 * this file is a guess, and anything not yet observed is simply absent.
 *
 * Offsets are in the building's local frame, where -X is upstream and +X is
 * downstream. They are 2D: a machine spanning two building layers can hide a
 * second port at the same (x, y), which is why some entries are marked partial.
 */
import type { Offset } from './ports'

export type PortSource =
  /** Re-derived from a bundled blueprint by the test suite. */
  | 'fixture'
  /** Measured in-game by a player and reported back. */
  | 'player-report'

export interface ConfirmedPorts {
  /** Belt inputs, in local tile offsets. */
  inputs: Offset[]
  /** Belt outputs, in local tile offsets. */
  outputs: Offset[]
  /** Pipe connections; fluid is bidirectional so these carry no direction. */
  fluid?: Offset[]
  samples: number
  source: PortSource
  /**
   * Which bundled blueprint backs a `fixture` entry. Defaults to the big player
   * platform; purpose-built rigs name themselves.
   */
  fixture?: string
  /**
   * The machine is known to move more shapes than the observed belt ports can
   * account for — usually a second input arriving via a lift on another layer.
   * Belt routing must refuse these.
   */
  partialBelts?: boolean
  /**
   * The machine consumes paint but the pipe side hasn't been isolated. Belt
   * routing is still fine; the player just has to run the pipe themselves.
   */
  fluidUnknown?: boolean
  note?: string
}

export const CONFIRMED_PORTS: Record<string, ConfirmedPorts> = {
  // ── carriers ────────────────────────────────────────────────────────────
  BeltDefaultForwardInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [[1, 0, 0]],
    samples: 477,
    source: 'fixture',
  },
  BeltDefaultLeftInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [[0, -1, 0]],
    samples: 82,
    source: 'fixture',
  },
  BeltDefaultLeftInternalVariantMirrored: {
    inputs: [[-1, 0, 0]],
    outputs: [[0, 1, 0]],
    samples: 75,
    source: 'fixture',
  },

  // ── flow control ────────────────────────────────────────────────────────
  Merger2To1LInternalVariant: {
    inputs: [
      [-1, 0, 0],
      [0, -1, 0],
    ],
    outputs: [[1, 0, 0]],
    samples: 36,
    source: 'fixture',
  },
  Merger2To1LInternalVariantMirrored: {
    inputs: [
      [-1, 0, 0],
      [0, 1, 0],
    ],
    outputs: [[1, 0, 0]],
    samples: 27,
    source: 'fixture',
  },
  Splitter1To2LInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [
      [0, -1, 0],
      [1, 0, 0],
    ],
    samples: 19,
    source: 'player-report',
  },
  Splitter1To2LInternalVariantMirrored: {
    inputs: [[-1, 0, 0]],
    outputs: [
      [0, 1, 0],
      [1, 0, 0],
    ],
    samples: 13,
    source: 'player-report',
  },
  SplitterTShapeInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [
      [0, -1, 0],
      [0, 1, 0],
    ],
    samples: 28,
    source: 'player-report',
  },

  // ── platform edges ──────────────────────────────────────────────────────
  BeltPortSenderInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [],
    samples: 57,
    source: 'fixture',
    note: 'Independently seen on 92 instances in a player module.',
  },
  BeltPortReceiverInternalVariant: {
    inputs: [],
    outputs: [[1, 0, 0]],
    samples: 45,
    source: 'fixture',
    note: 'Independently seen on 104 instances in a player module.',
  },

  // ── shape machines ──────────────────────────────────────────────────────
  CutterDefaultInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [
      [1, -1, 0],
      [1, 0, 0],
    ],
    samples: 40,
    source: 'fixture',
    note: '1×2. Both halves leave on +X, one per tile.',
  },
  CutterDefaultInternalVariantMirrored: {
    inputs: [[-1, 0, 0]],
    outputs: [
      [1, 0, 0],
      [1, 1, 0],
    ],
    samples: 8,
    source: 'fixture',
  },
  StackerStraightInternalVariant: {
    inputs: [
      [-1, 0, 0],
      [-1, 0, 1],
    ],
    outputs: [[1, 0, 0]],
    samples: 1,
    source: 'fixture',
    fixture: 'stacker two-floor rig',
    note: 'One tile in plan, two floors tall. Both shapes come in on -X, the bottom one on the lower floor and the top one on the upper; the result leaves on +X downstairs. The 1,017-building factory agreed on the plan-view offset across 72 instances but could not separate the floors, which is why this looked like a one-input machine until a rig was built for it.',
  },
  PainterDefaultInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [[1, 0, 0]],
    samples: 24,
    source: 'player-report',
    fluidUnknown: true,
    note: 'Belt ports are solid; the pipe side was not isolated in the sampled module.',
  },
  PainterDefaultInternalVariantMirrored: {
    inputs: [[-1, 0, 0]],
    outputs: [[1, 0, 0]],
    samples: 24,
    source: 'player-report',
    fluidUnknown: true,
  },
  CrystalGeneratorDefaultInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [[1, 0, 0]],
    samples: 36,
    source: 'player-report',
    fluidUnknown: true,
    note: 'Needs paint, but the pipe side has not been isolated — an earlier reading of (-1,1) came from wrongly treating pipes as directional and did not reproduce.',
  },
  CrystalGeneratorDefaultInternalVariantMirrored: {
    inputs: [[-1, 0, 0]],
    outputs: [[1, 0, 0]],
    samples: 36,
    source: 'player-report',
    fluidUnknown: true,
  },
  RotatorOneQuadInternalVariant: {
    inputs: [[-1, 0, 0]],
    outputs: [[1, 0, 0]],
    samples: 24,
    source: 'player-report',
    note: '1×1, straight through.',
  },
}

/** Machines whose geometry is still unknown — a generator must refuse these. */
export const UNKNOWN_PORTS = [
  'RotatorOneQuadCCWInternalVariant',
  'RotatorHalfInternalVariant',
  'CutterHalfInternalVariant',
  'PinPusherDefaultInternalVariant',
  'HalvesSwapperDefaultInternalVariant',
  'StackerDefaultInternalVariant',
] as const

export function portsFor(type: string): ConfirmedPorts | null {
  return CONFIRMED_PORTS[type] ?? null
}

/**
 * Whether a belt router can place this building. A missing pipe location is
 * fine — the player runs that themselves — but missing belt ports are not.
 */
export function isRoutable(type: string): boolean {
  const ports = CONFIRMED_PORTS[type]
  return ports !== undefined && ports.partialBelts !== true
}

/** Buildings that will need paint piped in by hand. */
export function needsManualPiping(type: string): boolean {
  return CONFIRMED_PORTS[type]?.fluidUnknown === true
}
