<script setup lang="ts">
/**
 * /trees 古树一树一档
 * 新建档案、按保护级别与树种筛选、回显检查次数与最新长势等级、级联删除。
 * 消费模型：Tree、Review、Survey、Measure、Support；复用组件：<VigorTag>、<FilterBar>、<StatBadge>、<EmptyPanel>
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import FilterBar from '@/components/common/FilterBar.vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import VigorTag from '@/components/common/VigorTag.vue'
import { useTreeStore } from '@/stores/treeStore'
import { staleFollowUps } from '@/utils/followUp'
import {
  PROTECT_LEVEL_OPTIONS,
  TREE_SPECIES_CANDIDATES,
  type ProtectLevel,
  type Tree,
  type TreeDraft,
} from '@/types/tree'

const router = useRouter()
const treeStore = useTreeStore()

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<TreeDraft>({
  code: '',
  species: '国槐',
  protectLevel: '二级',
  ageYears: 120,
  location: '',
  owner: '',
})

const rules: FormRules<TreeDraft> = {
  code: [
    { required: true, message: '请填写古树编号', trigger: 'blur' },
    { max: 32, message: '编号不超过 32 个字符', trigger: 'blur' },
  ],
  species: [{ required: true, message: '请填写树种', trigger: 'blur' }],
  protectLevel: [{ required: true, message: '请选择保护级别', trigger: 'change' }],
  ageYears: [{ required: true, message: '请填写树龄', trigger: 'blur' }],
  location: [{ required: true, message: '请填写位置', trigger: 'blur' }],
  owner: [{ required: true, message: '请填写管护单位', trigger: 'blur' }],
}

const speciesOptions = computed<string[]>(() => {
  const set = new Set<string>([...TREE_SPECIES_CANDIDATES, ...treeStore.speciesOptions])
  return Array.from(set)
})

const rows = computed<Tree[]>(() => treeStore.visibleTrees)

const totals = computed(() => {
  const list = treeStore.trees
  const level1 = list.filter((tree) => tree.protectLevel === '一级').length
  const weak = list.filter((tree) => {
    const vigor = treeStore.statOf(tree.id).latestVigor
    return vigor === '衰弱' || vigor === '濒危'
  }).length
  const overdue = list.reduce((acc, tree) => acc + treeStore.statOf(tree.id).overdueCount, 0)
  const stale = staleFollowUps(treeStore.measures, treeStore.reviews, null)
  return { level1, weak, overdue, staleCount: stale.length }
})

/** 隔了两次复评仍未收掉的挂账待办（全局，档案页单列） */
const staleFollowUpRows = computed(() => staleFollowUps(treeStore.measures, treeStore.reviews, null))

function treeName(treeId: string): string {
  const tree = treeStore.trees.find((item) => item.id === treeId)
  return tree === undefined ? '（古树已删除）' : `${tree.code} ${tree.species}`
}

onMounted(() => {
  void treeStore.loadAll()
})

function openCreate(): void {
  editingId.value = null
  Object.assign(form, {
    code: '',
    species: '国槐',
    protectLevel: '二级' as ProtectLevel,
    ageYears: 120,
    location: '',
    owner: '',
  })
  dialogVisible.value = true
}

function openEdit(row: Tree): void {
  editingId.value = row.id
  Object.assign(form, {
    code: row.code,
    species: row.species,
    protectLevel: row.protectLevel,
    ageYears: row.ageYears,
    location: row.location,
    owner: row.owner,
  })
  dialogVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (formRef.value === undefined) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value === null) {
      const row = await treeStore.createTree({ ...form })
      ElMessage.success(`已建立古树档案「${row.code}」，可继续登记树体检查`)
    } else {
      await treeStore.updateTree(editingId.value, { ...form })
      ElMessage.success('古树档案已更新')
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: Tree): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `将删除「${row.code} ${row.species}」及其全部树体检查、复壮措施、加固件与复评记录，且不可恢复。`,
      '确认删除古树档案？',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  await treeStore.deleteTree(row.id)
  ElMessage.success('古树档案已删除')
}

function goSurveys(row: Tree): void {
  treeStore.selectTree(row.id)
  void router.push(`/trees/${row.id}/surveys`)
}

