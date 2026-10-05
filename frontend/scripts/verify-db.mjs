/**
 * IndexedDB 集成验证：v2→v3 迁移 + 复评保存联动真实事务
 * 用 esbuild 打包后在 node + fake-indexeddb 下运行。
 */
import 'fake-indexeddb/auto'
import { db, DB_SCHEMA_VERSION, saveReviewWithFollowUp, deleteReviewWithLinkedMeasures } from '../src/utils/db'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('PASS:', msg)
  }
}

async function main() {
  assert(DB_SCHEMA_VERSION === 3, '当前结构版本为 v3')

  // ---- 1. 模拟 v2 老库：直接用 v2 schema 建库灌旧结构数据 ----
  db.close()
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('gbheritagetree')
    req.onsuccess = () => resolve()
    req.onblocked = () => resolve()
  })

  // 用 Dexie 以 v2 结构建旧库
  const { default: Dexie } = await import('dexie')
  const old = new Dexie('gbheritagetree')
  old.version(1).stores({
    trees: 'id, code, species, protectLevel, ageYears, createdAt',
    surveys: 'id, treeId, date',
    measures: 'id, treeId, type, state, date',
    supports: 'id, treeId, type, installDate',
    reviews: 'id, treeId, date, vigor',
  })
  old.version(2).stores({
    trees: 'id, code, species, protectLevel, ageYears, createdAt, updatedAt, owner',
    surveys: 'id, treeId, [treeId+date], date, siteNote',
    measures: 'id, treeId, type, state, date, operator',
    supports: 'id, treeId, type, installDate, lastCheckDate',
    reviews: 'id, treeId, date, vigor, trend',
  })
  await old.open()
  await old.table('trees').put({
    id: 't1', code: '京-01', species: '国槐', protectLevel: '一级', ageYears: 300,
    location: '测试', owner: '测试单位', lastMeasureDate: '',
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', revision: 2,
  })
  await old.table('measures').put({
    id: 'm-old', treeId: 't1', type: '施肥', date: '2025-05-01',
    material: '旧数据', operator: '张三', state: '计划',
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', revision: 2,
  })
  await old.table('reviews').put({
    id: 'r-old', treeId: 't1', date: '2025-06-01', vigor: '衰弱', trend: '下降',
    conclusion: '旧复评', followUp: '旧后续',
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z', revision: 2,
  })
  old.close()

  // ---- 2. 用当前 db（v3）打开，触发升级 ----
  await db.open()
  assert(db.verno === 3, `旧库自动升级到 v3（实际 verno=${db.verno}）`)
  const migratedMeasure = await db.measures.get('m-old')
  assert(migratedMeasure.sourceReviewId === '', '旧措施迁移后 sourceReviewId 补为空串')
  assert(migratedMeasure.revision === 3, '旧措施迁移后 revision=3')
  const migratedReview = await db.reviews.get('r-old')
  assert(migratedReview.followUpType === '' && migratedReview.pendingReason === '',
    '旧复评迁移后 followUpType / pendingReason 补为空串')

  // ---- 3. 保存新复评（衰弱 + 选类型）→ 自动挂待办 ----
  const review = {
    id: 'r-new', treeId: 't1', date: '2026-10-05', vigor: '衰弱', trend: '持平',
    conclusion: '新复评结论', followUp: '安排换土复壮', followUpType: '换土', pendingReason: '',
    createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z', revision: 3,
  }
  const r1 = await saveReviewWithFollowUp(review)
  assert(r1.linkedCreated === true, '保存衰弱复评 → 新建挂账待办')
  const linked = await db.measures.where('sourceReviewId').equals('r-new').toArray()
  assert(linked.length === 1 && linked[0].type === '换土' && linked[0].state === '计划'
    && linked[0].treeId === 't1' && linked[0].date === '2026-10-05',
    '挂账待办与复评同古树 / 同类型 / 同日期，状态计划，sourceReviewId 指回复评')

  // ---- 4. 改类型 → 同步待办 ----
  await saveReviewWithFollowUp({ ...review, followUpType: '透气' })
  const linked2 = await db.measures.where('sourceReviewId').equals('r-new').toArray()
  assert(linked2.length === 1 && linked2[0].type === '透气', '编辑复评改类型 → 待办同步且不重复挂')

  // ---- 5. 完成后再清空类型 → 留痕保留 ----
  await db.measures.update(linked2[0].id, { state: '已完成' })
  await saveReviewWithFollowUp({ ...review, followUpType: '' })
  const linked3 = await db.measures.where('sourceReviewId').equals('r-new').toArray()
  assert(linked3.length === 1 && linked3[0].state === '已完成', '已完成待办清空类型后留痕保留')

  // ---- 6. 未完成待办清空类型 → 撤销 ----
  const r2 = {
    id: 'r2', treeId: 't1', date: '2026-10-06', vigor: '一般', trend: '好转',
    conclusion: '又一次复评', followUp: '', followUpType: '施肥', pendingReason: '',
    createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', revision: 3,
  }
  await saveReviewWithFollowUp(r2)
  assert((await db.measures.where('sourceReviewId').equals('r2').count()) === 1, '第二次复评挂账成功')
  await saveReviewWithFollowUp({ ...r2, followUpType: '' })
  assert((await db.measures.where('sourceReviewId').equals('r2').count()) === 0, '未完成待办清空类型 → 撤销')

  // ---- 7. 删除复评：未完成连带撤销，已完成解除关联 ----
  await deleteReviewWithLinkedMeasures('r-new')
  assert((await db.reviews.get('r-new')) === undefined, '复评已删除')
  const leftover = await db.measures.where('sourceReviewId').equals('r-new').toArray()
  // 已完成的应被解除关联而不是删除
  assert((await db.measures.get(linked3[0].id)) !== undefined
    && leftover.length === 0
    && (await db.measures.get(linked3[0].id)).sourceReviewId === '',
    '删除复评：已完成待办解除关联并保留，未完成待办撤销')

  // ---- 8. 老数据措施（自行登记）未被迁移误伤 ----
  assert((await db.measures.get('m-old')).state === '计划', '原台账自行登记措施不受影响')

  console.log(process.exitCode ? '\n有断言失败' : '\n集成验证全部通过')
  db.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
