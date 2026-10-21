<template>
  <div class="overview-kpi-grid mb-4">
    <div class="row g-3">
      <div 
        v-for="kpi in kpis" 
        :key="kpi.id" 
        class="col-12 col-sm-6 col-md-4 col-lg"
      >
        <div 
          class="kpi-card bg-white border border-light-subtle rounded-3 p-3 h-100 shadow-sm d-flex flex-column justify-content-between position-relative"
          role="button"
          tabindex="0"
          :aria-label="`${kpi.label}: ${formatValue(kpi)} ${kpi.unit}`"
          @click="$emit('drilldown', kpi.drilldown)"
          @keydown.enter="$emit('drilldown', kpi.drilldown)"
          @keydown.space.prevent="$emit('drilldown', kpi.drilldown)"
        >
          <div class="d-flex align-items-center justify-content-between mb-2">
            <span class="text-muted small fw-semibold text-uppercase tracking-wider">{{ kpi.label }}</span>
            <div class="kpi-icon-wrapper rounded-circle d-flex align-items-center justify-content-center">
              <i class="bi fs-5" :class="'bi-' + (kpi.icon || 'speedometer2')"></i>
            </div>
          </div>
          
          <div class="my-1">
            <div class="d-flex align-items-baseline gap-2">
              <span class="kpi-value fw-bold text-dark fs-3">{{ formatValue(kpi) }}</span>
              <span class="kpi-unit text-muted small fw-semibold">{{ kpi.unit }}</span>
            </div>
            <div v-if="kpi.subtitle" class="kpi-subtitle text-muted extra-small mt-1">
              {{ kpi.subtitle }}
            </div>
          </div>

          <div class="kpi-footer d-flex align-items-center justify-content-between mt-2 pt-2 border-top border-light-subtle">
            <span class="extra-small text-primary fw-bold">View details</span>
            <i class="bi bi-chevron-right text-muted extra-small"></i>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  kpis: { type: Array, default: () => [] },
  metrics: { type: Object, default: () => ({}) }
});

defineEmits(['drilldown']);

function formatValue(kpi) {
  const val = kpi.value;
  if (val === null || val === undefined) return '—';
  if (kpi.unit === 'RM') {
    return Number(val).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? val : Number(val.toFixed(2));
  }
  return String(val);
}
</script>

<style scoped>
.kpi-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  cursor: pointer;
}
.kpi-card:hover, .kpi-card:focus {
  transform: translateY(-2px);
  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.08) !important;
  border-color: rgba(var(--bs-primary-rgb), 0.4) !important;
  outline: none;
}
.kpi-icon-wrapper {
  width: 36px;
  height: 36px;
  background-color: rgba(var(--bs-primary-rgb), 0.08);
  color: var(--bs-primary);
}
.extra-small {
  font-size: 0.75rem;
}
.tracking-wider {
  letter-spacing: 0.05em;
}
</style>
