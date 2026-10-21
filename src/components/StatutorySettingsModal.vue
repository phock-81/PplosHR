<script setup>
import { ref, watch, onMounted, nextTick } from 'vue';
import { dashboardActions } from '../services/dashboard';
import { DEFAULT_STATUTORY_CONFIG, TP1_RELIEF_CAPS } from '../services/statutory';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  canEdit: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['update:modelValue', 'saved']);

const activeTab = ref('statutory');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const success = ref('');

const form = ref({
  socsoCeiling: 6000,
  eisCeiling: 6000,
  epfEmployeeStandardRate: 0.11,
  epfEmployerLowWageRate: 0.13,
  epfEmployerHighWageRate: 0.12,
  epfEmployerSeniorRate: 0.04,
  pcbIndividualReliefMonthly: 750,
  pcbEpfMaxMonthlyDeduction: 333.33,
  pcbRebateMaxAnnualIncome: 35000,
  pcbRebateAmount: 400,
  tp1Caps: {
    parent_medical: 8000,
    serious_diseases_medical: 10000,
    lifestyle_general: 2500,
    lifestyle_sports: 1000,
    childcare_fees: 3000,
    sspn_savings: 8000,
    life_insurance: 3000,
    epf_voluntary: 4000,
    prs_annuity: 3000,
    education_medical_insurance: 3000,
    ev_charging: 2500,
    socso_relief: 350
  },
  overtimeCeilings: {
    general: 4000,
    site: 7000
  },
  inductionBenefits: {
    mileageCar: 0.50,
    mileageMotorcycle: 0.20,
    zeroMcAward: 300,
    wellnessByGrade: {
      S: 1500,
      M: 1000,
      E: 600,
      C: 600,
      W: 600
    },
    checkupByGrade: {
      S: 800,
      M: 500,
      E: 0,
      C: 0,
      W: 0
    },
    outstationMeals: {
      S: 'Actual expense with receipt',
      M: 70,
      E: 50,
      C: 'Not listed',
      W: 'Not listed'
    }
  }
});

const regulations = [
  {
    act: 'Employees Provident Fund Act 1991 (Act 452)',
    category: 'EPF',
    description: 'Governs mandatory retirement savings contributions for Malaysian private sector employees and employers.'
  },
  {
    act: "Employees' Social Security Act 1969 (Act 4)",
    category: 'SOCSO',
    description: 'Employment Injury & Invalidity Scheme with statutory RM 6,000 monthly wage ceiling.'
  },
  {
    act: 'Employment Insurance System Act 2017 (Act 800)',
    category: 'EIS',
    description: 'Job loss protection benefits capped at RM 6,000 ceiling, exempting workers aged 60 and above.'
  },
  {
    act: 'Income Tax Act 1967 (Form TP1 & PCB)',
    category: 'LHDN',
    description: 'Monthly tax deductions (Potongan Cukai Bulanan) and statutory tax relief deduction caps.'
  },
  {
    act: 'Employment Act 1955 (Section 60A Overtime)',
    category: 'EA 1955',
    description: 'Mandatory overtime calculation rates and salary threshold ceilings for general and site staff.'
  },
  {
    act: 'Metrio Induction Policy (FAM-23/G Jul 2025)',
    category: 'Metrio',
    description: 'Company-specific welfare policies: grade-based flexi-wellness, check-up, mileage, and Zero-MC awards.'
  }
];

