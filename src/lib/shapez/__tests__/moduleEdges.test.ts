import { describe, expect, it } from 'vitest'

import { layoutCrystalModule } from '../crystalModule'
import { layoutCutterModule } from '../cutterModule'
import {
  MODULE_INTAKE_ROW,
  MODULE_LANES,
  layoutLaneModule,
  platformFor,
} from '../module'
import { MODULE_WIRING, moduleCapacity, modulesNeeded, type ModuleEdge } from '../moduleEdges'
import { OPERATION_IDS, type OperationId } from '../operations'
import { layoutStackerModule } from '../stackerModule'
import { layoutSwapperModule } from '../swapperModule'
import { BELT_BASE_RATE, OPERATION_SPECS, ratedThroughput } from '../throughput'

interface Built {
  placements: { type: string; x?: number; y?: number; layer?: number }[]
  platform: string
}

/** Every module, and the platform each is laid on, so the edges can be found. */
function build(op: OperationId): { built: Built; area: ReturnType<typeof platformFor> } | null {
  const perLane = (id: OperationId) =>
    Math.ceil(BELT_BASE_RATE / ratedThroughput(OPERATION_SPECS[id], 100))

  if (op === 'stack') {
    const r = layoutStackerModule()
    return r.ok ? { built: r, area: platformFor(1, 4) } : null
  }
  if (op === 'cut') {
    const r = layoutCutterModule()
    return r.ok ? { built: r, area: platformFor(2, 3) } : null
  }
  if (op === 'swap') {
    const r = layoutSwapperModule()
    return r.ok ? { built: r, area: platformFor(2, 3) } : null
  }
  if (op === 'crystal') {
    const r = layoutCrystalModule()
    return r.ok ? { built: r, area: platformFor(2, 4) } : null
  }
  const r = layoutLaneModule(op, perLane(op))
  return r.ok ? { built: r, area: platformFor(1, 1) } : null
}

/**
 * The table that tells a player which side of one module meets which side of
 * the next, checked against where the generators actually put the ports.
 *
 * Written down and then verified, rather than trusted: a wrong edge here sends
 * someone to lay belt across a factory to a side that has nothing on it.
 */
describe('what each module edge carries', () => {
  it('describes every operation', () => {
    expect(Object.keys(MODULE_WIRING).sort()).toEqual([...OPERATION_IDS].sort())
  })

  it('puts the ports where the generated modules put them', () => {
    for (const op of OPERATION_IDS) {
      const made = build(op)
      expect(made, `${op}: 모듈이 안 나옵니다`).not.toBeNull()
      if (!made || !made.area) continue

      const { built, area } = made
      const edgeOf = (p: { x?: number; y?: number }): ModuleEdge | null =>
        p.y === MODULE_INTAKE_ROW ? 'intake'
        : p.y === area.area.minY ? 'outlet'
        : p.x === area.area.minX ? 'left'
        : p.x === area.area.maxX ? 'right'
        : null

      const seen = (prefix: string) => {
        const edges = new Map<ModuleEdge, number>()
        for (const placement of built.placements.filter((p) => p.type.startsWith(prefix))) {
          const edge = edgeOf(placement)
          if (edge) edges.set(edge, (edges.get(edge) ?? 0) + 1)
        }
        return edges
      }

      const catchers = seen('BeltPortReceiver')
      const launchers = seen('BeltPortSender')

      expect([...catchers.keys()].sort(), `${op} 입구 가장자리`).toEqual(
        MODULE_WIRING[op].inputs.map((port) => port.edge).sort(),
      )
      expect([...launchers.keys()].sort(), `${op} 출구 가장자리`).toEqual(
        MODULE_WIRING[op].outputs.map((port) => port.edge).sort(),
      )
      // and a dozen lanes on each of them, which is what makes modules chain
      for (const count of [...catchers.values(), ...launchers.values()]) {
        expect(count, `${op}`).toBe(MODULE_LANES)
      }
    }
  })

  it('says a module gets through twelve belts and no more', () => {
    expect(moduleCapacity(100)).toBe(MODULE_LANES * BELT_BASE_RATE)
    // most plans need a fraction of one, which is worth saying before someone
    // builds four of something they needed one of
    expect(modulesNeeded(60, 100)).toBe(1)
    expect(modulesNeeded(1440, 100)).toBe(1)
    expect(modulesNeeded(1441, 100)).toBe(2)
  })
})
