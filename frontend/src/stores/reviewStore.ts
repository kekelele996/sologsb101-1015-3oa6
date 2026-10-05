/**
 * 长势复评状态管理（Pinia）
 * 维护长势筛选条件与复评结论派生值；长势为衰弱 / 濒危时强制填写后续措施。
 * 复评保存即在措施台账挂一条同类型待办；该树还有未收挂账待办时，
 * 必须先写清未落实原因才允许再保存复评。
 */
import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Review, ReviewDraft, Trend, Vigor } from '../types/review'
import { VIGOR_NEED_FOLLOW_UP, VIGOR_OPTIONS } from '../types/review'
import {
  createReviewWithFollowUp,
  db,
  initDatabase,
  removeReview,
  updateReviewWithFollowUp,
} from '../utils/db'
import { openFollowUpsOf } from '../utils/followUp'
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

  /** 该株古树尚未收掉的复评挂账待办（编辑复评时排除其自身挂的那条） */
  async function blockingFollowUps(treeId: string, excludeReviewId: string | null): Promise<number> {
    const measures = await db.measures.where('treeId').equals(treeId).toArray()
    return openFollowUpsOf(measures, treeId).filter(
      (row) => excludeReviewId === null || row.sourceReviewId !== excludeReviewId,
    ).length
  }

  /**
   * 校验复评表单：
   * 1. 衰弱 / 濒危必须填写后续措施；
   * 2. 必须挑选挂账措施类型；
   * 3. 该树还有未收掉的挂账待办时，必须写清未落实原因。
   */
  async function validate(
    draft: ReviewDraft,
    excludeReviewId: string | null = null,
  ): Promise<ReviewValidation> {
    if (draft.conclusion.trim() === '') {
      return { ok: false, message: '请填写复评结论。' }
    }
    if (requireFollowUp(draft.vigor) && draft.followUp.trim() === '') {
      return { ok: false, message: `长势为「${draft.vigor}」时必须填写后续措施，否则无法保存。` }
    }
    if (draft.followUpType.trim() === '') {
      return { ok: false, message: '请挑选本次复评的挂账措施类型，保存后会在措施台账挂一条同类型待办。' }
    }
    const blocking = await blockingFollowUps(draft.treeId, excludeReviewId)
    if (blocking > 0 && draft.pendingReason.trim() === '') {
      return {
        ok: false,
        message: `该株古树还有 ${blocking} 条复评挂账待办未收掉，请先写清未落实原因后再保存本次复评。`,
      }
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

  async function createReview(draft: ReviewDraft): Promise<Review | null> {
    const check = await validate(draft)
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
      revision: 3,
    }
    const saved = await createReviewWithFollowUp(row)
    revision.value += 1
    lastMessage.value = `已登记 ${row.date} 长势复评：${row.vigor}（${row.trend}），措施台账已挂「${row.followUpType}」待办`
    return saved
  }

  async function updateReview(reviewId: string, draft: ReviewDraft): Promise<ReviewValidation> {
    const check = await validate(draft, reviewId)
    if (!check.ok) {
      lastMessage.value = check.message
      return check
    }
    const existing = await db.reviews.get(reviewId)
    if (!existing) return { ok: false, message: '复评记录不存在' }
    await updateReviewWithFollowUp({
      ...existing,
      treeId: draft.treeId,
      date: draft.date,
      vigor: draft.vigor,
      trend: draft.trend,
      conclusion: draft.conclusion.trim(),
      followUp: draft.followUp.trim(),
      followUpType: draft.followUpType,
      pendingReason: draft.pendingReason.trim(),
    })
    revision.value += 1
    lastMessage.value = '复评记录已更新，挂账待办已同步'
    return { ok: true, message: '' }
  }

  async function deleteReview(reviewId: string): Promise<void> {
    await removeReview(reviewId)
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
    blockingFollowUps,
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
