<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { dashboardActions } from '../services/dashboard';
import MobileClockPolicyAdmin from './MobileClockPolicyAdmin.vue';
import { formatDateKL, formatDateDMY } from '../utils/dateUtils';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  initialEmployee: {
    type: String,
    default: ''
  },
  employees: {
    type: Array,
    default: () => []
  },
  currentUser: {
    type: Object,
    default: () => ({ role: 'Admin', name: 'ADMIN' })
  }
});

const emit = defineEmits(['update:modelValue']);

const activeTab = ref('leaves');
const loading = ref(false);
const error = ref('');
const dossier = ref(null);
const selectedEmployee = ref('');
const searchQuery = ref('');
const viewLetter = ref(null);

const searchInputRef = ref(null);
const searchContainerRef = ref(null);
const isSearchFocused = ref(false);
const activeSuggestionIndex = ref(-1);

function handleDocumentClick(e) {
  if (searchContainerRef.value && !searchContainerRef.value.contains(e.target)) {
    isSearchFocused.value = false;
  }
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('click', handleDocumentClick);
  }
});

onUnmounted(() => {
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', handleDocumentClick);
  }
});

function getGlobalStaffSettings() {
  if (typeof window !== 'undefined') {
    if (window.staffSettings && Object.keys(window.staffSettings).length > 0) {
      return window.staffSettings;
    }
    if (dashboardActions && typeof dashboardActions.getStaffSettings === 'function') {
      const ds = dashboardActions.getStaffSettings();
      if (ds && Object.keys(ds).length > 0) return ds;
    }
    if (window.CacheManager?.getBootstrap) {
      const b = window.CacheManager.getBootstrap();
      if (b?.staffSettings && Object.keys(b.staffSettings).length > 0) return b.staffSettings;
    }
  }
  return {};
}

const effectiveUser = computed(() => {
  if (props.currentUser && props.currentUser.name && props.currentUser.name !== 'ADMIN') {
    return props.currentUser;
  }
  if (typeof window !== 'undefined' && window.currentUser && window.currentUser.name) {
    return window.currentUser;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem('hrPortalUser');
      if (saved) {
        const u = JSON.parse(saved);
        if (u && u.name) return u;
      }
    } catch (_) {}
  }
  return props.currentUser || { role: 'Admin', name: 'ADMIN' };
});

const canSwitchEmployee = computed(() => {
  const role = effectiveUser.value?.role;
  return ['Admin', 'HR', 'HOD', 'Supervisor'].includes(role);
});

const canManageMobileClock = computed(() => ['Admin','HR'].includes(effectiveUser.value?.role));

const canViewPayroll = computed(() => {
  const role = effectiveUser.value?.role;
  const currentUserName = effectiveUser.value?.name;
  const targetName = profile.value?.name || selectedEmployee.value;
  if (['Admin', 'HR'].includes(role)) return true;
  if (currentUserName && targetName && String(currentUserName).trim().toUpperCase() === String(targetName).trim().toUpperCase()) {
    return true;
  }
  return false;
});