async function loadSettings() {
  loading.value = true;
  error.value = '';
  try {
    const res = await dashboardActions.apiPost('getStatutorySettings', {});
    if (res.status === 'success' && res.data) {
      form.value = {
        ...form.value,
        ...res.data,
        tp1Caps: { ...form.value.tp1Caps, ...(res.data.tp1Caps || {}) },
        overtimeCeilings: { ...form.value.overtimeCeilings, ...(res.data.overtimeCeilings || {}) },
        inductionBenefits: {
          ...form.value.inductionBenefits,
          ...(res.data.inductionBenefits || {}),
          wellnessByGrade: { ...form.value.inductionBenefits.wellnessByGrade, ...(res.data.inductionBenefits?.wellnessByGrade || {}) },
          checkupByGrade: { ...form.value.inductionBenefits.checkupByGrade, ...(res.data.inductionBenefits?.checkupByGrade || {}) },
          outstationMeals: { ...form.value.inductionBenefits.outstationMeals, ...(res.data.inductionBenefits?.outstationMeals || {}) }
        }
      };
    }
  } catch (err) {
    error.value = err.message || 'Failed to load statutory settings.';
  } finally {
    loading.value = false;
  }
}

function resetDefaults() {
  if (!confirm('Reset all values to official statutory and policy defaults? Any unsaved edits will be discarded.')) return;
  form.value.socsoCeiling = DEFAULT_STATUTORY_CONFIG.socsoCeiling;
  form.value.eisCeiling = DEFAULT_STATUTORY_CONFIG.eisCeiling;
  form.value.epfEmployeeStandardRate = DEFAULT_STATUTORY_CONFIG.epfEmployeeStandardRate;
  form.value.epfEmployerLowWageRate = DEFAULT_STATUTORY_CONFIG.epfEmployerLowWageRate;
  form.value.epfEmployerHighWageRate = DEFAULT_STATUTORY_CONFIG.epfEmployerHighWageRate;
  form.value.epfEmployerSeniorRate = DEFAULT_STATUTORY_CONFIG.epfEmployerSeniorRate;
  form.value.pcbIndividualReliefMonthly = DEFAULT_STATUTORY_CONFIG.pcbIndividualReliefMonthly;
  form.value.pcbEpfMaxMonthlyDeduction = DEFAULT_STATUTORY_CONFIG.pcbEpfMaxMonthlyDeduction;
  form.value.pcbRebateMaxAnnualIncome = DEFAULT_STATUTORY_CONFIG.pcbRebateMaxAnnualIncome;
  form.value.pcbRebateAmount = DEFAULT_STATUTORY_CONFIG.pcbRebateAmount;

  form.value.tp1Caps = { ...TP1_RELIEF_CAPS };
  form.value.overtimeCeilings = { general: 4000, site: 7000 };
  form.value.inductionBenefits = {
    mileageCar: 0.50,
    mileageMotorcycle: 0.20,
    zeroMcAward: 300,
    wellnessByGrade: { S: 1500, M: 1000, E: 600, C: 600, W: 600 },
    checkupByGrade: { S: 800, M: 500, E: 0, C: 0, W: 0 },
    outstationMeals: { S: 'Actual expense with receipt', M: 70, E: 50, C: 'Not listed', W: 'Not listed' }
  };
  success.value = 'Defaults restored. Click Save Settings to persist changes.';
}

async function saveSettings() {
  if (!props.canEdit) return;
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    const res = await dashboardActions.apiPost('saveStatutorySettings', form.value);
    if (res.status === 'success') {
      success.value = 'Statutory and policy settings saved successfully!';
      emit('saved', res.data);
      setTimeout(() => {
        close();
      }, 1200);
    } else {
      error.value = res.message || 'Failed to save settings.';
    }
  } catch (err) {
    error.value = err.message || 'An error occurred while saving settings.';
  } finally {
    saving.value = false;
  }
}

function close() {
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

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    error.value = '';
    success.value = '';
    loadSettings();
    nextTick(() => {
      document.querySelector('#statutorySettingsModal input, #statutorySettingsModal button')?.focus();
    });
  }
});

onMounted(() => {
  if (props.modelValue) {
    loadSettings();
  }
});
</script>

