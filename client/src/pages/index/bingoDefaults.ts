const DEFAULT_GRID_SIZE = 5
const GRID_SIZE_OPTIONS = [3, 4, 5, 6]
import { STORAGE_KEYS } from '@/config/storageKeys'
import { DEFAULT_WORDS } from '../../../../shared/types'

const GRID_SIZE_KEY = STORAGE_KEYS.GRID_SIZE

// Nice Try original word list (only used by the nicetry category template)
const NICETRY_WORDS = [
  '瀑布',
  '搭档',
  '作画',
  '口罩+帽子+眼镜+耳机',
  '古代人',
  '谐音梗',
  '厉害折扣',
  '花束',
  '跑者',
  '落单耳机',
  '摆拍',
  '野猫对视',
  '球体',
  '一饮而尽',
  '好快的车',
  '电量告急',
  '排什么呢',
  '哼歌',
  '拍手',
  '基本一致',
  '燃起来了',
  '淋雨',
  '好招牌',
  '好高的老人',
  'Nice Try',
]

export { DEFAULT_GRID_SIZE, GRID_SIZE_OPTIONS, GRID_SIZE_KEY, DEFAULT_WORDS, NICETRY_WORDS }
