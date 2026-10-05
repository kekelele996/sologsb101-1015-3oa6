/**
 * 长势复评（Review）
 * 长势为「衰弱」或「濒危」时必须填写后续措施；
 * 选择后续措施类型后保存，会自动在复壮措施台账挂一条同类型待办（sourceReviewId 指回本次复评）。
 */
import type { MeasureType } from './measure'

/** 长势等级 */
export type Vigor = '旺盛' | '一般' | '衰弱' | '濒危'

/** 长势趋势 */
export type Trend = '好转' | '持平' | '下降'

export const VIGOR_OPTIONS: Vigor[] = ['旺盛', '一般', '衰弱', '濒危']
export const TREND_OPTIONS: Trend[] = ['好转', '持平', '下降']

/** 需要强制填写后续措施的长势等级 */
export const VIGOR_NEED_FOLLOW_UP: Vigor[] = ['衰弱', '濒危']

/** 复评保存后不向措施台账挂待办 */
export const FOLLOW_UP_TYPE_NONE = ''

export interface Review {
  id: string
  /** 所属古树 */
  treeId: string
  /** 复评日期 YYYY-MM-DD */
  date: string
  /** 长势 */
  vigor: Vigor
  /** 趋势 */
  trend: Trend
  /** 复评结论 */
  conclusion: string
  /** 后续措施文字说明（长势为衰弱 / 濒危时必填） */
  followUp: string
  /**
   * 后续措施类型：保存后在措施台账挂一条同类型待办（sourceReviewId 指回本次复评）；
   * 空串表示本次复评不挂台账待办。
   */
  followUpType: MeasureType | typeof FOLLOW_UP_TYPE_NONE
  /** 再做本次复评时，该株古树仍有未收掉的挂账待办，必须写明的未落实原因 */
  pendingReason: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑长势复评的表单草稿 */
export interface ReviewDraft {
  treeId: string
  date: string
  vigor: Vigor
  trend: Trend
  conclusion: string
  followUp: string
  followUpType: MeasureType | typeof FOLLOW_UP_TYPE_NONE
  pendingReason: string
}
