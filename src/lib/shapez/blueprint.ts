/**
 * Decodes shapez 2 blueprint strings.
 *
 * Format: `SHAPEZ2-<majorVersion>-<base64(gzip(json))>$`
 * Ported from the official `shapez2` python package's `blueprints.py`.
 */
import buildingData from './buildings.json'
import { parseShapeCode } from './shapeCode'
import type { Shape } from './types'

const PREFIX = 'SHAPEZ2'
const SEPARATOR = '-'
const SUFFIX = '$'

export class BlueprintError extends Error {}

interface VariantMeta {
  variant: string
  title: string
  tiles: [number, number, number][]
}

const BUILDING_VARIANTS = buildingData.buildingVariants as unknown as Record<string, VariantMeta>
const ISLANDS = buildingData.islands as unknown as Record<
  string,
  { title: string; tiles: [number, number, number][] }
>

export interface Tile {
  x: number
  y: number
  z: number
}

export interface BuildingEntry {
  /** Internal variant id, e.g. `PainterDefaultInternalVariant`. */
  type: string
  variant: string
  title: string
  pos: Tile
  rotation: number
  tiles: Tile[]
}

export interface IslandEntry {
  type: string
  title: string
  pos: Tile
  rotation: number
  buildings: BuildingEntry[]
}

export type BlueprintKind = 'building' | 'island'

export interface BlueprintIcon {
  kind: 'icon' | 'shape'
  /** Set when `kind === 'icon'`. */
  icon?: string
  /** Set when `kind === 'shape'`. */
  shape?: Shape
  shapeCode?: string
}

export interface Blueprint {
  kind: BlueprintKind
  majorVersion: number
  version: number
  icons: BlueprintIcon[]
  /** Flat list of every building, including those nested inside platforms. */
  buildings: BuildingEntry[]
  islands: IslandEntry[]
}

/** Rotates a tile offset clockwise around the origin, `rotation` quarter turns. */
function rotateCW(tile: [number, number, number], rotation: number): Tile {
  let [x, y] = tile
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++) {
    ;[x, y] = [-y, x]
  }
  return { x, y, z: tile[2] }
}

function decodeIcon(raw: string | null): BlueprintIcon | null {
  if (raw === null || raw === undefined) return null
  if (raw.startsWith('icon:')) return { kind: 'icon', icon: raw.slice('icon:'.length) }
  const code = raw.startsWith('shape:') ? raw.slice('shape:'.length) : raw
  const parsed = parseShapeCode(code)
  if (!parsed.ok) return null
  return { kind: 'shape', shape: parsed.shape, shapeCode: code }
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new BlueprintError('base64 구간에 사용할 수 없는 문자가 있습니다')
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

interface RawBuilding {
  X?: number
  Y?: number
  L?: number
  R?: number
  T?: string
  C?: string
}

interface RawIsland {
  X?: number
  Y?: number
  Z?: number
  R?: number
  T?: string
  B?: { Entries?: MaybeWrapped<RawBuilding>; Icon?: { Data?: MaybeWrapped<string | null> } }
}

/**
 * Positions stay in blueprint-local coordinates, exactly as the game stores
 * them — buildings inside a platform are not rotated by the platform's own
 * rotation.
 */
function decodeBuildings(raw: RawBuilding[]): BuildingEntry[] {
  const entries: BuildingEntry[] = []

  for (const building of raw) {
    const type = building.T
    if (typeof type !== 'string') {
      throw new BlueprintError('건물 항목에 타입(T)이 없습니다')
    }

    const meta = BUILDING_VARIANTS[type]
    const pos: Tile = { x: building.X ?? 0, y: building.Y ?? 0, z: building.L ?? 0 }
    const rotation = (((building.R ?? 0) % 4) + 4) % 4

    const tiles = (meta?.tiles ?? [[0, 0, 0]]).map((tile) => {
      const rotated = rotateCW(tile, rotation)
      return { x: pos.x + rotated.x, y: pos.y + rotated.y, z: pos.z + rotated.z }
    })

    entries.push({
      type,
      variant: meta?.variant ?? type,
      title: meta?.title ?? type,
      pos,
      rotation,
      tiles,
    })
  }

  return entries
}

/**
 * Newer game versions wrap arrays as `{ $type, $values: [...] }` (.NET style
 * serialisation), older ones use a plain array.
 */
type MaybeWrapped<T> = T[] | { $values?: T[] }

function unwrap<T>(value: MaybeWrapped<T> | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.$values)) return value.$values
  return []
}

