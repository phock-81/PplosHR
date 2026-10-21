<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { dashboardActions } from '../services/dashboard';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  companies: {
    type: Array,
    default: () => []
  },
  canEdit: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['update:modelValue', 'committed', 'saved']);

const currentYear = new Date().getFullYear();
const fromYear = ref(currentYear);
const toYear = ref(currentYear + 1);
const companyFilter = ref('');

const loading = ref(false);
const committing = ref(false);
const confirming = ref(false);
const error = ref('');
const success = ref('');

const previewList = ref([]);
const previewLoaded = ref(false);

const companyList = computed(() => props.companies || []);

watch(fromYear, (newVal) => {
  const y = Number(newVal);
  if (!isNaN(y)) {
    toYear.value = y + 1;
  }
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      error.value = '';
      success.value = '';
      confirming.value = false;
      loadPreview();
    }
  },
  { immediate: true }
);

function close() {
  if (committing.value) return;
  emit('update:modelValue', false);
}

function trapDialog(event) {
  if (event.key !== 'Tab') return;
  const items = [...event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

async function loadPreview() {
  loading.value = true;
  error.value = '';
  success.value = '';
  confirming.value = false;
  try {
    const res = await dashboardActions.apiPost('previewYearEndClose', {
      companyId: companyFilter.value,
      fromYear: Number(fromYear.value),
      toYear: Number(toYear.value)
    });
    if (res.status === 'success') {
      previewList.value = Array.isArray(res.data) ? res.data : (res.data?.preview || res.preview || []);
      previewLoaded.value = true;
    } else {
      error.value = res.message || 'Failed to load year-end preview.';
    }
  } catch (err) {
    error.value = err.message || 'An error occurred while loading preview.';
  } finally {
    loading.value = false;
  }
}

function initiateCommit() {
  if (!previewList.value.length) return;
  confirming.value = true;
}

function cancelCommit() {
  confirming.value = false;
}

async function executeCommit() {
  committing.value = true;
  error.value = '';
  success.value = '';
  try {
    const res = await dashboardActions.apiPost('executeYearEndClose', {
      companyId: companyFilter.value,
      fromYear: Number(fromYear.value),
      toYear: Number(toYear.value),
      records: previewList.value
    });
    if (res.status === 'success') {
      const count = res.data?.committedCount ?? previewList.value.length;
      success.value = `Successfully committed year-end rollover for ${count} employee(s) into leave year ${toYear.value}.`;
      confirming.value = false;
      emit('committed', res.data);
      emit('saved', res.data);
    } else {
      error.value = res.message || 'Failed to commit rollover.';
    }
  } catch (err) {
    error.value = err.message || 'An error occurred while committing rollover.';
  } finally {
    committing.value = false;
  }
}

const totalEmployees = computed(() => previewList.value.length);
const totalUnutilized = computed(() =>
  previewList.value.reduce((acc, r) => acc + (Number(r.unutilized ?? r.unutilizedAL) || 0), 0)
);
const totalStandardCF = computed(() =>
  previewList.value.reduce((acc, r) => acc + (Number(r.standardCarryForward) || 0), 0)
);
const totalExcessCF = computed(() =>
  previewList.value.reduce((acc, r) => acc + (Number(r.excessCarryForward) || 0), 0)
);
const totalNewOpening = computed(() =>
  previewList.value.reduce((acc, r) => acc + (Number(r.totalOpeningBalance) || 0), 0)
);
</script>

<template>
  <div
    v-if="modelValue"
    id="yearEndModal"
    class="hr-dialog-backdrop"
    @keydown.tab="trapDialog"
    @keydown.esc="!committing && close()"
  >
    <div
      class="hr-dialog year-end-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="yearEndDialogTitle"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="hr-dialog-head">
        <div>
          <h4 id="yearEndDialogTitle" class="d-flex align-items-center gap-2 mb-1">
            <i class="bi bi-calendar2-range text-primary"></i>
            Interactive Year-End Leave Rollover Tool
          </h4>
          <p class="text-muted small mb-0">
            Preview and commit Annual Leave carry forward and tenure entitlements for the new leave year.
          </p>
        </div>
        <button
          type="button"
          class="btn-close"
          aria-label="Close"
          :disabled="committing"
          @click="close"
        />
      </div>

      <!-- Body -->
      <div class="hr-dialog-body">
        <!-- Feedback Alerts -->
        <div v-if="error" role="alert" class="alert alert-danger py-2 mb-3">
          <i class="bi bi-exclamation-triangle-fill me-2"></i>{{ error }}
        </div>
        <div v-if="success" role="status" class="alert alert-success py-2 mb-3">
          <i class="bi bi-check-circle-fill me-2"></i>{{ success }}
        </div>

        <!-- Governing Policy Badge & Citation -->
        <div class="policy-citation-box mb-3">
          <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
            <span class="badge governing-policy-badge">
              <i class="bi bi-shield-check me-1"></i>
              Metrio Induction Policy FAM-23/G (Carry Forward Rules) & Employment Act 1955 Sec 60E
            </span>
          </div>
          <p class="text-muted small mb-0">
            <strong>Dual-Window Carry Forward:</strong> Standard carry forward (up to 14 days) remains valid until <strong>31-Dec</strong> of the following year. Excess carry forward above 14 days is valid only through <strong>30-April</strong>, after which unutilized excess is forfeited. New entitlement scales by completed service years (12–26 days).
          </p>
        </div>

        <!-- Filter Controls -->
        <div class="card p-3 mb-3 bg-light border">
          <div class="row g-3 align-items-end">
            <div class="col-md-4">
              <label class="form-label small fw-bold" for="filterCompany">Company Filter</label>
              <select
                id="filterCompany"
                v-model="companyFilter"
                class="form-select form-select-sm"
                :disabled="loading || committing"
              >
                <option value="">All Companies</option>
                <option v-for="c in companyList" :key="c.id" :value="c.id">
                  {{ c.name || c.title || c.code || c.id }}
                </option>
              </select>
            </div>
            <div class="col-md-3">
              <label class="form-label small fw-bold" for="fromYearInput">From Year</label>
              <input
                id="fromYearInput"
                v-model.number="fromYear"
                class="form-control form-control-sm"
                type="number"
                min="2000"
                max="2100"
                :disabled="loading || committing"
              />
            </div>
            <div class="col-md-3">
              <label class="form-label small fw-bold" for="toYearInput">To Year</label>
              <input
                id="toYearInput"
                v-model.number="toYear"
                class="form-control form-control-sm"
                type="number"
                min="2000"
                max="2100"
                :disabled="loading || committing"
              />
            </div>
            <div class="col-md-2 d-grid">
              <button
                type="button"
                class="btn btn-outline-primary btn-sm"
                :disabled="loading || committing"
                @click="loadPreview"
              >
                <span v-if="loading" class="spinner-border spinner-border-sm me-1" role="status"></span>
                <i v-else class="bi bi-arrow-repeat me-1"></i>
                Preview
              </button>
            </div>
          </div>
        </div>

        <!-- Confirmation State Banner -->
        <div v-if="confirming" class="alert alert-warning py-3 mb-3 border-warning">
          <h6 class="alert-heading fw-bold mb-1">
            <i class="bi bi-question-circle-fill me-1"></i>
            Confirm Year-End Leave Rollover?
          </h6>
          <p class="small mb-2">
            You are about to commit official opening balance records for <strong>{{ previewList.length }} employee(s)</strong> into leave year <strong>{{ toYear }}</strong>.
            This action will be permanently recorded in <code>HR_leaveOpeningBalances</code> and logged in <code>HR_audit</code>.
          </p>
          <div class="d-flex gap-2">
            <button
              type="button"
              class="btn btn-danger btn-sm"
              :disabled="committing"
              @click="executeCommit"
            >
              <span v-if="committing" class="spinner-border spinner-border-sm me-1" role="status"></span>
              <i v-else class="bi bi-check-circle me-1"></i>
              Yes, Commit Year-End Rollover
            </button>
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm"
              :disabled="committing"
              @click="cancelCommit"
            >
              Cancel
            </button>
          </div>
        </div>

        <!-- Summary Metrics -->
        <div v-if="previewLoaded && previewList.length" class="row g-2 mb-3 text-center">
          <div class="col-6 col-md-3">
            <div class="p-2 border rounded bg-white">
              <div class="text-muted small">Active Staff</div>
              <strong class="fs-6">{{ totalEmployees }}</strong>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="p-2 border rounded bg-white">
              <div class="text-muted small">Standard CF (Exp 31-Dec)</div>
              <strong class="fs-6 text-primary">{{ totalStandardCF.toFixed(1) }} d</strong>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="p-2 border rounded bg-white">
              <div class="text-muted small">Excess CF (Exp 30-Apr)</div>
              <strong class="fs-6 text-warning">{{ totalExcessCF.toFixed(1) }} d</strong>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="p-2 border rounded bg-white">
              <div class="text-muted small">Total New Opening</div>
              <strong class="fs-6 text-success">{{ totalNewOpening.toFixed(1) }} d</strong>
            </div>
          </div>
        </div>

        <!-- Interactive Preview Table -->
        <div class="table-responsive border rounded bg-white" style="max-height: 380px;">
          <table class="table table-hover table-sm align-middle mb-0">
            <thead class="table-light sticky-top">
              <tr>
                <th scope="col">Employee Name</th>
                <th scope="col" class="text-end">Unutilized AL</th>
                <th scope="col" class="text-end">
                  Standard CF
                  <small class="d-block text-muted fw-normal">exp 31-Dec (max 14d)</small>
                </th>
                <th scope="col" class="text-end">
                  Excess CF
                  <small class="d-block text-muted fw-normal">exp 30-Apr</small>
                </th>
                <th scope="col" class="text-end">
                  New Entitlement
                  <small class="d-block text-muted fw-normal">service scale 12-26d</small>
                </th>
                <th scope="col" class="text-end">
                  Total Opening
                  <small class="d-block text-muted fw-normal">{{ toYear }} Balance</small>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading">
                <td colspan="6" class="text-center py-4 text-muted">
                  <span class="spinner-border spinner-border-sm me-2" role="status"></span>
                  Calculating rollover balances...
                </td>
              </tr>
              <tr v-else-if="!previewList.length">
                <td colspan="6" class="text-center py-4 text-muted">
                  <i class="bi bi-inbox fs-3 d-block mb-1"></i>
                  No active employees found matching the selected filter.
                </td>
              </tr>
              <tr v-for="r in previewList" :key="r.employee || r.employeeName">
                <td>
                  <strong>{{ r.employee || r.employeeName }}</strong>
                  <span v-if="r.serviceYears != null" class="badge bg-light text-dark ms-1 small">
                    {{ r.serviceYears }}y svc
                  </span>
                </td>
                <td class="text-end">
                  {{ Number(r.unutilized ?? r.unutilizedAL).toFixed(2) }}
                </td>
                <td class="text-end text-primary fw-semibold">
                  {{ Number(r.standardCarryForward).toFixed(2) }}
                </td>
                <td class="text-end" :class="Number(r.excessCarryForward) > 0 ? 'text-warning fw-bold' : 'text-muted'">
                  {{ Number(r.excessCarryForward).toFixed(2) }}
                </td>
                <td class="text-end">
                  {{ Number(r.newEntitlement).toFixed(2) }}
                </td>
                <td class="text-end text-success fw-bold">
                  {{ Number(r.totalOpeningBalance).toFixed(2) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Footer -->
      <div class="hr-dialog-footer d-flex justify-content-between align-items-center">
        <div>
          <small class="text-muted">
            Year-End Rollover: {{ fromYear }} &rarr; {{ toYear }}
          </small>
        </div>
        <div class="d-flex gap-2">
          <button
            type="button"
            class="btn btn-outline-secondary"
            :disabled="committing"
            @click="close"
          >
            Close
          </button>
          <button
            v-if="canEdit"
            type="button"
            class="btn btn-success"
            :disabled="loading || committing || confirming || !previewList.length"
            @click="initiateCommit"
          >
            <i class="bi bi-check2-all me-1"></i>
            Commit Year-End Rollover
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.year-end-modal {
  width: 900px;
  max-width: 95vw;
}

.policy-citation-box {
  background: #f8fafc;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--line, #e2e8f0);
}

.governing-policy-badge {
  background: #eef4ff;
  color: #1e40af;
  border: 1px solid #bfdbfe;
  font-weight: 600;
  font-size: 0.8rem;
  padding: 5px 10px;
  border-radius: 6px;
  white-space: normal;
  text-align: left;
}
</style>
