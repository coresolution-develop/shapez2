/** Groups building variants so the tile map can colour them meaningfully. */
export type BuildingCategory = 'transport' | 'processing' | 'fluid' | 'logic' | 'other'

export const CATEGORY_LABELS: Record<BuildingCategory, string> = {
  transport: '운반',
  processing: '가공',
  fluid: '유체',
  logic: '회로',
  other: '기타',
}

export const CATEGORY_COLORS: Record<BuildingCategory, string> = {
  transport: '#64748b',
  processing: '#2563eb',
  fluid: '#0d9488',
  logic: '#d97706',
  other: '#7c3aed',
}

const RULES: [BuildingCategory, RegExp][] = [
  ['fluid', /^(Pipe|Pump|FluidStorage|FluidPort|Mixer)/],
  ['processing', /^(Cutter|Rotator|Stacker|Painter|PinPusher|CrystalGenerator|HalvesSwapper|Extractor)/],
  ['transport', /^(Belt|Splitter|Merger|Lift|Trash)/],
  ['logic', /^(Wire|LogicGate|Display|Button|ConstantSignal|BeltReader|Controlled|Virtual|Label|Sandbox)/],
]

export function buildingCategory(variant: string): BuildingCategory {
  for (const [category, pattern] of RULES) {
    if (pattern.test(variant)) return category
  }
  return 'other'
}
