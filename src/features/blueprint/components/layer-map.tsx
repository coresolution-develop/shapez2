import type { BuildingEntry } from '@/lib/shapez/blueprint'
import {
  CATEGORY_COLORS,
  buildingCategory,
} from '@/features/blueprint/utils/categories'

interface LayerMapProps {
  buildings: BuildingEntry[]
  layer: number
  bounds: { minX: number; minY: number; width: number; height: number }
}

const CELL = 10
const MAX_PIXELS = 520

/** Top-down view of one layer, one square per occupied tile. */
export function LayerMap({ buildings, layer, bounds }: LayerMapProps) {
  const cells: { x: number; y: number; color: string; title: string }[] = []

  for (const building of buildings) {
    const color = CATEGORY_COLORS[buildingCategory(building.variant)]
    for (const tile of building.tiles) {
      if (tile.z !== layer) continue
      cells.push({
        x: (tile.x - bounds.minX) * CELL,
        // screen y grows downward while blueprint y grows upward
        y: (bounds.height - 1 - (tile.y - bounds.minY)) * CELL,
        color,
        title: `${building.title} (${tile.x}, ${tile.y})`,
      })
    }
  }

  const pixelWidth = bounds.width * CELL
  const pixelHeight = bounds.height * CELL
  const scale = Math.min(1, MAX_PIXELS / Math.max(pixelWidth, pixelHeight))

  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${pixelWidth} ${pixelHeight}`}
        width={pixelWidth * scale}
        height={pixelHeight * scale}
        className="h-auto max-w-full rounded-md border bg-muted/30"
        role="img"
        aria-label={`${layer + 1}층 배치도`}
      >
        {cells.map((cell, index) => (
          <rect
            key={index}
            x={cell.x}
            y={cell.y}
            width={CELL}
            height={CELL}
            fill={cell.color}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={0.5}
          >
            <title>{cell.title}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        {layer + 1}층 · {cells.length}칸
      </figcaption>
    </figure>
  )
}
