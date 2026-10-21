<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { dashboardActions } from '../services/dashboard';
import {
  TEMPLATE_TYPES,
  METRIO_COMPANY_INFO,
  generateReferenceNumber,
  generateIncrementLetter,
  generateConfirmationLetter,
  generateTransferLetter,
  generateMemoLetter,
  generateLetterBody
} from '../services/letterTemplates';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  employees: { type: Array, default: () => [] },
  currentUser: { type: Object, default: () => null },
  companies: { type: Array, default: () => [] }
});

const emit = defineEmits(['update:modelValue', 'saved', 'issued']);

const api = dashboardActions.apiPost;

// State
const templateType = ref('Increment');
const selectedEmployee = ref('');
const issueDate = ref(new Date().toISOString().slice(0, 10));
const refNo = ref('');
const customRefEdited = ref(false);
const seqCounter = ref(1);
const saving = ref(false);
const error = ref('');
const successMsg = ref('');

// Signatory
const signatoryName = ref('Puan Nurul Huda binti Ahmad');
const signatoryRole = ref('Head of People & Culture');

// Increment fields
const currentSalary = ref(4000);
const newSalary = ref(4600);
const incrementAmount = ref(600);
const incrementPercentage = ref(15.0);
const effectiveDate = ref(new Date().toISOString().slice(0, 10));

// Confirmation fields
const confirmationDate = ref(new Date().toISOString().slice(0, 10));
const confirmationJobTitle = ref('Senior Executive');
const salaryAdjustment = ref('');
const confirmedNewSalary = ref(null);

// Transfer fields
const fromDeptRole = ref('Operations / Executive');
const toDeptRole = ref('Project Management / Senior Executive');
const reportingManager = ref('Head of Department');
const transferEffectiveDate = ref(new Date().toISOString().slice(0, 10));

// Memo fields
const memoSubject = ref('Official Notice to All Personnel');
const memoBody = ref('Please be informed that company operations and scheduling for the upcoming quarter will proceed as outlined in the attached operational plan. All department heads are requested to ensure team compliance.');
const memoSignOff = ref('Human Resources Department');

// Auto-generate reference number when template changes if not manually overridden
function refreshRefNo() {
  const yr = new Date(issueDate.value || Date.now()).getFullYear();
  refNo.value = generateReferenceNumber(templateType.value, yr, seqCounter.value);
}

watch(templateType, () => {
  if (!customRefEdited.value) {
    refreshRefNo();
  }
});

watch(issueDate, () => {
  if (!customRefEdited.value) {
    refreshRefNo();
  }
});

// Employee selection handler to prefill fields
function onEmployeeSelect() {
  const emp = props.employees.find(e => e.name === selectedEmployee.value);
  if (!emp) return;

  if (emp.basic) {
    currentSalary.value = Number(emp.basic);
    newSalary.value = Math.round(Number(emp.basic) * 1.1);
    updateIncrementFromNewSalary();
  }
  if (emp.jobTitle) {
    confirmationJobTitle.value = emp.jobTitle;
    fromDeptRole.value = `${emp.departmentId || 'Operations'} / ${emp.jobTitle}`;
  }
  if (emp.manager) {
    reportingManager.value = emp.manager;
  }
}

// Increment auto-calculations
function updateIncrementFromNewSalary() {
  const cur = Number(currentSalary.value) || 0;
  const nw = Number(newSalary.value) || 0;
  const inc = nw - cur;
  incrementAmount.value = inc > 0 ? inc : 0;
  incrementPercentage.value = cur > 0 ? Number(((inc / cur) * 100).toFixed(1)) : 0;
}

function updateIncrementFromAmount() {
  const cur = Number(currentSalary.value) || 0;
  const inc = Number(incrementAmount.value) || 0;
  newSalary.value = cur + inc;
  incrementPercentage.value = cur > 0 ? Number(((inc / cur) * 100).toFixed(1)) : 0;
}