/**
 * From major version 5 the icons moved out of the compressed payload and into
 * the trailing section, as `[{ Type, Content }]_<n>` where `Content` is itself
 * a JSON string holding `{ "Data": [...] }`.
 */
function iconsFromTrailing(trailing: string): (string | null)[] {
  const array = /^\[.*\]/.exec(trailing)?.[0]
  if (!array) return []
  try {
    const parsed: unknown = JSON.parse(array)
    if (!Array.isArray(parsed)) return []
    for (const item of parsed) {
      const content = (item as { Content?: unknown })?.Content
      if (typeof content !== 'string') continue
      const inner: unknown = JSON.parse(content)
      const data = (inner as { Data?: unknown })?.Data
      if (Array.isArray(data)) {
        return data.map((value) => (typeof value === 'string' ? value : null))
      }
    }
  } catch {
    // an unfamiliar trailing section just means no icons
  }
  return []
}

interface RawBlueprint {
  V?: number
  BP?: {
    $type?: string
    Entries?: MaybeWrapped<RawBuilding | RawIsland>
    Icon?: { Data?: MaybeWrapped<string | null> }
  }
}

/**
 * Splits and validates the wrapper.
 *
 * Blueprint strings look like `SHAPEZ2-<major>-<base64>$`, but from major
 * version 5 the game appends an extra section before the `$` (`...==[]_2$`).
 * We keep the base64 run and ignore whatever follows it.
 */
export async function decodeBlueprint(rawBlueprint: string): Promise<Blueprint> {
  const trimmed = rawBlueprint.trim()
  const parts = trimmed.split(SEPARATOR)

  if (parts.length < 3) {
    throw new BlueprintError(`구분자 '-'가 2개 이상이어야 하는데 ${parts.length - 1}개입니다`)
  }
  const [prefix, majorVersionRaw] = parts
  const codeAndSuffix = parts.slice(2).join(SEPARATOR)

  if (prefix !== PREFIX) throw new BlueprintError(`'${PREFIX}'로 시작해야 합니다`)
  if (!/^\d+$/.test(majorVersionRaw)) throw new BlueprintError('버전이 숫자가 아닙니다')
  if (!codeAndSuffix.endsWith(SUFFIX)) throw new BlueprintError(`'${SUFFIX}'로 끝나야 합니다`)

  const payload = codeAndSuffix.slice(0, -1)
  const encoded = /^[A-Za-z0-9+/]*={0,2}/.exec(payload)?.[0] ?? ''
  const trailing = payload.slice(encoded.length)
  if (encoded === '') {
    throw new BlueprintError(
      payload === '' ? '본문이 비어 있습니다' : 'base64로 읽을 수 있는 구간이 없습니다',
    )
  }

  let json: string
  try {
    json = await gunzip(base64ToBytes(encoded))
  } catch (error) {
    if (error instanceof BlueprintError) throw error
    throw new BlueprintError('본문을 gzip 해제하지 못했습니다')
  }

  let decoded: RawBlueprint
  try {
    decoded = JSON.parse(json)
  } catch {
    throw new BlueprintError('본문이 올바른 JSON이 아닙니다')
  }

  const body = decoded.BP
  if (typeof decoded.V !== 'number' || body === null || typeof body !== 'object') {
    throw new BlueprintError('청사진 JSON 구조가 예상과 다릅니다')
  }

  const kind: BlueprintKind = body.$type === 'Island' ? 'island' : 'building'
  const rawIcons = unwrap(body.Icon?.Data)
  const icons = (rawIcons.length > 0 ? rawIcons : iconsFromTrailing(trailing))
    .map(decodeIcon)
    .filter((icon): icon is BlueprintIcon => icon !== null)
  const rawEntries = unwrap(body.Entries)

  if (kind === 'building') {
    return {
      kind,
      majorVersion: Number(majorVersionRaw),
      version: decoded.V,
      icons,
      buildings: decodeBuildings(rawEntries as RawBuilding[]),
      islands: [],
    }
  }

  const islands: IslandEntry[] = []
  const buildings: BuildingEntry[] = []

  for (const island of rawEntries as RawIsland[]) {
    const type = island.T
    if (typeof type !== 'string') throw new BlueprintError('플랫폼 항목에 타입(T)이 없습니다')

    const pos: Tile = { x: island.X ?? 0, y: island.Y ?? 0, z: island.Z ?? 0 }
    const rotation = (((island.R ?? 0) % 4) + 4) % 4
    const nested = decodeBuildings(unwrap(island.B?.Entries))

    islands.push({
      type,
      title: ISLANDS[type]?.title ?? type,
      pos,
      rotation,
      buildings: nested,
    })
    buildings.push(...nested)
  }

  return {
    kind,
    majorVersion: Number(majorVersionRaw),
    version: decoded.V,
    icons,
    buildings,
    islands,
  }
}

