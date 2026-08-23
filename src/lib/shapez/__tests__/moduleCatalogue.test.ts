import { describe, expect, it } from 'vitest'

import { MODULE_CATALOGUE, catalogueDemo } from '../moduleCatalogue'
import { OPERATIONS, OPERATION_IDS } from '../operations'
import { toShapeCode } from '../shapeCode'

/**
 * The catalogue is the page that explains what a module is for, so its examples
 * have to keep meaning what they say. They are run through the simulator rather
 * than written down, which stops them drifting from the game — but an example
 * can still go quietly useless: an input the operation leaves untouched shows
 * the reader nothing, and a shape code that stops parsing shows them no picture
 * at all.
 */
describe('the module catalogue', () => {
  it('covers every operation exactly once', () => {
    const listed = MODULE_CATALOGUE.map((entry) => entry.op)
    expect([...listed].sort()).toEqual([...OPERATION_IDS].sort())
  })

  it('feeds each operation the number of shapes it takes', () => {
    for (const entry of MODULE_CATALOGUE) {
      expect(entry.inputs, entry.op).toHaveLength(OPERATIONS[entry.op].inputs)
    }
  })

  it('works every example out with the simulator', () => {
    for (const entry of MODULE_CATALOGUE) {
      const demo = catalogueDemo(entry)
      expect(demo, `${entry.op}: example did not run`).not.toBeNull()
      expect(demo!.after, entry.op).toHaveLength(OPERATIONS[entry.op].outputs)
    }
  })

  it('picks examples where something visibly happens', () => {
    // an example whose result equals its input teaches the reader nothing —
    // rotating a symmetrical shape is the easy way to get this wrong
    for (const entry of MODULE_CATALOGUE) {
      const demo = catalogueDemo(entry)!
      const before = demo.before.map(toShapeCode)
      const after = demo.after.map(toShapeCode)
      expect(after, `${entry.op}: the example comes out exactly as it went in`).not.toEqual(before)
    }
  })

  it('names what the module does, not what the building is called', () => {
    // "회전기" is the building; "90° 돌리기" is what the player wants done
    for (const entry of MODULE_CATALOGUE) {
      expect(entry.title, entry.op).not.toContain(OPERATIONS[entry.op].labelKo)
      expect(entry.title.length, entry.op).toBeGreaterThan(3)
      expect(entry.does.length, entry.op).toBeGreaterThan(10)
    }
  })
})
