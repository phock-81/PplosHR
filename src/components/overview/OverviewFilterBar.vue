<template>
  <div class="overview-filter-bar bg-white border border-light-subtle rounded-3 p-3 mb-4 shadow-sm">
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-3">
      <!-- Title & Role Badge -->
      <div class="d-flex align-items-center gap-2">
        <span class="badge px-3 py-2 fs-6 rounded-pill" :class="roleBadgeClass">
          <i class="bi me-1" :class="roleIcon"></i>{{ roleBadgeLabel }}
        </span>
        <div class="text-muted small border-start ps-2 d-none d-md-block">
          MYT As-of: <span class="fw-semibold text-dark">{{ todayMyt }}</span>
        </div>
      </div>

      <!-- Filter Controls -->
      <div class="d-flex flex-wrap align-items-center gap-2 flex-grow-1 justify-content-end">
        <!-- Company Selector (HR & Admin only) -->
        <div v-if="['HR', 'Admin'].includes(normalizedRole)" class="filter-group">
          <label class="form-label visually-hidden">Company</label>
          <select 
            v-model="modelCompany" 
            class="form-select form-select-sm fw-semibold shadow-none"
            @change="onCompanyChange"
          >
            <option value="all">All Companies</option>
            <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.title || c.name || c.code }}</option>
          </select>
        </div>

        <!-- Department Selector (HR & Admin only) -->
        <div v-if="['HR', 'Admin'].includes(normalizedRole)" class="filter-group">
          <label class="form-label visually-hidden">Department</label>
          <select 
            v-model="modelDepartment" 
            class="form-select form-select-sm fw-semibold shadow-none"
          >
            <option value="all">All Departments</option>
            <option v-for="d in availableDepartments" :key="d.id" :value="d.id">{{ d.title || d.name || d.code }}</option>
          </select>
        </div>

        <!-- Period Selector (All Roles) -->
        <div class="filter-group">
          <label class="form-label visually-hidden">Period</label>
          <select v-model="modelPeriod" class="form-select form-select-sm fw-semibold shadow-none">
            <option value="today">Today</option>
            <option value="thisMonth">This Month</option>
            <option value="lastMonth">Last Month</option>
            <option value="ytd">Year to Date (YTD)</option>
          </select>
        </div>

        <!-- Reset Button -->
        <button 
          class="btn btn-outline-secondary btn-sm fw-semibold shadow-sm"
          type="button"
          title="Reset Filters"
          @click="resetFilters"
        >
          <i class="bi bi-arrow-counterclockwise me-1"></i>Reset
        </button>

        <!-- Refresh Button -->
        <button 
          class="btn btn-outline-primary btn-sm fw-bold shadow-sm"
          type="button"
          :disabled="refreshing"
          @click="$emit('refresh')"
        >
          <span v-if="refreshing" class="spinner-border spinner-border-sm me-1"></span>
          <i v-else class="bi bi-arrow-clockwise me-1"></i>
          Refresh
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { getMytToday, normalizeRole } from './OverviewMetricService';

const props = defineProps({
  role: { type: String, default: 'User' },
  companies: { type: Array, default: () => [] },
  departments: { type: Array, default: () => [] },
  selectedCompany: { type: String, default: 'all' },
  selectedDepartment: { type: String, default: 'all' },
  selectedPeriod: { type: String, default: 'thisMonth' },
  refreshing: { type: Boolean, default: false }
});

const emit = defineEmits([
  'update:selectedCompany',
  'update:selectedDepartment',
  'update:selectedPeriod',
  'refresh',
  'reset'
]);

const todayMyt = computed(() => getMytToday());
const normalizedRole = computed(() => normalizeRole(props.role));

const roleBadgeLabel = computed(() => {
  if (normalizedRole.value === 'Admin') return 'Enterprise Superadmin';
  if (normalizedRole.value === 'HR') return 'People Operations';
  if (normalizedRole.value === 'HOD') return 'Team Manager';
  return 'Employee Self-Service';
});

const roleBadgeClass = computed(() => {
  if (normalizedRole.value === 'Admin') return 'bg-dark text-white';
  if (normalizedRole.value === 'HR') return 'bg-primary text-white';
  if (normalizedRole.value === 'HOD') return 'bg-success text-white';
  return 'bg-secondary-subtle text-secondary-emphasis border';
});

const roleIcon = computed(() => {
  if (normalizedRole.value === 'Admin') return 'bi-shield-check';
  if (normalizedRole.value === 'HR') return 'bi-people-fill';
  if (normalizedRole.value === 'HOD') return 'bi-diagram-3-fill';
  return 'bi-person-badge';
});

const modelCompany = computed({
  get: () => props.selectedCompany,
  set: (val) => emit('update:selectedCompany', val)
});

const modelDepartment = computed({
  get: () => props.selectedDepartment,
  set: (val) => emit('update:selectedDepartment', val)
});

const modelPeriod = computed({
  get: () => props.selectedPeriod,
  set: (val) => emit('update:selectedPeriod', val)
});

const availableDepartments = computed(() => {
  if (!props.departments) return [];
  if (props.selectedCompany && props.selectedCompany !== 'all') {
    return props.departments.filter(d => String(d.companyId) === String(props.selectedCompany));
  }
  return props.departments;
});

function onCompanyChange() {
  if (props.selectedDepartment !== 'all') {
    const valid = availableDepartments.value.some(d => String(d.id) === String(props.selectedDepartment));
    if (!valid) emit('update:selectedDepartment', 'all');
  }
}

function resetFilters() {
  emit('update:selectedCompany', 'all');
  emit('update:selectedDepartment', 'all');
  emit('update:selectedPeriod', 'thisMonth');
  emit('reset');
}
</script>

<style scoped>
.filter-group {
  min-width: 150px;
}
@media (max-width: 768px) {
  .filter-group {
    min-width: 100%;
  }
}
</style>
