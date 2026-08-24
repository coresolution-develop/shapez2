import { describe, expect, it } from 'vitest'

import {
  MOST_OF_ONE,
  addToBasket,
  basketCost,
  formatBasket,
  machinesInModule,
  parseBasket,
  setBasketCount,
} from '../moduleBasket'
import { SEARCHED_MODULES } from '../moduleEdges'
import { OPERATION_IDS } from '../operations'

describe('the module basket', () => {
  it('survives the round trip through a URL', () => {
    const basket = [
      { op: 'r90cw' as const, count: 4 },
      { op: 'cut' as const, count: 1 },
      { op: 'paint' as const, count: 2 },
    ]
    expect(parseBasket(formatBasket(basket))).toEqual(basket)
  })

  it('leaves the count off when there is one of something', () => {
    // the common case by far, and a URL is read by people
    expect(formatBasket([{ op: 'cut', count: 1 }])).toBe('cut')
    expect(formatBasket([{ op: 'cut', count: 3 }])).toBe('cut*3')
  })

  it('opens the rest of a link when part of it is nonsense', () => {
    // this arrives from a URL, which is to say from anywhere. A basket with one
    // bad name in it should still open rather than come back empty
    expect(parseBasket('cut,notathing,paint*2,r90cw*0,pin*abc')).toEqual([
      { op: 'cut', count: 1 },
      { op: 'paint', count: 2 },
    ])
    expect(parseBasket(null)).toEqual([])
    expect(parseBasket('')).toEqual([])
  })

  it('adds up rather than repeating an entry', () => {
    expect(parseBasket('cut,cut*2')).toEqual([{ op: 'cut', count: 3 }])
    expect(addToBasket(addToBasket([], 'cut'), 'cut', 2)).toEqual([{ op: 'cut', count: 3 }])
  })

  it('will not hold a hundred of anything', () => {
    expect(addToBasket([{ op: 'cut', count: 98 }], 'cut', 50)).toEqual([
      { op: 'cut', count: MOST_OF_ONE },
    ])
    expect(parseBasket('cut*500')).toEqual([{ op: 'cut', count: MOST_OF_ONE }])
    expect(setBasketCount([{ op: 'cut', count: 1 }], 'cut', 400)).toEqual([
      { op: 'cut', count: MOST_OF_ONE },
    ])
  })

  it('takes an entry out when its count reaches nothing', () => {
    expect(setBasketCount([{ op: 'cut', count: 1 }], 'cut', 0)).toEqual([])
  })

  it('counts the machines the same way the module generators do', () => {
    // the basket prints this total before anything is built, so it is a promise
    for (const [op, promised] of SEARCHED_MODULES) {
      expect(machinesInModule(op, 100), op).toBe(promised.machines)
    }
    for (const op of OPERATION_IDS) {
      expect(machinesInModule(op, 100), op).toBeGreaterThan(0)
    }
  })

  it('adds up what a basket costs to build', () => {
    const cost = basketCost([{ op: 'cut', count: 2 }, { op: 'r90cw', count: 1 }], 100)
    expect(cost.platforms).toBe(3)
    expect(cost.machines).toBe(2 * machinesInModule('cut', 100) + machinesInModule('r90cw', 100))
  })
})
