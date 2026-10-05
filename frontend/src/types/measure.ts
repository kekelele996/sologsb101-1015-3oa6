/**
 * 复壮措施（Measure）
 * 换土、施肥、透气、树洞修补、病虫害防治等，按实施状态跟踪。
 * sourceReviewId 非空的措施由长势复评自动挂账生成，挂账待办的「收掉 / 挂起」
 * 直接由 state 决定：state !== '已完成' 即待办挂起。
 */

/** 措施类型 */
export type MeasureType = '换土' | '施肥' | '透气' | '树洞修补' | '病虫害防治'

/** 实施状态：计划 / 实施中 / 已完成 */
export type MeasureState = '计划' | '实施中' | '已完成'

export const MEASURE_TYPE_OPTIONS: MeasureType[] = ['换土', '施肥', '透气', '树洞修补', '病虫害防治']
export const MEASURE_STATE_OPTIONS: MeasureState[] = ['计划', '实施中', '已完成']

export interface Measure {
  id: string
  /** 所属古树 */
  treeId: string
  /** 措施类型 */
  type: MeasureType
  /** 实施日期 YYYY-MM-DD（复评挂账生成时取复评日期） */
  date: string
  /** 材料 */
  material: string
  /** 负责人 */
  operator: string
  /** 实施状态 */
  state: MeasureState
  /** 挂账来源复评 id；手工登记的措施为空字符串 */
  sourceReviewId: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑复壮措施的表单草稿 */
export interface MeasureDraft {
  treeId: string
  type: MeasureType
  date: string
  material: string
  operator: string
  state: MeasureState
}
