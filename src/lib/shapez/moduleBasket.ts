/**
 * The modules put aside to build, and how they survive a page reload.
 *
 * A factory is not one shape. Working out that the whole thing wants two
 * cutters, a painter and four rotators meant holding it across three screens,
 * so it is held here instead — and written into the URL with the rest of the
 * setup, which makes a half-planned factory a link rather than a tab you dare
 * not close.
 */
import { MODULE_LANES } from './module'
import { SEARCHED_MODULES } from './moduleEdges'
import { OPERATION_IDS, type OperationId } from './operations'
import { OPERATION_SPECS, beltThroughput, ratedThroughput, type SpeedTier } from './throughput'

export interface BasketEntry {
  op: OperationId
  count: number
}

/** Nobody is building a hundred of one module, and a URL should not say so. */
export const MOST_OF_ONE = 99

/**
 * `r90cw*2,cut` — the count is left off when it is one, which is most of them.
 *
 * Anything unrecognised is dropped rather than argued with: this arrives from a
 * URL, which is to say from anywhere, and a link with one bad name in it should
 * still open the rest of the basket.
 */
export function parseBasket(raw: string | null | undefined): BasketEntry[] {
  if (!raw) return []
  const seen = new Map<OperationId, number>()
  for (const piece of raw.split(',')) {
    const [name, times] = piece.split('*')
    if (!OPERATION_IDS.includes(name as OperationId)) continue
    const count = times === undefined ? 1 : Number(times)
    if (!Number.isFinite(count) || count < 1) continue
    const op = name as OperationId
    seen.set(op, Math.min(MOST_OF_ONE, (seen.get(op) ?? 0) + Math.floor(count)))
  }
  return [...seen].map(([op, count]) => ({ op, count }))
}

export function formatBasket(basket: BasketEntry[]): string {
  return basket
    .filter((entry) => entry.count > 0)
    .map((entry) => (entry.count === 1 ? entry.op : `${entry.op}*${entry.count}`))
    .join(',')
}

/** Putting one in, or another of one already there. */
export function addToBasket(basket: BasketEntry[], op: OperationId, count = 1): BasketEntry[] {
  const held = basket.find((entry) => entry.op === op)
  if (!held) return [...basket, { op, count: Math.min(MOST_OF_ONE, count) }]
  return basket.map((entry) =>
    entry.op === op ? { ...entry, count: Math.min(MOST_OF_ONE, entry.count + count) } : entry,
  )
}

export function setBasketCount(
  basket: BasketEntry[],
  op: OperationId,
  count: number,
): BasketEntry[] {
  if (count <= 0) return basket.filter((entry) => entry.op !== op)
  return basket.map((entry) =>
    entry.op === op ? { ...entry, count: Math.min(MOST_OF_ONE, count) } : entry,
  )
}

/** How many machines one module of this kind holds. */
export function machinesInModule(op: OperationId, tier: SpeedTier): number {
  const searched = SEARCHED_MODULES.get(op)
  if (searched) return searched.machines
  const perLane = Math.ceil(beltThroughput(tier) / ratedThroughput(OPERATION_SPECS[op], tier))
  return perLane * MODULE_LANES
}

/** What the basket costs to build: platforms to place and machines to fill. */
export function basketCost(basket: BasketEntry[], tier: SpeedTier) {
  return {
    platforms: basket.reduce((sum, entry) => sum + entry.count, 0),
    machines: basket.reduce(
      (sum, entry) => sum + entry.count * machinesInModule(entry.op, tier),
      0,
    ),
  }
}