const allStaffList = computed(() => {
  let list = (props.employees && props.employees.length) ? props.employees : [];
  if (!list.length) {
    const allSettings = getGlobalStaffSettings();
    if (allSettings && Object.keys(allSettings).length > 0) {
      list = Object.entries(allSettings).map(([name, s]) => ({
        name,
        ...(typeof s === 'object' ? s : {})
      }));
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map(e => {
    if (typeof e === 'string') {
      return {
        name: e,
        employee: e,
        role: 'Staff',
        label: e,
        department: '',
        employeeNo: '',
        jobTitle: '',
        icNo: '',
        company: ''
      };
    }
    const name = e.name || e.employee || '';
    const role = e.role || 'Staff';
    const dept = e.department || e.departmentName || '';
    const empNo = e.employeeNo || e.id || '';
    const jobTitle = e.jobTitle || '';
    const icNo = e.icNo || '';
    const company = e.company || e.companyName || '';
    const photo = e.photo || e.photoUrl || (typeof window !== 'undefined' && window.staffSettings && window.staffSettings[name] && (window.staffSettings[name].photo || window.staffSettings[name].photoUrl)) || '';
    return {
      ...e,
      name,
      employee: name,
      role,
      department: dept,
      employeeNo: empNo,
      jobTitle,
      icNo,
      company,
      photo,
      photoUrl: photo,
      label: `${name} (${role})`
    };
  });
});

const employeeOptions = computed(() => {
  return allStaffList.value.map(e => ({ name: e.name, label: e.label }));
});

const searchKeyword = computed(() => (searchQuery.value || '').trim().toLowerCase());

const matchingSuggestions = computed(() => {
  const kw = searchKeyword.value;
  const currentSel = (selectedEmployee.value || '').trim().toLowerCase();
  const all = allStaffList.value;
  if (!all.length) return [];

  if (!kw || kw === currentSel) {
    return all.slice(0, 10);
  }

  const kwDigits = kw.replace(/\D/g, '');

  return all.filter(s => {
    const name = String(s.name || '').toLowerCase();
    const role = String(s.role || '').toLowerCase();
    const dept = String(s.department || '').toLowerCase();
    const empNo = String(s.employeeNo || '').toLowerCase();
    const job = String(s.jobTitle || '').toLowerCase();
    const company = String(s.company || '').toLowerCase();
    const ic = String(s.icNo || '').replace(/\D/g, '');

    return name.includes(kw) ||
      empNo.includes(kw) ||
      dept.includes(kw) ||
      role.includes(kw) ||
      job.includes(kw) ||
      company.includes(kw) ||
      (kwDigits.length >= 3 && ic.includes(kwDigits));
  }).slice(0, 15);
});

const filteredEmployeeOptions = computed(() => {
  const kw = searchKeyword.value;
  const currentSel = (selectedEmployee.value || '').trim().toLowerCase();
  if (!kw || kw === currentSel) {
    return allStaffList.value;
  }
  const matches = matchingSuggestions.value;
  if (matches.length > 0) {
    const hasCurrent = matches.some(m => m.name === selectedEmployee.value);
    if (!hasCurrent && selectedEmployee.value) {
      const currentObj = allStaffList.value.find(s => s.name === selectedEmployee.value);
      if (currentObj) return [currentObj, ...matches];
    }
    return matches;
  }
  return allStaffList.value;
});

// Persistent in-memory and sessionStorage cache across modal opens and unmounts
const globalDossierCache = new Map();

function getCachedDossier(name) {
  if (!name) return null;
  const key = String(name).trim().toUpperCase();
  if (globalDossierCache.has(key)) {
    return globalDossierCache.get(key);
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(`pplos_dossier_${key}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Date.now() - (parsed.cachedAt || 0) < 15 * 60 * 1000) {
          globalDossierCache.set(key, parsed.data);
          return parsed.data;
        }
      }
    } catch (_) {}
  }
  return null;
}

function setCachedDossier(name, data) {
  if (!name || !data) return;
  const key = String(name).trim().toUpperCase();
  globalDossierCache.set(key, data);
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(`pplos_dossier_${key}`, JSON.stringify({
        cachedAt: Date.now(),
        data
      }));
    } catch (_) {}
  }
}

function resolveInitialTarget() {
  const initial = (props.initialEmployee || '').trim();
  if (initial) return initial;

  const curUser = effectiveUser.value;
  // If user role is Staff / User or has a valid name, default to own profile
  if (curUser?.name && curUser.name !== 'ADMIN') {
    if (curUser.role === 'User' || curUser.role === 'Staff') {
      return curUser.name;
    }
  }

  // If Admin or HOD without preselected target, pick own name if in staff list, or first staff
  const staff = allStaffList.value;
  if (staff.length > 0) {
    if (curUser?.name) {
      const ownStaff = staff.find(s => s.name.toUpperCase() === curUser.name.toUpperCase());
      if (ownStaff) return ownStaff.name;
    }
    return staff[0].name;
  }

  return curUser?.name || '';
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      activeTab.value = 'leaves';
      const target = resolveInitialTarget();
      selectedEmployee.value = target;
      searchQuery.value = target;
      error.value = '';
      if (target) {
        loadDossier();
      }
    } else {
      viewLetter.value = null;
    }
  },
  { immediate: true }
);

watch(
  () => props.initialEmployee,
  (newEmp) => {
    if (newEmp && props.modelValue) {
      selectedEmployee.value = newEmp;
      searchQuery.value = newEmp;
      loadDossier();
    }
  }
);

watch(allStaffList, (newList) => {
  if (!selectedEmployee.value && newList.length > 0) {
    const target = resolveInitialTarget();
    if (target) {
      selectedEmployee.value = target;
      searchQuery.value = target;
      loadDossier();
    }
  }
});

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

const isSyncing = ref(false);

function calculateTenure(joinedDate, serviceYearsSource) {
  if (serviceYearsSource !== undefined && serviceYearsSource !== '' && !isNaN(Number(serviceYearsSource))) {
    const rawNum = Number(serviceYearsSource);
    const formattedYears = rawNum % 1 === 0 ? String(rawNum) : rawNum.toFixed(2);
    return `${formattedYears} year${rawNum === 1 ? '' : 's'}`;
  }
  if (!joinedDate) return 'N/A';
  const joined = new Date(joinedDate);
  if (isNaN(joined.getTime())) return 'N/A';
  const now = new Date();
  let months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
  if (now.getDate() < joined.getDate()) months--;
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y > 0 && m > 0) return `${y} yr${y > 1 ? 's' : ''} ${m} mo`;
  if (y > 0) return `${y} year${y > 1 ? 's' : ''}`;
  return `${m} month${m === 1 ? '' : 's'}`;
}

function findStaffObject(name) {
  if (!name) return null;
  const norm = String(name).trim().toUpperCase();

  // 1. Check global staffSettings (window, dashboardActions, CacheManager)
  const allSettings = getGlobalStaffSettings();
  if (allSettings[name]) return allSettings[name];
  if (allSettings[norm]) return allSettings[norm];
  const matchInSettings = Object.values(allSettings).find(s => 
    s && (String(s.name || '').trim().toUpperCase() === norm ||
          String(s.employeeNo || '').trim().toUpperCase() === norm ||
          String(s.id || '').trim().toUpperCase() === norm)
  );
  if (matchInSettings) return matchInSettings;

  // 2. Check props.employees
  if (Array.isArray(props.employees)) {
    const match = props.employees.find(e => 
      typeof e === 'object' && e && (
        String(e.name || e.employee || '').trim().toUpperCase() === norm ||
        String(e.employeeNo || e.id || '').trim().toUpperCase() === norm
      )
    );
    if (match) return match;
  }

  // 3. Fallback to effectiveUser self
  const curUser = effectiveUser.value;
  if (curUser && String(curUser.name || '').trim().toUpperCase() === norm) {
    return {
      name: curUser.name,
      role: curUser.role || 'Staff',
      email: curUser.email || '',
      department: curUser.department || '',
      company: curUser.company || '',
      alBalance: curUser.alBalance,
      alEntitlement: curUser.alEntitlement,
      mcBalance: curUser.mcBalance,
      mcEntitlement: curUser.mcEntitlement
    };
  }

  return null;
}

function buildLocalDossier(name) {
  const s = findStaffObject(name);
  if (!s) return null;

  const targetName = s.name || name;
  const tenure = calculateTenure(s.joinedDate, s.serviceYearsSource);

  let localLeaves = [];
  if (typeof window !== 'undefined') {
    const allLeaves = window.globalLeaves || window.teamLeave || (window.CacheManager?.getTeamLeave ? window.CacheManager.getTeamLeave() : []) || [];
    if (Array.isArray(allLeaves)) {
      localLeaves = allLeaves.filter(l => String(l.name || l.employee || '').trim().toUpperCase() === targetName.toUpperCase()).map(l => ({
        id: l.id || Math.random().toString(),
        name: targetName,
        type: l.type || l.category || 'AL',
        start: l.start,
        end: l.end,
        days: Number(l.days || l.totalDays || 1),
        status: l.status || 'Approved',
        reason: l.reason || ''
      }));
    }
  }

  return {
    profile: {
      name: targetName,
      status: s.status || 'Active',
      role: s.role || 'Staff',
      basic: parseFloat(s.basic) || 0,
      hourly: parseFloat(s.hourly) || 0,
      gender: s.gender || 'Male',
      icNo: s.icNo || '',
      contactNo: s.contactNo || '',
      address: s.address || '',
      emergency: s.emergency || '',
      joinedDate: s.joinedDate || '',
      confirmDate: s.confirmDate || '',
      resignDate: s.resignDate || '',
      salaryHistory: s.salaryHistory || '',
      attachment: s.attachment || '',
      socsoNo: s.socsoNo || '',
      epfNo: s.epfNo || '',
      taxNo: s.taxNo || '',
      bankNo: s.bankNo || '',
      alEntitlement: parseFloat(s.alEntitlement) || 0,
      mcEntitlement: parseFloat(s.mcEntitlement) || 0,
      employeeNo: s.employeeNo || s.id || '',
      companyId: s.companyId || '',
      companyName: s.companyName || s.company || '',
      departmentId: s.departmentId || '',
      departmentName: s.departmentName || s.department || '',
      manager: s.manager || '',
      jobTitle: s.jobTitle || '',
      jobTitleId: s.jobTitleId || '',
      gradeId: s.gradeId || '',
      gradeCode: s.gradeCode || '',
      gradeTitle: s.gradeTitle || '',
      location: s.location || '',
      assignedResources: s.assignedResources || '',
      email: s.email || '',
      race: s.race || '',
      academicLevel: s.academicLevel || '',
      workBase: s.workBase || '',
      serviceYears: s.serviceYears || 0,
      tenure: tenure,
      photo: s.photo || s.photoUrl || '',
      photoUrl: s.photoUrl || s.photo || '',
      restDays: s.restDays || []
    },
    leaves: {
      history: localLeaves,
      applications: localLeaves,
      balances: [
        { category: 'Annual', balance: s.alBalance ?? s.alEntitlement ?? 0, entitlement: s.alEntitlement || 0, used: s.alUsed || 0 },
        { category: 'Medical', balance: s.mcBalance ?? s.mcEntitlement ?? 0, entitlement: s.mcEntitlement || 0, used: 0 }
      ],
      leaveEvents: [],
      openingBalances: []
    },
    claims: {
      summary: { totalRequestedRM: 0, totalApprovedRM: 0, totalPaidRM: 0 },
      history: []
    },
    payroll: {
      payslips: []
    },
    assets: {
      assigned: s.assignedResources ? [{ title: s.assignedResources, category: 'Assigned Resource' }] : []
    },
    letters: [],
    attendance: { records: [] }
  };
}

async function loadDossier(force = false) {
  let empTarget = (selectedEmployee.value || searchQuery.value || resolveInitialTarget()).trim();
  if (!empTarget && allStaffList.value.length > 0) {
    empTarget = allStaffList.value[0].name;
  }
  if (!empTarget) {
    loading.value = false;
    dossier.value = null;
    return;
  }

  selectedEmployee.value = empTarget;
  searchQuery.value = empTarget;
  error.value = '';

  // 1. Instant response from persistent cache (0ms)
  const cached = getCachedDossier(empTarget);
  if (!force && cached) {
    dossier.value = cached;
    loading.value = false;
    isSyncing.value = true;
  } else if (!force && !dossier.value) {
    // 2. Instant response from local staff settings & leaves (0ms)
    const local = buildLocalDossier(empTarget);
    if (local) {
      dossier.value = local;
      loading.value = false;
      isSyncing.value = true;
    } else {
      loading.value = true;
      dossier.value = null;
    }
  } else if (force) {
    loading.value = true;
  }

  try {
    const res = await dashboardActions.apiPost('getStaffDossier', { employee: empTarget });
    if (res && res.status === 'success' && res.data) {
      dossier.value = res.data;
      setCachedDossier(empTarget, res.data);
      selectedEmployee.value = res.data.profile?.name || empTarget;
      if (activeTab.value === 'payroll' && !canViewPayroll.value) {
        activeTab.value = 'leaves';
      }
    } else {
      if (!dossier.value) {
        error.value = res?.message || 'Failed to retrieve employee dossier.';
      }
    }
  } catch (err) {
    if (!dossier.value) {
      error.value = err.message || 'Error communicating with server.';
    }
  } finally {
    loading.value = false;
    isSyncing.value = false;
  }
}

function onSearchFocus(event) {
  isSearchFocused.value = true;
  activeSuggestionIndex.value = -1;
  event.target?.select();
}

function onSearchInput() {
  isSearchFocused.value = true;
  activeSuggestionIndex.value = -1;
}

function onSearchKeydown(event) {
  if (!isSearchFocused.value && event.key === 'ArrowDown') {
    isSearchFocused.value = true;
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (matchingSuggestions.value.length > 0) {
      activeSuggestionIndex.value = Math.min(activeSuggestionIndex.value + 1, matchingSuggestions.value.length - 1);
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (matchingSuggestions.value.length > 0) {
      activeSuggestionIndex.value = Math.max(activeSuggestionIndex.value - 1, -1);
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    handleSearchSubmit();
  } else if (event.key === 'Escape') {
    isSearchFocused.value = false;
  }
}

function clearSearch() {
  searchQuery.value = '';
  activeSuggestionIndex.value = -1;
  isSearchFocused.value = true;
  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function selectSuggestedStaff(emp) {
  selectedEmployee.value = emp.name;
  searchQuery.value = emp.name;
  isSearchFocused.value = false;
  activeSuggestionIndex.value = -1;
  loadDossier();
}

function handleSearchSubmit() {
  if (activeSuggestionIndex.value >= 0 && activeSuggestionIndex.value < matchingSuggestions.value.length) {
    selectSuggestedStaff(matchingSuggestions.value[activeSuggestionIndex.value]);
    return;
  }
  const kw = searchKeyword.value;
  if (matchingSuggestions.value.length > 0) {
    selectSuggestedStaff(matchingSuggestions.value[0]);
    return;
  }
  if (searchQuery.value.trim()) {
    selectedEmployee.value = searchQuery.value.trim();
    isSearchFocused.value = false;
    loadDossier();
  }
}

function handleEmployeeSelect() {
  searchQuery.value = selectedEmployee.value;
  isSearchFocused.value = false;
  loadDossier();
}

function formatMoney(val) {
  const n = Number(val);
  return Number.isFinite(n) ? n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

function formatTenureDisplay(val) {
  if (val == null || val === '') return 'N/A';
  const s = String(val);
  return s.replace(/(\d+\.\d{3,})\s*(years?|yrs?)/gi, (_, n, u) => `${Number(n).toFixed(2)} ${u}`)
          .replace(/^(\d+\.\d{3,})$/, (_, n) => `${Number(n).toFixed(2)} years`);
}

function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

const profile = computed(() => dossier.value?.profile || {});
const leaves = computed(() => dossier.value?.leaves || {});
const leaveHistory = computed(() => leaves.value.history || leaves.value.applications || []);
const leaveBalances = computed(() => leaves.value.balances || []);
const openingBalances = computed(() => leaves.value.openingBalances || []);

const claims = computed(() => dossier.value?.claims || {});
const claimsHistory = computed(() => claims.value.history || claims.value.records || []);
const claimsUtilisation = computed(() => claims.value.utilisation || {});

const payroll = computed(() => dossier.value?.payroll || {});
const payrollHistory = computed(() => payroll.value.history || payroll.value.records || []);
const latestPayroll = computed(() => payroll.value.latest || payrollHistory.value[0] || null);

const assets = computed(() => dossier.value?.assets || {});
const assetsList = computed(() => assets.value.records || assets.value.assignments || []);

const letters = computed(() => dossier.value?.letters || {});
const lettersList = computed(() => letters.value.records || letters.value.history || []);
const attendancePhotos = computed(() => dossier.value?.attendancePhotos || []);
const selectedVerificationPhoto = ref(null);

function openAttendanceRecord(photo) {
  close();
  const emp = profile.value?.name || selectedEmployee.value;
  if (typeof window !== 'undefined') {
    if (window.$ && $('#attendanceStaffSearch').length) {
      $('#attendanceStaffSearch').val(emp);
    }
    if (typeof window.switchTab === 'function') {
      window.switchTab('dashboard');
    } else if (typeof window.switchMobileTab === 'function') {
      window.switchMobileTab('dashboard');
    }
    if (window.dashboardActions?.renderDashboard) {
      window.dashboardActions.renderDashboard();
    }
    window.dispatchEvent(new CustomEvent('navigate-attendance', {
      detail: { employee: emp, date: photo?.date || (photo?.serverTime ? photo.serverTime.slice(0, 10) : '') }
    }));
  }
}

// Payroll KPI aggregations
const ytdGross = computed(() => payrollHistory.value.reduce((acc, p) => acc + (Number(p.gross) || 0), 0));
const ytdNet = computed(() => payrollHistory.value.reduce((acc, p) => acc + (Number(p.nettPay) || 0), 0));
const ytdDeductions = computed(() => payrollHistory.value.reduce((acc, p) => acc + (Number(p.totalEmpDed) || 0), 0));

function printLetterContent(ltr) {
  viewLetter.value = ltr;
}
</script>

<template>
  <div
    v-if="modelValue"
    class="hr-dialog-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="dossierModalTitle"
    tabindex="-1"
    @keydown.tab="trapDialog"
    @keydown.esc="close"
  >
    <div class="hr-dialog dossier-modal-container">
      <!-- Modal Header -->
      <div class="hr-dialog-head bg-white">
        <div class="d-flex align-items-center gap-3">
          <div class="d-flex align-items-center justify-content-center bg-primary text-white rounded-circle dossier-icon">
            <i class="bi bi-file-earmark-person fs-4"></i>
          </div>
          <div>
            <h4 id="dossierModalTitle" class="fw-bold mb-0">360° Staff Profile Enquiry Dossier</h4>
            <p class="text-muted small mb-0">Unified personnel intelligence, leave records, claims utilisation, payroll & assets</p>
          </div>
        </div>
        <button type="button" class="btn-close" aria-label="Close" @click="close"></button>
      </div>

      <!-- Employee Switcher Toolbar (Admin, HR, HOD) -->
      <div v-if="canSwitchEmployee" class="bg-light px-4 py-2 border-bottom d-flex flex-wrap align-items-center justify-content-between gap-2">
        <div class="d-flex align-items-center gap-2 flex-grow-1 position-relative" style="max-width: 480px;" ref="searchContainerRef">
          <label for="dossierSearchInput" class="small fw-bold text-muted text-nowrap mb-0">
            <i class="bi bi-search me-1"></i>Search Staff:
          </label>
          <div class="input-group input-group-sm position-relative">
            <input
              id="dossierSearchInput"
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              class="form-control pe-4"
              placeholder="Keyword (name, ID, IC, dept)..."
              autocomplete="off"
              @focus="onSearchFocus"
              @input="onSearchInput"
              @keydown="onSearchKeydown"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="btn btn-sm btn-link text-muted position-absolute top-50 translate-middle-y z-3 p-0 border-0 text-decoration-none"
              title="Clear keyword"
              style="right: 56px; background: transparent; line-height: 1;"
              @click="clearSearch"
            >
              <i class="bi bi-x-circle-fill text-secondary"></i>
            </button>
            <button class="btn btn-outline-primary" type="button" :disabled="loading" @click="handleSearchSubmit">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
              Find
            </button>
          </div>

          <!-- Live Keyword Suggestions Dropdown -->
          <div
            v-if="isSearchFocused && matchingSuggestions.length"
            class="position-absolute start-0 end-0 bg-white rounded-3 shadow-lg border overflow-hidden z-3 dossier-typeahead-menu"
            style="top: 100%; margin-top: 4px; max-height: 280px; overflow-y: auto;"
          >
            <div class="px-3 py-1 bg-light border-bottom d-flex justify-content-between align-items-center">
              <span class="text-muted fw-bold" style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em;">
                Matching Staff ({{ matchingSuggestions.length }})
              </span>
              <span class="text-muted" style="font-size: 0.7rem;">↑↓ navigate &middot; Enter select</span>
            </div>
            <div
              v-for="(emp, idx) in matchingSuggestions"
              :key="emp.name"
              class="px-3 py-2 cursor-pointer border-bottom d-flex align-items-center justify-content-between dossier-typeahead-item"
              :class="{ 'bg-primary-subtle text-primary fw-bold': idx === activeSuggestionIndex, 'bg-light': emp.name === selectedEmployee && idx !== activeSuggestionIndex }"
              @mousedown.prevent="selectSuggestedStaff(emp)"
              @mouseenter="activeSuggestionIndex = idx"
            >
              <div class="d-flex align-items-center gap-2">
                <div class="avatar-circle-sm bg-light text-primary fw-bold border rounded-circle d-flex align-items-center justify-content-center overflow-hidden flex-shrink-0" style="width: 28px; height: 28px; font-size: 0.75rem;">
                  <img v-if="emp.photo || emp.photoUrl" :src="emp.photo || emp.photoUrl" class="w-100 h-100 object-fit-cover" alt="" />
                  <span v-else>{{ getInitials(emp.name) }}</span>
                </div>
                <div>
                  <div class="d-flex align-items-center gap-1">
                    <span class="fw-semibold text-dark" style="font-size: 0.85rem;">{{ emp.name }}</span>
                    <span class="badge bg-secondary-subtle text-secondary" style="font-size: 0.65rem;">{{ emp.role || 'Staff' }}</span>
                  </div>
                  <div class="text-muted" style="font-size: 0.72rem;">
                    <span v-if="emp.employeeNo" class="me-2"><i class="bi bi-person-badge me-1"></i>{{ emp.employeeNo }}</span>
                    <span v-if="emp.department" class="me-2"><i class="bi bi-building me-1"></i>{{ emp.department }}</span>
                    <span v-if="emp.jobTitle"><i class="bi bi-briefcase me-1"></i>{{ emp.jobTitle }}</span>
                  </div>
                </div>
              </div>
              <i class="bi bi-chevron-right text-muted small"></i>
            </div>
          </div>
          <div
            v-else-if="isSearchFocused && searchKeyword && !matchingSuggestions.length"
            class="position-absolute start-0 end-0 bg-white rounded-3 shadow border p-3 text-center text-muted small z-3"
            style="top: 100%; margin-top: 4px;"
          >
            <i class="bi bi-search me-1"></i> No staff found matching "<strong>{{ searchQuery }}</strong>"
          </div>
        </div>

        <div v-if="employeeOptions.length" class="d-flex align-items-center gap-2 flex-grow-1" style="min-width: 300px; max-width: 440px;">
          <label for="dossierEmpSelect" class="small fw-bold text-muted text-nowrap mb-0">Switch:</label>
          <select
            id="dossierEmpSelect"
            v-model="selectedEmployee"
            class="form-select form-select-sm fw-medium shadow-none"
            style="min-width: 250px; width: 100%;"
            @change="handleEmployeeSelect"
          >
            <option v-for="emp in filteredEmployeeOptions" :key="emp.name" :value="emp.name">
              {{ emp.label }}
            </option>
          </select>
        </div>

        <div class="d-flex align-items-center gap-2">
          <span v-if="isSyncing" class="badge bg-primary-subtle text-primary border d-inline-flex align-items-center gap-1 extra-small">
            <span class="spinner-border spinner-border-sm" style="width: 10px; height: 10px;"></span> Syncing live...
          </span>
          <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="loading" @click="loadDossier(true)">
            <i class="bi bi-arrow-clockwise me-1" :class="{'spin-anim': isSyncing}"></i> Refresh
          </button>
        </div>
      </div>

      <!-- Modal Body -->
      <div class="hr-dialog-body p-4 bg-light">
        <!-- Error Alert -->
        <div v-if="error" class="alert alert-danger d-flex align-items-center gap-2" role="alert">
          <i class="bi bi-exclamation-triangle-fill fs-5"></i>
          <div>{{ error }}</div>
        </div>

        <!-- Loading State (only if no dossier available) -->
        <div v-if="loading && !dossier" class="text-center py-5">
          <div class="spinner-border text-primary mb-3" role="status">
            <span class="visually-hidden">Loading dossier...</span>
          </div>
          <h5 class="text-muted fw-normal">Retrieving 360° staff dossier...</h5>
        </div>

        <div v-else-if="dossier">
          <!-- 1. Header Identity Card -->
          <div class="card shadow-sm border-0 mb-4 overflow-hidden">
            <div class="card-body p-4 bg-white">
              <div class="d-flex flex-column flex-sm-row align-items-start gap-3">
                <div class="dossier-avatar-container flex-shrink-0">
                  <div class="rounded-circle overflow-hidden border shadow-sm d-flex align-items-center justify-content-center bg-light" style="width: 72px; height: 72px;">
                    <img v-if="profile.photo || profile.photoUrl" :src="profile.photo || profile.photoUrl" class="w-100 h-100 object-fit-cover" :alt="profile.name" />
                    <div v-else class="fw-bold text-primary" style="font-size: 1.5rem;">
                      {{ getInitials(profile.name) }}
                    </div>
                  </div>
                </div>
                <div class="profile-header-details flex-grow-1">
                  <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
                    <h3 class="fw-bold mb-0 text-dark text-uppercase">{{ profile.name }}</h3>
                  <span
                    class="badge"
                    :class="profile.status === 'Active' ? 'bg-success' : 'bg-danger'"
                  >
                    {{ profile.status }}
                  </span>
                  <span class="badge bg-primary">
                    {{ profile.role || 'Staff' }}
                  </span>
                  <span v-if="profile.gradeCode" class="badge bg-info text-dark">
                    Grade {{ profile.gradeCode }} ({{ profile.gradeTitle || 'Standard' }})
                  </span>
                </div>

                <p class="text-muted mb-2">
                  <strong class="text-dark">{{ profile.jobTitle || 'Team Member' }}</strong>
                  <span v-if="profile.departmentName"> · {{ profile.departmentName }}</span>
                  <span v-if="profile.companyName"> · {{ profile.companyName }}</span>
                  <span v-if="profile.location"> ({{ profile.location }})</span>
                </p>

                <div class="row g-2 text-muted small">
                  <div class="col-6 col-md-3">
                    <strong>Employee ID:</strong> {{ profile.employeeNo || 'N/A' }}
                  </div>
                  <div class="col-6 col-md-3">
                    <strong>IC No:</strong> {{ profile.icNo || 'N/A' }}
                  </div>
                  <div class="col-6 col-md-3">
                    <strong>Joined:</strong> {{ formatDateDMY(profile.joinedDate) || 'N/A' }}
                  </div>
                  <div class="col-6 col-md-3">
                    <strong>Confirmed:</strong> {{ formatDateDMY(profile.confirmDate) || 'N/A' }}
                  </div>
                  <div class="col-6 col-md-3">
                    <strong>Tenure:</strong>
                    <span class="badge bg-secondary-subtle text-secondary border ms-1">
                      {{ formatTenureDisplay(profile.tenure) }}
                    </span>
                  </div>
                  <div class="col-6 col-md-3">
                    <strong>Manager:</strong> {{ profile.manager || 'None (Direct Report)' }}
                  </div>
                  <div class="col-6 col-md-3">
                    <strong>Contact:</strong> {{ profile.contactNo || profile.email || 'N/A' }}
                  </div>
                  <div v-if="canViewPayroll" class="col-6 col-md-3">
                    <strong>Basic Salary:</strong> RM {{ formatMoney(profile.basic) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

          <!-- Per-staff HR toggle: permission is revalidated on the server. -->
          <details v-if="canManageMobileClock && profile.name" class="card border-0 shadow-sm mb-4">
            <summary class="card-body fw-bold" style="cursor:pointer"><i class="bi bi-geo-alt me-2"></i>Mobile clock-in permissions & geofences</summary>
            <div class="card-body pt-0"><MobileClockPolicyAdmin :key="profile.employeeNo || profile.name" :employee="profile.name" :company-id="profile.companyId || ''" /></div>
          </details>

          <!-- 2. Interactive Navigation Tabs (Modern Scrollable Pill Bar) -->
          <div class="dossier-tabs-nav mb-3">
            <ul class="nav nav-pills dossier-tabs flex-nowrap overflow-x-auto gap-2 pb-1" role="tablist">
              <li class="nav-item flex-shrink-0" role="presentation">
                <button
                  class="nav-link"
                  :class="{ active: activeTab === 'leaves' }"
                  type="button"
                  role="tab"
                  @click="activeTab = 'leaves'"
                >
                  <i class="bi bi-calendar2-check me-1"></i>
                  Leave Balances &amp; History
                  <span class="badge rounded-pill ms-1" :class="activeTab === 'leaves' ? 'bg-white text-primary' : 'bg-light text-secondary'">{{ leaveHistory.length }}</span>
                </button>
              </li>
              <li class="nav-item flex-shrink-0" role="presentation">
                <button
                  class="nav-link"
                  :class="{ active: activeTab === 'claims' }"
                  type="button"
                  role="tab"
                  @click="activeTab = 'claims'"
                >
                  <i class="bi bi-receipt me-1"></i>
                  Claims &amp; Flexi-Wellness
                  <span class="badge rounded-pill ms-1" :class="activeTab === 'claims' ? 'bg-white text-primary' : 'bg-light text-secondary'">{{ claimsHistory.length }}</span>
                </button>
              </li>
              <li v-if="canViewPayroll" class="nav-item flex-shrink-0" role="presentation">
                <button
                  class="nav-link"
                  :class="{ active: activeTab === 'payroll' }"
                  type="button"
                  role="tab"
                  @click="activeTab = 'payroll'"
                >
                  <i class="bi bi-cash-stack me-1"></i>
                  Payroll History
                  <span class="badge rounded-pill ms-1" :class="activeTab === 'payroll' ? 'bg-white text-primary' : 'bg-light text-secondary'">{{ payrollHistory.length }}</span>
                </button>
              </li>
              <li class="nav-item flex-shrink-0" role="presentation">
                <button
                  class="nav-link"
                  :class="{ active: activeTab === 'assets' }"
                  type="button"
                  role="tab"
                  @click="activeTab = 'assets'"
                >
                  <i class="bi bi-laptop me-1"></i>
                  Assigned Assets &amp; Equipment
                  <span class="badge rounded-pill ms-1" :class="activeTab === 'assets' ? 'bg-white text-primary' : 'bg-light text-secondary'">{{ assetsList.length }}</span>
                </button>
              </li>
              <li class="nav-item flex-shrink-0" role="presentation">
                <button
                  class="nav-link"
                  :class="{ active: activeTab === 'letters' }"
                  type="button"
                  role="tab"
                  @click="activeTab = 'letters'"
                >
                  <i class="bi bi-envelope-paper me-1"></i>
                  HR Letters &amp; Correspondence
                  <span class="badge rounded-pill ms-1" :class="activeTab === 'letters' ? 'bg-white text-primary' : 'bg-light text-secondary'">{{ lettersList.length }}</span>
                </button>
              </li>
              <li class="nav-item flex-shrink-0" role="presentation">
                <button
                  class="nav-link"
                  :class="{ active: activeTab === 'attendance' }"
                  type="button"
                  role="tab"
                  @click="activeTab = 'attendance'"
                >
                  <i class="bi bi-camera me-1"></i>
                  Attendance &amp; Verification
                  <span class="badge rounded-pill ms-1" :class="activeTab === 'attendance' ? 'bg-white text-primary' : 'bg-light text-secondary'">{{ attendancePhotos.length }}</span>
                </button>
              </li>
            </ul>
          </div>

          <!-- Tab 1: Leave Balances & History -->
          <div v-if="activeTab === 'leaves'" class="tab-pane-content">
            <!-- Balances Summary Cards -->
            <div class="row g-3 mb-4">
              <div v-for="b in leaveBalances" :key="b.category" class="col-12 col-md-4">
                <div class="card h-100 border-0 shadow-sm">
                  <div class="card-body p-3">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                      <h6 class="fw-bold mb-0 text-dark">{{ b.category }} Leave</h6>
                      <span class="badge bg-primary-subtle text-primary border">
                        Bal: {{ b.balance != null ? b.balance : 'N/A' }} d
                      </span>
                    </div>
                    <div class="row text-center g-1 text-muted small mt-2">
                      <div class="col-4 border-end">
                        <div class="fw-bold text-dark">{{ b.openingBalance || b.entitlement || 0 }}</div>
                        <div>Opening</div>
                      </div>
                      <div class="col-4 border-end">
                        <div class="fw-bold text-danger">{{ b.used || 0 }}</div>
                        <div>Taken</div>
                      </div>
                      <div class="col-4">
                        <div class="fw-bold text-success">{{ b.balance != null ? b.balance : 0 }}</div>
                        <div>Available</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Dual-Window Carry Forward Expiry Notices -->
            <div v-if="openingBalances.length" class="mb-3">
              <div
                v-for="op in openingBalances"
                :key="op.id"
                class="p-3 bg-white border rounded shadow-sm mb-2"
              >
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <div class="d-flex align-items-center gap-2">
                    <i class="bi bi-calendar-range text-warning fs-5"></i>
                    <div>
                      <strong class="text-dark">{{ op.year }} {{ op.category }} Carry-Forward Notice</strong>
                      <div class="text-muted small">Effective from: {{ op.effectiveDate }}</div>
                    </div>
                  </div>
                  <div class="d-flex gap-2 flex-wrap">
                    <span v-if="op.standardCarryForward" class="badge bg-primary">
                      Standard CF: {{ op.standardCarryForward }}d (exp {{ op.standardExpiryDate || `${op.year}-12-31` }})
                    </span>
                    <span v-if="op.excessCarryForward" class="badge bg-warning text-dark">
                      Excess CF: {{ op.excessCarryForward }}d (exp {{ op.excessExpiryDate || `${op.year}-04-30` }})
                    </span>
                    <span v-if="op.newEntitlement" class="badge bg-success">
                      New Entitlement: {{ op.newEntitlement }}d
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Leave Applications History Table -->
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                <h6 class="fw-bold mb-0">Leave Applications &amp; History</h6>
                <span class="text-muted small">{{ leaveHistory.length }} recorded applications</span>
              </div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead class="table-light small">
                    <tr>
                      <th>Ref ID</th>
                      <th>Type</th>
                      <th>Period</th>
                      <th class="text-center">Days</th>
                      <th>Split Breakdown</th>
                      <th>Reason</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!leaveHistory.length">
                      <td colspan="7" class="text-center py-4 text-muted">
                        <i class="bi bi-inbox fs-4 d-block mb-1"></i>
                        No leave records found for this employee.
                      </td>
                    </tr>
                    <tr v-for="l in leaveHistory" :key="l.id">
                      <td class="fw-bold small">{{ l.id }}</td>
                      <td>
                        <span class="badge bg-secondary-subtle text-dark border">
                          {{ l.type }}
                        </span>
                      </td>
                      <td class="small">
                        {{ l.start }} <span class="text-muted">to</span> {{ l.end }}
                      </td>
                      <td class="text-center fw-bold">{{ l.days }}</td>
                      <td class="small">
                        <span v-if="l.annualDays || l.unpaidDays" class="badge bg-info-subtle text-dark border">
                          AL: {{ l.annualDays || 0 }}d / NPL: {{ l.unpaidDays || 0 }}d
                        </span>
                        <span v-else class="text-muted">-</span>
                      </td>
                      <td class="small text-truncate" style="max-width: 200px;" :title="l.reason">
                        {{ l.reason || '-' }}
                      </td>
                      <td>
                        <span
                          class="badge"
                          :class="l.status === 'Approved' ? 'bg-success' : l.status === 'Rejected' ? 'bg-danger' : 'bg-warning text-dark'"
                        >
                          {{ l.status }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Tab 2: Claims & Flexi-Wellness Utilisation -->
          <div v-if="activeTab === 'claims'" class="tab-pane-content">
            <!-- Induction Policy Benefit Caps -->
            <div class="row g-3 mb-4">
              <!-- Shared Flexi Cap -->
              <div class="col-12 col-md-6">
                <div class="card h-100 border-0 shadow-sm p-3">
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <h6 class="fw-bold mb-0 text-dark">
                      <i class="bi bi-heart-pulse text-danger me-1"></i>
                      Shared Medical / Dental / Optical Flexi Pool
                    </h6>
                    <span class="badge bg-primary">Cap: RM {{ formatMoney(claimsUtilisation.flexiCap) }}</span>
                  </div>
                  <div class="text-muted small mb-2">
                    Governed by Metrio Induction Policy FAM-23/G (Grade {{ profile.gradeCode || 'M' }})
                  </div>
                  <div class="progress mb-2" style="height: 10px;">
                    <div
                      class="progress-bar bg-primary"
                      role="progressbar"
                      :style="{
                        width: `${Math.min(100, claimsUtilisation.flexiCap ? (claimsUtilisation.flexiSpent / claimsUtilisation.flexiCap) * 100 : 0)}%`
                      }"
                    ></div>
                  </div>
                  <div class="d-flex justify-content-between small">
                    <span>Claimed: <strong>RM {{ formatMoney(claimsUtilisation.flexiSpent) }}</strong></span>
                    <span class="text-success fw-bold">Remaining: RM {{ formatMoney(claimsUtilisation.flexiRemaining) }}</span>
                  </div>
                </div>
              </div>

              <!-- Medical Check-up Cap -->
              <div class="col-12 col-md-6">
                <div class="card h-100 border-0 shadow-sm p-3">
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <h6 class="fw-bold mb-0 text-dark">
                      <i class="bi bi-activity text-info me-1"></i>
                      Annual Medical Check-up Pool
                    </h6>
                    <span class="badge bg-info text-dark">Cap: RM {{ formatMoney(claimsUtilisation.checkupCap) }}</span>
                  </div>
                  <div class="text-muted small mb-2">
                    Available for confirmed staff with &ge;1 year service (Grades S &amp; M)
                  </div>
                  <div class="progress mb-2" style="height: 10px;">
                    <div
                      class="progress-bar bg-info"
                      role="progressbar"
                      :style="{
                        width: `${Math.min(100, claimsUtilisation.checkupCap ? (claimsUtilisation.checkupSpent / claimsUtilisation.checkupCap) * 100 : 0)}%`
                      }"
                    ></div>
                  </div>
                  <div class="d-flex justify-content-between small">
                    <span>Claimed: <strong>RM {{ formatMoney(claimsUtilisation.checkupSpent) }}</strong></span>
                    <span class="text-success fw-bold">Remaining: RM {{ formatMoney(claimsUtilisation.checkupRemaining) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Claims History Table -->
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                <h6 class="fw-bold mb-0">Expense &amp; Wellness Claims</h6>
                <span class="text-muted small">{{ claimsHistory.length }} recorded claims</span>
              </div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead class="table-light small">
                    <tr>
                      <th>Receipt Date</th>
                      <th>Category</th>
                      <th>Clinic / Merchant / Purpose</th>
                      <th>Receipt No</th>
                      <th class="text-end">Amount (RM)</th>
                      <th>Status</th>
                      <th>Payment Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!claimsHistory.length">
                      <td colspan="7" class="text-center py-4 text-muted">
                        <i class="bi bi-receipt fs-4 d-block mb-1"></i>
                        No claims recorded for this employee.
                      </td>
                    </tr>
                    <tr v-for="c in claimsHistory" :key="c.id">
                      <td class="small">{{ formatDateDMY(c.date) }}</td>
                      <td>
                        <span class="badge bg-secondary-subtle text-dark border">
                          {{ c.category }}
                        </span>
                      </td>
                      <td class="small fw-semibold">{{ c.title }}</td>
                      <td class="small font-monospace">{{ c.receiptNo }}</td>
                      <td class="text-end fw-bold">RM {{ formatMoney(c.amount) }}</td>
                      <td>
                        <span
                          class="badge"
                          :class="c.status === 'Paid' ? 'bg-success' : c.status === 'Approved' ? 'bg-primary' : c.status === 'Rejected' ? 'bg-danger' : 'bg-warning text-dark'"
                        >
                          {{ c.status }}
                        </span>
                      </td>
                      <td class="small font-monospace text-muted">
                        {{ c.paymentReference || '-' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Tab 3: Payroll History -->
          <div v-if="activeTab === 'payroll' && canViewPayroll" class="tab-pane-content">
            <!-- Payroll KPI Summary Cards -->
            <div class="row g-3 mb-4">
              <div class="col-6 col-md-3">
                <div class="card border-0 shadow-sm p-3 text-center bg-white">
                  <div class="text-muted small">Latest Net Pay</div>
                  <h4 class="fw-bold text-success mb-0">
                    RM {{ formatMoney(latestPayroll?.nettPay) }}
                  </h4>
                  <small class="text-muted">{{ latestPayroll?.month || 'N/A' }}</small>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="card border-0 shadow-sm p-3 text-center bg-white">
                  <div class="text-muted small">Latest Gross Pay</div>
                  <h4 class="fw-bold text-primary mb-0">
                    RM {{ formatMoney(latestPayroll?.gross) }}
                  </h4>
                  <small class="text-muted">{{ latestPayroll?.month || 'N/A' }}</small>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="card border-0 shadow-sm p-3 text-center bg-white">
                  <div class="text-muted small">YTD Total Gross</div>
                  <h4 class="fw-bold text-dark mb-0">
                    RM {{ formatMoney(ytdGross) }}
                  </h4>
                  <small class="text-muted">{{ payrollHistory.length }} periods</small>
                </div>
              </div>
              <div class="col-6 col-md-3">
                <div class="card border-0 shadow-sm p-3 text-center bg-white">
                  <div class="text-muted small">YTD Total Net</div>
                  <h4 class="fw-bold text-success mb-0">
                    RM {{ formatMoney(ytdNet) }}
                  </h4>
                  <small class="text-muted">deductions: RM {{ formatMoney(ytdDeductions) }}</small>
                </div>
              </div>
            </div>

            <!-- Historical Payslips Table -->
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                <h6 class="fw-bold mb-0">Monthly Payroll &amp; Statutory Deductions</h6>
                <span class="text-muted small">{{ payrollHistory.length }} recorded months</span>
              </div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0 table-sm">
                  <thead class="table-light small">
                    <tr>
                      <th>Month</th>
                      <th class="text-end">Basic (RM)</th>
                      <th class="text-center">Days</th>
                      <th class="text-end">Gross (RM)</th>
                      <th class="text-end">EPF Emp</th>
                      <th class="text-end">SOCSO Emp</th>
                      <th class="text-end">EIS Emp</th>
                      <th class="text-end">PCB</th>
                      <th class="text-end">Tot Ded (RM)</th>
                      <th class="text-end">Net Pay (RM)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!payrollHistory.length">
                      <td colspan="10" class="text-center py-4 text-muted">
                        <i class="bi bi-wallet2 fs-4 d-block mb-1"></i>
                        No payroll records found for this employee.
                      </td>
                    </tr>
                    <tr v-for="p in payrollHistory" :key="p.month">
                      <td class="fw-bold small">{{ p.month }}</td>
                      <td class="text-end small">{{ formatMoney(p.basic) }}</td>
                      <td class="text-center small">{{ p.workedDays }}</td>
                      <td class="text-end small fw-bold text-primary">{{ formatMoney(p.gross) }}</td>
                      <td class="text-end small text-danger">{{ formatMoney(p.epfEmp) }}</td>
                      <td class="text-end small text-danger">{{ formatMoney(p.socsoEmp) }}</td>
                      <td class="text-end small text-danger">{{ formatMoney(p.eisEmp) }}</td>
                      <td class="text-end small text-danger">{{ formatMoney(p.pcb) }}</td>
                      <td class="text-end small text-danger fw-bold">{{ formatMoney(p.totalEmpDed) }}</td>
                      <td class="text-end fw-bold text-success fs-6">RM {{ formatMoney(p.nettPay) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Tab 4: Assigned Assets & Equipment -->
          <div v-if="activeTab === 'assets'" class="tab-pane-content">
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center gap-2">
                  <h6 class="fw-bold mb-0">Assigned Company Assets &amp; Equipment</h6>
                  <span class="badge bg-success">{{ assets.activeCount || 0 }} Active</span>
                </div>
                <span class="text-muted small">{{ assetsList.length }} total handover history</span>
              </div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead class="table-light small">
                    <tr>
                      <th>Asset Code</th>
                      <th>Resource Name</th>
                      <th>Type / Category</th>
                      <th>Assigned Date</th>
                      <th>Handover Condition</th>
                      <th>Location / Notes</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!assetsList.length">
                      <td colspan="7" class="text-center py-4 text-muted">
                        <i class="bi bi-box-seam fs-4 d-block mb-1"></i>
                        No company assets currently assigned to this employee.
                      </td>
                    </tr>
                    <tr v-for="a in assetsList" :key="a.id">
                      <td class="fw-bold small font-monospace">{{ a.code || a.resourceId }}</td>
                      <td class="fw-semibold small">
                        <i
                          class="bi me-1"
                          :class="a.category === 'Laptop' ? 'bi-laptop' : a.category === 'Vehicle' ? 'bi-car-front' : 'bi-tools'"
                        ></i>
                        {{ a.title || a.resourceTitle || 'Asset' }}
                      </td>
                      <td>
                        <span class="badge bg-secondary-subtle text-dark border">
                          {{ a.category || 'Equipment' }}
                        </span>
                      </td>
                      <td class="small">{{ formatDateDMY(a.date) }}</td>
                      <td class="small text-muted">{{ a.condition || '-' }}</td>
                      <td class="small text-muted text-truncate" style="max-width: 200px;" :title="a.notes">
                        {{ a.notes || a.location || '-' }}
                      </td>
                      <td>
                        <span
                          class="badge"
                          :class="a.status === 'Assigned' ? 'bg-success' : 'bg-secondary'"
                        >
                          {{ a.status }}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Tab 5: HR Letters & Corporate Correspondence -->
          <div v-if="activeTab === 'letters'" class="tab-pane-content">
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white py-3 d-flex justify-content-between align-items-center">
                <h6 class="fw-bold mb-0">Official HR Letters &amp; Corporate Correspondence</h6>
                <span class="text-muted small">{{ lettersList.length }} official documents</span>
              </div>
              <div class="table-responsive">
                <table class="table table-hover align-middle mb-0">
                  <thead class="table-light small">
                    <tr>
                      <th>Issue Date</th>
                      <th>Category</th>
                      <th>Subject / Title</th>
                      <th>Status</th>
                      <th>Content Summary</th>
                      <th class="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!lettersList.length">
                      <td colspan="6" class="text-center py-4 text-muted">
                        <i class="bi bi-envelope-open fs-4 d-block mb-1"></i>
                        No HR letters or corporate correspondence on file.
                      </td>
                    </tr>
                    <tr v-for="ltr in lettersList" :key="ltr.id">
                      <td class="small">{{ formatDateDMY(ltr.date) }}</td>
                      <td>
                        <span class="badge bg-primary-subtle text-primary border">
                          {{ ltr.category }}
                        </span>
                      </td>
                      <td class="fw-semibold small">{{ ltr.title }}</td>
                      <td>
                        <span
                          class="badge"
                          :class="ltr.status === 'Issued' ? 'bg-success' : 'bg-warning text-dark'"
                        >
                          {{ ltr.status }}
                        </span>
                      </td>
                      <td class="small text-muted text-truncate" style="max-width: 250px;" :title="ltr.notes">
                        {{ ltr.notes }}
                      </td>
                      <td class="text-end">
                        <button
                          type="button"
                          class="btn btn-outline-secondary btn-sm"
                          @click="printLetterContent(ltr)"
                        >
                          <i class="bi bi-eye me-1"></i> View Letter
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Letter Detail View Modal / Box -->
            <div v-if="viewLetter" class="card mt-3 border-primary shadow-sm">
              <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                <h6 class="mb-0 fw-bold">
                  <i class="bi bi-envelope-paper me-1"></i>
                  {{ viewLetter.title }} ({{ viewLetter.category }})
                </h6>
                <button type="button" class="btn-close btn-close-white" @click="viewLetter = null"></button>
              </div>
              <div class="card-body p-4 bg-white">
                <div class="d-flex justify-content-between border-bottom pb-2 mb-3 text-muted small">
                  <div><strong>Addressed To:</strong> {{ profile.name }}</div>
                  <div><strong>Date:</strong> {{ formatDateDMY(viewLetter.date) }}</div>
                  <div><strong>Status:</strong> {{ viewLetter.status }}</div>
                </div>
                <div class="letter-body p-3 bg-light rounded border" style="white-space: pre-wrap; font-family: Georgia, serif; line-height: 1.6;">
{{ viewLetter.notes }}
                </div>
              </div>
            </div>
          </div>

          <!-- Tab 6: Attendance & Verification Photos -->
          <div v-if="activeTab === 'attendance'" class="tab-pane-content">
            <div class="alert alert-info py-2 px-3 mb-3 d-flex align-items-center justify-content-between small">
              <div>
                <i class="bi bi-shield-check me-1"></i>
                Face Verification &amp; GPS Attendance Records for <strong>{{ profile.name }}</strong>
              </div>
              <span class="badge bg-light text-primary border">Biometric GPS Audit</span>
            </div>

            <div v-if="attendancePhotos.length === 0" class="text-center py-5 bg-white rounded-3 border">
              <i class="bi bi-camera-slash fs-1 text-muted mb-2 d-block"></i>
              <h6 class="text-muted fw-bold">No Face Verification Records Found</h6>
              <p class="text-muted small mb-0">Selfie verification photos captured during mobile GPS clock-in will appear here.</p>
            </div>

            <div v-else class="row g-3">
              <div v-for="p in attendancePhotos" :key="p.id" class="col-12 col-md-6 col-lg-4">
                <div class="card h-100 border-0 shadow-sm overflow-hidden">
                  <div class="position-relative bg-dark text-center" style="height: 200px;">
                    <a v-if="p.photolink || /^https:\/\//.test(p.url || p.photo || '')"
                      :href="p.photolink || p.url || p.photo" target="_blank" rel="noopener noreferrer"
                      class="d-flex h-100 align-items-center justify-content-center flex-column gap-2 text-decoration-none" style="min-height:140px">
                      <i class="bi bi-file-earmark-image fs-1"></i><span class="small">Open private Drive photo</span>
                    </a>
                    <img
                      v-else
                      :src="p.url || p.photo"
                      :alt="p.title"
                      class="w-100 h-100"
                      style="object-fit: cover; cursor: pointer;"
                      @click="selectedVerificationPhoto = p"
                    />
                    <span
                      class="badge position-absolute top-0 start-0 m-2 shadow-sm"
                      :class="p.punchType === 'IN' || p.type === 'IN' ? 'bg-success' : 'bg-danger'"
                    >
                      {{ p.punchType === 'IN' || p.type === 'IN' ? 'CLOCK IN' : 'CLOCK OUT' }}
                    </span>
                    <span class="badge bg-dark bg-opacity-75 position-absolute bottom-0 start-0 m-2">
                      {{ p.date }}
                    </span>
                  </div>
                  <div class="card-body p-3 small d-flex flex-column justify-content-between">
                    <div>
                      <div class="fw-bold text-dark mb-1">{{ p.title || 'Attendance Selfie' }}</div>
                      <div class="text-muted mb-2">
                        <i class="bi bi-clock me-1"></i>
                        {{ new Date(p.serverTime || p.date).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) }}
                      </div>
                      <div v-if="p.location && p.location.latitude" class="text-muted mb-2">
                        <i class="bi bi-geo-alt me-1"></i>
                        <a :href="`https://www.google.com/maps?q=${encodeURIComponent(p.location.latitude+','+p.location.longitude)}`" target="_blank" rel="noopener noreferrer">
                          {{ p.location.latitude }}, {{ p.location.longitude }}
                        </a>
                        <span class="small"> (±{{ p.location.accuracyM }}m)</span>
                      </div>
                    </div>
                    <div class="pt-2 border-top mt-2 d-flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="btn btn-sm btn-outline-secondary flex-grow-1"
                        @click="selectedVerificationPhoto = p"
                      >
                        <i class="bi bi-zoom-in me-1"></i> View Photo
                      </button>
                      <a
                        v-if="p.photolink || (p.url && p.url.startsWith('https://drive.google.com'))"
                        :href="p.photolink || p.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="btn btn-sm btn-outline-success flex-grow-1"
                      >
                        <i class="bi bi-google me-1"></i> Drive
                      </a>
                      <button
                        type="button"
                        class="btn btn-sm btn-primary flex-grow-1"
                        @click="openAttendanceRecord(p)"
                      >
                        <i class="bi bi-calendar-check me-1"></i> View Attendance
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Lightbox Modal for Selected Photo -->
            <div v-if="selectedVerificationPhoto" class="photo-modal-backdrop" @click.self="selectedVerificationPhoto = null">
              <div class="photo-modal-dialog card shadow-lg border-0">
                <div class="card-header bg-white d-flex align-items-center justify-content-between py-3 border-bottom">
                  <div class="d-flex align-items-center gap-2">
                    <i class="bi bi-camera-fill text-primary fs-5"></i>
                    <h6 class="fw-bold mb-0">Attendance Verification Record</h6>
                  </div>
                  <button type="button" class="btn-close" aria-label="Close" @click="selectedVerificationPhoto = null"></button>
                </div>
                <div class="card-body p-4 text-center">
                  <a v-if="selectedVerificationPhoto.photolink || /^https:\/\//.test(selectedVerificationPhoto.url || selectedVerificationPhoto.photo || '')"
                    :href="selectedVerificationPhoto.photolink || selectedVerificationPhoto.url || selectedVerificationPhoto.photo"
                    target="_blank" rel="noopener noreferrer" class="btn btn-outline-primary mb-3">Open private photo in Google Drive</a>
                  <img
                    v-else
                    :src="selectedVerificationPhoto.url || selectedVerificationPhoto.photo"
                    alt="Selfie"
                    class="img-fluid rounded-4 shadow border mb-3"
                    style="max-width: 320px; max-height: 320px; object-fit: cover;"
                  />
                  <div class="text-start bg-light rounded-3 p-3 small mb-3">
                    <div><strong>Staff:</strong> {{ profile.name }}</div>
                    <div><strong>Punch:</strong> {{ selectedVerificationPhoto.punchType === 'IN' || selectedVerificationPhoto.type === 'IN' ? 'Clock In' : 'Clock Out' }}</div>
                    <div><strong>Timestamp:</strong> {{ new Date(selectedVerificationPhoto.serverTime || selectedVerificationPhoto.date).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) }}</div>
                    <div v-if="selectedVerificationPhoto.location">
                      <strong>GPS:</strong>
                      <a :href="`https://www.google.com/maps?q=${encodeURIComponent(selectedVerificationPhoto.location.latitude+','+selectedVerificationPhoto.location.longitude)}`" target="_blank" rel="noopener noreferrer">
                        {{ selectedVerificationPhoto.location.latitude }}, {{ selectedVerificationPhoto.location.longitude }}
                      </a>
                      (±{{ selectedVerificationPhoto.location.accuracyM }} m)
                    </div>
                  </div>
                  <div class="d-flex gap-2 justify-content-center">
                    <button type="button" class="btn btn-primary" @click="openAttendanceRecord(selectedVerificationPhoto)">
                      <i class="bi bi-calendar-check me-1"></i>View Attendance Record
                    </button>
                    <button type="button" class="btn btn-outline-secondary" @click="selectedVerificationPhoto = null">
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Fallback empty state if neither error, loading nor dossier -->
        <div v-else class="text-center py-5 text-muted">
          <i class="bi bi-person-bounding-box fs-1 text-secondary mb-3 d-block"></i>
          <h5 class="fw-bold">No Staff Dossier Available</h5>
          <p class="small mb-3">Please select or search for an employee above to view their 360° intelligence dossier.</p>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="hr-dialog-footer bg-white border-top">
        <button type="button" class="btn btn-outline-secondary" @click="close">
          Close Dossier
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dossier-modal-container {
  width: 1050px;
  max-width: 96vw;
  max-height: 92vh;
  overflow-y: auto;
}

.dossier-icon {
  width: 44px;
  height: 44px;
}

.avatar-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  font-weight: 700;
  box-shadow: 0 4px 10px rgba(29, 78, 216, 0.25);
}

.dossier-tabs-nav {
  position: relative;
  background: #f8fafc;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.dossier-tabs {
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE/Edge */
  -webkit-overflow-scrolling: touch;
}

.dossier-tabs::-webkit-scrollbar {
  display: none; /* Chrome, Safari */
}

.dossier-tabs .nav-link {
  color: #475569;
  background: transparent;
  border: 1px solid transparent;
  font-weight: 600;
  font-size: 0.85rem;
  padding: 8px 16px;
  border-radius: 9999px;
  transition: all 0.15s ease-in-out;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.dossier-tabs .nav-link:hover {
  background: #ffffff;
  color: #0f172a;
  border-color: #e2e8f0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.dossier-tabs .nav-link.active {
  background: #1d4ed8;
  color: #ffffff;
  border-color: #1d4ed8;
  box-shadow: 0 2px 8px rgba(29, 78, 216, 0.28);
}

.photo-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  z-index: 1060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.photo-modal-dialog {
  max-width: 440px;
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  animation: photoModalIn 0.18s ease-out;
}
@keyframes photoModalIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.dossier-typeahead-menu {
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  border: 1px solid #cbd5e1;
}
.dossier-typeahead-item {
  transition: background-color 0.12s ease-in-out;
}
.dossier-typeahead-item:hover {
  background-color: #f1f5f9;
}
.avatar-circle-sm {
  flex-shrink: 0;
}
.extra-small {
  font-size: 0.72rem;
}
.spin-anim {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