function updateIncrementFromPercentage() {
  const cur = Number(currentSalary.value) || 0;
  const pct = Number(incrementPercentage.value) || 0;
  const inc = Math.round(cur * (pct / 100));
  incrementAmount.value = inc;
  newSalary.value = cur + inc;
}

// Letter subject
const letterSubject = computed(() => {
  switch (templateType.value) {
    case 'Increment':
      return 'LETTER OF SALARY INCREMENT';
    case 'Confirmation':
      return `CONFIRMATION OF EMPLOYMENT AS ${(confirmationJobTitle.value || 'EMPLOYEE').toUpperCase()}`;
    case 'Transfer':
      return 'INTERNAL TRANSFER AND RE-DESIGNATION';
    case 'Memo':
      return (memoSubject.value || 'INTERNAL MEMORANDUM').toUpperCase();
    default:
      return 'OFFICIAL HR CORRESPONDENCE';
  }
});

// Letter body formatted
const letterBody = computed(() => {
  const emp = props.employees.find(e => e.name === selectedEmployee.value) || {};
  const empName = selectedEmployee.value || '[Employee Name]';

  switch (templateType.value) {
    case 'Increment':
      return generateIncrementLetter({
        employeeName: empName,
        employeeNo: emp.employeeNo || '',
        currentSalary: currentSalary.value,
        newSalary: newSalary.value,
        incrementAmount: incrementAmount.value,
        percentage: incrementPercentage.value,
        effectiveDate: effectiveDate.value,
        jobTitle: emp.jobTitle || 'Staff',
        department: emp.departmentId || 'General'
      });
    case 'Confirmation':
      return generateConfirmationLetter({
        employeeName: empName,
        employeeNo: emp.employeeNo || '',
        jobTitle: confirmationJobTitle.value,
        department: emp.departmentId || 'General',
        confirmationDate: confirmationDate.value,
        salaryAdjustment: salaryAdjustment.value,
        newSalary: confirmedNewSalary.value
      });
    case 'Transfer':
      return generateTransferLetter({
        employeeName: empName,
        employeeNo: emp.employeeNo || '',
        fromDepartment: fromDeptRole.value.split('/')[0]?.trim() || 'Operations',
        fromRole: fromDeptRole.value.split('/')[1]?.trim() || 'Executive',
        toDepartment: toDeptRole.value.split('/')[0]?.trim() || 'Project Management',
        toRole: toDeptRole.value.split('/')[1]?.trim() || 'Senior Executive',
        reportingManager: reportingManager.value,
        effectiveDate: transferEffectiveDate.value
      });
    case 'Memo':
      return generateMemoLetter({
        employeeName: empName,
        subject: memoSubject.value,
        memoBody: memoBody.value,
        signOff: memoSignOff.value
      });
    default:
      return '';
  }
});

// Selected employee details
const currentEmp = computed(() => {
  return props.employees.find(e => e.name === selectedEmployee.value) || {};
});

// Print action
function handlePrint() {
  window.print();
}

// Save action (status: 'Issued' | 'Draft')
async function handleSave(status = 'Draft') {
  if (!selectedEmployee.value && templateType.value !== 'Memo') {
    error.value = 'Please select an employee.';
    return;
  }

  saving.value = true;
  error.value = '';
  successMsg.value = '';

  try {
    const recordPayload = {
      employee: selectedEmployee.value || 'ALL STAFF',
      category: templateType.value,
      title: letterSubject.value,
      date: issueDate.value,
      refNo: refNo.value,
      notes: letterBody.value,
      status: status
    };

    const res = await api('hrSave', {
      module: 'letters',
      record: recordPayload
    });

    if (res.status !== 'success') {
      throw new Error(res.message || 'Failed to save letter');
    }

    successMsg.value = status === 'Issued' ? 'Letter issued successfully!' : 'Letter saved as Draft.';
    seqCounter.value++;

    if (status === 'Issued') {
      emit('issued', res.data);
    }
    emit('saved', res.data);

    setTimeout(() => {
      closeModal();
    }, 1000);
  } catch (err) {
    error.value = err.message || 'Error saving letter';
  } finally {
    saving.value = false;
  }
}

