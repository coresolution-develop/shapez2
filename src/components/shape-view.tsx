/**
 * Renders a shape as SVG using the same geometry as the in-game shape viewer
 * (ported from `shapez2.shapeViewer`).
 */
import { COLOR_SKINS } from '@/lib/shapez/types'
import type { ColorSkinId, Part, Shape } from '@/lib/shapez/types'

const BORDER_COLOR = '#231923'
const PIN_COLOR = '#47454b'
const BG_CIRCLE = 'rgba(31, 41, 61, 0.1)'

// pixel sizes taken from the in-game shape viewer, normalised to a 100×100 box
const SHAPE_SIZE = (407 / 602) * 100
const BG_DIAMETER = (520 / 602) * 100
const BORDER_WIDTH = (15 / 602) * 100
const LAYER_SIZE_REDUCTION = 0.75

const SQRT_3 = Math.sqrt(3)
const SQRT_2 = Math.sqrt(2)
const SQRT_6 = Math.sqrt(6)

function darken(hex: string): string {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => Math.round(parseInt(value.slice(i, i + 2), 16) / 2))
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Outline of a part, in local coordinates where (0, size) is the shape centre. */
function partPath(typeCode: string, size: number): string | null {
  switch (typeCode) {
    case 'C':
      return `M 0 ${size} L 0 0 A ${size} ${size} 0 0 1 ${size} ${size} Z`
    case 'R':
      return `M 0 0 L ${size} 0 L ${size} ${size} L 0 ${size} Z`
    case 'S':
      return `M ${size} 0 L ${size / 2} ${size} L 0 ${size} L 0 ${size / 2} Z`
    case 'W': {
      // square with a circular bite taken out of the top-right
      const cx = 1.4 * size
      const cy = -0.4 * size
      const r = 1.18 * size
      const topX = cx - Math.sqrt(r * r - cy * cy)
      const rightY = cy + Math.sqrt(r * r - (size - cx) * (size - cx))
      return `M 0 0 L ${topX} 0 A ${r} ${r} 0 0 0 ${size} ${rightY} L ${size} ${size} L 0 ${size} Z`
    }
    case 'H':
      return `M 0 0 L ${(SQRT_3 / 2) * size} ${size / 2} L 0 ${size} Z`
    case 'G':
      return `M 0 0 L ${(SQRT_3 / 6) * size} ${size / 2} L ${(SQRT_3 / 2) * size} ${size / 2} L 0 ${size} Z`
    case 'F': {
      const r = ((3 - SQRT_3) / 4) * size
      const side = 2 * r
      const cx = (side * (SQRT_3 / 2)) / 2
      const cy = size - side + Math.sqrt(r * r - cx * cx)
      const start = ((360 - 30) * Math.PI) / 180
      const stop = ((360 - 30 - 180) * Math.PI) / 180
      const point = (angle: number) => `${cx + r * Math.cos(angle)} ${cy - r * Math.sin(angle)}`
      return [
        `M 0 ${size - side}`,
        `A ${r} ${r} 0 0 0 ${point(stop)}`,
        `L ${point(start)}`,
        `L ${(SQRT_3 / 2) * side} ${size - r}`,
        `L 0 ${size}`,
        'Z',
      ].join(' ')
    }
    default:
      return null
  }
}

/** The two darker facets drawn on a quad crystal. */
function crystalFacets(size: number, layerIndex: number): string[] {
  const offset = layerIndex % 2 === 0 ? 0 : 22.5
  const wedge = (from: number, to: number) => {
    const point = (deg: number) => {
      const angle = (deg * Math.PI) / 180
      return `${size * Math.cos(angle)} ${size - size * Math.sin(angle)}`
    }
    return `M 0 ${size} L ${point(from)} A ${size} ${size} 0 0 0 ${point(to)} Z`
  }
  return [wedge(67.5 - offset, 90 - offset), wedge(22.5 - offset, 45 - offset)]
}

interface PartVisual {
  key: string
  transform: string
  fill: string | null
  path: string | null
  facets: string[]
  pin: { cx: number; cy: number; r: number } | null
  crystalOutline: string | null
}

function buildVisuals(shape: Shape, skin: ColorSkinId): PartVisual[][] {
  const colors = COLOR_SKINS[skin]
  const partCount = shape.layers[0].length

  return shape.layers.map((layer, layerIndex) => {
    const shapeSize = SHAPE_SIZE * LAYER_SIZE_REDUCTION ** layerIndex
    const size = shapeSize / 2

    return layer.flatMap((part: Part, partIndex): PartVisual[] => {
      if (part.type === null) return []

      const transform = `rotate(${(360 / partCount) * partIndex} 50 50) translate(50 ${50 - size})`
      const key = `${layerIndex}-${partIndex}`
      const code = part.type.code

      if (code === 'P') {
        const pin =
          partCount === 4
            ? { cx: size / 3, cy: (2 * size) / 3, r: size / 6 }
            : { cx: (SQRT_2 / 6) * size, cy: (1 - SQRT_6 / 6) * size, r: size / 6 }
        return [{ key, transform, fill: PIN_COLOR, path: null, facets: [], pin, crystalOutline: null }]
      }

      const fill = part.color ? colors[part.color] : colors.u

      if (code === 'c') {
        const outline =
          partCount === 4
            ? `M 0 ${size} L 0 0 A ${size} ${size} 0 0 1 ${size} ${size} Z`
            : `M 0 0 L ${(SQRT_3 / 2) * size} ${size / 2} L 0 ${size} Z`
        return [
          {
            key,
            transform,
            fill,
            path: null,
            facets: partCount === 4 ? crystalFacets(size, layerIndex) : [],
            pin: null,
            crystalOutline: outline,
          },
        ]
      }

      return [
        { key, transform, fill, path: partPath(code, size), facets: [], pin: null, crystalOutline: null },
      ]
    })
  })
}

export interface ShapeViewProps {
  shape: Shape
  size?: number
  skin?: ColorSkinId
  className?: string
  title?: string
}

export function ShapeView({ shape, size = 96, skin = 'RGB', className, title }: ShapeViewProps) {
  const layers = buildVisuals(shape, skin)

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title ?? 'shape'}
    >
      {title ? <title>{title}</title> : null}
      <circle cx={50} cy={50} r={BG_DIAMETER / 2} fill={BG_CIRCLE} />

      {layers.map((visuals, layerIndex) => (
        <g key={layerIndex}>
          {visuals.map((visual) => (
            <g key={`fill-${visual.key}`} transform={visual.transform}>
              {visual.path ? <path d={visual.path} fill={visual.fill ?? 'none'} /> : null}
              {visual.crystalOutline ? (
                <>
                  <path d={visual.crystalOutline} fill={visual.fill ?? 'none'} />
                  {visual.facets.map((facet, index) => (
                    <path key={index} d={facet} fill={darken(visual.fill ?? '#000000')} />
                  ))}
                </>
              ) : null}
              {visual.pin ? (
                <circle cx={visual.pin.cx} cy={visual.pin.cy} r={visual.pin.r} fill={PIN_COLOR} />
              ) : null}
            </g>
          ))}

          {visuals.map((visual) =>
            visual.path ? (
              <g key={`line-${visual.key}`} transform={visual.transform}>
                <path
                  d={visual.path}
                  fill="none"
                  stroke={BORDER_COLOR}
                  strokeWidth={BORDER_WIDTH}
                  strokeLinejoin="round"
                />
              </g>
            ) : null,
          )}
        </g>
      ))}
    </svg>
  )
}
