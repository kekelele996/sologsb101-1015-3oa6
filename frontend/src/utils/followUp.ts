/**
 * 复评挂账领域规则（纯函数）
 * - 复评保存后在措施台账生成一条 sourceReviewId 指向该次复评的同类型待办；
 * - 挂账待办的「收掉 / 挂起」直接由措施状态决定：state !== '已完成' 即挂起（待办未收）；
 * - 该株古树存在未收挂账待办时，再次复评必须填写未落实原因；
 * - 源复评之后又隔了两次及以上复评仍未收掉的，档案页单列预警。
 */
import type { Measure } from '../types/measure'
import type { Review } from '../types/review'

/** 是否为复评挂账生成的措施 */
export function isReviewLinked(measure: Measure): boolean {
  return measure.sourceReviewId !== ''
}

/** 挂账待办是否还挂着（未收掉）：措施状态不是「已完成」 */
export function isOpenFollowUp(measure: Measure): boolean {
  return isReviewLinked(measure) && measure.state !== '已完成'
}

/** 某株古树下全部挂账措施（含已收掉与未收掉） */
export function linkedMeasuresOf(measures: Measure[], treeId: string): Measure[] {
  return measures.filter((row) => row.treeId === treeId && isReviewLinked(row))
}

/** 某株古树下尚未收掉的挂账待办 */
export function openFollowUpsOf(measures: Measure[], treeId: string): Measure[] {
  return measures.filter((row) => row.treeId === treeId && isOpenFollowUp(row))
}

/** 复评按时间先后排序（日期相同按创建先后兜底） */
export function sortReviewsChronologically(reviews: Review[]): Review[] {
  return [...reviews].sort((a, b) =>
    a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )
}

/**
 * 一条挂账待办在其源复评之后「隔了几次复评」。
 * 源复评不存在时返回 0（数据不完整时不做预警）。
 */
export function reviewsSinceFollowUp(review: Review | undefined, reviews: Review[]): number {
  if (review === undefined) return 0
  const ordered = sortReviewsChronologically(reviews.filter((row) => row.treeId === review.treeId))
  const index = ordered.findIndex((row) => row.id === review.id)
  if (index < 0) return 0
  return ordered.length - 1 - index
}

/** 跨两次复评仍未收掉的判定阈值（源复评之后又做了 ≥ 2 次复评） */
export const FOLLOW_UP_STALE_REVIEW_GAP = 2

export interface StaleFollowUp {
  measure: Measure
  /** 挂账来源复评 */
  review: Review
  /** 源复评之后又隔的复评次数 */
  gap: number
}

/**
 * 找出「隔了两次复评还没收掉」的挂账待办。
 * @param treeId 限定古树；传 null 时统计全部古树
 */
export function staleFollowUps(measures: Measure[], reviews: Review[], treeId: string | null): StaleFollowUp[] {
  const open = measures.filter(
    (row) => (treeId === null || row.treeId === treeId) && isOpenFollowUp(row),
  )
  const reviewById = new Map(reviews.map((row) => [row.id, row]))
  const result: StaleFollowUp[] = []
  open.forEach((measure) => {
    const review = reviewById.get(measure.sourceReviewId)
    if (review === undefined) return
    const gap = reviewsSinceFollowUp(review, reviews)
    if (gap >= FOLLOW_UP_STALE_REVIEW_GAP) {
      result.push({ measure, review, gap })
    }
  })
  return result.sort(
    (a, b) =>
      b.gap - a.gap ||
      a.review.date.localeCompare(b.review.date) ||
      a.measure.treeId.localeCompare(b.measure.treeId),
  )
}
