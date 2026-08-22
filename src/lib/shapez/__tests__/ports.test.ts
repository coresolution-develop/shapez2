import { describe, expect, it } from 'vitest'

import { decodeBlueprint } from '../blueprint'
import { derivePorts, forwardDirection, mediumOf, shapePorts, toLocal, toWorld } from '../ports'
import type { Offset, PortModel } from '../ports'

import vectors from './blueprintVectors.json'

const PLATFORM = (vectors as { name: string; code: string }[]).find((vector) =>
  vector.name.startsWith('player platform'),
)!

const offsets = (ports: { offset: Offset }[]) =>
  ports.map((port) => `${port.offset[0]},${port.offset[1]}`).sort()

describe('port geometry', () => {
  it('agrees on which way a building faces', () => {
    expect(forwardDirection(0)).toEqual([1, 0])
    expect(forwardDirection(1)).toEqual([0, 1])
    expect(forwardDirection(2)).toEqual([-1, 0])
    expect(forwardDirection(3)).toEqual([0, -1])

    for (const rotation of [0, 1, 2, 3]) {
      const [dx, dy] = forwardDirection(rotation)
      expect(toLocal(dx, dy, rotation)).toEqual([1, 0])
      expect(toWorld([1, 0], rotation)).toEqual([dx, dy])
    }
  })

  it('separates belt ports from pipe ports', () => {
    expect(mediumOf('BeltDefaultForwardInternalVariant')).toBe('shape')
    expect(mediumOf('Lift1UpForwardInternalVariant')).toBe('shape')
    expect(mediumOf('Merger2To1LInternalVariant')).toBe('shape')
    expect(mediumOf('PipeForwardInternalVariant')).toBe('fluid')
    expect(mediumOf('FluidPortSenderInternalVariant')).toBe('fluid')
    // machines carry both, so they are only classified via their neighbours
    expect(mediumOf('PainterDefaultInternalVariant')).toBeNull()
  })

  describe('derived from a real 1,017-building factory', () => {
    let ports: Map<string, PortModel>

    it('derives ports', async () => {
      const blueprint = await decodeBlueprint(PLATFORM.code)
      expect(blueprint.buildings.length).toBeGreaterThan(1000)
      ports = derivePorts(blueprint.buildings)
      expect(ports.size).toBeGreaterThan(5)
    })

    it('finds the cutter has one input and two outputs', () => {
      const cutter = ports.get('CutterDefaultInternalVariant')!
      expect(cutter.instances).toBe(40)
      expect(offsets(cutter.inputs)).toEqual(['-1,0'])
      expect(offsets(cutter.outputs)).toEqual(['1,-1', '1,0'])
      // the mirrored variant flips the second half to the other side
      const mirrored = ports.get('CutterDefaultInternalVariantMirrored')!
      expect(offsets(mirrored.inputs)).toEqual(['-1,0'])
      expect(offsets(mirrored.outputs)).toEqual(['1,0', '1,1'])
    })

    it('finds flow-control buildings', () => {
      const merger = ports.get('Merger2To1LInternalVariant')!
      expect(offsets(merger.inputs)).toEqual(['-1,0', '0,-1'])
      expect(offsets(merger.outputs)).toEqual(['1,0'])

      const splitter = ports.get('Splitter1To2LInternalVariant')!
      expect(offsets(splitter.inputs)).toEqual(['-1,0'])
      expect(offsets(splitter.outputs)).toEqual(['0,-1', '1,0'])
    })

    it('treats belt ports as a pure sink and a pure source', () => {
      const sender = ports.get('BeltPortSenderInternalVariant')!
      expect(offsets(sender.inputs)).toEqual(['-1,0'])
      expect(sender.outputs).toHaveLength(0)

      const receiver = ports.get('BeltPortReceiverInternalVariant')!
      expect(receiver.inputs).toHaveLength(0)
      expect(offsets(receiver.outputs)).toEqual(['1,0'])
    })

    it('reads turn belts as one in, one out at a right angle', () => {
      const left = ports.get('BeltDefaultLeftInternalVariant')!
      expect(offsets(left.inputs)).toEqual(['-1,0'])
      expect(offsets(left.outputs)).toEqual(['0,-1'])

      const right = ports.get('BeltDefaultLeftInternalVariantMirrored')!
      expect(offsets(right.inputs)).toEqual(['-1,0'])
      expect(offsets(right.outputs)).toEqual(['0,1'])
    })

    it('keeps inputs upstream and outputs downstream', () => {
      for (const [type, model] of ports) {
        // lifts change layer, and the "Backward" ones deliberately deliver
        // behind themselves, so the -X/+X rule doesn't apply to them
        if (type.startsWith('Lift')) continue
        for (const port of model.inputs) {
          expect(port.offset[0], `${type} input on +X`).toBeLessThanOrEqual(0)
        }
        for (const port of model.outputs) {
          expect(port.offset[0], `${type} output on -X`).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('reports how confident each port is', () => {
      const cutter = ports.get('CutterDefaultInternalVariant')!
      // the straight-through output is backed by every single instance
      const straight = cutter.outputs.find((port) => port.offset[1] === 0)!
      expect(straight.count).toBe(cutter.instances)
    })

    it('labels every port on this factory as shape-carrying', () => {
      // no pipes in this blueprint, so nothing should come back as fluid
      for (const [type, model] of ports) {
        const shape = shapePorts(model)
        expect(shape.inputs.length + shape.outputs.length, type).toBe(
          model.inputs.length + model.outputs.length,
        )
      }
    })
  })
})