export interface BlueprintSummary {
  kind: BlueprintKind
  version: number
  majorVersion: number
  totalBuildings: number
  totalIslands: number
  /** Building counts keyed by display title, most common first. */
  byTitle: { title: string; variant: string; count: number }[]
  /** Bounding box of every occupied tile. */
  bounds: { min: Tile; max: Tile; width: number; height: number; layers: number } | null
  unknownTypes: string[]
}

export function summarize(blueprint: Blueprint): BlueprintSummary {
  const counts = new Map<string, { title: string; variant: string; count: number }>()
  const unknown = new Set<string>()

  let min: Tile | null = null
  let max: Tile | null = null

  const stretch = (tile: Tile) => {
    if (min === null || max === null) {
      min = { ...tile }
      max = { ...tile }
      return
    }
    min.x = Math.min(min.x, tile.x)
    min.y = Math.min(min.y, tile.y)
    min.z = Math.min(min.z, tile.z)
    max.x = Math.max(max.x, tile.x)
    max.y = Math.max(max.y, tile.y)
    max.z = Math.max(max.z, tile.z)
  }

  for (const building of blueprint.buildings) {
    if (!BUILDING_VARIANTS[building.type]) unknown.add(building.type)
    const entry = counts.get(building.variant) ?? {
      title: building.title,
      variant: building.variant,
      count: 0,
    }
    entry.count++
    counts.set(building.variant, entry)
    for (const tile of building.tiles) stretch(tile)
  }

  for (const island of blueprint.islands) stretch(island.pos)

  // Splitters, mergers and lifts share a display title with the plain belt in
  // the game data, so spell out the variant when a title covers several.
  const titleUsage = new Map<string, number>()
  for (const entry of counts.values()) {
    titleUsage.set(entry.title, (titleUsage.get(entry.title) ?? 0) + 1)
  }
  for (const entry of counts.values()) {
    if ((titleUsage.get(entry.title) ?? 0) > 1) {
      entry.title = `${entry.title} (${entry.variant.replace(/Variant$/, '')})`
    }
  }

  const bounds =
    min === null || max === null
      ? null
      : {
          min,
          max,
          width: (max as Tile).x - (min as Tile).x + 1,
          height: (max as Tile).y - (min as Tile).y + 1,
          layers: (max as Tile).z - (min as Tile).z + 1,
        }

  return {
    kind: blueprint.kind,
    version: blueprint.version,
    majorVersion: blueprint.majorVersion,
    totalBuildings: blueprint.buildings.length,
    totalIslands: blueprint.islands.length,
    byTitle: [...counts.values()].sort((a, b) => b.count - a.count),
    bounds,
    unknownTypes: [...unknown],
  }
}