function closeModal() {
  emit('update:modelValue', false);
  error.value = '';
  successMsg.value = '';
}

onMounted(() => {
  refreshRefNo();
  if (props.currentUser?.name) {
    signatoryName.value = props.currentUser.name;
    if (props.currentUser.role === 'Admin' || props.currentUser.role === 'HR') {
      signatoryRole.value = 'Human Resources Department';
    }
  }
});
</script>

<template>
  <div v-if="modelValue" class="letter-modal-root" role="dialog" aria-modal="true" tabindex="-1">
    <div class="letter-modal-backdrop" @click="closeModal"></div>

    <div class="letter-modal-dialog">
      <div class="letter-modal-content">
        <!-- Modal Header -->
        <div class="letter-modal-header no-print">
          <div>
            <h4 class="mb-0">
              <i class="bi bi-file-earmark-text text-warning me-2"></i>Corporate HR Correspondence Letterhead Generator
            </h4>
            <small class="text-muted">Draft, preview, print, and issue official Metrio Group correspondence letters</small>
          </div>
          <button type="button" class="btn-close" aria-label="Close" :disabled="saving" @click="closeModal"></button>
        </div>

        <!-- Modal Body (Two-Column Layout) -->
        <div class="letter-modal-body">
          <div v-if="error" class="alert alert-danger mb-3 no-print" role="alert">{{ error }}</div>
          <div v-if="successMsg" class="alert alert-success mb-3 no-print" role="status">{{ successMsg }}</div>

          <div class="row g-4">
            <!-- Left Column: Form Controls (Hidden in print) -->
            <div class="col-lg-5 letterhead-form-panel no-print">
              <div class="card p-3 shadow-sm border-0 bg-light">
                <h6 class="border-bottom pb-2 mb-3 text-primary">
                  <i class="bi bi-sliders me-1"></i> Letter Configuration
                </h6>

                <!-- Template Selector -->
                <div class="mb-3">
                  <label class="form-label fw-bold">Template Type</label>
                  <div class="btn-group w-100" role="group">
                    <button
                      v-for="t in TEMPLATE_TYPES"
                      :key="t"
                      type="button"
                      class="btn btn-sm"
                      :class="templateType === t ? 'btn-primary' : 'btn-outline-secondary'"
                      @click="templateType = t"
                    >
                      {{ t }}
                    </button>
                  </div>
                </div>

                <!-- Employee Selector -->
                <div class="mb-3">
                  <label class="form-label fw-bold" for="letterEmployeeSelect">Select Employee *</label>
                  <select
                    id="letterEmployeeSelect"
                    v-model="selectedEmployee"
                    class="form-select form-select-sm"
                    @change="onEmployeeSelect"
                  >
                    <option value="">-- Choose Employee --</option>
                    <option v-for="emp in employees" :key="emp.name" :value="emp.name">
                      {{ emp.name }} {{ emp.jobTitle ? '(' + emp.jobTitle + ')' : '' }}
                    </option>
                  </select>
                </div>

                <!-- Reference Number & Issue Date -->
                <div class="row g-2 mb-3">
                  <div class="col-7">
                    <label class="form-label fw-bold small" for="letterRefInput">Reference Code</label>
                    <div class="input-group input-group-sm">
                      <input
                        id="letterRefInput"
                        v-model="refNo"
                        class="form-control"
                        placeholder="HR/TEMPLATE/YEAR/SEQ"
                        @input="customRefEdited = true"
                      />
                      <button class="btn btn-outline-secondary" type="button" title="Regenerate code" @click="refreshRefNo">
                        <i class="bi bi-arrow-clockwise"></i>
                      </button>
                    </div>
                  </div>
                  <div class="col-5">
                    <label class="form-label fw-bold small" for="letterDateInput">Issue Date</label>
                    <input id="letterDateInput" v-model="issueDate" type="date" class="form-control form-control-sm" />
                  </div>
                </div>

                <!-- Template-Specific Fields: Increment -->
                <div v-if="templateType === 'Increment'" class="border p-2 rounded mb-3 bg-white">
                  <span class="badge bg-secondary mb-2">Increment Parameters</span>
                  <div class="row g-2 mb-2">
                    <div class="col-6">
                      <label class="form-label small" for="curSalaryInput">Current Basic (RM)</label>
                      <input
                        id="curSalaryInput"
                        v-model.number="currentSalary"
                        type="number"
                        min="0"
                        step="50"
                        class="form-control form-control-sm"
                        @input="updateIncrementFromNewSalary"
                      />
                    </div>
                    <div class="col-6">
                      <label class="form-label small" for="newSalaryInput">New Basic (RM)</label>
                      <input
                        id="newSalaryInput"
                        v-model.number="newSalary"
                        type="number"
                        min="0"
                        step="50"
                        class="form-control form-control-sm"
                        @input="updateIncrementFromNewSalary"
                      />
                    </div>
                  </div>
                  <div class="row g-2 mb-2">
                    <div class="col-6">
                      <label class="form-label small" for="incAmountInput">Increment Amount (RM)</label>
                      <input
                        id="incAmountInput"
                        v-model.number="incrementAmount"
                        type="number"
                        min="0"
                        step="10"
                        class="form-control form-control-sm"
                        @input="updateIncrementFromAmount"
                      />
                    </div>
                    <div class="col-6">
                      <label class="form-label small" for="incPctInput">Percentage (%)</label>
                      <input
                        id="incPctInput"
                        v-model.number="incrementPercentage"
                        type="number"
                        step="0.1"
                        class="form-control form-control-sm"
                        @input="updateIncrementFromPercentage"
                      />
                    </div>
                  </div>
                  <div>
                    <label class="form-label small" for="incEffectiveDate">Effective Date</label>
                    <input id="incEffectiveDate" v-model="effectiveDate" type="date" class="form-control form-control-sm" />
                  </div>
                </div>

                <!-- Template-Specific Fields: Confirmation -->
                <div v-else-if="templateType === 'Confirmation'" class="border p-2 rounded mb-3 bg-white">
                  <span class="badge bg-secondary mb-2">Confirmation Parameters</span>
                  <div class="mb-2">
                    <label class="form-label small" for="confJobTitle">Confirmed Designation</label>
                    <input id="confJobTitle" v-model="confirmationJobTitle" type="text" class="form-control form-control-sm" />
                  </div>
                  <div class="row g-2 mb-2">
                    <div class="col-6">
                      <label class="form-label small" for="confDate">Confirmation Date</label>
                      <input id="confDate" v-model="confirmationDate" type="date" class="form-control form-control-sm" />
                    </div>
                    <div class="col-6">
                      <label class="form-label small" for="confNewSalary">Salary Adjustment (RM)</label>
                      <input
                        id="confNewSalary"
                        v-model="confirmedNewSalary"
                        type="number"
                        min="0"
                        step="50"
                        placeholder="Optional"
                        class="form-control form-control-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label class="form-label small" for="confRemarks">Salary Adjustment Notes</label>
                    <input
                      id="confRemarks"
                      v-model="salaryAdjustment"
                      type="text"
                      placeholder="e.g. Adjusted to RM 4,500.00"
                      class="form-control form-control-sm"
                    />
                  </div>
                </div>

                <!-- Template-Specific Fields: Transfer -->
                <div v-else-if="templateType === 'Transfer'" class="border p-2 rounded mb-3 bg-white">
                  <span class="badge bg-secondary mb-2">Transfer Parameters</span>
                  <div class="mb-2">
                    <label class="form-label small" for="trfFrom">From Department / Role</label>
                    <input id="trfFrom" v-model="fromDeptRole" type="text" class="form-control form-control-sm" />
                  </div>
                  <div class="mb-2">
                    <label class="form-label small" for="trfTo">To Department / Role</label>
                    <input id="trfTo" v-model="toDeptRole" type="text" class="form-control form-control-sm" />
                  </div>
                  <div class="row g-2">
                    <div class="col-6">
                      <label class="form-label small" for="trfMgr">Reporting Manager</label>
                      <input id="trfMgr" v-model="reportingManager" type="text" class="form-control form-control-sm" />
                    </div>
                    <div class="col-6">
                      <label class="form-label small" for="trfDate">Effective Date</label>
                      <input id="trfDate" v-model="transferEffectiveDate" type="date" class="form-control form-control-sm" />
                    </div>
                  </div>
                </div>

                <!-- Template-Specific Fields: Memo -->
                <div v-else-if="templateType === 'Memo'" class="border p-2 rounded mb-3 bg-white">
                  <span class="badge bg-secondary mb-2">Memorandum Content</span>
                  <div class="mb-2">
                    <label class="form-label small" for="memoSubj">Memo Subject</label>
                    <input id="memoSubj" v-model="memoSubject" type="text" class="form-control form-control-sm" />
                  </div>
                  <div class="mb-2">
                    <label class="form-label small" for="memoText">Body Content</label>
                    <textarea id="memoText" v-model="memoBody" rows="4" class="form-control form-control-sm"></textarea>
                  </div>
                  <div>
                    <label class="form-label small" for="memoSign">Sign-off / Dept</label>
                    <input id="memoSign" v-model="memoSignOff" type="text" class="form-control form-control-sm" />
                  </div>
                </div>

                <!-- Signatory Details -->
                <div class="border-top pt-2">
                  <h6 class="small fw-bold text-muted mb-2">Corporate Signatory</h6>
                  <div class="row g-2">
                    <div class="col-6">
                      <label class="form-label small mb-1" for="sigName">Signatory Name</label>
                      <input id="sigName" v-model="signatoryName" type="text" class="form-control form-control-sm" />
                    </div>
                    <div class="col-6">
                      <label class="form-label small mb-1" for="sigRole">Signatory Title</label>
                      <input id="sigRole" v-model="signatoryRole" type="text" class="form-control form-control-sm" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Right Column: Real-time Letterhead Preview (Printed in print mode) -->
            <div class="col-lg-7">
              <div class="letterhead-preview-wrapper">
                <!-- PRINT CONTAINER WITH CLASS .letterhead-print -->
                <div class="letterhead-print">
                  <!-- Metrio Corporate Header -->
                  <div class="lh-header">
                    <div class="d-flex justify-content-between align-items-center">
                      <div>
                        <div class="lh-company-title">{{ METRIO_COMPANY_INFO.name }}</div>
                        <div class="lh-company-sub">{{ METRIO_COMPANY_INFO.tagline }}</div>
                        <div class="lh-company-sub">{{ METRIO_COMPANY_INFO.registration }}</div>
                      </div>
                      <div class="text-end text-muted small" style="font-size: 8.5pt;">
                        <div>{{ METRIO_COMPANY_INFO.address }}</div>
                        <div>Tel: {{ METRIO_COMPANY_INFO.phone }} | Fax: {{ METRIO_COMPANY_INFO.fax }}</div>
                        <div>Email: {{ METRIO_COMPANY_INFO.email }} | {{ METRIO_COMPANY_INFO.website }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- Metadata Row (Ref No & Date) -->
                  <div class="lh-meta-row">
                    <div>
                      <strong>Ref: </strong><span>{{ refNo }}</span>
                    </div>
                    <div>
                      <strong>Date: </strong><span>{{ issueDate }}</span>
                    </div>
                  </div>

                  <!-- Recipient Block -->
                  <div class="lh-recipient">
                    <div><strong>{{ selectedEmployee || '[EMPLOYEE NAME]' }}</strong></div>
                    <div v-if="currentEmp.employeeNo">Employee ID: {{ currentEmp.employeeNo }}</div>
                    <div v-if="currentEmp.icNo">NRIC / Passport: {{ currentEmp.icNo }}</div>
                    <div v-if="currentEmp.departmentId">Department: {{ currentEmp.departmentId }}</div>
                    <div v-if="currentEmp.address">{{ currentEmp.address }}</div>
                  </div>

                  <!-- Letter Subject -->
                  <div class="lh-subject">
                    {{ letterSubject }}
                  </div>

                  <!-- Body Text -->
                  <div class="lh-body">
                    {{ letterBody }}
                  </div>

                  <!-- Signature Block -->
                  <div class="lh-signature-block">
                    <div>Yours faithfully,</div>
                    <div class="fw-bold mt-1 mb-4">{{ METRIO_COMPANY_INFO.name }}</div>
                    <div style="height: 45px; border-bottom: 1px dotted #999; width: 220px; margin-bottom: 6px;"></div>
                    <div class="fw-bold">{{ signatoryName }}</div>
                    <div class="text-muted" style="font-size: 9.5pt;">{{ signatoryRole }}</div>
                  </div>

                  <!-- Employee Acknowledgement Block (Increment / Confirmation / Transfer) -->
                  <div v-if="['Increment', 'Confirmation', 'Transfer'].includes(templateType)" class="lh-ack-block">
                    <div class="fw-bold mb-1">EMPLOYEE ACKNOWLEDGEMENT &amp; ACCEPTANCE</div>
                    <p class="mb-2" style="font-size: 9pt;">
                      I, <strong>{{ selectedEmployee || '_________________________' }}</strong>
                      <span v-if="currentEmp.icNo"> (NRIC: {{ currentEmp.icNo }})</span>,
                      hereby confirm receipt, understand, and agree to the terms set forth in this correspondence.
                    </p>
                    <div class="d-flex justify-content-between mt-3 pt-2" style="font-size: 9pt;">
                      <div style="width: 45%;">
                        <div style="border-top: 1px solid #000; padding-top: 4px;">Employee Signature</div>
                      </div>
                      <div style="width: 45%;">
                        <div style="border-top: 1px solid #000; padding-top: 4px;">Date</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Modal Footer Actions (Hidden in print) -->
        <div class="letter-modal-actions no-print d-flex justify-content-between align-items-center p-3 border-top bg-light">
          <div>
            <span class="text-muted small">
              <i class="bi bi-info-circle me-1"></i> "Save &amp; Issue" persists to <code>HR_letters</code> with status <strong>Issued</strong> and makes it visible in the staff dossier.
            </span>
          </div>
          <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary" type="button" :disabled="saving" @click="closeModal">
              Cancel
            </button>
            <button class="btn btn-outline-info" type="button" :disabled="saving" @click="handlePrint">
              <i class="bi bi-printer me-1"></i> Print / Export PDF
            </button>
            <button class="btn btn-outline-primary" type="button" :disabled="saving" @click="handleSave('Draft')">
              <i class="bi bi-save me-1"></i> Save as Draft
            </button>
            <button class="btn btn-success" type="button" :disabled="saving" @click="handleSave('Issued')">
              <i class="bi bi-check2-circle me-1"></i> Save &amp; Issue Letter
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.letter-modal-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1060;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.letter-modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}

.letter-modal-dialog {
  position: relative;
  z-index: 1061;
  width: 95vw;
  max-width: 1350px;
  max-height: 94vh;
  display: flex;
  flex-direction: column;
}

.letter-modal-content {
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 94vh;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}

.letter-modal-header {
  padding: 16px 24px;
  border-bottom: 1px solid #dee2e6;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8f9fa;
}

.letter-modal-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

.letterhead-form-panel {
  max-height: 75vh;
  overflow-y: auto;
}
</style>
