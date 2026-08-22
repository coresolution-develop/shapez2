/**
 * Throughput model: how many buildings and belts a plan needs to hit a target
 * output rate.
 *
 * Rates are shapes per minute at the 100% speed multiplier, taken from the
 * shapez 2 wiki's per-building pages. Every building scales linearly with the
 * speed upgrade, so the five wiki-listed tiers are exactly base × 50/75/100/
 * 125/150 %.
 */
import type { OperationId } from './operations'
import { orderedSteps, type BuildNode } from './plan'
import type { ColorCode } from './types'

export const SPEED_TIERS = [50, 75, 100, 125, 150] as const
export type SpeedTier = (typeof SPEED_TIERS)[number]

/** Belt lane capacity at 100%. */
export const BELT_BASE_RATE = 120

export interface BuildingSpec {
  nameKo: string
  building: string
  /** operations per minute at the 100% speed multiplier */
  baseRate: number
  /** litres of paint consumed per operation */
  fluidPerOp?: number
  /**
   * Painter-family machines only have upgrade tiers from 100% up, so the two
   * lower belt/cutting tiers don't slow them down.
   */
  paintingFamily?: boolean
}

export const EXTRACTOR_SPEC: BuildingSpec = {
  nameKo: '미니 채굴기',
  building: 'Extractor (Mini-Miner)',
  baseRate: 30,
}

export type StackerVariant = 'straight' | 'bent'

export const STACKER_SPECS: Record<StackerVariant, BuildingSpec> = {
  straight: { nameKo: '결합기', building: 'Stacker', baseRate: 20 },
  bent: { nameKo: '굽은 결합기', building: 'Bent Stacker', baseRate: 30 },
}

export const OPERATION_SPECS: Record<OperationId, BuildingSpec> = {
  cut: { nameKo: '절단기', building: 'Cutter', baseRate: 30 },
  hcut: { nameKo: '절반 파괴기', building: 'Half Destroyer', baseRate: 40 },
  r90cw: { nameKo: '회전기', building: 'Rotator', baseRate: 60 },
  r90ccw: { nameKo: '회전기', building: 'Rotator', baseRate: 60 },
  r180: { nameKo: '회전기', building: 'Rotator', baseRate: 60 },
  swap: { nameKo: '교환기', building: 'Halves Swapper', baseRate: 30 },
  stack: STACKER_SPECS.straight,
  paint: { nameKo: '색칠기', building: 'Painter', baseRate: 30, fluidPerOp: 10, paintingFamily: true },
  pin: { nameKo: '핀 누름기', building: 'Pin Pusher', baseRate: 40 },
  crystal: {
    nameKo: '결정체 생성기',
    building: 'Crystal Generator',
    baseRate: 20,
    fluidPerOp: 20,
    paintingFamily: true,
  },
}

export function ratedThroughput(spec: BuildingSpec, tier: SpeedTier): number {
  const effective = spec.paintingFamily ? Math.max(tier, 100) : tier
  return (spec.baseRate * effective) / 100
}

export function beltThroughput(tier: SpeedTier): number {
  return (BELT_BASE_RATE * tier) / 100
}

export interface NodeLoad {
  /** shapes per minute this node must deliver to its consumers */
  rate: number
  /** operations per minute the physical building runs at */
  opRate: number
  buildings: number
  /** belts needed to carry this node's output */
  belts: number
  spec: BuildingSpec
}

export interface BuildingTotal {
  spec: BuildingSpec
  count: number
  opRate: number
}

export interface FluidTotal {
  color: ColorCode
  litresPerMinute: number
}

export interface ThroughputPlan {
  target: number
  tier: SpeedTier
  loads: Map<string, NodeLoad>
  buildings: BuildingTotal[]
  extractors: { part: string; count: number; rate: number }[]
  fluids: FluidTotal[]
  totalBuildings: number
  /** belts needed on the finished-shape output line */
  outputBelts: number
}

interface Options {
  target: number
  tier: SpeedTier
  stackerVariant: StackerVariant
}

function specFor(node: BuildNode, stackerVariant: StackerVariant): BuildingSpec {
  if (node.op === null) return EXTRACTOR_SPEC
  if (node.op === 'stack') return STACKER_SPECS[stackerVariant]
  return OPERATION_SPECS[node.op]
}

/**
 * Two nodes that differ only by which output of a 2-output building they take
 * (a cutter's two halves, a swapper's two sides) are the same machine.
 */
function machineKey(node: BuildNode): string {
  if (node.op === null) return `extract:${node.sourcePart}:${node.id}`
  return `${node.op}|${node.color ?? ''}|${node.inputs.map((i) => i.id).join(',')}`
}