/**
 * The game version stamped onto blueprints we produce. The game accepts
 * anything at or below its own version; this matches the data we ship.
 */
export const ENCODE_GAME_VERSION = 1122
export const ENCODE_MAJOR_VERSION = 1

export interface BuildingPlacement {
  /** Internal variant id, e.g. `CutterDefaultInternalVariant`. */
  type: string
  x?: number
  y?: number
  /** Building layer (0-2). */
  layer?: number
  /** Quarter turns clockwise. */
  rotation?: number
}

async function gzipCompress(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Current-game format. Version 5 wraps arrays and moves icons to the tail. */
export const V5_GAME_VERSION = 1138
export const V5_MAJOR_VERSION = 5

const NET = 'Game.Core.Blueprint.Serialization'
const ICON_TYPE =
  'BlueprintIcon, SPZGameAssembly, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null'

export interface EncodeOptions {
  icons?: (string | null)[]
  /** Which blueprint format to emit. Defaults to the current game's. */
  format?: 'v1' | 'v5'
}

/**
 * Builds a pasteable building blueprint. Mirrors the official encoder: default
 * values are omitted, and the payload is gzipped then base64'd.
 *
 * The trailing `[...]_<n>` section on version 5 codes carries the icons, and
 * `<n>` is the character length of the JSON in front of it.
 */
export async function encodeBuildingBlueprint(
  buildings: BuildingPlacement[],
  options: EncodeOptions | (string | null)[] = {},
): Promise<string> {
  if (buildings.length === 0) throw new BlueprintError('건물이 하나도 없는 청사진은 만들 수 없습니다')

  const settings: EncodeOptions = Array.isArray(options) ? { icons: options } : options
  const icons = settings.icons ?? [null, null, null, null]
  const format = settings.format ?? 'v5'

  if (format === 'v1') {
    const payload = {
      V: ENCODE_GAME_VERSION,
      BP: {
        $type: 'Building',
        Icon: { Data: icons },
        Entries: buildings.map((building) => {
          const entry: Record<string, string | number> = { T: building.type }
          if (building.x) entry.X = building.x
          if (building.y) entry.Y = building.y
          if (building.layer) entry.L = building.layer
          if (building.rotation) entry.R = building.rotation
          return entry
        }),
        BinaryVersion: ENCODE_GAME_VERSION,
      },
    }
    const compressed = await gzipCompress(JSON.stringify(payload))
    return `${PREFIX}${SEPARATOR}${ENCODE_MAJOR_VERSION}${SEPARATOR}${bytesToBase64(compressed)}${SUFFIX}`
  }

  const payload = {
    $type: `${NET}.SerializableBlueprint, ${NET}`,
    V: V5_GAME_VERSION,
    BP: {
      $type: 'Building',
      Entries: {
        $type: `${NET}.SerializableBuildingEntry[], ${NET}`,
        $values: buildings.map((building) => ({
          $type: `${NET}.SerializableBuildingEntry, ${NET}`,
          X: building.x ?? 0,
          Y: building.y ?? 0,
          L: building.layer ?? 0,
          R: building.rotation ?? 0,
          T: building.type,
          C: null,
        })),
      },
    },
  }

  const tail = icons.some((icon) => icon !== null)
    ? JSON.stringify([{ Type: ICON_TYPE, Content: JSON.stringify({ Data: icons }) }])
    : '[]'

  const compressed = await gzipCompress(JSON.stringify(payload))
  return `${PREFIX}${SEPARATOR}${V5_MAJOR_VERSION}${SEPARATOR}${bytesToBase64(compressed)}${tail}_${tail.length}${SUFFIX}`
}

/** Finds every blueprint code embedded in a chunk of text. */
export function findBlueprintCodes(text: string): string[] {
  const codes: string[] = []
  let index = text.indexOf(PREFIX)
  while (index !== -1) {
    const end = text.indexOf(SUFFIX, index)
    if (end === -1) break
    codes.push(text.slice(index, end + 1))
    index = text.indexOf(PREFIX, end)
  }
  return codes
}
