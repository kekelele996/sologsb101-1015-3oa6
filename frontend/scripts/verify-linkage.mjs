/* 联动规则快速验证（纯逻辑，不启动浏览器） */
import {
  isOpenLinkedMeasure,
  openLinkedMeasures,
  measuresOfReview,
  laterReviewCount,
  overdueLinkedMeasures,
  latestPendingReason,
} from '../src/utils/followUp'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('PASS:', msg)
  }
}

// ---- 种子数据（精简复刻 seed.ts 的 treeC 场景）----
const treeC = 'tree-c'
const measures = [
  { id: 'm-c1', treeId: treeC, type: '树洞修补', state: '已完成', sourceReviewId: 'r-c1' },
  { id: 'm-c3', treeId: treeC, type: '换土', state: '实施中', sourceReviewId: 'r-c2' },
  { id: 'm-c4', treeId: treeC, type: '透气', state: '计划', sourceReviewId: 'r-c3' },
  { id: 'm-c5', treeId: treeC, type: '树洞修补', state: '计划', sourceReviewId: 'r-c4' },
  { id: 'm-manual', treeId: treeC, type: '施肥', state: '计划', sourceReviewId: '' },
]
const reviews = [
  { id: 'r-c1', treeId: treeC, date: '2024-08-28', pendingReason: '' },
  { id: 'r-c2', treeId: treeC, date: '2025-09-05', pendingReason: '' },
  { id: 'r-c3', treeId: treeC, date: '2026-07-20', pendingReason: '原因A' },
  { id: 'r-c4', treeId: treeC, date: '2026-09-12', pendingReason: '原因B' },
]

assert(openLinkedMeasures(treeC, measures).map((m) => m.id).join(',') === 'm-c3,m-c4,m-c5',
  '开放挂账待办 = 计划/实施中且 sourceReviewId 非空（已完成与自行登记排除）')
assert(measuresOfReview('r-c1', measures)[0].id === 'm-c1', 'measuresOfReview 能找回来源复评的待办')
assert(isOpenLinkedMeasure(measures[0]) === false, '已完成的挂账不算开放待办（待办已收掉）')

assert(laterReviewCount(measures[1], reviews) === 2, 'm-c3 之后隔了 r-c3、r-c4 共 2 次复评')
assert(laterReviewCount(measures[2], reviews) === 1, 'm-c4 之后隔了 1 次复评')
assert(laterReviewCount(measures[3], reviews) === 0, 'm-c5 是最新复评挂出，隔 0 次')

const overdue = overdueLinkedMeasures(treeC, measures, reviews)
assert(overdue.length === 1 && overdue[0].measure.id === 'm-c3', '跨两次复评未收清单只含 m-c3')
assert(overdueLinkedMeasures(undefined, measures, reviews).length === 1, '不限古树时跨树汇总一致')

assert(latestPendingReason(treeC, measures, reviews) === '原因B', '未落实原因取最近一次复评（r-c4）')

// 完成 m-c3 后应立即从两份清单消失
const measures2 = measures.map((m) => (m.id === 'm-c3' ? { ...m, state: '已完成' } : m))
assert(openLinkedMeasures(treeC, measures2).find((m) => m.id === 'm-c3') === undefined,
  '措施标记已完成 → 待办收掉')
assert(overdueLinkedMeasures(treeC, measures2, reviews).length === 0, '收掉后跨两次清单清空')

// 退回实施中 → 又挂起
const measures3 = measures2.map((m) => (m.id === 'm-c3' ? { ...m, state: '实施中' } : m))
assert(overdueLinkedMeasures(treeC, measures3, reviews).length === 1, '退回实施中 → 重新挂起且仍跨两次')

// ---- 模拟保存复评时的挂账联动算法（复刻 saveReviewWithFollowUp 核心分支）----
function simulateSave(state, review) {
  const linked = state.measures.filter((m) => m.sourceReviewId === review.id)
  const pending = linked.filter((m) => m.state !== '已完成')
  let created = false
  if (review.followUpType === '') {
    state.measures = state.measures.filter((m) => !pending.some((p) => p.id === m.id))
  } else if (pending.length > 0) {
    state.measures = state.measures.map((m) =>
      pending.some((p) => p.id === m.id)
        ? { ...m, treeId: review.treeId, type: review.followUpType, date: review.date }
        : m,
    )
  } else if (linked.length === 0) {
    state.measures.push({
      id: 'm-new', treeId: review.treeId, type: review.followUpType,
      date: review.date, state: '计划', sourceReviewId: review.id,
    })
    created = true
  }
  return created
}

const s1 = { measures: [] }
assert(simulateSave(s1, { id: 'r1', treeId: 't1', date: '2026-10-01', followUpType: '换土' }) === true
  && s1.measures[0].state === '计划' && s1.measures[0].type === '换土'
  && s1.measures[0].sourceReviewId === 'r1', '新复评选类型 → 挂同类型计划待办并指向该复评')

assert(simulateSave(s1, { id: 'r1', treeId: 't1', date: '2026-10-02', followUpType: '施肥' }) === false
  && s1.measures[0].type === '施肥' && s1.measures[0].date === '2026-10-02',
  '编辑复评改类型/日期 → 同步既有待办，不重复挂')

assert(simulateSave(s1, { id: 'r1', treeId: 't1', date: '2026-10-02', followUpType: '' }) === false
  && s1.measures.length === 0, '清空类型且待办未完成 → 撤销待办')

// 已完成的待办：清空类型/删除来源都保留留痕
const s2 = { measures: [{ id: 'done', treeId: 't1', type: '换土', state: '已完成', sourceReviewId: 'r1', date: '2026-01-01' }] }
simulateSave(s2, { id: 'r1', treeId: 't1', date: '2026-10-02', followUpType: '' })
assert(s2.measures.length === 1 && s2.measures[0].sourceReviewId === 'r1', '已完成待办清空类型时保留留痕')
simulateSave(s2, { id: 'r1', treeId: 't1', type: '换土', followUpType: '施肥', date: '2026-10-02' })
assert(s2.measures[0].type === '换土', '已完成待办不被类型同步覆盖')

console.log(process.exitCode ? '\n有断言失败' : '\n全部断言通过')
