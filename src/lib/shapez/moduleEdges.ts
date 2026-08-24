/**
 * Which edge of a module carries what, and how many modules a rate needs.
 *
 * The generators know this already — it is implicit in where each of them puts
 * its catchers and launchers — but nothing said it out loud, and a player
 * holding four blueprints needs to be told which side of one meets which side
 * of the next. Two of these placements were measured off a module a player
 * built and one falls out of how far a launcher throws; none of them is a
 * matter of taste, so they are written here once and checked against the real
 * layouts by `moduleEdges.test.ts` rather than trusted.
 */
import { generateCrystalModule } from './crystalModule'
import { generateCutterModule } from './cutterModule'
import { MODULE_LANES, generateLaneModule } from './module'
import { OPERATIONS, type OperationId } from './operations'
import { generateStackerModule } from './stackerModule'
import { generateSwapperModule } from './swapperModule'
import { OPERATION_SPECS, beltThroughput, ratedThroughput, type SpeedTier } from './throughput'

/** A module's four sides, named as the player sees them on the platform. */
export type ModuleEdge = 'intake' | 'outlet' | 'left' | 'right'

export const EDGE_NAMES_KO: Record<ModuleEdge, string> = {
  intake: '위쪽',
  outlet: '아래쪽',
  left: '왼쪽',
  right: '오른쪽',
}

export interface EdgePort {
  edge: ModuleEdge
  /** What travels here, in the player's words. */
  carries: string
}

export interface ModuleWiring {
  inputs: EdgePort[]
  outputs: EdgePort[]
}

/**
 * Where every module's belts meet the world.
 *
 * The two-shape and two-result machines are the interesting ones, and they fit
 * together: a stacker takes its second shape along its right edge, and a cutter
 * sends its second half out its left — which is the same distance apart as two
 * platforms side by side, so one feeds the other with nothing in between.
 */
export const MODULE_WIRING: Record<OperationId, ModuleWiring> = {
  r90cw: { inputs: [{ edge: 'intake', carries: '도형' }], outputs: [{ edge: 'outlet', carries: '돌린 도형' }] },
  r90ccw: { inputs: [{ edge: 'intake', carries: '도형' }], outputs: [{ edge: 'outlet', carries: '돌린 도형' }] },
  r180: { inputs: [{ edge: 'intake', carries: '도형' }], outputs: [{ edge: 'outlet', carries: '돌린 도형' }] },
  hcut: { inputs: [{ edge: 'intake', carries: '도형' }], outputs: [{ edge: 'outlet', carries: '남긴 절반' }] },
  pin: { inputs: [{ edge: 'intake', carries: '도형' }], outputs: [{ edge: 'outlet', carries: '핀 올린 도형' }] },
  paint: { inputs: [{ edge: 'intake', carries: '도형' }], outputs: [{ edge: 'outlet', carries: '칠한 도형' }] },
  crystal: {
    inputs: [{ edge: 'intake', carries: '도형' }],
    outputs: [{ edge: 'outlet', carries: '결정체 채운 도형' }],
  },
  stack: {
    inputs: [
      { edge: 'intake', carries: '아래로 깔릴 도형' },
      { edge: 'right', carries: '위에 얹을 도형' },
    ],
    outputs: [{ edge: 'outlet', carries: '겹친 도형' }],
  },
  cut: {
    inputs: [{ edge: 'intake', carries: '도형' }],
    outputs: [
      { edge: 'outlet', carries: '한쪽 절반' },
      { edge: 'left', carries: '나머지 절반' },
    ],
  },
  swap: {
    inputs: [
      { edge: 'intake', carries: '도형 A' },
      { edge: 'right', carries: '도형 B' },
    ],
    outputs: [
      { edge: 'outlet', carries: 'A였던 줄' },
      { edge: 'left', carries: 'B였던 줄' },
    ],
  },
}

/**
 * How much one module gets through, in shapes a minute.
 *
 * Twelve belts arrive and every module holds enough machines to keep them all
 * full, so a module's capacity is simply twelve belts' worth — which is a great
 * deal more than most plans need, and worth saying plainly before a player
 * builds four of something they needed one of.
 */
export function moduleCapacity(tier: SpeedTier): number {
  return MODULE_LANES * beltThroughput(tier)
}

export function modulesNeeded(rate: number, tier: SpeedTier): number {
  return Math.max(1, Math.ceil(rate / moduleCapacity(tier)))
}

/** How a module's second input or output is described, if it has one. */
export function sideNote(op: OperationId): string | null {
  const wiring = MODULE_WIRING[op]
  const extraIn = wiring.inputs.find((port) => port.edge !== 'intake')
  const extraOut = wiring.outputs.find((port) => port.edge !== 'outlet')
  if (!extraIn && !extraOut) return null

  const parts: string[] = []
  if (extraIn) parts.push(`${EDGE_NAMES_KO[extraIn.edge]} 가장자리로 ${extraIn.carries}을 넣고`)
  if (extraOut) parts.push(`${EDGE_NAMES_KO[extraOut.edge]} 가장자리로 ${extraOut.carries}이 나옵니다`)
  return `${OPERATIONS[op].labelKo} 모듈은 ${parts.join(', ')}`
}

/**
 * Making the module for an operation, whichever generator that takes.
 *
 * Four of them have their belts searched for rather than written down, which
 * takes anything from a quarter of a second to a couple, and the other six come
 * back at once. Anything showing modules to a person needs to know which is
 * which, so it asks before making the slow ones instead of stopping the page —
 * and can say how big one will be before it is asked for, which is what the two
 * numbers here are for. `moduleEdges.test.ts` checks them against the real
 * layouts, since a promised size that turns out wrong is worse than no promise.
 */
export const SEARCHED_MODULES = new Map<OperationId, { perLane: number; machines: number }>([
  ['stack', { perLane: 6, machines: 72 }],
  ['cut', { perLane: 4, machines: 48 }],
  ['swap', { perLane: 4, machines: 48 }],
  ['crystal', { perLane: 6, machines: 72 }],
])

export interface MadeModule {
  code: string | null
  reason: string | null
  warnings: string[]
  machines: number
}

export async function makeModule(
  op: OperationId,
  tier: SpeedTier,
  icon?: string,
): Promise<MadeModule> {
  const wrap = (
    layout: { ok: true; machines: number; warnings: string[] } | { ok: false; reason: string },
    code: string | null,
  ): MadeModule =>
    layout.ok
      ? { code, reason: null, warnings: layout.warnings, machines: layout.machines }
      : { code: null, reason: layout.reason, warnings: [], machines: 0 }

  if (op === 'stack') {
    const { layout, code } = await generateStackerModule(icon)
    return wrap(layout, code)
  }
  if (op === 'cut') {
    const { layout, code } = await generateCutterModule(icon)
    return wrap(layout, code)
  }
  if (op === 'swap') {
    const { layout, code } = await generateSwapperModule(icon)
    return wrap(layout, code)
  }
  if (op === 'crystal') {
    const { layout, code } = await generateCrystalModule(icon)
    return wrap(layout, code)
  }

  const perLane = Math.ceil(beltThroughput(tier) / ratedThroughput(OPERATION_SPECS[op], tier))
  const { layout, code } = await generateLaneModule(op, perLane, icon)
  return wrap(layout, code)
}
