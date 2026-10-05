/**
 * 长势复评状态管理（Pinia）
 * 维护长势筛选条件与复评结论派生值；长势为衰弱 / 濒危时强制填写后续措施；
 * 保存时按选择的后续措施类型自动在措施台账挂待办；
 * 该株古树仍有未收掉的挂账待办时，必须先写明未落实原因才允许保存。
 */
import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Review, ReviewDraft, Trend, Vigor } from '../types/review'
import { VIGOR_NEED_FOLLOW_UP, VIGOR_OPTIONS } from '../types/review'
import {
  db,
  deleteReviewWithLinkedMeasures,
  initDatabase,
  ROW_REVISION,
  saveReviewWithFollowUp,
} from '../utils/db'
import { nowIso, uuid } from '../utils/id'
import { useTreeStore } from './treeStore'

/** 长势复评筛选条件 */
export interface ReviewFilters {
  keyword: string
  treeId: string | 'all'
  vigor: Vigor | 'all'
  trend: Trend | 'all'
}

/** 复评结论校验结果 */
export interface ReviewValidation {
  ok: boolean
  message: string
}

/** 校验时的页面上下文：仍未收掉的挂账待办数（编辑时已排除本次复评自己挂出的那条） */
export interface ReviewValidateContext {
  blockingCount?: number
}

export const useReviewStore = defineStore('review', () => {
  const filters = reactive<ReviewFilters>({ keyword: '', treeId: 'all', vigor: 'all', trend: 'all' })
  const selectedIds = ref<string[]>([])
  const lastMessage = ref('')
  const revision = ref(0)

  /** 长势分布统计，供复评页徽标使用 */
  const vigorStats = computed<Record<Vigor, number>>(() => {
    const result = { 旺盛: 0, 一般: 0, 衰弱: 0, 濒危: 0 } as Record<Vigor, number>
    const treeStore = useTreeStore()
    VIGOR_OPTIONS.forEach((vigor) => {
      result[vigor] = treeStore.reviews.filter((row) => row.vigor === vigor).length
    })
    return result
  })

  /** 长势为衰弱 / 濒危且未填写后续措施的古树数量 */
  const followUpMissing = computed<number>(() => {
    const treeStore = useTreeStore()
    return treeStore.trees.filter((tree) => {
      const list = treeStore.reviews
        .filter((row) => row.treeId === tree.id)
        .sort((a, b) => a.date.localeCompare(b.date))
      const latest = list.length > 0 ? list[list.length - 1] : null
      if (latest === null) return false
      return VIGOR_NEED_FOLLOW_UP.includes(latest.vigor) && latest.followUp.trim() === ''
    }).length
  })

  /** 需要填写后续措施的长势等级 */
  const requireFollowUp = (vigor: Vigor): boolean => VIGOR_NEED_FOLLOW_UP.includes(vigor)

  /**
   * 校验复评表单：
   * 1. 衰弱 / 濒危必须填写后续措施，并选择一个后续措施类型挂台账待办；
   * 2. 该株古树还有未收掉的挂账待办时，必须写明未落实原因。
   */
  function validate(draft: ReviewDraft, context: ReviewValidateContext = {}): ReviewValidation {
    if (requireFollowUp(draft.vigor) && draft.followUp.trim() === '') {
      return { ok: false, message: `长势为「${draft.vigor}」时必须填写后续措施，否则无法保存。` }
    }
    if (requireFollowUp(draft.vigor) && draft.followUpType === '') {
      return { ok: false, message: `长势为「${draft.vigor}」时必须选择一个后续措施类型，保存后会挂到措施台账跟踪落实。` }
    }
    if ((context.blockingCount ?? 0) > 0 && draft.pendingReason.trim() === '') {
      return {
        ok: false,
        message: `该株古树还有 ${context.blockingCount} 条复评挂账待办未收掉，请先写明未落实原因再保存本次复评。`,
      }
    }
    if (draft.conclusion.trim() === '') {
      return { ok: false, message: '请填写复评结论。' }
    }
    return { ok: true, message: '' }
  }

  async function init(): Promise<void> {
    await initDatabase()
    revision.value += 1
  }

  function setFilters(patch: Partial<ReviewFilters>): void {
    Object.assign(filters, patch)
  }

  function resetFilters(): void {
    filters.keyword = ''
    filters.treeId = 'all'
    filters.vigor = 'all'
    filters.trend = 'all'
    selectedIds.value = []
  }

  function setSelectedIds(ids: string[]): void {
    selectedIds.value = [...ids]
  }

  async function createReview(
    draft: ReviewDraft,
    context: ReviewValidateContext = {},
  ): Promise<Review | null> {
    const check = validate(draft, context)
    if (!check.ok) {
      lastMessage.value = check.message
      return null
    }
    const stamp = nowIso()
    const row: Review = {
      id: uuid('review'),
      treeId: draft.treeId,
      date: draft.date,
      vigor: draft.vigor,
      trend: draft.trend,
      conclusion: draft.conclusion.trim(),
      followUp: draft.followUp.trim(),
      followUpType: draft.followUpType,
      pendingReason: draft.pendingReason.trim(),
      createdAt: stamp,
      updatedAt: stamp,
      revision: ROW_REVISION,
    }
    const { linkedCreated } = await saveReviewWithFollowUp(row)
    revision.value += 1
    lastMessage.value = linkedCreated
      ? `已登记 ${row.date} 长势复评：${row.vigor}（${row.trend}），并在措施台账挂出「${row.followUpType}」待办`
      : `已登记 ${row.date} 长势复评：${row.vigor}（${row.trend}）`
    return row
  }

  async function updateReview(
    reviewId: string,
    draft: ReviewDraft,
    context: ReviewValidateContext = {},
  ): Promise<ReviewValidation> {
    const check = validate(draft, context)
    if (!check.ok) {
      lastMessage.value = check.message
      return check
    }
    const existing = await db.reviews.get(reviewId)
    if (!existing) return { ok: false, message: '复评记录不存在' }
    const row: Review = {
      ...existing,
      treeId: draft.treeId,
      date: draft.date,
      vigor: draft.vigor,
      trend: draft.trend,
      conclusion: draft.conclusion.trim(),
      followUp: draft.followUp.trim(),
      followUpType: draft.followUpType,
      pendingReason: draft.pendingReason.trim(),
    }
    const { linkedCreated } = await saveReviewWithFollowUp(row)
    revision.value += 1
    lastMessage.value = linkedCreated
      ? `复评记录已更新，并在措施台账挂出「${row.followUpType}」待办`
      : '复评记录已更新'
    return { ok: true, message: '' }
  }

  async function deleteReview(reviewId: string): Promise<void> {
    await deleteReviewWithLinkedMeasures(reviewId)
    selectedIds.value = selectedIds.value.filter((id) => id !== reviewId)
    revision.value += 1
  }

  async function refreshCounts(): Promise<void> {
    await useTreeStore().refreshCounts()
  }

  return {
    filters,
    selectedIds,
    lastMessage,
    revision,
    vigorStats,
    followUpMissing,
    requireFollowUp,
    validate,
    init,
    setFilters,
    resetFilters,
    setSelectedIds,
    createReview,
    updateReview,
    deleteReview,
    refreshCounts,
  }
})
