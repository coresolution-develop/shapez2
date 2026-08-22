/**
 * What a player can build at a given point in the game.
 *
 * shapez 2 hands out buildings in two ways: milestones unlock them on the main
 * path, and side upgrades are bought separately with research points. A plan is
 * only useful if it sticks to what you already have.
 */
import { buildingNameKo, milestoneNameKo } from './namesKo'
import type { OperationId } from './operations'
import progressionData from './progression.json'
import type { ColorCode } from './types'

export interface Milestone {
  index: number
  id: string
  title: string
  unlocks: string[]
}

export interface SideUpgrade {
  id: string
  title: string
  unlocks: string[]
  cost: number | null
  requires: string[]
}

export interface ScenarioProgression {
  maxShapeLayers: number
  milestones: Milestone[]
  sideUpgrades: SideUpgrade[]
}

export const PROGRESSION = progressionData as unknown as Record<string, ScenarioProgression>

export type ScenarioKey = keyof typeof PROGRESSION & string

/** Which building each operation needs, and what to call it in Korean. */
export const OPERATION_BUILDINGS: Record<OperationId, { variant: string; nameKo: string }> = {
  hcut: { variant: 'CutterHalfVariant', nameKo: buildingNameKo('CutterHalfVariant') },
  cut: { variant: 'CutterDefaultVariant', nameKo: buildingNameKo('CutterDefaultVariant') },
  r90cw: { variant: 'RotatorOneQuadVariant', nameKo: `${buildingNameKo('RotatorOneQuadVariant')} (시계)` },
  r90ccw: {
    variant: 'RotatorOneQuadCCWVariant',
    nameKo: `${buildingNameKo('RotatorOneQuadVariant')} (반시계)`,
  },
  r180: { variant: 'RotatorHalfVariant', nameKo: `${buildingNameKo('RotatorOneQuadVariant')} (180°)` },
  stack: { variant: 'StackerStraightVariant', nameKo: buildingNameKo('StackerStraightVariant') },
  swap: {
    variant: 'HalvesSwapperDefaultVariant',
    nameKo: buildingNameKo('HalvesSwapperDefaultVariant'),
  },
  paint: { variant: 'PainterDefaultVariant', nameKo: buildingNameKo('PainterDefaultVariant') },
  pin: { variant: 'PinPusherDefaultVariant', nameKo: buildingNameKo('PinPusherDefaultVariant') },
  crystal: {
    variant: 'CrystalGeneratorDefaultVariant',
    nameKo: buildingNameKo('CrystalGeneratorDefaultVariant'),
  },
}

export const BENT_STACKER_VARIANT = 'StackerDefaultVariant'
export const MIXER_VARIANT = 'MixerDefaultVariant'
export const MIXER_NAME_KO = buildingNameKo(MIXER_VARIANT)

/** Colors a pump provides directly; everything else needs the mixer. */
const PRIMARY_COLORS: ColorCode[] = ['r', 'g', 'b']

export interface Unlocks {
  /** Buildings available, by variant id. */
  variants: Set<string>
  operations: Set<OperationId>
  colors: Set<ColorCode>
  bentStacker: boolean
}

export interface ProgressState {
  scenario: ScenarioKey
  /** How many milestones are complete; 0 means nothing unlocked yet. */
  milestone: number
  /** Ids of side upgrades the player has bought. */
  sideUpgrades: string[]
}

/** Everything unlocked — used when the player opts out of progress limits. */
export function allUnlocks(): Unlocks {
  return {
    variants: new Set(),
    operations: new Set(Object.keys(OPERATION_BUILDINGS) as OperationId[]),
    colors: new Set<ColorCode>(['r', 'g', 'b', 'c', 'm', 'y', 'w']),
    bentStacker: true,
  }
}

export function unlocksFor(progress: ProgressState): Unlocks {
  const scenario = PROGRESSION[progress.scenario] ?? PROGRESSION.default
  const variants = new Set<string>()

  for (const milestone of scenario.milestones) {
    if (milestone.index > progress.milestone) continue
    for (const variant of milestone.unlocks) variants.add(variant)
  }
  for (const upgrade of scenario.sideUpgrades) {
    if (!progress.sideUpgrades.includes(upgrade.id)) continue
    for (const variant of upgrade.unlocks) variants.add(variant)
  }

  const operations = new Set<OperationId>()
  for (const [operation, building] of Object.entries(OPERATION_BUILDINGS) as [
    OperationId,
    { variant: string },
  ][]) {
    if (variants.has(building.variant)) operations.add(operation)
  }
  // the bent stacker is a second stacker variant, not a separate operation
  if (variants.has(BENT_STACKER_VARIANT)) operations.add('stack')

  const colors = new Set<ColorCode>()
  if (variants.has(OPERATION_BUILDINGS.paint.variant)) {
    for (const color of PRIMARY_COLORS) colors.add(color)
    if (variants.has(MIXER_VARIANT)) {
      for (const color of ['c', 'm', 'y', 'w'] as ColorCode[]) colors.add(color)
    }
  }

  return { variants, operations, colors, bentStacker: variants.has(BENT_STACKER_VARIANT) }
}

/** The earliest milestone that hands out the given building. */
export function milestoneForVariant(scenario: ScenarioKey, variant: string): Milestone | null {
  const data = PROGRESSION[scenario] ?? PROGRESSION.default
  return data.milestones.find((milestone) => milestone.unlocks.includes(variant)) ?? null
}

export function sideUpgradeForVariant(scenario: ScenarioKey, variant: string): SideUpgrade | null {
  const data = PROGRESSION[scenario] ?? PROGRESSION.default
  return data.sideUpgrades.find((upgrade) => upgrade.unlocks.includes(variant)) ?? null
}

/** Human-readable "you still need X" for a building the player lacks. */
export function unlockHint(scenario: ScenarioKey, variant: string, nameKo: string): string {
  const milestone = milestoneForVariant(scenario, variant)
  if (milestone) {
    return `${nameKo} (마일스톤 ${milestone.index} · ${milestoneNameKo(milestone.id, milestone.title)})`
  }
  const upgrade = sideUpgradeForVariant(scenario, variant)
  if (upgrade) {
    const cost = upgrade.cost === null ? '' : ` · 연구포인트 ${upgrade.cost}`
    return `${nameKo} (사이드 업그레이드 「${upgrade.title}」${cost})`
  }
  return nameKo
}
