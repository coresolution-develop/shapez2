/**
 * A whole plan sized to fill belts, step by step.
 *
 * The shape module puts one machine at each step. That is a factory, but a
 * small one — a median plan built that way sustains twenty shapes a minute,
 * and every module this project makes carries twelve belts. So it does not
 * plug into anything, which is what makes the build order lay out thirteen
 * single-operation platforms instead of one whole-plan module.
 *
 * This is the arithmetic for the version that does fill twelve belts: how many
 * machines each step needs, and how many belts run between one step and the
 * next. It is only the counting — where any of it stands is a separate problem
 * — but it is the counting the layout has to agree with, so it is written down
 * once and checked rather than recomputed in the middle of placing things.
 *
 * The interface between steps is *belts, not machines*. A step takes some
 * number of belts in, splits them across its machines, and merges the results
 * back onto some number of belts out. That is how the single-operation modules
 * already work, and it means two neighbouring steps never have to match machine
 * for machine — a step with four cutters can feed a step with two rotators
 * without anything having to know both numbers at once.
 */
import { orderedSteps, type BuildNode } from './plan'
import { OPERATION_BUILDING } from './module'
import type { OperationId } from './operations'
import {
  beltThroughput,
  computeThroughput,
  type SpeedTier,
  type StackerVariant,
} from './throughput'

/** Four lanes a floor on three floors, as every module in this project has. */
export const FACTORY_LANES = 12

export interface FactoryStep {
  /** Any one of the plan nodes this machine makes, for naming and shapes. */
  node: BuildNode
  /**
   * Every result it makes, keyed by which of its ports carries it.
   *
   * A cutter's two halves are two streams on two sets of belts, not one stream
   * of twice as much — adding their rates together and taking the wider of the
   * two belt counts is how this first came out with half the belts it needed.
   */
  outputs: Map<number, FactoryOutput>
  op: OperationId
  /** The building this step is made of. */
  type: string
  /** How far from an extractor, which is what puts steps in build order. */
  depth: number
  /** Machines this step needs to keep up. */
  machines: number
  /** Times a minute the machines run between them, which is what sizes them. */
  opRate: number
  /** Shapes a minute the whole step must deliver, across all its outputs. */
  rate: number
  /** Belts leaving the step, across all its outputs. */
  beltsOut: number
  /** Where each of this step's inputs comes from, and on how many belts. */
  inputs: FactoryFeed[]
}

export interface FactoryOutput {
  node: BuildNode
  rate: number
  belts: number
}

export interface FactoryFeed {
  /** The step that makes it, or null when the player feeds it in. */
  from: FactoryStep | null
  /** The plan node itself — which of a two-output machine's results this is. */
  node: BuildNode
  /** Named when the player feeds it: the raw part to put on the belt. */
  part: string | null
  /** Shapes a minute this input must arrive at. */
  rate: number
  belts: number
}

export interface FactoryPlan {
  steps: FactoryStep[]
  /** The finished shape, on this many belts. */
  lanes: number
  /** Every raw material the player has to bring, and on how many belts. */
  raw: { part: string; rate: number; belts: number }[]
  machines: number
  /** Tiles the machines alone take up, before a single belt is placed. */
  machineTiles: number
}

/**
 * What a factory has to hold to keep `lanes` belts of the finished shape full.
 *
 * The rates come from the same throughput model the rest of the app uses, run
 * at a target of exactly as many shapes a minute as `lanes` belts carry. That
 * is the only reason this can be short: the hard part — how demand multiplies
 * back up a plan when a cutter throws half away and a stacker eats two — is
 * already solved and tested elsewhere, and getting it wrong a second time here
 * is how the two would drift apart.
 */
