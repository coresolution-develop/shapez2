import { describe, expect, it } from 'vitest'

import { applyOperation, OPERATION_IDS } from '../operations'
import { fullShape, parseShapeCode, toShapeCode } from '../shapeCode'
import { planStats } from '../plan'
import { isStable, solveShape } from '../solver'
import { PAINTABLE_COLORS, QUAD_CONFIG, operationConfig, type Shape } from '../types'

const config = operationConfig(QUAD_CONFIG, 'normal')

function parse(code: string): Shape {
  const result = parseShapeCode(code, QUAD_CONFIG)
  if (!result.ok) throw new Error(`${code}: ${result.error}`)
  return result.shape
}

describe('solver', () => {
  const solvable = [
    'CuCuCuCu',
    'RuRuRuRu',
    'CrCrCrCr',
    'CuRuCuRu',
    'CrSgWbRy',
    'Cu------',
    '--Ru----',
    'RbRbRbRb:CrCrCrCr',
    'CwCwCwCw:RwRwRwRw:SwSwSwSw',
    'CrCrCrCr:CgCgCgCg:CbCbCbCb:CyCyCyCy',
    'CuCu----:CuCu----',
    'P-P-P-P-:CuCuCuCu',
    'P-P-----:CrCr----',
    'RrRr--Rr',
  ]

  for (const code of solvable) {
    it(`solves ${code}`, () => {
      const result = solveShape(parse(code), config)
      if (!result.ok) throw new Error(`${code}: ${result.error}`)
      expect(result.root.code).toBe(code)
      expect(planStats(result.root).totalBuildings).toBeGreaterThanOrEqual(0)
    })
  }

  it('rejects shapes gravity would collapse', () => {
    const result = solveShape(parse('--------:CuCuCuCu'), config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('중력')
  })

  it('rejects shapes with too many layers', () => {
    const result = solveShape(parse('Cu:Cu:Cu:Cu:Cu'.split(':').map(() => 'CuCuCuCu').join(':')), config)
    expect(result.ok).toBe(false)
  })

  it('never returns a plan that does not build the target', () => {
    // Random reachable shapes: whatever the solver returns must be verified.
    let solved = 0
    let total = 0
    let seed = 42
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const pool: Shape[] = QUAD_CONFIG.mineableParts.map((part) => fullShape(part, QUAD_CONFIG))

    for (let i = 0; i < 400; i++) {
      const op = OPERATION_IDS[Math.floor(random() * OPERATION_IDS.length)]
      const meta = { inputs: op === 'swap' || op === 'stack' ? 2 : 1 }
      const inputs = Array.from(
        { length: meta.inputs },
        () => pool[Math.floor(random() * pool.length)],
      )
      const color = PAINTABLE_COLORS[Math.floor(random() * PAINTABLE_COLORS.length)]
      const outputs = applyOperation(op, inputs, config, color)
      const produced = outputs[Math.floor(random() * outputs.length)]
      if (produced.layers.every((l) => l.every((p) => p.type === null))) continue
      pool.push(produced)
      if (pool.length > 60) pool.shift()

      if (!isStable(produced)) continue
      total++
      const result = solveShape(produced, config)
      if (result.ok) {
        solved++
        expect(result.root.code, `plan for ${toShapeCode(produced)}`).toBe(toShapeCode(produced))
      }
    }

    expect(total).toBeGreaterThan(50)
    // coverage guard — drops here mean the solver regressed
    expect(solved / total).toBeGreaterThan(0.7)
  })
})
