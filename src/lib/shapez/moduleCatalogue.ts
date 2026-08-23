/**
 * What each module does, in the plainest words, with a worked example.
 *
 * The examples are not drawn by hand and not written down: the shapes shown as
 * the result are whatever `applyOperation` returns for the shapes shown as the
 * input. A picture here therefore cannot disagree with the game — if a rule
 * changes, the picture changes with it, and the test that runs every entry
 * catches an example that has stopped meaning anything.
 */
import { applyOperation, type OperationId } from './operations'
import { parseShapeCode } from './shapeCode'
import { QUAD_CONFIG, operationConfig, type ColorCode, type Shape } from './types'

export interface CatalogueEntry {
  op: OperationId
  /** What the module does to a shape, not what the building is called. */
  title: string
  does: string
  /** Shape codes to feed the example, in the order the operation takes them. */
  inputs: string[]
  color?: ColorCode
}

export const MODULE_CATALOGUE: CatalogueEntry[] = [
  {
    op: 'r90cw',
    title: '시계 방향으로 90° 돌리기',
    does: '도형 하나를 받아 시계 방향으로 한 칸 돌려 내보냅니다.',
    inputs: ['CuRuSuWu'],
  },
  {
    op: 'r90ccw',
    title: '반시계 방향으로 90° 돌리기',
    does: '같은 회전을 반대로 합니다.',
    inputs: ['CuRuSuWu'],
  },
  {
    op: 'r180',
    title: '180° 돌리기',
    does: '반 바퀴 돌립니다. 회전기 두 대를 거치는 것보다 한 대로 끝내는 게 쌉니다.',
    inputs: ['CuRuSuWu'],
  },
  {
    op: 'hcut',
    title: '반으로 갈라 한쪽 버리기',
    does: '반으로 잘라 한쪽만 내보내고 나머지는 안에서 없앱니다. 버린 반쪽을 치울 벨트가 필요 없습니다.',
    inputs: ['CuRuSuWu'],
  },
  {
    op: 'paint',
    title: '맨 위 층 칠하기',
    does: '물감을 받아 맨 위 층을 그 색으로 칠합니다. 물감 배관은 직접 이어야 합니다.',
    inputs: ['CuCuCuCu'],
    color: 'r',
  },
  {
    op: 'pin',
    title: '핀 밀어 올리기',
    does: '도형을 한 층 밀어 올리고 그 밑에 지지 핀을 답니다.',
    inputs: ['CuCuCuCu'],
  },
  {
    op: 'cut',
    title: '반으로 갈라 양쪽 쓰기',
    does: '반으로 자른 두 조각을 모두 내보냅니다. 나가는 벨트가 두 줄이라 아직 모듈로 못 만듭니다.',
    inputs: ['CuRuSuWu'],
  },
  {
    op: 'stack',
    title: '위아래로 겹치기',
    does: '도형 두 개를 받아 위쪽을 아래쪽에 얹습니다. 벨트가 두 줄 들어와서 모듈도 입구가 둘입니다.',
    inputs: ['RuRuRuRu', 'CuCuCuCu'],
  },
  {
    op: 'crystal',
    title: '빈칸을 결정체로 채우기',
    does: '물감을 받아 도형의 빈칸을 결정체로 메웁니다. 기계가 두 층을 차지해서 아직 모듈로 못 만듭니다.',
    inputs: ['Cu--Cu--'],
    color: 'b',
  },
  {
    op: 'swap',
    title: '절반씩 맞바꾸기',
    does: '도형 두 개의 반쪽을 서로 바꿉니다. 결정체는 겹치면 깨지므로 이쪽으로 붙입니다.',
    inputs: ['CuCuCuCu', 'RuRuRuRu'],
  },
]

const CONFIG = operationConfig(QUAD_CONFIG, 'normal')

export interface CatalogueDemo {
  before: Shape[]
  after: Shape[]
}

/** Runs an entry's example through the simulator, or gives up quietly. */
export function catalogueDemo(entry: CatalogueEntry): CatalogueDemo | null {
  const before: Shape[] = []
  for (const code of entry.inputs) {
    const parsed = parseShapeCode(code, QUAD_CONFIG)
    if (!parsed.ok) return null
    before.push(parsed.shape)
  }

  try {
    return { before, after: applyOperation(entry.op, before, CONFIG, entry.color) }
  } catch {
    return null
  }
}