export function factoryPlan(
  root: BuildNode,
  options: {
    lanes?: number
    tier: SpeedTier
    stackerVariant: StackerVariant
    /** Tiles a building of this type covers, for the size estimate. */
    tilesOf: (type: string) => number
  },
): FactoryPlan {
  const lanes = options.lanes ?? FACTORY_LANES
  const beltRate = beltThroughput(options.tier)
  const target = lanes * beltRate

  const throughput = computeThroughput(root, {
    target,
    tier: options.tier,
    stackerVariant: options.stackerVariant,
  })

  // A cutter feeding two different steps is one machine, not two. The plan says
  // so by giving both steps the same inputs and a different output index, and
  // counting them separately is how the demand on whatever feeds that cutter
  // came out at exactly twice what the cutter actually eats.
  const ordered = orderedSteps(root).filter((node) => node.op !== null)
  const byNode = new Map<string, FactoryStep>()
  const byMachine = new Map<string, FactoryStep>()
  const steps: FactoryStep[] = []

  for (const node of ordered) {
    const load = throughput.loads.get(node.id)
    if (!load) continue
    const key = `${node.op}|${node.color ?? ''}|${node.inputs.map((one) => one.id).join(',')}`
    const held = byMachine.get(key)
    if (held) {
      held.outputs.set(node.outputIndex, { node, rate: load.rate, belts: load.belts })
      held.rate += load.rate
      held.beltsOut += load.belts
      byNode.set(node.id, held)
      continue
    }
    const step: FactoryStep = {
      node,
      outputs: new Map([[node.outputIndex, { node, rate: load.rate, belts: load.belts }]]),
      op: node.op as OperationId,
      type: OPERATION_BUILDING[node.op as OperationId],
      depth: 0,
      machines: load.buildings,
      opRate: load.opRate,
      rate: load.rate,
      beltsOut: load.belts,
      inputs: [],
    }
    byMachine.set(key, step)
    byNode.set(node.id, step)
    steps.push(step)
  }

  // depth is the longest way back to an extractor: a step stands to the right
  // of everything it draws from, however many other steps also draw from those
  const depthOf = (step: FactoryStep, seen = new Set<string>()): number => {
    if (seen.has(step.node.id)) return 0
    seen.add(step.node.id)
    return (
      1 +
      Math.max(
        0,
        ...step.node.inputs.map((input) => {
          const from = byNode.get(input.id)
          return from ? depthOf(from, seen) : 0
        }),
      )
    )
  }
  for (const step of steps) step.depth = depthOf(step)
  steps.sort((a, b) => a.depth - b.depth)

  const raw = new Map<string, { part: string; rate: number; belts: number }>()

  for (const step of steps) {
    // one entry per distinct input, so a machine fed the same shape twice gets
    // one feed carrying twice as much rather than two feeds to the same port
    for (const input of dedupe(step.node.inputs)) {
      const from = byNode.get(input.id) ?? null
      // what this step alone draws, which is not the whole of what its source
      // makes when two steps draw from the same one
      const rate = shareOf(step, input.id, step.opRate)
      const belts = Math.max(1, Math.ceil(rate / beltRate))
      step.inputs.push({
        from,
        node: input,
        part: from ? null : (input.sourcePart ?? null),
        rate,
        belts,
      })
      if (!from && input.sourcePart) {
        const held = raw.get(input.sourcePart) ?? { part: input.sourcePart, rate: 0, belts: 0 }
        held.rate += rate
        raw.set(input.sourcePart, held)
      }
    }
  }
  for (const held of raw.values()) held.belts = Math.max(1, Math.ceil(held.rate / beltRate))

  return {
    steps,
    lanes,
    raw: [...raw.values()],
    machines: steps.reduce((sum, step) => sum + step.machines, 0),
    machineTiles: steps.reduce(
      (sum, step) => sum + step.machines * options.tilesOf(step.type),
      0,
    ),
  }
}

/**
 * How much of a source's output this one consumer takes.
 *
 * A shape wanted in two places is made once and split, so a consumer's share is
 * its own demand and not everything its source produces. Each run of a machine
 * eats one of each thing on its input list, so the share is simply how often
 * this machine runs times how many times the shape appears on that list — a
 * stacker laying a shape on itself wants two of it per run.
 *
 * `factoryPlan.test.ts` adds the shares back up and checks they come to what
 * the source was told to make, which is the property that would break first if
 * this and the throughput model ever drifted apart.
 */
function shareOf(step: FactoryStep, inputId: string, opRate: number): number {
  const times = step.node.inputs.filter((input) => input.id === inputId).length
  return opRate * times
}

/** The distinct things a step is fed, keeping the order they are listed in. */
function dedupe(inputs: BuildNode[]): BuildNode[] {
  const seen = new Set<string>()
  return inputs.filter((input) => !seen.has(input.id) && seen.add(input.id))
}
