/**
 * 复评 ↔ 复壮措施挂账派生规则（纯函数，供 store / 页面 / 导出复用）
 *
 * 台账里的一条措施就是一条待办：
 * - state 为「计划 / 实施中」→ 挂账待办（未收掉）；
 * - state 为「已完成」→ 待办收掉；退回计划 / 实施中又自动挂起；
 * - sourceReviewId 非空表示这条待办由某次长势复评自动挂出。
 */
import type { Measure } from '../types/measure'
import type { Review } from '../types/review'

/** 挂账待办：由复评自动挂出、且尚未标记为已完成 */
export function isOpenLinkedMeasure(measure: Measure): boolean {
  return measure.sourceReviewId !== '' && measure.state !== '已完成'
}

/** 该古树当前还没收掉的复评挂账待办 */
export function openLinkedMeasures(treeId: string, measures: Measure[]): Measure[] {
  return measures.filter((row) => row.treeId === treeId && isOpenLinkedMeasure(row))
}

/** 某次复评挂出的待办（含已完成留痕），按日期倒序 */
export function measuresOfReview(reviewId: string, measures: Measure[]): Measure[] {
  return measures
    .filter((row) => row.sourceReviewId === reviewId)
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * 挂账待办在之后隔了多少次复评仍未收掉：
 * 取来源复评之后（日期更晚；同日按 id 稳定去重）的复评次数。
 */
export function laterReviewCount(measure: Measure, reviews: Review[]): number {
  const source = reviews.find((row) => row.id === measure.sourceReviewId)
  if (source === undefined) return 0
  return reviews.filter(
    (row) =>
      row.treeId === measure.treeId &&
      (row.date > source.date || (row.date === source.date && row.id > source.id)),
  ).length
}

export interface OverdueLinkedMeasure {
  measure: Measure
  sourceReview: Review | null
  /** 来源复评之后已做过的复评次数 */
  laterReviews: number
}

/**
 * 「隔了两次复评还没收掉」的挂账待办：
 * 来源复评之后已经又做了 ≥ 2 次复评，待办仍处于计划 / 实施中。
 */
export function overdueLinkedMeasures(
  treeId: string | undefined,
  measures: Measure[],
  reviews: Review[],
): OverdueLinkedMeasure[] {
  const candidates = measures.filter((row) => {
    if (!isOpenLinkedMeasure(row)) return false
    if (treeId !== undefined && row.treeId !== treeId) return false
    return true
  })
  return candidates
    .map((measure) => {
      const sourceReview = reviews.find((row) => row.id === measure.sourceReviewId) ?? null
      return { measure, sourceReview, laterReviews: laterReviewCount(measure, reviews) }
    })
    .filter((item) => item.laterReviews >= 2)
    .sort(
      (a, b) =>
        b.laterReviews - a.laterReviews ||
        (a.sourceReview?.date ?? '').localeCompare(b.sourceReview?.date ?? ''),
    )
}

/** 取一条开放挂账待办最近一次被复评时写下的未落实原因（无则空串） */
export function latestPendingReason(
  treeId: string,
  measures: Measure[],
  reviews: Review[],
): string {
  const open = openLinkedMeasures(treeId, measures)
  if (open.length === 0) return ''
  const sourceIds = new Set(open.map((row) => row.sourceReviewId))
  const withReason = reviews
    .filter((row) => row.treeId === treeId && row.pendingReason.trim() !== '')
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  // 优先取针对当前开放挂账的复评原因，取不到再退回该树任意一次记录
  const matched = withReason.find((row) => sourceIds.has(row.id)) ?? withReason[0]
  return matched === undefined ? '' : matched.pendingReason.trim()
}