<template>
  <div
    v-if="modelValue"
    id="statutorySettingsModal"
    class="hr-dialog-backdrop"
    @keydown.tab="trapDialog"
    @keydown.esc="!saving && close()"
  >
    <div
      class="hr-dialog statutory-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="statutoryDialogTitle"
      tabindex="-1"
    >
      <form @submit.prevent="saveSettings">
        <!-- Header -->
        <div class="hr-dialog-head">
          <div>
            <h4 id="statutoryDialogTitle" class="d-flex align-items-center gap-2">
              <i class="bi bi-shield-check text-primary"></i>
              Statutory & Policy Settings Center
            </h4>
            <p class="text-muted small mb-0">
              Manage official regulatory parameters, contribution rates, and corporate induction benefits without code deployment.
            </p>
          </div>
          <button
            type="button"
            class="btn-close"
            aria-label="Close"
            :disabled="saving"
            @click="close"
          />
        </div>

        <!-- Body -->
        <div class="hr-dialog-body">
          <div v-if="error" role="alert" class="alert alert-danger py-2">
            <i class="bi bi-exclamation-triangle-fill me-2"></i>{{ error }}
          </div>
          <div v-if="success" role="status" class="alert alert-success py-2">
            <i class="bi bi-check-circle-fill me-2"></i>{{ success }}
          </div>

          <!-- Governing Regulatory Badges Section -->
          <div class="regulatory-section mb-3">
            <h6 class="text-uppercase fw-bold text-muted small mb-2">
              <i class="bi bi-bank2 me-1"></i> Governing Legal & Policy Citations
            </h6>
            <div class="d-flex flex-wrap gap-2">
              <span
                v-for="badge in regulations"
                :key="badge.act"
                class="badge statutory-badge"
                :title="badge.description"
              >
                <i class="bi bi-bookmark-check-fill me-1"></i>
                {{ badge.act }}
              </span>
            </div>
          </div>

          <!-- Navigation Tabs -->
          <ul class="nav nav-pills mb-3 border-bottom pb-2">
            <li class="nav-item">
              <button
                type="button"
                class="nav-link py-1 px-3"
                :class="{ active: activeTab === 'statutory' }"
                @click="activeTab = 'statutory'"
              >
                <i class="bi bi-sliders me-1"></i> Statutory Rates & Ceilings
              </button>
            </li>
            <li class="nav-item">
              <button
                type="button"
                class="nav-link py-1 px-3"
                :class="{ active: activeTab === 'tax' }"
                @click="activeTab = 'tax'"
              >
                <i class="bi bi-receipt me-1"></i> Form TP1 Relief Caps
              </button>
            </li>
            <li class="nav-item">
              <button
                type="button"
                class="nav-link py-1 px-3"
                :class="{ active: activeTab === 'policy' }"
                @click="activeTab = 'policy'"
              >
                <i class="bi bi-briefcase me-1"></i> Overtime & Induction Benefits
              </button>
            </li>
          </ul>

          <div v-if="loading" class="text-center py-4 text-muted">
            <div class="spinner-border spinner-border-sm me-2" role="status"></div>
            Loading statutory configuration...
          </div>

          <!-- Tab 1: Statutory Rates & Ceilings -->
          <div v-else-if="activeTab === 'statutory'">
            <div class="alert alert-light border small py-2 mb-3">
              <strong>Mandated Ceilings:</strong> Applicable under Employees Provident Fund Act 1991 (Act 452), Employees' Social Security Act 1969 (Act 4), and Employment Insurance System Act 2017 (Act 800).
            </div>
            <div class="hr-form-grid">
              <div>
                <label class="form-label" for="hr-socsoCeiling">SOCSO Monthly Wage Ceiling (RM) *</label>
                <input
                  id="hr-socsoCeiling"
                  v-model.number="form.socsoCeiling"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Act 4 Third Schedule (Default: RM 6,000)</small>
              </div>

              <div>
                <label class="form-label" for="hr-eisCeiling">EIS Monthly Wage Ceiling (RM) *</label>
                <input
                  id="hr-eisCeiling"
                  v-model.number="form.eisCeiling"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Act 800 Second Schedule (Default: RM 6,000)</small>
              </div>

              <div>
                <label class="form-label" for="hr-epfEmployeeStandardRate">EPF Employee Rate (Standard) *</label>
                <input
                  id="hr-epfEmployeeStandardRate"
                  v-model.number="form.epfEmployeeStandardRate"
                  class="form-control"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: 0.11 (11% contribution)</small>
              </div>

              <div>
                <label class="form-label" for="hr-epfEmployerLowWageRate">EPF Employer Rate (&le; RM 5,000) *</label>
                <input
                  id="hr-epfEmployerLowWageRate"
                  v-model.number="form.epfEmployerLowWageRate"
                  class="form-control"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: 0.13 (13% contribution)</small>
              </div>

              <div>
                <label class="form-label" for="hr-epfEmployerHighWageRate">EPF Employer Rate (&gt; RM 5,000) *</label>
                <input
                  id="hr-epfEmployerHighWageRate"
                  v-model.number="form.epfEmployerHighWageRate"
                  class="form-control"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: 0.12 (12% contribution)</small>
              </div>

              <div>
                <label class="form-label" for="hr-epfEmployerSeniorRate">EPF Employer Rate (Age &ge; 60) *</label>
                <input
                  id="hr-epfEmployerSeniorRate"
                  v-model.number="form.epfEmployerSeniorRate"
                  class="form-control"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: 0.04 (4% contribution, EE is 0%)</small>
              </div>

              <div>
                <label class="form-label" for="hr-pcbIndividualReliefMonthly">PCB Individual Relief (Monthly RM) *</label>
                <input
                  id="hr-pcbIndividualReliefMonthly"
                  v-model.number="form.pcbIndividualReliefMonthly"
                  class="form-control"
                  type="number"
                  min="0"
                  step="1"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">RM 9,000 annual / 12 months = RM 750</small>
              </div>

              <div>
                <label class="form-label" for="hr-pcbEpfMaxMonthlyDeduction">PCB Max EPF Monthly Deduction (RM) *</label>
                <input
                  id="hr-pcbEpfMaxMonthlyDeduction"
                  v-model.number="form.pcbEpfMaxMonthlyDeduction"
                  class="form-control"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">RM 4,000 annual / 12 months = RM 333.33</small>
              </div>
            </div>
          </div>

          <!-- Tab 2: Form TP1 Relief Caps -->
          <div v-else-if="activeTab === 'tax'">
            <div class="alert alert-light border small py-2 mb-3">
              <strong>LHDN Form TP1:</strong> Individual employee personal deduction limits under the Income Tax Act 1967.
            </div>
            <div class="hr-form-grid">
              <div>
                <label class="form-label" for="hr-lifestyle_sports">Sports Equipment & Activities (RM) *</label>
                <input
                  id="hr-lifestyle_sports"
                  v-model.number="form.tp1Caps.lifestyle_sports"
                  class="form-control"
                  type="number"
                  min="0"
                  step="50"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 1,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-lifestyle_general">Lifestyle General (Books/Devices) (RM) *</label>
                <input
                  id="hr-lifestyle_general"
                  v-model.number="form.tp1Caps.lifestyle_general"
                  class="form-control"
                  type="number"
                  min="0"
                  step="50"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 2,500</small>
              </div>

              <div>
                <label class="form-label" for="hr-parent_medical">Medical Care for Parents (RM) *</label>
                <input
                  id="hr-parent_medical"
                  v-model.number="form.tp1Caps.parent_medical"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 8,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-serious_diseases_medical">Serious Diseases Medical (RM) *</label>
                <input
                  id="hr-serious_diseases_medical"
                  v-model.number="form.tp1Caps.serious_diseases_medical"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 10,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-childcare_fees">Childcare Centre Fees (RM) *</label>
                <input
                  id="hr-childcare_fees"
                  v-model.number="form.tp1Caps.childcare_fees"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 3,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-sspn_savings">SSPN Net Savings (RM) *</label>
                <input
                  id="hr-sspn_savings"
                  v-model.number="form.tp1Caps.sspn_savings"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 8,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-life_insurance">Life Insurance & Takaful (RM) *</label>
                <input
                  id="hr-life_insurance"
                  v-model.number="form.tp1Caps.life_insurance"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 3,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-epf_voluntary">EPF Voluntary Contribution (RM) *</label>
                <input
                  id="hr-epf_voluntary"
                  v-model.number="form.tp1Caps.epf_voluntary"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 4,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-prs_annuity">PRS / Deferred Annuity (RM) *</label>
                <input
                  id="hr-prs_annuity"
                  v-model.number="form.tp1Caps.prs_annuity"
                  class="form-control"
                  type="number"
                  min="0"
                  step="100"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 3,000</small>
              </div>

              <div>
                <label class="form-label" for="hr-socso_relief">SOCSO / EIS Relief (RM) *</label>
                <input
                  id="hr-socso_relief"
                  v-model.number="form.tp1Caps.socso_relief"
                  class="form-control"
                  type="number"
                  min="0"
                  step="10"
                  required
                  :disabled="!canEdit || saving"
                />
                <small class="text-muted">Default: RM 350</small>
              </div>
            </div>
          </div>

          <!-- Tab 3: Overtime & Induction Benefits -->
          <div v-else-if="activeTab === 'policy'">
            <!-- Overtime Ceilings -->
            <div class="mb-4">
              <h6 class="fw-bold border-bottom pb-2">
                <i class="bi bi-clock-history me-1 text-primary"></i>
                Overtime Salary Ceilings (Employment Act 1955 Section 60A)
              </h6>
              <div class="hr-form-grid">
                <div>
                  <label class="form-label" for="hr-otGeneral">General Staff OT Salary Ceiling (RM) *</label>
                  <input
                    id="hr-otGeneral"
                    v-model.number="form.overtimeCeilings.general"
                    class="form-control"
                    type="number"
                    min="0"
                    step="100"
                    required
                    :disabled="!canEdit || saving"
                  />
                  <small class="text-muted">Statutory threshold: RM 4,000</small>
                </div>
                <div>
                  <label class="form-label" for="hr-otSite">Site Operations OT Salary Ceiling (RM) *</label>
                  <input
                    id="hr-otSite"
                    v-model.number="form.overtimeCeilings.site"
                    class="form-control"
                    type="number"
                    min="0"
                    step="100"
                    required
                    :disabled="!canEdit || saving"
                  />
                  <small class="text-muted">Site Operations allowance threshold: RM 7,000</small>
                </div>
              </div>
            </div>

            <!-- Induction Policy Allowances -->
            <div class="mb-4">
              <h6 class="fw-bold border-bottom pb-2">
                <i class="bi bi-award me-1 text-primary"></i>
                Metrio Induction Policy (FAM-23/G Jul 2025)
              </h6>
              <div class="hr-form-grid">
                <div>
                  <label class="form-label" for="hr-mileageCar">Mileage Rate - Personal Car (RM/km) *</label>
                  <input
                    id="hr-mileageCar"
                    v-model.number="form.inductionBenefits.mileageCar"
                    class="form-control"
                    type="number"
                    min="0"
                    step="0.05"
                    required
                    :disabled="!canEdit || saving"
                  />
                  <small class="text-muted">Default: RM 0.50 per km</small>
                </div>

                <div>
                  <label class="form-label" for="hr-mileageMotorcycle">Mileage Rate - Motorcycle (RM/km) *</label>
                  <input
                    id="hr-mileageMotorcycle"
                    v-model.number="form.inductionBenefits.mileageMotorcycle"
                    class="form-control"
                    type="number"
                    min="0"
                    step="0.05"
                    required
                    :disabled="!canEdit || saving"
                  />
                  <small class="text-muted">Default: RM 0.20 per km</small>
                </div>

                <div>
                  <label class="form-label" for="hr-zeroMcAward">Zero-MC Annual Award (RM) *</label>
                  <input
                    id="hr-zeroMcAward"
                    v-model.number="form.inductionBenefits.zeroMcAward"
                    class="form-control"
                    type="number"
                    min="0"
                    step="50"
                    required
                    :disabled="!canEdit || saving"
                  />
                  <small class="text-muted">Annual incentive for 0 medical leave taken (Default: RM 300)</small>
                </div>
              </div>
            </div>

            <!-- Grade Allowances Table -->
            <div>
              <h6 class="fw-bold border-bottom pb-2">
                <i class="bi bi-layers me-1 text-primary"></i>
                Grade Allowances (Annual Pool RM)
              </h6>
              <div class="table-responsive">
                <table class="table table-sm table-bordered">
                  <thead class="table-light">
                    <tr>
                      <th style="width: 80px;">Grade</th>
                      <th>Flexi-wellness (RM)</th>
                      <th>Medical Check-up (RM)</th>
                      <th>Outstation Meals</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th class="align-middle">S</th>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.wellnessByGrade.S"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.checkupByGrade.S"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model="form.inductionBenefits.outstationMeals.S"
                          class="form-control form-control-sm"
                          type="text"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th class="align-middle">M</th>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.wellnessByGrade.M"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.checkupByGrade.M"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.outstationMeals.M"
                          class="form-control form-control-sm"
                          type="number"
                          step="5"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th class="align-middle">E</th>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.wellnessByGrade.E"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.checkupByGrade.E"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.outstationMeals.E"
                          class="form-control form-control-sm"
                          type="number"
                          step="5"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                    </tr>
                    <tr>
                      <th class="align-middle">C</th>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.wellnessByGrade.C"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.checkupByGrade.C"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td class="text-muted align-middle small">Not listed</td>
                    </tr>
                    <tr>
                      <th class="align-middle">W</th>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.wellnessByGrade.W"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td>
                        <input
                          v-model.number="form.inductionBenefits.checkupByGrade.W"
                          class="form-control form-control-sm"
                          type="number"
                          step="50"
                          :disabled="!canEdit || saving"
                        />
                      </td>
                      <td class="text-muted align-middle small">Not listed</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="hr-dialog-footer d-flex justify-content-between align-items-center">
          <div>
            <button
              v-if="canEdit"
              type="button"
              class="btn btn-outline-warning btn-sm"
              :disabled="saving || loading"
              @click="resetDefaults"
            >
              <i class="bi bi-arrow-counterclockwise me-1"></i>
              Reset to Defaults
            </button>
          </div>
          <div class="d-flex gap-2">
            <button
              type="button"
              class="btn btn-outline-secondary"
              :disabled="saving"
              @click="close"
            >
              Close
            </button>
            <button
              v-if="canEdit"
              type="submit"
              class="btn btn-primary"
              :disabled="saving || loading"
            >
              <span
                v-if="saving"
                class="spinner-border spinner-border-sm me-1"
                role="status"
              ></span>
              <i v-else class="bi bi-check2-circle me-1"></i>
              {{ saving ? 'Saving...' : 'Save Settings' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.statutory-modal {
  width: 820px;
  max-width: 95vw;
}

.statutory-badge {
  background: #f1f4f9;
  color: #1a4f8b;
  border: 1px solid #c7d8ee;
  font-weight: 500;
  font-size: 0.76rem;
  padding: 5px 9px;
  border-radius: 6px;
  white-space: normal;
  text-align: left;
}

.regulatory-section {
  background: #f8fafc;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--line, #e2e8f0);
}

.nav-pills .nav-link {
  color: #555;
  font-size: 0.85rem;
  border-radius: 8px;
}

.nav-pills .nav-link.active {
  background-color: var(--accent, #0d6efd);
  color: #fff;
}
</style>
