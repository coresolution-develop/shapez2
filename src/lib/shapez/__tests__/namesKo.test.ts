import { describe, expect, it } from 'vitest'

import { OPERATIONS, OPERATION_IDS } from '../operations'
import {
  PART_NAMES_KO,
  SCENARIO_NAMES_KO,
  buildingNameKo,
  colorNameKo,
  islandNameKo,
  milestoneNameKo,
} from '../namesKo'
import { OPERATION_BUILDINGS, PROGRESSION } from '../progression'
import { OPERATION_SPECS, STACKER_SPECS } from '../throughput'
import { COLORS } from '../types'

/**
 * Terminology has to match what the player reads in game. Transliterations like
 * "스태커" or "페인터" are not Korean names — the game says 결합기 and 색칠기.
 */
const TRANSLITERATIONS = [
  '스태커',
  '페인터',
  '커터',
  '스와퍼',
  '믹서',
  '핀 푸셔',
  '크리스탈',
  '벨트 포트',
  '리프트',
]

function assertNoTransliteration(label: string, where: string) {
  for (const bad of TRANSLITERATIONS) {
    expect(label.includes(bad), `${where}: "${label}" uses the transliteration "${bad}"`).toBe(false)
  }
}

describe('Korean names come from the game', () => {
  it('uses the game names for the processing buildings', () => {
    expect(buildingNameKo('CutterDefaultVariant')).toBe('절단기')
    expect(buildingNameKo('CutterHalfVariant')).toBe('절반 파괴기')
    expect(buildingNameKo('StackerStraightVariant')).toBe('결합기')
    expect(buildingNameKo('StackerDefaultVariant')).toBe('굽은 결합기')
    expect(buildingNameKo('PainterDefaultVariant')).toBe('색칠기')
    expect(buildingNameKo('RotatorOneQuadVariant')).toBe('회전기')
    expect(buildingNameKo('PinPusherDefaultVariant')).toBe('핀 누름기')
    expect(buildingNameKo('CrystalGeneratorDefaultVariant')).toBe('결정체 생성기')
    expect(buildingNameKo('HalvesSwapperDefaultVariant')).toBe('교환기')
    expect(buildingNameKo('MixerDefaultVariant')).toBe('색상 혼합기')
    expect(buildingNameKo('ExtractorDefaultVariant')).toBe('미니 채굴기')
    expect(buildingNameKo('BeltDefaultVariant')).toBe('컨베이어 벨트')
  })

  it('uses the game names for colours', () => {
    expect(colorNameKo('r')).toBe('빨간색')
    expect(colorNameKo('c')).toBe('시안')
    expect(colorNameKo('u')).toBe('무색')
    for (const color of COLORS) {
      expect(colorNameKo(color), color).not.toBe(color)
    }
  })

  it('falls back to what it was given for anything unknown', () => {
    expect(buildingNameKo('NoSuchVariant', 'Fallback')).toBe('Fallback')
    expect(islandNameKo('NoSuchIsland', 'Fallback')).toBe('Fallback')
  })

  it('never labels an operation with a transliteration', () => {
    for (const id of OPERATION_IDS) {
      assertNoTransliteration(OPERATIONS[id].labelKo, `OPERATIONS.${id}`)
      assertNoTransliteration(OPERATION_BUILDINGS[id].nameKo, `OPERATION_BUILDINGS.${id}`)
      assertNoTransliteration(OPERATION_SPECS[id].nameKo, `OPERATION_SPECS.${id}`)
    }
    for (const [variant, spec] of Object.entries(STACKER_SPECS)) {
      assertNoTransliteration(spec.nameKo, `STACKER_SPECS.${variant}`)
    }
    for (const [code, name] of Object.entries(PART_NAMES_KO)) {
      assertNoTransliteration(name, `PART_NAMES_KO.${code}`)
    }
  })

  it('names every shape part', () => {
    for (const code of ['C', 'R', 'S', 'W', 'H', 'G', 'F', 'P', 'c']) {
      expect(PART_NAMES_KO[code], code).toBeTruthy()
    }
    // the game only ever writes these three out, in one side quest title
    expect(PART_NAMES_KO.C).toBe('원')
    expect(PART_NAMES_KO.S).toBe('별')
    expect(PART_NAMES_KO.R).toBe('정사각형')
  })
})

describe('scenario naming', () => {
  it('names scenarios the way the game does', () => {
    expect(SCENARIO_NAMES_KO.default).toBe('클래식 · 일반')
    expect(SCENARIO_NAMES_KO.hard).toBe('클래식 · 어려움')
    expect(SCENARIO_NAMES_KO.hexagonal).toBe('클래식 · 육각')
    // the game calls this 광기, not "Insane"
    expect(SCENARIO_NAMES_KO.insane).toBe('클래식 · 광기')
    expect(SCENARIO_NAMES_KO.converter).toBe('제조')
  })

  it('has a Korean name for every scenario we ship data for', () => {
    for (const key of Object.keys(PROGRESSION)) {
      expect(SCENARIO_NAMES_KO[key], key).toBeTruthy()
    }
  })

  it('translates the milestones it can and leaves the rest alone', () => {
    expect(milestoneNameKo('RNInitial', 'Rotate & Cut')).toBe('회전 및 절단')
    expect(milestoneNameKo('RNFluids', 'Fluids & Painting')).toBe('유체 및 색칠')
    // no counterpart in the current game, so it stays as it was
    expect(milestoneNameKo('RNEndOfGame', 'Final Qualification')).toBe('Final Qualification')
  })

  it('does not claim to cover the 제조 scenario', () => {
    // our progression data predates that mode; offering it would be a lie
    expect(PROGRESSION.converter).toBeUndefined()
  })
})
