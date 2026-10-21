<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { dashboardActions } from '../services/dashboard';
import { mergeAttendancePunches } from '../utils/attendanceMerge.mjs';
import { formatDateKL, formatDateDMY } from '../utils/dateUtils.js';

const props = defineProps({
  user: { type: Object, required: true },
  embedded: { type: Boolean, default: false }
});
const emit = defineEmits(['close']);
const dialog = ref(null);
const selectedMonth = ref(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).slice(0, 7));
const loading = ref(false);
const error = ref('');
const attendance = ref([]);
const events = ref([]);
const lockedMonths = ref([]);
let loadSequence = 0;

// Per-row Remark editing state
const rowRemarks = ref({});
const rowSaving = ref({});
const rowSaved = ref({});
const rowError = ref({});
const globalFeedback = ref('');

// Backward-compatible state if modal edit is triggered
const editingRow = ref(null);
const editRemarkText = ref('');
const savingRemark = ref(false);
const remarkError = ref('');
const remarkSuccess = ref('');

const identity = () => String(props.user.employeeNo || props.user.name || '');

function normalizeJoinedDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const dmy = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  const dateOnly = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const parsed = new Date(dateOnly + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateOnly ? dateOnly : '';
  }
  if (!(value instanceof Date) && !/^\d{4}-\d{2}-\d{2}T/.test(raw)) return '';
  const timestamp = value instanceof Date ? value : new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : raw + '+08:00');
  return Number.isFinite(timestamp.getTime()) ? formatDateKL(timestamp) : '';
}

const joinedDate = computed(() => normalizeJoinedDate(props.user.joinedDate || props.user.joined));

const isMonthLocked = computed(() => {
  const m = selectedMonth.value;
  return (lockedMonths.value || []).some(km => km === m || km.startsWith(m + '__'));
});

const rows = computed(() => mergeAttendancePunches({
  imported: attendance.value,
  mobileEvents: events.value,
  joinedDate: joinedDate.value,
  month: selectedMonth.value,
  employeeName: props.user.name || ''
}));

function syncRowRemarks(newRows) {
  if (!Array.isArray(newRows)) return;
  newRows.forEach(r => {
    const key = r.Date || r.date;
    if (key && rowRemarks.value[key] === undefined) {
      rowRemarks.value[key] = r.remark || r.inRemark || '';
    }
  });
}

watch(rows, (newRows) => {
  syncRowRemarks(newRows);
}, { immediate: true });

watch(selectedMonth, () => {
  rowRemarks.value = {};
  rowSaving.value = {};
  rowSaved.value = {};
  rowError.value = {};
  globalFeedback.value = '';
});