function handleFilterChange(key: string, value: string): void {
  if (key === 'protectLevel') treeStore.setFilters({ protectLevel: value as ProtectLevel | 'all' })
  if (key === 'species') treeStore.setFilters({ species: value })
}
</script>

<template>
  <div>
    <div class="stat-row">
      <StatBadge label="在档古树" :value="treeStore.trees.length" suffix="株" tone="primary" icon="Histogram" />
      <StatBadge label="一级古树" :value="totals.level1" suffix="株" tone="success" icon="DataLine" />
      <StatBadge label="衰弱/濒危" :value="totals.weak" suffix="株" tone="danger" icon="Warning" hint="最新长势为衰弱或濒危的古树" />
      <StatBadge
        label="跨两次复评未落实"
        :value="totals.staleCount"
        suffix="项"
        :tone="totals.staleCount > 0 ? 'danger' : 'success'"
        icon="AlarmClock"
        hint="挂账待办在源复评之后又隔了两次及以上复评，仍未改成「已完成」"
      />
      <StatBadge label="加固件超期" :value="totals.overdue" suffix="件" tone="warning" icon="Warning" hint="超过检查周期未检查的加固件" />
      <StatBadge label="筛选结果" :value="rows.length" suffix="株" tone="info" icon="PieChart" size="small" />
    </div>

    <el-alert
      v-if="staleFollowUpRows.length > 0"
      type="error"
      show-icon
      :closable="false"
      class="mb-14"
      :title="`有 ${staleFollowUpRows.length} 项复评挂账待办隔了两次复评还没收掉`"
      description="请尽快在复壮措施台账中推进实施；确需延期的，在下次复评时写清未落实原因。"
    />

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span class="card-header__title">古树名木一树一档</span>
          <el-button type="primary" @click="openCreate">
            <el-icon><Plus /></el-icon>
            <span>新建古树档案</span>
          </el-button>
        </div>
      </template>

      <FilterBar
        :keyword="treeStore.filters.keyword"
        :fields="[
          { key: 'protectLevel', label: '保护级别', options: PROTECT_LEVEL_OPTIONS as unknown as string[] },
          { key: 'species', label: '树种', options: speciesOptions },
        ]"
        :values="{ protectLevel: treeStore.filters.protectLevel, species: treeStore.filters.species }"
        :result-text="`命中 ${rows.length} / ${treeStore.trees.length} 株`"
        @update:keyword="(value: string) => treeStore.setFilters({ keyword: value })"
        @change="handleFilterChange"
        @reset="treeStore.resetFilters()"
      />

      <EmptyPanel
        v-if="treeStore.ready && treeStore.trees.length === 0"
        title="还没有古树档案"
        description="先为一株古树建立档案（编号、树种、保护级别、树龄、位置、管护单位），再登记树体检查与复壮措施。"
        action-text="新建第一个古树档案"
        @action="openCreate"
      />

      <el-table
        v-else
        v-loading="!treeStore.ready"
        :data="rows"
        row-key="id"
        stripe
        @row-click="goSurveys"
      >
        <el-table-column label="编号 / 树种" min-width="190">
          <template #default="{ row }">
            <div class="cell-stack">
              <el-link type="primary" @click.stop="goSurveys(row)">{{ row.code }}</el-link>
              <span class="cell-sub">{{ row.species }} · 约 {{ row.ageYears }} 年</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="保护级别" width="110">
          <template #default="{ row }">
            <el-tag :type="row.protectLevel === '一级' ? 'danger' : row.protectLevel === '二级' ? 'warning' : 'info'">
              {{ row.protectLevel }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="位置 / 管护单位" min-width="240">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ row.location }}</span>
              <span class="cell-sub">{{ row.owner }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="检查次数" width="110" align="right">
          <template #default="{ row }">{{ treeStore.statOf(row.id).surveyCount }} 次</template>
        </el-table-column>
        <el-table-column label="最新长势" width="170">
          <template #default="{ row }">
            <VigorTag
              :vigor="treeStore.statOf(row.id).latestVigor"
              :trend="treeStore.statOf(row.id).latestTrend"
            />
          </template>
        </el-table-column>
        <el-table-column label="倾斜度" width="130">
          <template #default="{ row }">
            <span v-if="treeStore.statOf(row.id).latestSurvey === null" class="cell-sub">未检查</span>
            <el-tag
              v-else
              :type="treeStore.statOf(row.id).lean === 'danger' ? 'danger' : treeStore.statOf(row.id).lean === 'watch' ? 'warning' : 'success'"
              size="small"
            >
              {{ treeStore.statOf(row.id).latestSurvey?.leanDeg }}° {{ treeStore.statOf(row.id).leanLabel }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="待办措施" min-width="130" align="right">
          <template #default="{ row }">
            <div class="cell-stack" style="align-items: flex-end">
              <span>{{ treeStore.statOf(row.id).pendingMeasureCount }} 项</span>
              <span
                v-if="treeStore.statOf(row.id).openFollowUpCount > 0"
                class="cell-sub"
              >含复评挂账 {{ treeStore.statOf(row.id).openFollowUpCount }} 项</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="加固件超期" width="120" align="right">
          <template #default="{ row }">
            <span :class="{ 'cell-warn': treeStore.statOf(row.id).overdueCount > 0 }">
              {{ treeStore.statOf(row.id).overdueCount }} 件
            </span>
          </template>
        </el-table-column>
        <el-table-column label="最近复壮" width="130">
          <template #default="{ row }">
            <span v-if="row.lastMeasureDate === ''" class="cell-sub">未登记</span>
            <span v-else>{{ row.lastMeasureDate }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="goSurveys(row)">树体检查</el-button>
            <el-button link type="primary" size="small" @click.stop="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click.stop="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="staleFollowUpRows.length > 0" shadow="never" class="stale-card">
      <template #header>
        <div class="card-header">
          <span class="card-header__title">隔了两次复评仍未收掉的挂账待办</span>
          <el-button type="primary" plain @click="router.push('/measures')">去措施台账处理</el-button>
        </div>
      </template>
      <el-table :data="staleFollowUpRows" row-key="measure.id" stripe>
        <el-table-column label="古树" min-width="180">
          <template #default="{ row }">
            <el-link type="primary" @click="router.push(`/trees/${row.measure.treeId}/surveys`)">
              {{ treeName(row.measure.treeId) }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="挂账措施" width="130">
          <template #default="{ row }">
            <el-tag type="danger" effect="light">{{ row.measure.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源复评" width="170">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ row.review.date }}</span>
              <span class="cell-sub">{{ row.review.vigor }} · {{ row.review.trend }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="已隔复评" width="120" align="center">
          <template #default="{ row }">
            <el-tag type="danger" size="small">{{ row.gap }} 次未收</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="当前状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.measure.state === '实施中' ? 'warning' : 'info'" size="small">
              {{ row.measure.state }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="复评后续措施说明" min-width="240">
          <template #default="{ row }">
            <span>{{ row.review.followUp === '' ? '（未填写）' : row.review.followUp }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId === null ? '新建古树档案' : '编辑古树档案'"
      width="620px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="古树编号" prop="code">
              <el-input v-model="form.code" placeholder="如：京-01-0007" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="树种" prop="species">
              <el-select v-model="form.species" filterable allow-create style="width: 100%">
                <el-option v-for="item in speciesOptions" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="保护级别" prop="protectLevel">
              <el-select v-model="form.protectLevel" style="width: 100%">
                <el-option v-for="item in PROTECT_LEVEL_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="树龄（年）" prop="ageYears">
              <el-input-number v-model="form.ageYears" :min="1" :max="5000" :step="10" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="位置" prop="location">
          <el-input v-model="form.location" placeholder="如：东城区国子监街 18 号院门前" />
        </el-form-item>
        <el-form-item label="管护单位" prop="owner">
          <el-input v-model="form.owner" placeholder="如：东城区园林绿化局" />
        </el-form-item>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="保存后该株古树会成为「当前古树」，可直接进入树体检查页登记检查记录。"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.card-header__title {
  font-size: 15px;
  font-weight: 600;
  color: #2f2a24;
}

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-sub {
  font-size: 12px;
  color: #8c8479;
}

.cell-warn {
  color: #c0392b;
  font-weight: 600;
}

.mb-14 {
  margin-bottom: 14px;
}

.stale-card {
  margin-top: 14px;
  border-color: #e6b8b3;
}
</style>
