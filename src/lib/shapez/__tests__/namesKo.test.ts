import { describe, expect, it } from 'vitest'

import { OPERATIONS, OPERATION_IDS } from '../operations'
import { PART_NAMES_KO, buildingNameKo, colorNameKo, islandNameKo } from '../namesKo'
import {
  GAME_VERSION,
  OPERATION_BUILDINGS,
  PROGRESSION,
  SCENARIO_KEYS,
  milestoneNameKo,
  scenarioNameKo,
} from '../progression'
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
  '벨트 포트', // the game says 벨트 발사기 / 벨트 포획기
  '리프트', // the game says 벨트 승강기
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

/**
 * Scenario and milestone names ride along with the progression data, read out
 * of the installed game rather than hand-written here.
 */
describe('scenario naming', () => {
  it('names scenarios the way the game names them on its mode screen', () => {
    expect(scenarioNameKo('default')).toBe('클래식 · 일반')
    expect(scenarioNameKo('hard')).toBe('클래식 · 어려움')
    expect(scenarioNameKo('hexagonal')).toBe('클래식 · 육각')
    // the game calls this 광기, not "Insane"
    expect(scenarioNameKo('insane')).toBe('클래식 · 광기')
    expect(scenarioNameKo('converter')).toBe('제조 · 일반')
    expect(scenarioNameKo('converterHard')).toBe('제조 · 어려움')
  })

  it('covers the 제조 scenarios', () => {
    expect(PROGRESSION.converter).toBeDefined()
    expect(PROGRESSION.converter.gameMode).toBe('ConverterGameMode')
    expect(PROGRESSION.converterHard.gameMode).toBe('ConverterGameMode')
  })

  it('has a Korean name for every scenario and milestone', () => {
    for (const key of SCENARIO_KEYS) {
      expect(scenarioNameKo(key), key).toBeTruthy()
      for (const milestone of PROGRESSION[key].milestones) {
        assertNoTransliteration(milestoneNameKo(milestone), `${key}.${milestone.id}`)
        expect(milestoneNameKo(milestone), `${key}.${milestone.id}`).not.toBe(milestone.id)
      }
    }
  })

  it('records which game build the data came from', () => {
    expect(GAME_VERSION).toMatch(/^\d+\.\d+/)
  })
})