async function refresh() {
  const sequence = ++loadSequence;
  const requestedIdentity = identity();
  loading.value = true;
  error.value = '';
  try {
    const result = await dashboardActions.apiPost('mobileClockConfig', {});
    if (sequence !== loadSequence || requestedIdentity !== identity()) return;
    if (result?.status !== 'success' || !result.data) throw Error(result?.message || 'Attendance could not be loaded. Please try again.');
    const data = result.data;
    const expectedName = String(props.user.name || '').trim().toUpperCase();
    if (String(data.employee || '').trim().toUpperCase() !== expectedName ||
        (props.user.employeeNo && String(data.employeeNo) !== String(props.user.employeeNo))) {
      throw Error('Attendance response did not match your account. Please sign in again.');
    }
    attendance.value = (Array.isArray(data.attendance) ? data.attendance : []).filter(row => {
      const name = String(row.name || row.Name || row.employee || '').trim().toUpperCase();
      const employeeNo = String(row.employeeNo || row.id || '').trim();
      if (name && name !== expectedName) return false;
      if (employeeNo && props.user.employeeNo && employeeNo !== String(props.user.employeeNo)) return false;
      return name === expectedName || Boolean(props.user.employeeNo && employeeNo === String(props.user.employeeNo));
    });
    events.value = Array.isArray(data.events) ? data.events : [];
    lockedMonths.value = Array.isArray(data.lockedMonths) ? data.lockedMonths : [];
  } catch (failure) {
    if (sequence !== loadSequence || requestedIdentity !== identity()) return;
    error.value = failure?.message || 'Attendance could not be loaded. Please try again.';
    attendance.value = [];
    events.value = [];
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

async function applyRemark(row) {
  if (isMonthLocked.value) return;
  const date = row.Date || row.date;
  if (!date) return;
  const remarkText = String(rowRemarks.value[date] ?? '').trim();
  rowSaving.value[date] = true;
  rowError.value[date] = '';
  rowSaved.value[date] = false;
  globalFeedback.value = '';

  try {
    const res = await dashboardActions.apiPost('saveStaffAttendanceRemark', {
      date: date,
      remark: remarkText,
      in: row.ClockIn && row.ClockIn !== '—' ? row.ClockIn : '',
      out: row.ClockOut && row.ClockOut !== '—' ? row.ClockOut : '',
      shift: row.shift || ''
    });

    if (res && res.status === 'success') {
      row.remark = remarkText;
      const idx = attendance.value.findIndex(a => (a.Date || a.date) === date);
      if (idx > -1) {
        attendance.value[idx].remark = remarkText;
      } else {
        attendance.value.push({
          Date: date,
          date: date,
          remark: remarkText,
          ClockIn: row.ClockIn,
          ClockOut: row.ClockOut
        });
      }

      // Reflect on overall attendance page in dashboard
      if (typeof dashboardActions.updateStaffAttendanceRemark === 'function') {
        dashboardActions.updateStaffAttendanceRemark(props.user, date, remarkText);
      }

      rowSaved.value[date] = true;
      globalFeedback.value = `Remark for ${formatDateDMY(date)} saved & reflected on overall attendance.`;
      setTimeout(() => {
        rowSaved.value[date] = false;
      }, 3000);
    } else {
      rowError.value[date] = res?.message || 'Could not save remark.';
    }
  } catch (err) {
    rowError.value[date] = err?.message || 'Network error saving remark.';
  } finally {
    rowSaving.value[date] = false;
  }
}

function startEditRemark(row) {
  if (isMonthLocked.value) return;
  editingRow.value = row;
  editRemarkText.value = rowRemarks.value[row.Date || row.date] ?? (row.remark || row.inRemark || '');
  remarkError.value = '';
  remarkSuccess.value = '';
}

function cancelEditRemark() {
  editingRow.value = null;
  editRemarkText.value = '';
  remarkError.value = '';
}

async function saveRemark() {
  if (!editingRow.value) return;
  savingRemark.value = true;
  remarkError.value = '';
  remarkSuccess.value = '';
  try {
    const date = editingRow.value.Date || editingRow.value.date;
    const res = await dashboardActions.apiPost('saveStaffAttendanceRemark', {
      date: date,
      remark: editRemarkText.value,
      in: editingRow.value.ClockIn !== '—' ? editingRow.value.ClockIn : '',
      out: editingRow.value.ClockOut !== '—' ? editingRow.value.ClockOut : '',
      shift: editingRow.value.shift || ''
    });
    if (res && res.status === 'success') {
      const savedText = editRemarkText.value;
      editingRow.value.remark = savedText;
      rowRemarks.value[date] = savedText;
      const idx = attendance.value.findIndex(a => (a.Date || a.date) === date);
      if (idx > -1) {
        attendance.value[idx].remark = savedText;
      } else {
        attendance.value.push({ Date: date, date, remark: savedText, ClockIn: editingRow.value.ClockIn, ClockOut: editingRow.value.ClockOut });
      }

      // Reflect on overall attendance page in dashboard
      if (typeof dashboardActions.updateStaffAttendanceRemark === 'function') {
        dashboardActions.updateStaffAttendanceRemark(props.user, date, savedText);
      }

      remarkSuccess.value = 'Remark saved successfully!';
      setTimeout(() => {
        editingRow.value = null;
        remarkSuccess.value = '';
      }, 700);
    } else {
      remarkError.value = res?.message || 'Could not save remark.';
    }
  } catch (err) {
    remarkError.value = err?.message || 'Network error saving remark.';
  } finally {
    savingRemark.value = false;
  }
}

watch(() => props.user, () => { attendance.value = []; events.value = []; void refresh(); });
onMounted(async () => {
  if (!props.embedded) {
    await nextTick();
    dialog.value?.showModal();
  }
  void refresh();
});
onBeforeUnmount(() => {
  loadSequence++;
  if (!props.embedded) dialog.value?.close();
});
</script>

<template>
  <!-- Embedded Workspace View -->
  <div v-if="embedded" class="personal-attendance-view">
    <div class="main-card p-4 shadow-sm border border-light-subtle rounded-3 mb-4">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-4 pb-3 border-bottom">
        <div>
          <h4 class="fw-bold mb-1 text-dark d-flex align-items-center gap-2">
            <i class="bi bi-clock-history text-primary"></i> My Attendance
          </h4>
          <p class="text-muted small mb-0">{{ user.name }} · Monthly attendance punches, shift times &amp; remarks</p>
        </div>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <div class="d-flex align-items-center gap-2">
            <label class="form-label small fw-bold text-secondary mb-0" for="pa-month-input">Month:</label>
            <input id="pa-month-input" v-model="selectedMonth" type="month" class="form-control form-control-sm" style="width: 160px;" />
          </div>
          <button type="button" class="btn btn-outline-primary btn-sm" :disabled="loading" @click="refresh">
            <i class="bi bi-arrow-clockwise me-1"></i> {{ loading ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
      </div>

      <!-- Month Status Banner -->
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 p-3 mb-3 rounded-3" :class="isMonthLocked ? 'bg-secondary-subtle border border-secondary-subtle' : 'bg-success-subtle border border-success-subtle'">
        <div class="d-flex align-items-center gap-2">
          <i :class="isMonthLocked ? 'bi bi-lock-fill text-secondary fs-5' : 'bi bi-pencil-square text-success fs-5'"></i>
          <div>
            <div class="fw-bold" :class="isMonthLocked ? 'text-secondary' : 'text-success'">
              Status: {{ isMonthLocked ? 'Approved & Locked by HR' : 'Active / Unapproved' }}
            </div>
            <div class="extra-small text-muted">
              {{ isMonthLocked ? 'Attendance for this month has been audited and approved by HR. Records and remarks are finalized.' : 'Attendance for this month is active. You may directly key in remarks and click "Apply" to update the record and reflect on the overall attendance page.' }}
            </div>
          </div>
        </div>
        <span class="badge" :class="isMonthLocked ? 'bg-secondary text-white' : 'bg-success text-white'">
          {{ isMonthLocked ? 'Read-only' : 'Remarks Editable' }}
        </span>
      </div>

      <!-- Global feedback alert if applied -->
      <div v-if="globalFeedback" class="alert alert-success py-2 px-3 small mb-3 d-flex align-items-center gap-2" role="status">
        <i class="bi bi-check-circle-fill"></i>
        <span>{{ globalFeedback }}</span>
      </div>

      <!-- Table Section -->
      <section :aria-busy="loading" aria-live="polite">
        <p v-if="loading" role="status" class="text-muted py-4 text-center">
          <span class="spinner-border spinner-border-sm me-2" role="status"></span> Loading your attendance records…
        </p>
        <div v-else-if="error" class="alert alert-danger" role="alert">
          {{ error }} <button type="button" class="btn btn-sm btn-outline-danger ms-2" @click="refresh">Try again</button>
        </div>
        <p v-else-if="!selectedMonth" class="text-muted py-4 text-center">Select a month to view your attendance.</p>
        <p v-else-if="!rows.length" class="text-muted py-4 text-center">No attendance records found for {{ selectedMonth }}.</p>
        
        <div v-else class="table-responsive">
          <table class="table align-middle table-hover border">
            <thead class="table-light">
              <tr>
                <th scope="col" style="min-width: 110px;">Date</th>
                <th scope="col" style="min-width: 90px;">1st In</th>
                <th scope="col" style="min-width: 90px;">Last Out</th>
                <th scope="col" style="min-width: 110px;">Source</th>
                <th scope="col" style="min-width: 250px;">Staff Remark</th>
                <th scope="col" class="text-end" style="min-width: 110px;" v-if="!isMonthLocked">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.Date">
                <td class="fw-bold text-dark">{{ formatDateDMY(row.Date) }}</td>
                <td>
                  <span v-if="row.ClockIn && row.ClockIn !== '—'" class="badge bg-success-subtle text-success border border-success-subtle fs-6 font-monospace">
                    {{ row.ClockIn }}
                  </span>
                  <span v-else class="text-muted">—</span>
                </td>
                <td>
                  <span v-if="row.ClockOut && row.ClockOut !== '—'" class="badge bg-primary-subtle text-primary border border-primary-subtle fs-6 font-monospace">
                    {{ row.ClockOut }}
                  </span>
                  <span v-else class="text-muted">—</span>
                </td>
                <td>
                  <div class="extra-small text-muted">
                    <span v-if="row.clockInSource" class="d-block">In: {{ row.clockInSource }}</span>
                    <span v-if="row.clockOutSource" class="d-block">Out: {{ row.clockOutSource }}</span>
                    <span v-if="!row.clockInSource && !row.clockOutSource">—</span>
                  </div>
                </td>
                <td>
                  <div v-if="!isMonthLocked" class="d-flex flex-column gap-1">
                    <input 
                      v-model="rowRemarks[row.Date]" 
                      type="text" 
                      class="form-control form-control-sm border-secondary-subtle"
                      placeholder="Key in remark..." 
                      :disabled="rowSaving[row.Date]"
                      @keydown.enter.prevent="applyRemark(row)"
                    />
                    <div v-if="rowError[row.Date]" class="text-danger extra-small">
                      <i class="bi bi-exclamation-circle me-1"></i>{{ rowError[row.Date] }}
                    </div>
                  </div>
                  <div v-else-if="row.remark" class="p-1 px-2 bg-light rounded text-dark small border">
                    <i class="bi bi-chat-left-text me-1 text-primary"></i>{{ row.remark }}
                  </div>
                  <span v-else class="text-muted extra-small italic">No remark added</span>
                </td>
                <td class="text-end" v-if="!isMonthLocked">
                  <button 
                    type="button" 
                    class="btn btn-sm rounded-pill px-3 fw-semibold apply-btn"
                    :class="rowSaved[row.Date] ? 'btn-success text-white' : 'btn-outline-primary'"
                    :disabled="rowSaving[row.Date]"
                    @click="applyRemark(row)"
                  >
                    <span v-if="rowSaving[row.Date]" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    <i v-else-if="rowSaved[row.Date]" class="bi bi-check2 me-1"></i>
                    {{ rowSaving[row.Date] ? 'Saving…' : (rowSaved[row.Date] ? 'Applied' : 'Apply') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>

  <!-- Dialog Modal View (Fallback when opened via event / user modal) -->
  <Teleport to="body" v-else>
    <dialog ref="dialog" class="personal-attendance" aria-labelledby="personal-attendance-title" @cancel.prevent="emit('close')">
      <header class="d-flex align-items-start justify-content-between gap-3 mb-4">
        <div>
          <h2 id="personal-attendance-title" class="h4 mb-1">My Attendance</h2>
          <p class="text-muted mb-0">{{ user.name }} · Recorded attendance history &amp; remarks</p>
        </div>
        <button type="button" class="btn-close" aria-label="Close my attendance" @click="emit('close')"></button>
      </header>
      <div class="d-flex align-items-end justify-content-between gap-3 mb-3 flex-wrap">
        <div class="d-flex align-items-center gap-2">
          <div>
            <label class="form-label small mb-1" for="personal-attendance-month">Month</label>
            <input id="personal-attendance-month" v-model="selectedMonth" type="month" class="form-control form-control-sm" />
          </div>
          <span class="badge ms-2 mt-4" :class="isMonthLocked ? 'bg-secondary' : 'bg-success'">
            {{ isMonthLocked ? 'Locked by HR' : 'Active / Unapproved' }}
          </span>
        </div>
        <button type="button" class="btn btn-outline-primary btn-sm" :disabled="loading" @click="refresh">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>

      <!-- Feedback Banner if applied -->
      <div v-if="globalFeedback" class="alert alert-success py-2 px-3 small mb-3 d-flex align-items-center gap-2" role="status">
        <i class="bi bi-check-circle-fill"></i>
        <span>{{ globalFeedback }}</span>
      </div>

      <section :aria-busy="loading" aria-live="polite">
        <p v-if="loading" role="status" class="text-muted py-4">Loading your attendance…</p>
        <div v-else-if="error" class="alert alert-danger" role="alert">
          {{ error }} <button type="button" class="btn btn-sm btn-outline-danger ms-2" @click="refresh">Try again</button>
        </div>
        <p v-else-if="!selectedMonth" class="text-muted py-4">Select a month to view your attendance.</p>
        <p v-else-if="!rows.length" class="text-muted py-4">No attendance records available for {{ selectedMonth }}.</p>
        <div v-else class="table-responsive">
          <table class="table align-middle">
            <thead>
              <tr>
                <th scope="col" style="min-width: 110px;">Date</th>
                <th scope="col" style="min-width: 90px;">First in</th>
                <th scope="col" style="min-width: 90px;">Last out</th>
                <th scope="col" style="min-width: 240px;">Remark</th>
                <th scope="col" style="min-width: 100px;" v-if="!isMonthLocked">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.Date">
                <th scope="row" class="fw-semibold">{{ formatDateDMY(row.Date) }}</th>
                <td>{{ row.ClockIn }}</td>
                <td>{{ row.ClockOut }}</td>
                <td>
                  <div v-if="!isMonthLocked" class="d-flex flex-column gap-1">
                    <input 
                      v-model="rowRemarks[row.Date]" 
                      type="text" 
                      class="form-control form-control-sm border-secondary-subtle"
                      placeholder="Key in remark..."
                      :disabled="rowSaving[row.Date]"
                      @keydown.enter.prevent="applyRemark(row)"
                    />
                    <div v-if="rowError[row.Date]" class="text-danger extra-small">
                      <i class="bi bi-exclamation-circle me-1"></i>{{ rowError[row.Date] }}
                    </div>
                  </div>
                  <span v-else class="text-muted">{{ row.remark || '—' }}</span>
                </td>
                <td v-if="!isMonthLocked">
                  <button 
                    type="button" 
                    class="btn btn-sm rounded-pill px-3 fw-semibold apply-btn"
                    :class="rowSaved[row.Date] ? 'btn-success text-white' : 'btn-outline-primary'"
                    :disabled="rowSaving[row.Date]"
                    @click="applyRemark(row)"
                  >
                    <span v-if="rowSaving[row.Date]" class="spinner-border spinner-border-sm me-1" role="status"></span>
                    <i v-else-if="rowSaved[row.Date]" class="bi bi-check2 me-1"></i>
                    {{ rowSaving[row.Date] ? 'Saving…' : (rowSaved[row.Date] ? 'Applied' : 'Apply') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Edit Remark in Modal (Fallback) -->
      <div v-if="editingRow" class="card p-3 mt-3 border bg-light">
        <div class="fw-bold small mb-2">Edit Remark for {{ formatDateDMY(editingRow.Date) }}</div>
        <input v-model="editRemarkText" type="text" class="form-control form-control-sm mb-2" placeholder="Enter reason or remark..." />
        <div class="d-flex justify-content-end gap-2">
          <button type="button" class="btn btn-sm btn-secondary" @click="cancelEditRemark">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary" :disabled="savingRemark" @click="saveRemark">Save</button>
        </div>
      </div>
      <p class="small text-muted mb-0 mt-3">Active/unapproved months allow adding remarks directly before HR review. Approved months are locked.</p>
    </dialog>
  </Teleport>
</template>

<style scoped>
.personal-attendance { width: min(920px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow: auto; border: 1px solid #dce2e8; border-radius: 16px; padding: 28px; color: #243447; box-shadow: 0 24px 80px #172b4d33; }
.personal-attendance::backdrop { background: #14233780; }
.personal-attendance caption { caption-side: bottom; font-size: .85rem; }
.extra-small { font-size: 0.75rem; }
.italic { font-style: italic; }
.apply-btn { font-size: 0.8rem; min-width: 78px; transition: all 0.2s ease; }
</style>