interface MachineRates {
  steps: BuildNode[]
  /** shapes per minute each node must deliver */
  demand: Map<string, number>
  /** operations per minute each physical machine runs at */
  machineRate: Map<string, number>
  machineMembers: Map<string, BuildNode[]>
}

/** Propagates the target rate back through the plan, machine by machine. */
function computeMachineRates(root: BuildNode, target: number): MachineRates {
  const steps = orderedSteps(root)

  const demand = new Map<string, number>()
  demand.set(root.id, target)

  const machineMembers = new Map<string, BuildNode[]>()
  const machineFirstStep = new Map<string, number>()
  for (const [index, node] of steps.entries()) {
    const key = machineKey(node)
    const list = machineMembers.get(key) ?? []
    list.push(node)
    machineMembers.set(key, list)
    if (!machineFirstStep.has(key)) machineFirstStep.set(key, index)
  }

  // A machine's earliest member always precedes the earliest member of anything
  // it feeds, so descending "first step" visits consumers before producers.
  const machineOrder = [...machineMembers.keys()].sort(
    (a, b) => machineFirstStep.get(b)! - machineFirstStep.get(a)!,
  )

  const machineRate = new Map<string, number>()

  for (const key of machineOrder) {
    const members = machineMembers.get(key)!
    // one machine feeds all of its outputs, so it runs at the busiest of them
    const rate = Math.max(...members.map((member) => demand.get(member.id) ?? 0))
    machineRate.set(key, rate)

    for (const input of members[0].inputs) {
      demand.set(input.id, (demand.get(input.id) ?? 0) + rate)
    }
  }

  return { steps, demand, machineRate, machineMembers }
}

/**
 * Building-equivalents needed per shape/minute of output — a scale-independent
 * measure of how expensive a plan is to actually run. Used by the solver to
 * pick between plans that all produce the right shape.
 */
export function planCost(root: BuildNode, stackerVariant: StackerVariant = 'straight'): number {
  const { steps, machineRate } = computeMachineRates(root, 1)
  const counted = new Set<string>()
  let cost = 0

  for (const node of steps) {
    const key = machineKey(node)
    if (counted.has(key)) continue
    counted.add(key)
    const spec = specFor(node, stackerVariant)
    cost += (machineRate.get(key) ?? 0) / spec.baseRate
  }

  return cost
}

export function computeThroughput(root: BuildNode, options: Options): ThroughputPlan {
  const { target, tier, stackerVariant } = options
  const { steps, demand, machineRate } = computeMachineRates(root, target)

  const beltRate = beltThroughput(tier)
  const loads = new Map<string, NodeLoad>()
  const buildingTotals = new Map<string, BuildingTotal>()
  const extractorTotals = new Map<string, { part: string; count: number; rate: number }>()
  const fluidTotals = new Map<ColorCode, number>()
  const countedMachines = new Set<string>()

  for (const node of steps) {
    const key = machineKey(node)
    const spec = specFor(node, stackerVariant)
    const opRate = machineRate.get(key) ?? 0
    const rate = demand.get(node.id) ?? 0
    const capacity = ratedThroughput(spec, tier)
    const buildings = Math.ceil(opRate / capacity)

    loads.set(node.id, {
      rate,
      opRate,
      buildings,
      belts: Math.ceil(rate / beltRate),
      spec,
    })

    if (countedMachines.has(key)) continue
    countedMachines.add(key)

    if (node.op === null) {
      const existing = extractorTotals.get(node.sourcePart!) ?? {
        part: node.sourcePart!,
        count: 0,
        rate: 0,
      }
      existing.count += buildings
      existing.rate += opRate
      extractorTotals.set(node.sourcePart!, existing)
      continue
    }

    const totalKey = spec.building
    const existing = buildingTotals.get(totalKey) ?? { spec, count: 0, opRate: 0 }
    existing.count += buildings
    existing.opRate += opRate
    buildingTotals.set(totalKey, existing)

    if (spec.fluidPerOp && node.color) {
      fluidTotals.set(
        node.color,
        (fluidTotals.get(node.color) ?? 0) + opRate * spec.fluidPerOp,
      )
    }
  }

  const buildings = [...buildingTotals.values()].sort((a, b) => b.count - a.count)

  return {
    target,
    tier,
    loads,
    buildings,
    extractors: [...extractorTotals.values()].sort((a, b) => b.count - a.count),
    fluids: [...fluidTotals.entries()]
      .map(([color, litresPerMinute]) => ({ color, litresPerMinute }))
      .sort((a, b) => b.litresPerMinute - a.litresPerMinute),
    totalBuildings: buildings.reduce((sum, entry) => sum + entry.count, 0),
    outputBelts: Math.ceil(target / beltRate),
  }
}
