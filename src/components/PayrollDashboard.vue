<script setup>
import AccountMenu from "./AccountMenu.vue";
import HrWorkspace from "./HrWorkspace.vue";
const StaffDossierModal = defineAsyncComponent(() => import("./StaffDossierModal.vue"));
const PersonalAttendance = defineAsyncComponent(() => import("./PersonalAttendance.vue"));
const MobileAppShell = defineAsyncComponent(() => import("./mobile/MobileAppShell.vue"));
import { onMounted, onBeforeUnmount, ref, computed, watch, nextTick, defineAsyncComponent } from "vue";
import { mountDashboard, dashboardActions } from "../services/dashboard";
import { clearMobileSessionCache } from '../services/mobileSessionCache';

const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
const currentUser = ref(null);
const hrBootstrapRecords = ref({});
const hrEmployees = ref([]);
const hrTeamLeave = ref([]);
const isBrowserFullscreen = ref(false);

const showDossierModal = ref(false);
const dossierTargetEmployee = ref('');
const showPersonalAttendance = ref(false);
function openPersonalAttendance() {
  if (typeof document !== 'undefined') {
    const activeSection = document.querySelector('.tab-section.active');
    if (activeSection && activeSection.id === 'my-attendance') return;
  }
  if (currentUser.value && !isMobile.value) showPersonalAttendance.value = true;
}
function onTabSwitch() {
  showPersonalAttendance.value = false;
}
const effectiveUserForDossier = computed(() => {
  if (currentUser.value && currentUser.value.name) return currentUser.value;
  if (typeof window !== 'undefined' && window.currentUser && window.currentUser.name) return window.currentUser;
  try {
    const s = localStorage.getItem('hrPortalUser');
    if (s) {
      const u = JSON.parse(s);
      if (u && u.name) return u;
    }
  } catch (_) {}
  return { role: 'Admin', name: 'ADMIN' };
});

const allEmployeesForDossier = computed(() => {
  if (hrEmployees.value && hrEmployees.value.length) return hrEmployees.value;
  const ss = (dashboardActions?.getStaffSettings ? dashboardActions.getStaffSettings() : null) || (typeof window !== 'undefined' ? window.staffSettings : null);
  if (ss && Object.keys(ss).length > 0) {
    return Object.entries(ss).map(([name, s]) => ({ name, ...(typeof s === 'object' ? s : {}) }));
  }
  return [];
});

function openStaffDossier(name = '') {
    if (!name) {
      const u = effectiveUserForDossier.value;
      if (u?.role === 'User' && u?.name) {
        name = u.name;
      } else {
        const ss = (dashboardActions?.getStaffSettings ? dashboardActions.getStaffSettings() : null) || (typeof window !== 'undefined' ? window.staffSettings : {});
        const keys = Object.keys(ss || {});
        if (keys.length > 0) name = keys[0];
      }
    }
    dossierTargetEmployee.value = name;
    showDossierModal.value = true;
}
if (typeof window !== 'undefined') {
    window.openStaffDossier = openStaffDossier;
    window.addEventListener('hr-open-dossier', (e) => openStaffDossier(e?.detail?.name || ''));
    setTimeout(() => {
        import("./StaffDossierModal.vue");
    }, 1200);
}
function toggleBrowserFullscreen() {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement) {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      req.call(el).then(() => {
        isBrowserFullscreen.value = true;
      }).catch(() => {});
    }
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) {
      exit.call(document).then(() => {
        isBrowserFullscreen.value = false;
      }).catch(() => {});
    }
  }
}
function onFullscreenChange() {
  if (typeof document !== 'undefined') {
    isBrowserFullscreen.value = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }
}

function updateIsMobile() {
  if (typeof window !== 'undefined') {
    isMobile.value = window.innerWidth <= 768;
  }
}

let mobileBootstrapPending = null;
let mobileSessionGeneration = 0;
let mobileLoadVersion = 0;
let mobileBootstrapPendingIdentity = '';
let mobileBootstrapIdentity = '';
let mobileBootstrapLoadedAt = 0;
function mobileIdentity(user) { return user?.employeeNo || user?.username || user?.name || ''; }
async function refreshMobileBootstrap(force = false) {
  if (!currentUser.value) return;
  const identity = mobileIdentity(currentUser.value);
  if (!force && mobileBootstrapIdentity === identity && Date.now() - mobileBootstrapLoadedAt < 90000) return;
  if (!force && mobileBootstrapPending && mobileBootstrapPendingIdentity === identity) return mobileBootstrapPending;
  mobileBootstrapPendingIdentity = identity;
  const requestIdentity = identity;
  const generation = mobileSessionGeneration;
  const version = ++mobileLoadVersion;
  const requestToken = localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken');
  const role = currentUser.value.role;
  const permittedScope = ['Admin', 'HR'].includes(role) ? 'all' :
    ['HOD','Supervisor'].includes(role) ? 'overview' : 'personal';
  const job = (async () => {
    const res = await apiPost('hrBootstrap', { scope: permittedScope });
    if (version !== mobileLoadVersion || generation !== mobileSessionGeneration || requestIdentity !== mobileIdentity(currentUser.value) || requestToken !== (localStorage.getItem('hrPortalToken') || sessionStorage.getItem('hrPortalToken'))) return;
    if (res?.status !== 'success' || !res.data) throw Error(res?.message || 'Could not refresh your records. Please try again.');
    if (res?.status === 'success' && res.data) {
        hrBootstrapRecords.value = res.data.records || {};
        hrEmployees.value = (res.data.employees || []).map(emp => ({
  ...emp,
  id: emp.id || emp.employeeNo || emp.name,
  name: emp.name || emp.employee || '',
  employee: emp.name || emp.employee || '',
  company: emp.company || emp.companyName || emp.companyId || '',
  department: emp.department || emp.departmentName || emp.departmentId || ''
}));
        hrTeamLeave.value = res.data.teamLeave || [];
        mobileBootstrapIdentity = identity;
        mobileBootstrapLoadedAt = Date.now();
    }
  })().finally(() => { if (mobileBootstrapPending === job) { mobileBootstrapPending = null; mobileBootstrapPendingIdentity = ''; } });
  mobileBootstrapPending = job;
  return job;
}
function handleSession(e) {
  const nextUser = e.detail;
  showDossierModal.value = false;
  showPersonalAttendance.value = false;
  dossierTargetEmployee.value = '';
  mobileSessionGeneration++;
  mobileBootstrapPending = null;
  mobileBootstrapPendingIdentity = '';
  {
    clearMobileSessionCache();
    mobileBootstrapIdentity = '';
    mobileBootstrapLoadedAt = 0;
    hrBootstrapRecords.value = {};
    hrTeamLeave.value = [];
    hrEmployees.value = [];
  }
  currentUser.value = nextUser;
  if (nextUser && isMobile.value) void refreshMobileBootstrap().catch(console.error);
}
const { renderSummaryDashboard, renderPie, resetPie, getTieredWage, calcStatutory, calculatePeriodDataRange, processLogin, applyUserRoleUI, logout, switchTab, switchMobileTab, fetchPayslips, formatMonthStr, renderSelectedPayslip, closePayslip, printPayslip, handleLeaveTypeChange, loadStaffPortal, loadMyProfile, updateMyProfile, calculateLeaveDays, handleLeaveFileUpload, handleHalfDayChange, submitLeaveApp, fetchMyLeave, withdrawLeave, fetchLeaveManagementData, processLeave, toggleSummaryView, toggleReportType, formatTimeForInput, generateColors, apiPost, formatLocalDate, initializeApp, calculateStats, handleFile, parseData, generatePayrollData, lockCurrentMonth, unlockCurrentMonth, renderDashboard, syncToGoogleSheets, openEditModal, saveRowEdit, buildTable, handleReportExport, exportOTClaimForm, exportSummaryRange, exportToExcel, renderStaffMgmt, handleStaffFileUpload, addNewStaff, openStaffModal, saveStaffProfile, saveBiometricLocally, uploadStaffDocuments, saveStaffPayslipToFolder, saveRateLocally, syncSingleStaff, deleteStaff, renderHolidayMgmt, addHolidayRow, syncHolidaysToDB, handleStatusChange, toggleForgotPass, processResetPassword, enableSplitLeave, handleSplitDaysInput, handleAttendanceCompanyChange, handleAttendanceDepartmentChange, handleStaffCompanyFilterChange, setStaffViewMode, handleSummaryCompanyChange } = dashboardActions;
watch(isMobile, mobile => {
  if (mobile && currentUser.value) void refreshMobileBootstrap().catch(console.error);
  else if (!mobile && ['Admin','HR','HOD','Supervisor'].includes(currentUser.value?.role)) void initializeApp();
});
const sidebarOpen = ref(false);
const showPassword = ref(false);
const { filterStaffCards } = dashboardActions;
watch(sidebarOpen, async (open) => {
    await nextTick();
    if (open) document.querySelector('#sidebar .sidebar-close')?.focus();
    else document.querySelector('.mobile-menu-toggle')?.focus();
});
function trapNavigation(event) {
    if (!sidebarOpen.value) return;
    const items = [...event.currentTarget.querySelectorAll('button, summary, a[href]')];
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onMounted(() => {
    mountDashboard();
    if (typeof window !== 'undefined') {
        window.addEventListener('resize', updateIsMobile);
        window.addEventListener('hr-session', handleSession);
        window.addEventListener('hr-switch-tab', onTabSwitch);
        window.addEventListener('hr-personal-attendance', openPersonalAttendance);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);
        if (window.currentUser) {
            handleSession({ detail: window.currentUser });
        }
    }
});
onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
        window.removeEventListener('resize', updateIsMobile);
        window.removeEventListener('hr-session', handleSession);
        window.removeEventListener('hr-switch-tab', onTabSwitch);
        window.removeEventListener('hr-personal-attendance', openPersonalAttendance);
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    }
});
</script>
<template>
<div id="loginScreen" style="height: 100vh; width: 100vw; display: flex; justify-content: center; align-items: center; background: var(--canvas); position: fixed; top: 0; left: 0; z-index: 9999;">
    
    <section class="login-intro" aria-label="HR Portal employee workspace">
        <div class="brand-mark"><i class="bi bi-grid-1x2-fill" aria-hidden="true"></i><span>HR Portal<span class="brand-subtitle">Employee workspace</span></span></div>
        <div class="login-intro-copy"><span class="eyebrow">YOUR PEOPLE WORKSPACE</span><h1>A clearer view of<br>every working day.</h1><p>Attendance, leave and payroll.<br>One place to keep your team moving.</p></div>
        <div class="login-capabilities"><span><i class="bi bi-calendar-check" aria-hidden="true"></i> Attendance</span><span><i class="bi bi-person-check" aria-hidden="true"></i> Leave</span><span><i class="bi bi-wallet2" aria-hidden="true"></i> Payroll</span></div>
    </section>
    <div class="card shadow p-4" style="width: 350px; border-radius: 12px;" id="loginBox">
        <span class="eyebrow login-eyebrow">HR Portal EMPLOYEE PORTAL</span><h2 class="login-title">Welcome back</h2><p class="login-description">Sign in to your attendance and payroll workspace.</p>
        <div class="mb-3">
            <label class="form-label small fw-bold text-muted" for="loginUser">Username</label>
            <input type="text" id="loginUser" class="form-control" autocomplete="username" placeholder="Enter your username" spellcheck="false">
        </div>
        <div class="mb-4">
            <label class="form-label small fw-bold text-muted" for="loginPass">Password</label>
            <div class="password-field"><input :type="showPassword ? 'text' : 'password'" id="loginPass" class="form-control" autocomplete="current-password" placeholder="Enter your password"><button class="password-toggle" type="button" @click="showPassword = !showPassword" :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword"><i :class="showPassword ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true"></i></button></div>
        </div>
        <button class="btn btn-primary w-100 fw-bold" id="btnLogin" @click="processLogin()">Sign in <i class="bi bi-arrow-right ms-2" aria-hidden="true"></i></button>
        <div class="text-center mt-3">
            <button type="button" class="btn btn-link small fw-bold" @click="toggleForgotPass(true)">Forgot password?</button>
        </div>
        <div id="loginError" role="alert" class="text-danger small mt-2 text-center" style="display:none;"></div>
    </div>

    <div class="card shadow p-4" style="width: 350px; border-radius: 12px; display: none;" id="forgotPassBox">
        <h4 class="fw-bold text-center mb-4 text-primary">Reset Password</h4>
        <div class="mb-3">
            <label class="form-label small fw-bold text-muted">Username</label>
            <input type="text" id="resetUser" class="form-control">
        </div>
        <div class="mb-3">
            <label class="form-label small fw-bold text-muted" for="resetIc">IC No. (xxxxxx-xx-xxxx)</label>
            <input type="text" id="resetIc" class="form-control" placeholder="123456-12-1234">
        </div>
        <div class="mb-4">
            <label class="form-label small fw-bold text-muted" for="resetNewPass">New Password</label>
            <input type="password" id="resetNewPass" class="form-control">
        </div>
        <button class="btn btn-primary w-100 fw-bold mb-2" id="btnResetPass" @click="processResetPassword()">Reset Password</button>
        <div class="text-center">
            <button type="button" class="btn btn-link small" @click="toggleForgotPass(false)"><i class="bi bi-arrow-left me-1" aria-hidden="true"></i> Back to sign in</button>
        </div>
        <div id="resetError" role="alert" class="text-danger small mt-2 text-center" style="display:none;"></div>
        <div id="resetSuccess" role="status" class="text-success small mt-2 text-center" style="display:none;"></div>
    </div>

</div>

<PersonalAttendance v-if="showPersonalAttendance && currentUser && !isMobile" :user="currentUser" @close="showPersonalAttendance = false" />

<MobileAppShell
    v-if="currentUser && isMobile"
    :user="currentUser"
    :records="hrBootstrapRecords"
    :team-leave="hrTeamLeave"
    :employees="hrEmployees"
    @open-dossier="openStaffDossier"
    :refresh-data="() => refreshMobileBootstrap(true)"
    @logout="clearMobileSessionCache(); logout(); currentUser = null"
/>

<div v-show="!currentUser || !isMobile" class="wrapper">
    <button v-if="sidebarOpen" class="sidebar-backdrop no-print" type="button" aria-label="Close navigation" @click="sidebarOpen = false"></button>
    <nav id="sidebar" class="no-print" :class="{ 'sidebar-open': sidebarOpen }" aria-label="Main navigation" @click="$event.target.closest('a') && (sidebarOpen = false)" @keydown.esc="sidebarOpen = false" @keydown.tab="trapNavigation">
        <div class="sidebar-header"><button class="sidebar-close" type="button" aria-label="Close navigation" @click="sidebarOpen = false"><i class="bi bi-x-lg" aria-hidden="true"></i></button>
            <div class="brand-mark"><i class="bi bi-grid-1x2-fill" aria-hidden="true"></i><span>HR Portal<span class="brand-subtitle">People operations</span></span></div>
            
        </div>
        <ul class="list-unstyled components" id="sidebarMenu">
            </ul>
    </nav>

    <main id="content">
        
       <div class="d-flex justify-content-between align-items-center mb-4 border-bottom pb-3 no-print" id="mainTopHeader">
            <div class="header-title-group">
                <button type="button" class="mobile-menu-toggle btn btn-outline-secondary" @click="sidebarOpen = !sidebarOpen" :aria-expanded="sidebarOpen" aria-controls="sidebar" aria-label="Open navigation"><i class="bi bi-list" aria-hidden="true"></i></button>
                <div><span class="workspace-label">PEOPLE OPERATIONS</span>
                <h2 class="fw-bold mb-1" id="pageTitle" style="color: var(--ink);">Payroll Overview</h2></div>
            </div>
            <div class="d-flex gap-2 align-items-center">
                <input type="file" id="fileInput" accept=".csv, .xlsx, .xls" hidden>
                <span id="syncStatus" role="status" aria-live="polite" class="me-2 fw-bold text-secondary" style="font-size:0.9rem; display:none;"></span>
                <button type="button" class="btn btn-outline-secondary px-3 py-2 admin-only-element" @click="initializeApp()" id="refreshSystemBtn" style="display:none;" aria-label="Refresh dashboard data" title="Refresh data"><i class="bi bi-arrow-clockwise"></i></button>
                <AccountMenu />
            </div>
        </div>

        <div id="initialLoader" role="status" aria-live="polite">
            <div class="spinner-border text-primary mb-3" style="width: 3rem; height: 3rem;"></div>
            <h5>Getting your workspace ready</h5><p class="small text-muted">Loading attendance, leave and payroll records.</p>
        </div>
        <div class="alert alert-danger no-print" id="loadError" role="alert" style="display:none;"><i class="bi bi-exclamation-circle me-2" aria-hidden="true"></i><span>We could not load your records. Check your connection and try again.</span><button class="btn btn-sm btn-outline-danger ms-2" type="button" @click="initializeApp()">Try again</button></div>
        <div class="text-center text-muted py-5" id="emptyStateMsg" style="display:none;">
            <i class="bi bi-file-earmark-spreadsheet fs-1 mb-3 text-secondary"></i>
            <h5>Your attendance workspace is ready</h5>
            <p>Attendance and payroll records are synchronized automatically from the backend.</p>
        </div>

        <HrWorkspace :enabled="!isMobile" />
        <div id="summary-dashboard" class="tab-section active" style="display:none;">
            
            <div class="row g-2 mb-4 align-items-center bg-white p-3 rounded-3 shadow-sm border border-light mx-0 no-print">
                <div class="col-12 col-md-auto fw-bold text-muted text-uppercase mb-1 mb-md-0" style="letter-spacing: 1px; font-size:0.8rem;">Analyze Period:</div>
                <div class="col-6 col-md-2">
                    <select class="form-select border-secondary fw-bold" id="summaryViewType" @change="toggleSummaryView()">
                        <option value="monthly">Monthly</option>
                        <option value="accumulated">Accumulated</option>
                    </select>
                </div>
                <div class="col-6 col-md-2" id="summaryMonthDiv">
                    <select class="form-select border-secondary fw-bold" id="sumDashMonth" aria-label="Payroll analysis month" @change="renderSummaryDashboard()"></select>
                </div>
                <div class="col-12 col-md-auto fw-bold text-muted text-uppercase ms-md-2 mb-1 mb-md-0" style="letter-spacing: 1px; font-size:0.8rem;">Company:</div>
                <div class="col-6 col-md-3">
                    <select class="form-select border-secondary fw-semibold" id="summaryCompanySelect" aria-label="Filter summary by company" @change="handleSummaryCompanyChange()">
                        <option value="ALL">All Companies</option>
                    </select>
                </div>
                <div class="col-12 col-md-auto fw-bold text-muted text-uppercase ms-md-2 mb-1 mb-md-0" style="letter-spacing: 1px; font-size:0.8rem;">Dept:</div>
                <div class="col-6 col-md-2">
                    <select class="form-select border-secondary fw-semibold" id="summaryDepartmentSelect" aria-label="Filter summary by department" @change="renderSummaryDashboard()">
                        <option value="ALL">All Projects / Depts</option>
                    </select>
                </div>
            </div>

            <div class="kpi-row" id="kpiPanelSum">
                <div class="kpi-card flex-column align-items-start">
                    <div class="d-flex align-items-center mb-2">
                        <div class="kpi-icon-wrapper icon-blue" style="width:36px; height:36px; font-size:1rem;"><i class="bi bi-wallet-fill"></i></div>
                        <div class="kpi-label">Total Payroll</div>
                    </div>
                    <div class="kpi-value" id="kpiTotalPayroll">RM 0.00</div>
                    <div class="small mt-1 fw-bold" id="kpiTotalPayrollVs" style="color: var(--muted);">vs prev: -</div>
                </div>
                <div class="kpi-card flex-column align-items-start">
                    <div class="d-flex align-items-center mb-2">
                        <div class="kpi-icon-wrapper" style="width:36px; height:36px; font-size:1rem; background: rgba(56, 178, 172, 0.15); color: #319795; border-radius: 10px; display: flex; align-items: center; justify-content: center;"><i class="bi bi-person-fill-dash"></i></div>
                        <div class="kpi-label">Employee Statutory</div>
                    </div>
                    <div class="kpi-value" id="kpiEmpStatutory">RM 0.00</div>
                    <div class="small mt-1 fw-bold" id="kpiEmpStatutoryVs" style="color: var(--muted);">vs prev: -</div>
                </div>
                <div class="kpi-card flex-column align-items-start">
                    <div class="d-flex align-items-center mb-2">
                        <div class="kpi-icon-wrapper" style="width:36px; height:36px; font-size:1rem; background: rgba(128, 90, 213, 0.15); color: #805ad5; border-radius: 10px; display: flex; align-items: center; justify-content: center;"><i class="bi bi-building-fill-add"></i></div>
                        <div class="kpi-label">Employer Statutory</div>
                    </div>
                    <div class="kpi-value" id="kpiEmprStatutory">RM 0.00</div>
                    <div class="small mt-1 fw-bold" id="kpiEmprStatutoryVs" style="color: var(--muted);">vs prev: -</div>
                </div>
                <div class="kpi-card flex-column align-items-start">
                    <div class="d-flex align-items-center mb-2">
                        <div class="kpi-icon-wrapper icon-orange" style="width:36px; height:36px; font-size:1rem;"><i class="bi bi-lightning-charge-fill"></i></div>
                        <div class="kpi-label">OT Intensity (OT/Total)</div>
                    </div>
                    <div class="kpi-value" id="kpiOtIntensity">0%</div>
                    <div class="small mt-1 fw-bold" id="kpiOtIntensityVs" style="color: var(--muted);">vs prev: -</div>
                </div>
                <div class="kpi-card flex-column align-items-start">
                    <div class="d-flex align-items-center mb-2">
                        <div class="kpi-icon-wrapper icon-green" style="width:36px; height:36px; font-size:1rem;"><i class="bi bi-person-fill-exclamation"></i></div>
                        <div class="kpi-label">Avg OT Per Head</div>
                    </div>
                    <div class="kpi-value" id="kpiAvgOt">0 Hrs</div>
                    <div class="small mt-1 fw-bold" id="kpiAvgOtVs" style="color: var(--muted);">vs prev: -</div>
                </div>
            </div>

            <div class="row g-4 mb-4" id="chartPanelSum" style="display:none;">
                <div class="col-md-5">
                    <div class="main-card p-4 h-100">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h5 class="fw-bold text-secondary text-uppercase mb-0" style="font-size:0.85rem; letter-spacing:0.5px;">Wage Distribution</h5>
                            <button class="btn btn-sm btn-outline-secondary py-0" id="btnBackPie" @click="resetPie()" style="display:none;"><i class="bi bi-arrow-left"></i> Back</button>
                        </div>
                        <div class="text-muted small mb-3" id="pieChartInst" style="font-size:0.75rem;">Click on a slice to view detailed breakdown</div>
                        <div class="pie-chart-wrapper" style="position: relative; height:240px; width:100%">
                            <canvas id="wagePieChart"></canvas>
                        </div>
                    </div>
                </div>
                <div class="col-md-7">
                    <div class="main-card p-4 h-100">
                        <h5 class="fw-bold mb-3 text-secondary text-uppercase" style="font-size:0.85rem; letter-spacing:0.5px;">Top 5 OT Earners (Hours)</h5>
                        <div style="position: relative; height:250px; width:100%">
                            <canvas id="otBarChart"></canvas>
                        </div>
                    </div>
                </div>
            </div>

            <div class="main-card mt-4 no-print" id="exportPanelSum" style="display:none;">
                <div class="card-body-custom bg-light border border-light shadow-sm rounded-4">
                    <h5 class="fw-bold mb-4"><i class="bi bi-file-earmark-excel me-2 text-success"></i> Generate Reports</h5>
                    
                    <div class="row g-3 align-items-end" style="max-width: 900px;">
                        <div class="col-md-4">
                            <label class="form-label fw-bold small text-muted text-uppercase" for="reportTypeSelect">Report Type</label>
                            <select class="form-select border-secondary fw-bold" id="reportTypeSelect" @change="toggleReportType()">
                                <option value="summary">Summary Report (Payroll Format)</option>
                                <option value="monthly">Monthly Report (Detailed Individual Rows)</option>
                                <option value="ot_claim">Staff OT Claim (Blank Form)</option>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small text-muted text-uppercase" id="lblMonthStart" for="exportMonthStart">Start Month</label>
                            <select class="form-select border-secondary" id="exportMonthStart"></select>
                        </div>
                        <div class="col-md-3">
                            <label class="form-label fw-bold small text-muted text-uppercase" id="lblMonthEnd" for="exportMonthEnd">End Month</label>
                            <select class="form-select border-secondary" id="exportMonthEnd"></select>
                        </div>
                        <div class="col-md-2">
                            <button class="btn btn-primary w-100 fw-bold shadow-sm" @click="handleReportExport()">
                                Export File
                            </button>
                        </div>
                    </div>
                    <div class="mt-3 text-muted small">
                        <i class="bi bi-info-circle-fill text-primary me-1"></i> 
                        Generating reports automatically applies frozen rates if the month was previously locked in the Attendance Dashboard.
                    </div>
                </div>
            </div>
        </div>

        <div id="dashboard" class="tab-section" style="display:none;">
            <div class="main-card mb-4">
                <div class="card-body-custom">
                    <div class="controls-section no-print" id="controlPanel">
                        <input type="file" id="attendanceFileUpload" accept=".csv, .xlsx, .xls" style="display:none;" />
                        <label for="attendanceFileUpload" class="d-none">Upload Staff Attendance</label>
                        <div class="row g-2 align-items-end">
                            <div class="col-12 col-md-3 col-xl-2">
                                <label class="form-label fw-bold small text-muted text-uppercase mb-1" for="attendanceCompanySelect"><i class="bi bi-building me-1"></i>Company</label>
                                <select class="form-select form-select-sm border-primary-subtle fw-semibold" id="attendanceCompanySelect" aria-label="Filter attendance by company" @change="handleAttendanceCompanyChange()">
                                    <option value="ALL">All Companies</option>
                                </select>
                            </div>
                            <div class="col-12 col-md-3 col-xl-3">
                                <label class="form-label fw-bold small text-muted text-uppercase mb-1" for="attendanceDepartmentSelect"><i class="bi bi-diagram-3 me-1"></i>Project / Department</label>
                                <select class="form-select form-select-sm border-primary-subtle fw-semibold" id="attendanceDepartmentSelect" aria-label="Filter attendance by project or department" @change="handleAttendanceDepartmentChange()">
                                    <option value="ALL">All Projects / Depts</option>
                                </select>
                            </div>
                            <div class="col-12 col-md-3 col-xl-2">
                                <label class="form-label fw-bold small text-muted text-uppercase mb-1" for="staffSelect"><i class="bi bi-person me-1"></i>Staff</label>
                                <select class="form-select form-select-sm border-primary-subtle fw-bold" id="staffSelect" aria-label="Select staff to view" @change="renderDashboard()"></select>
                            </div>
                            <div class="col-6 col-md-3 col-xl-2">
                                <label class="form-label fw-bold small text-muted text-uppercase mb-1" for="monthSelect"><i class="bi bi-calendar-month me-1"></i>Month</label>
                                <select class="form-select form-select-sm border-secondary fw-semibold" id="monthSelect" aria-label="Select month" @change="renderDashboard()"></select>
                            </div>
                            <div class="col-6 col-md-12 col-xl-3">
                                <label class="form-label fw-bold small text-muted text-uppercase mb-1" for="attendanceStaffSearch"><i class="bi bi-search me-1"></i>Search</label>
                                <div class="search-field">
                                    <i class="bi bi-search" aria-hidden="true"></i>
                                    <input type="search" id="attendanceStaffSearch" class="form-control form-control-sm" placeholder="Search by name, ID, role..." aria-label="Search staff attendance" @input="renderDashboard()">
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="reportContainer"></div>
                </div>
            </div>
        </div>

        <div id="staff-mgmt" class="tab-section" style="display:none;">
            <div id="staffContent" class="main-card" style="background: transparent; box-shadow: none;">
                <div class="staff-toolbar no-print p-3 bg-white rounded-3 shadow-sm border mb-4">
                    <div class="row g-2 align-items-end">
                        <div class="col-12 col-sm-6 col-lg-3">
                            <label class="form-label small fw-bold text-muted text-uppercase mb-1" for="staffCompanyFilter"><i class="bi bi-building me-1"></i>Company</label>
                            <select id="staffCompanyFilter" class="form-select form-select-sm fw-semibold" aria-label="Filter staff by company" @change="handleStaffCompanyFilterChange()">
                                <option value="all">All Companies</option>
                            </select>
                        </div>
                        <div class="col-12 col-sm-6 col-lg-3">
                            <label class="form-label small fw-bold text-muted text-uppercase mb-1" for="staffDepartmentFilter"><i class="bi bi-diagram-3 me-1"></i>Project / Department</label>
                            <select id="staffDepartmentFilter" class="form-select form-select-sm fw-semibold" aria-label="Filter staff by department" @change="filterStaffCards()">
                                <option value="all">All Projects / Depts</option>
                            </select>
                        </div>
                        <div class="col-12 col-sm-8 col-lg-5">
                            <label class="form-label small fw-bold text-muted text-uppercase mb-1" for="staffSearch"><i class="bi bi-search me-1"></i>Staff Search</label>
                            <div class="search-field">
                                <i class="bi bi-search" aria-hidden="true"></i>
                                <input type="search" id="staffSearch" class="form-control form-control-sm" placeholder="Search by name, IC, role, grade..." aria-label="Search staff" @input="filterStaffCards()">
                            </div>
                        </div>
                        <div style="display:none;">
                            <select id="staffStatusFilter" class="form-select form-select-sm" aria-label="Filter staff by employment status" @change="filterStaffCards()">
                                <option value="all">All statuses</option>
                                <option value="Active">Active</option>
                                <option value="Resigned">Resigned</option>
                            </select>
                        </div>
                        <div class="col-12 col-sm-4 col-lg-auto d-flex flex-column align-items-center justify-content-end ms-lg-auto">
                            <label class="form-label small fw-bold text-muted text-uppercase mb-1 d-none d-lg-block text-center w-100">Layout</label>
                            <div class="btn-group btn-group-sm layout-switcher-pill shadow-sm" role="group" aria-label="View layout switcher">
                                <div role="button" tabindex="0" id="staffViewTableBtn" class="btn btn-outline-primary active" title="Data Table View" @click="setStaffViewMode('table')">
                                    <i class="bi bi-table"></i>
                                </div>
                                <div role="button" tabindex="0" id="staffViewCardsBtn" class="btn btn-outline-primary" title="Compact Cards View" @click="setStaffViewMode('cards')">
                                    <i class="bi bi-grid-fill"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top flex-wrap gap-2">
                        <span id="staffResultCount" class="small text-muted fw-semibold" role="status" aria-live="polite"></span>
                        <div class="d-flex align-items-center gap-2 ms-auto">
                            <button class="btn btn-primary btn-sm fw-bold shadow-sm" id="btnAddStaff" @click="addNewStaff()">
                                <i class="bi bi-person-plus-fill me-1"></i> Add Staff
                            </button>
                            <button id="openStaffDossierBtn" class="btn btn-outline-info btn-sm fw-bold shadow-sm" type="button" @click="openStaffDossier()">
                                <i class="bi bi-file-earmark-person me-1"></i> 360° Staff Dossier
                            </button>
                        </div>
                    </div>
                </div>
                <div id="staffSearchEmpty" class="search-empty bg-white p-5 rounded-3 shadow-sm border text-center" style="display:none;">
                    <i class="bi bi-people fs-1 text-muted mb-2 d-block" aria-hidden="true"></i>
                    <h5 class="fw-bold">No matching staff found</h5>
                    <p class="text-muted mb-0">Try adjusting your company, department, status filter or search keyword.</p>
                </div>
                <div id="staffCardsContainer"></div>
            </div>
        </div>

        <div id="holidays" class="tab-section admin-only-element" style="display:none;">
            <div id="holidayContent" class="main-card">
                <div class="card-body-custom p-3">
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                        <div>
                            <h5 class="fw-bold mb-1 text-dark"><i class="bi bi-calendar-event me-2 text-primary"></i>Public Holiday Schedule &amp; Entitlement Matrix</h5>
                            <p class="text-muted small mb-0">Configure holidays by Company, Work Base (Office / Site) and Location (PG, SEL, KL, NS) matching official gazetted dates.</p>
                        </div>
                        <div class="d-flex flex-wrap align-items-center gap-2">
                            <button type="button" class="btn btn-outline-success btn-sm fw-semibold" id="btnDownloadHolidayTemplate" onclick="downloadHolidayTemplate()">
                                <i class="bi bi-file-earmark-excel me-1"></i>Template
                            </button>
                            <button type="button" class="btn btn-outline-primary btn-sm fw-semibold" id="btnUploadHolidays" onclick="$('#holidayExcelInput').click()">
                                <i class="bi bi-cloud-arrow-up me-1"></i>Upload
                            </button>
                            <input type="file" id="holidayExcelInput" accept=".xlsx, .xls, .csv" style="display:none;" onchange="handleHolidayFileUpload(event)" />
                            <button type="button" class="btn btn-outline-secondary btn-sm fw-semibold" id="btnLoad2026HolidayPreset" onclick="loadDefault2026HolidayMatrix()">
                                <i class="bi bi-magic me-1"></i>Preload 2026 Schedule
                            </button>
                            <button type="button" class="btn btn-outline-primary btn-sm fw-semibold" onclick="addHolidayRow()">
                                <i class="bi bi-plus-lg me-1"></i>Add Holiday
                            </button>
                            <button type="button" class="btn btn-primary btn-sm fw-bold shadow-sm" id="saveHolBtn" onclick="syncHolidaysToDB()">
                                <i class="bi bi-cloud-arrow-up-fill me-1"></i>Save Holidays to DB
                            </button>
                        </div>
                    </div>

                    <!-- Filter Bar for Holidays -->
                    <div class="bg-light border rounded p-2 mb-3 d-flex flex-wrap align-items-center gap-2">
                        <div class="d-flex align-items-center gap-1">
                            <span class="small fw-bold text-muted"><i class="bi bi-funnel me-1"></i>Filter:</span>
                        </div>
                        <div style="min-width: 140px;">
                            <select id="holidayYearFilter" class="form-select form-select-sm" onchange="renderHolidayMgmt()">
                                <option value="all">All Years</option>
                                <option value="2026" selected>Year 2026</option>
                                <option value="2025">Year 2025</option>
                            </select>
                        </div>
                        <div style="min-width: 140px;">
                            <select id="holidayCompanyFilter" class="form-select form-select-sm" onchange="renderHolidayMgmt()">
                                <option value="all">All Companies</option>
                                <option value="SQ">Setar Quay (SQ)</option>
                                <option value="MS">Milan Stream (MS)</option>
                            </select>
                        </div>
                        <div class="flex-grow-1" style="min-width: 200px;">
                            <input type="text" id="holidaySearchInput" class="form-control form-control-sm" placeholder="Search holiday title or notes..." oninput="renderHolidayMgmt()">
                        </div>
                    </div>

                    <div class="table-responsive border rounded shadow-sm" style="max-height: 650px; overflow-y: auto;">
                        <table class="table table-bordered table-hover align-middle mb-0" id="holidayMatrixTable">
                            <thead class="table-dark sticky-top small" style="z-index: 5;">
                                <tr>
                                    <th rowspan="2" class="text-center align-middle" style="width: 45px;">No.</th>
                                    <th rowspan="2" class="align-middle text-center" style="min-width: 150px;">Date (DD/MM/YYYY)</th>
                                    <th rowspan="2" class="align-middle text-center" style="width: 110px;">Day</th>
                                    <th rowspan="2" class="align-middle" style="min-width: 250px;">Public Holiday</th>
                                    <th rowspan="2" class="align-middle" style="width: 95px;">Company</th>
                                    <th colspan="2" class="text-center text-white py-1" style="background-color: #ea580c; letter-spacing: 0.5px;">OFFICE</th>
                                    <th colspan="4" class="text-center text-white py-1" style="background-color: #16a34a; letter-spacing: 0.5px;">SITE</th>
                                    <th rowspan="2" class="text-center align-middle" style="width: 80px;">Action</th>
                                </tr>
                                <tr>
                                    <th class="text-center py-1 fw-bold" style="background-color: #fed7aa; color: #9a3412; width: 65px;" title="Office - Penang">PG</th>
                                    <th class="text-center py-1 fw-bold" style="background-color: #fed7aa; color: #9a3412; width: 65px;" title="Office - Selangor">SEL</th>
                                    <th class="text-center py-1 fw-bold" style="background-color: #bbf7d0; color: #166534; width: 65px;" title="Site - Penang">PG</th>
                                    <th class="text-center py-1 fw-bold" style="background-color: #bbf7d0; color: #166534; width: 65px;" title="Site - Selangor">SEL</th>
                                    <th class="text-center py-1 fw-bold" style="background-color: #bbf7d0; color: #166534; width: 65px;" title="Site - Kuala Lumpur">KL</th>
                                    <th class="text-center py-1 fw-bold" style="background-color: #bbf7d0; color: #166534; width: 65px;" title="Site - Negeri Sembilan">NS</th>
                                </tr>
                            </thead>
                            <tbody id="holidayTableBody"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <div id="my-attendance" class="tab-section" style="display:none;">
            <PersonalAttendance v-if="currentUser && !isMobile" :user="currentUser" :embedded="true" />
        </div>

        <div id="payslips-portal" class="tab-section" style="display:none;">
            
            <div class="main-card p-4 shadow-sm">
                <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3 no-print">
                    <h2 class="h5 mb-0">Pay history</h2>
                    <button id="refreshPayslips" class="btn btn-outline-primary btn-sm" style="display:none;" @click="fetchPayslips()">Refresh payslips</button>
                </div>
                <p id="payslip-status" class="text-muted" role="status" aria-live="polite"></p>
                <p id="payslip-error" class="text-danger" role="alert" style="display:none;"></p>
                <div id="payslip-list" class="table-responsive no-print" style="display:none;">
                    <table class="table table-hover align-middle border shadow-sm rounded-3 overflow-hidden">
                        <caption class="visually-hidden">Your payslips, newest pay period first</caption>
                        <thead class="table-light small">
                            <tr>
                                <th scope="col" class="fw-bold">Pay Period</th>
                                <th scope="col" class="text-end fw-bold">Basic (RM)</th>
                                <th scope="col" class="text-end fw-bold">OT / Add (RM)</th>
                                <th scope="col" class="text-end fw-bold">Gross (RM)</th>
                                <th scope="col" class="text-end fw-bold">EPF (RM)</th>
                                <th scope="col" class="text-end fw-bold">SOCSO/EIS (RM)</th>
                                <th scope="col" class="text-end fw-bold">Tax / PCB (RM)</th>
                                <th scope="col" class="text-end fw-bold">Deductions (RM)</th>
                                <th scope="col" class="text-end fw-bold text-success">Net Pay (RM)</th>
                                <th scope="col" class="text-center fw-bold">Status</th>
                                <th scope="col" class="text-end fw-bold">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="payslip-list-body"></tbody>
                    </table>
                </div>
                <div id="no-payslip-msg" class="text-center text-muted py-5" style="display:none;">
                    <i class="bi bi-receipt fs-1 mb-3 text-secondary" aria-hidden="true"></i>
                    <h3 class="h5">No payslips available</h3>
                    <p>Your payslips will appear here when payroll is published.</p>
                </div>
                <div id="payslip-detail-toolbar" class="d-flex justify-content-between align-items-center mt-4 mb-3 no-print d-none">
                    <h3 id="payslip-detail-title" class="h5 mb-0" tabindex="-1"></h3>
                    <button class="btn btn-outline-secondary btn-sm" @click="closePayslip()">Close details</button>
                </div>
                <div id="payslip-print-section" style="display:none;">
                    <div class="ps-border-b d-flex justify-content-between">
                        <div>
                            <strong>EMPLOYEE PAYSLIP</strong><br>
                            NAME &nbsp;&nbsp;&nbsp;: <span id="ps-name" class="text-uppercase fw-bold"></span><br>
                            DEPT &nbsp;&nbsp;&nbsp;: PETROL STATION
                        </div>
                        <div>
                            PAY PERIOD : <span id="ps-period"></span><br>
                            STAFF# &nbsp;&nbsp;&nbsp;: <span id="ps-staff-id"></span><br>
                            I/C# &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span id="ps-ic"></span>
                        </div>
                    </div>
                    
                    <div class="ps-grid-col2 ps-border-solid-b">
                        <div class="ps-row-flex">
                            <div class="text-center w-100">--- EARNINGS ---</div>
                            <div style="min-width: 100px; text-align: right;">--- RM ---</div>
                        </div>
                        <div class="ps-row-flex ps-divider-v">
                            <div class="text-center w-100">--- DEDUCTIONS ---</div>
                            <div style="min-width: 100px; text-align: right;">--- RM ---</div>
                        </div>
                    </div>
                    
                    <div class="ps-grid-col2">
                        <div>
                            <div class="ps-row-flex">
                                <div>BASIC PAY</div><div id="ps-basic"></div>
                            </div>
                            <div class="ps-row-flex mt-1">
                                <div>TOTAL OVERTIME</div><div id="ps-ot"></div>
                            </div>
                            <div style="height: 120px;"></div>
                            <div class="ps-row-flex ps-border-t">
                                <div class="pe-3">TOTAL :</div><div id="ps-gross"></div>
                            </div>
                        </div>
                        <div class="ps-divider-v">
                            <div class="ps-row-flex">
                                <div>EMPLOYEE EPF (KWSP)</div><div id="ps-epf-emp"></div>
                            </div>
                            <div class="ps-row-flex mt-1">
                                <div>EMPLOYEE SOCSO (PERKESO)</div><div id="ps-socso-emp"></div>
                            </div>
                            <div class="ps-row-flex mt-1">
                                <div>EMPLOYEE EIS</div><div id="ps-eis-emp"></div>
                            </div>
                            <div style="height: 102px;"></div>
                            <div class="ps-row-flex ps-border-t">
                                <div class="pe-3">TOTAL :</div><div id="ps-deductions"></div>
                            </div>
                        </div>
                    </div>

                    <div class="ps-grid-col2 ps-border-solid-t">
                        <div class="pt-1">
                            ANNUAL USED SINCE OPENING : <span id="ps-al-taken">0.00</span> &nbsp;&nbsp;&nbsp; BALANCE : <span id="ps-al-bal">0.00</span><br>
                            MEDICAL USED SINCE OPENING : <span id="ps-mc-taken">0.00</span> &nbsp;&nbsp;&nbsp; BALANCE : <span id="ps-mc-bal">0.00</span>
                        </div>
                        <div class="ps-row-flex ps-divider-v pt-1">
                            <div class="pe-3 fw-bold ps-4">NETT PAY :</div>
                            <div id="ps-nett" class="fw-bold" style="border-bottom: 3px double #000; padding-bottom: 2px;"></div>
                        </div>
                    </div>

                    <div class="ps-border-solid-t mt-2 pt-2">
                        <div class="d-flex gap-5">
                            <div>EPF#&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span id="ps-epf-no">-</span></div>
                            <div>TAX#&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span id="ps-tax-no">-</span></div>
                        </div>
                        <div class="d-flex gap-5 mt-1 pb-2">
                            <div>SOCSO/EIS#: <span id="ps-socso-no">-</span></div>
                            <div>BANK#&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <span id="ps-bank-no">-</span></div>
                        </div>
                    </div>

                    <div class="ps-border-solid-t pt-2 ps-grid-col2">
                        <div>
                            <div class="text-center mb-1">--- CURRENT-MONTH ---</div>
                            <table class="ps-table">
                                <tr><th class="txt-left"></th><th>E.P.F.</th><th>SOCSO</th><th>EIS</th><th>TAX</th></tr>
                                <tr><td class="txt-left">EMP'EE:</td><td id="ps-cm-epf-emp"></td><td id="ps-cm-socso-emp"></td><td id="ps-cm-eis-emp"></td><td>0.00</td></tr>
                                <tr><td class="txt-left">EMP'ER:</td><td id="ps-cm-epf-empr"></td><td id="ps-cm-socso-empr"></td><td id="ps-cm-eis-empr"></td><td></td></tr>
                                <tr><td class="txt-left">TOTAL :</td><td id="ps-cm-epf-tot"></td><td id="ps-cm-socso-tot"></td><td id="ps-cm-eis-tot"></td><td></td></tr>
                            </table>
                        </div>
                        <div class="ps-divider-v">
                            <div class="text-center mb-1">--- YEAR-TO-DATE ---</div>
                            <table class="ps-table">
                                <tr><th class="txt-left"></th><th>E.P.F.</th><th>SOCSO</th><th>EIS</th><th>TAX</th></tr>
                                <tr><td class="txt-left">EMP'EE:</td><td id="ps-ytd-epf-emp"></td><td id="ps-ytd-socso-emp"></td><td id="ps-ytd-eis-emp"></td><td>0.00</td></tr>
                                <tr><td class="txt-left">EMP'ER:</td><td id="ps-ytd-epf-empr"></td><td id="ps-ytd-socso-empr"></td><td id="ps-ytd-eis-empr"></td><td></td></tr>
                                <tr><td class="txt-left">TOTAL :</td><td id="ps-ytd-epf-tot"></td><td id="ps-ytd-socso-tot"></td><td id="ps-ytd-eis-tot"></td><td></td></tr>
                            </table>
                        </div>
                    </div>
                </div>

            </div>
        </div>

        
        <div id="my-profile" class="tab-section profile-redesign-shell" style="display:none;">
            <!-- Modern Compact Profile Hero Card -->
            <div class="profile-hero-card mb-3">
                <div class="profile-hero-content">
                    <div class="profile-avatar-wrapper" id="myProfileAvatarContainer" title="Click to upload profile photo to Google Drive">
                        <img id="myProfileAvatarImg" src="" class="profile-avatar-img" alt="Profile Photo" style="display:none;" />
                        <div id="myProfileAvatarInitials" class="profile-avatar-initials">--</div>
                        <button type="button" class="btn btn-primary profile-avatar-cam-btn" id="btnUploadProfilePhoto" title="Upload profile photo">
                            <i class="bi bi-camera-fill"></i>
                        </button>
                        <div id="myProfilePhotoSpinner" class="profile-photo-spinner" style="display:none;">
                            <span class="spinner-border spinner-border-sm text-light"></span>
                        </div>
                        <input type="file" id="myProfilePhotoFileInput" accept="image/*" style="display:none;" />
                    </div>

                    <div class="profile-hero-identity">
                        <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
                            <h4 class="fw-bold mb-0 text-dark" id="myProfileHeroName">Loading profile...</h4>
                            <span class="badge rounded-pill bg-success-subtle text-success border border-success-subtle px-2 py-1 small fw-semibold" id="myProfileHeroStatus">
                                <i class="bi bi-circle-fill me-1" style="font-size: 0.5rem; vertical-align: middle;"></i>Active
                            </span>
                            <span class="badge rounded-pill bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 small fw-semibold" id="myProfileHeroRole">Staff</span>
                        </div>
                        <div class="text-secondary small mb-2">
                            <span id="myProfileHeroJobTitle" class="fw-semibold text-dark">Staff</span>
                            <span class="text-muted mx-1">&bull;</span>
                            <span id="myProfileHeroDepartment">Department</span>
                            <span class="text-muted mx-1">&bull;</span>
                            <span id="myProfileHeroCompany">Company</span>
                        </div>
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span class="badge bg-light text-dark border px-2 py-1 small fw-normal">
                                <i class="bi bi-person-badge text-primary me-1"></i><span id="myProfileHeroEmpNo">ID: —</span>
                            </span>
                            <span class="badge bg-light text-dark border px-2 py-1 small fw-normal">
                                <i class="bi bi-geo-alt text-danger me-1"></i><span id="myProfileHeroLocation">—</span>
                            </span>
                            <span class="badge bg-light text-dark border px-2 py-1 small fw-normal">
                                <i class="bi bi-briefcase text-secondary me-1"></i><span id="myProfileHeroWorkBase">Office</span>
                            </span>
                        </div>
                    </div>

                    <div class="profile-hero-actions ms-auto">
                        <button type="button" class="btn btn-outline-secondary btn-sm" @click="switchMobileTab('payslips-portal')">
                            <i class="bi bi-receipt me-1"></i>My Payslips
                        </button>
                        <button type="button" class="btn btn-outline-secondary btn-sm" @click="openStaffDossier()">
                            <i class="bi bi-person-vcard me-1"></i>360° Dossier
                        </button>
                        <button type="button" class="btn btn-primary btn-sm px-3 fw-bold shadow-sm" id="btnUpdateMyProfileTop" @click="updateMyProfile()">
                            <i class="bi bi-check-circle me-1"></i>Save Changes
                        </button>
                    </div>
                </div>
            </div>

            <!-- Sleek Compact Sub-tabs Navigation -->
            <ul class="nav nav-pills profile-nav-pills mb-3" id="myProfileTabs" role="tablist">
                <li class="nav-item flex-fill text-center" role="presentation">
                    <button class="nav-link active py-2 px-3 fw-semibold w-100" id="myprofile-tab-personal-btn" data-bs-toggle="pill" data-bs-target="#myprofile-tab-personal" type="button" role="tab">
                        <i class="bi bi-person-fill me-1"></i>Personal &amp; Contact
                    </button>
                </li>
                <li class="nav-item flex-fill text-center" role="presentation">
                    <button class="nav-link py-2 px-3 fw-semibold w-100" id="myprofile-tab-employment-btn" data-bs-toggle="pill" data-bs-target="#myprofile-tab-employment" type="button" role="tab">
                        <i class="bi bi-building me-1"></i>Employment &amp; Org
                    </button>
                </li>
                <li class="nav-item flex-fill text-center" role="presentation">
                    <button class="nav-link py-2 px-3 fw-semibold w-100" id="myprofile-tab-salary-btn" data-bs-toggle="pill" data-bs-target="#myprofile-tab-salary" type="button" role="tab">
                        <i class="bi bi-cash-stack me-1"></i>Salary &amp; Statutory
                    </button>
                </li>
                <li class="nav-item flex-fill text-center" role="presentation">
                    <button class="nav-link py-2 px-3 fw-semibold w-100" id="myprofile-tab-schedule-btn" data-bs-toggle="pill" data-bs-target="#myprofile-tab-schedule" type="button" role="tab">
                        <i class="bi bi-calendar2-week me-1"></i>Leave &amp; Schedule
                    </button>
                </li>
                <li class="nav-item flex-fill text-center" role="presentation">
                    <button class="nav-link py-2 px-3 fw-semibold w-100" id="myprofile-tab-docs-btn" data-bs-toggle="pill" data-bs-target="#myprofile-tab-docs" type="button" role="tab">
                        <i class="bi bi-folder2-open me-1"></i>Documents &amp; Drive
                    </button>
                </li>
            </ul>

            <div class="tab-content" id="myProfileTabContent">
                <!-- Tab 1: Personal & Contact -->
                <div class="tab-pane fade show active" id="myprofile-tab-personal" role="tabpanel">
                    <!-- Read-only Personal Details -->
                    <div class="profile-card-section mb-3">
                        <div class="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
                            <h6 class="fw-bold text-dark mb-0"><i class="bi bi-card-text text-primary me-2"></i>Personal Information</h6>
                            <span class="badge bg-light text-muted border small">Company Master Record</span>
                        </div>
                        <div class="row g-2">
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileStatus">Status</label>
                                <input type="text" class="form-control" id="myProfileStatus" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group" id="divMyProfileResignDate" style="display:none;">
                                <label for="myProfileResignDate" class="text-danger">Resignation Date</label>
                                <input type="text" class="form-control border-danger text-danger fw-bold" id="myProfileResignDate" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileName">Full Name</label>
                                <input type="text" class="form-control fw-semibold" id="myProfileName" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileIcNo">IC / NRIC No.</label>
                                <input type="text" class="form-control" id="myProfileIcNo" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileGender">Gender</label>
                                <input type="text" class="form-control" id="myProfileGender" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileRace">Race</label>
                                <input type="text" class="form-control" id="myProfileRace" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileAge">Age</label>
                                <input type="text" class="form-control" id="myProfileAge" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileAcademicLevel">Academic Level</label>
                                <input type="text" class="form-control" id="myProfileAcademicLevel" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileUsername">Username</label>
                                <input type="text" class="form-control" id="myProfileUsername" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileRole">System Role</label>
                                <input type="text" class="form-control fw-semibold" id="myProfileRole" readonly>
                            </div>
                        </div>
                    </div>

                    <!-- Editable Contact & Security Details -->
                    <div class="profile-card-section editable-card">
                        <div class="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
                            <div>
                                <h6 class="fw-bold text-primary mb-0"><i class="bi bi-pencil-square me-2"></i>Contact &amp; Security Settings</h6>
                                <p class="text-muted small mb-0">You can edit your contact numbers, address, and password below.</p>
                            </div>
                            <span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 small">Editable</span>
                        </div>
                        <div class="row g-3">
                            <div class="col-md-6 profile-field-group">
                                <label for="myProfileContact"><i class="bi bi-telephone text-primary"></i> Contact No.</label>
                                <input type="text" class="form-control border-primary" id="myProfileContact" placeholder="e.g. +6012-3456789">
                            </div>
                            <div class="col-md-6 profile-field-group">
                                <label for="myProfileEmergency"><i class="bi bi-heart-pulse text-danger"></i> Emergency Contact</label>
                                <input type="text" class="form-control border-primary" id="myProfileEmergency" placeholder="Name & contact phone">
                            </div>
                            <div class="col-12 profile-field-group">
                                <label for="myProfileAddress"><i class="bi bi-geo-alt text-success"></i> Residential Address</label>
                                <textarea class="form-control border-primary" id="myProfileAddress" rows="2" placeholder="Full residential address"></textarea>
                            </div>
                            <div class="col-md-6 profile-field-group">
                                <label for="myProfilePassword"><i class="bi bi-lock text-warning"></i> Password</label>
                                <input type="password" class="form-control border-primary" id="myProfilePassword" placeholder="Leave blank to keep unchanged" autocomplete="new-password">
                                <div class="form-text small text-muted">Only enter text here if you wish to change your login password.</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab 2: Employment & Organisation -->
                <div class="tab-pane fade" id="myprofile-tab-employment" role="tabpanel">
                    <div class="profile-card-section mb-3">
                        <div class="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
                            <h6 class="fw-bold text-dark mb-0"><i class="bi bi-diagram-3 text-primary me-2"></i>Organizational Alignment</h6>
                            <span class="badge bg-light text-muted border small">HR Master</span>
                        </div>
                        <div class="row g-2">
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileEmployeeNo">Employee ID</label>
                                <input type="text" class="form-control fw-semibold" id="myProfileEmployeeNo" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileBiometricId">Biometric Device ID</label>
                                <input type="text" class="form-control" id="myProfileBiometricId" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileCompany">Company</label>
                                <input type="text" class="form-control" id="myProfileCompany" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileDepartment">Department</label>
                                <input type="text" class="form-control" id="myProfileDepartment" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileManager">Reporting Manager</label>
                                <input type="text" class="form-control" id="myProfileManager" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileJobTitle">Job Title</label>
                                <input type="text" class="form-control fw-semibold" id="myProfileJobTitle" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileJobGrade">Job Grade</label>
                                <input type="text" class="form-control" id="myProfileJobGrade" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileEmail">Work Email</label>
                                <input type="text" class="form-control" id="myProfileEmail" readonly>
                            </div>
                            <div class="col-sm-6 col-md-6 profile-field-group">
                                <label for="myProfileWorkBase">Work Base</label>
                                <input type="text" class="form-control" id="myProfileWorkBase" readonly>
                            </div>
                            <div class="col-sm-6 col-md-6 profile-field-group">
                                <label for="myProfileLocation">Work Location / Site</label>
                                <input type="text" class="form-control" id="myProfileLocation" readonly>
                            </div>
                            <div class="col-12 profile-field-group mt-2">
                                <label for="myProfileAssignedResources"><i class="bi bi-laptop me-1 text-primary"></i>Assigned Resources &amp; Equipment</label>
                                <textarea class="form-control" id="myProfileAssignedResources" rows="2" readonly></textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab 3: Salary & Statutory -->
                <div class="tab-pane fade" id="myprofile-tab-salary" role="tabpanel">
                    <div class="profile-card-section mb-3">
                        <div class="profile-salary-hero mb-3">
                            <div>
                                <span class="badge bg-success text-white px-2 py-1 mb-1 small fw-semibold">CONFIDENTIAL COMPENSATION</span>
                                <h4 class="fw-bold text-success mb-0 d-flex align-items-center">
                                    <span class="fs-6 me-2 text-muted fw-normal">Basic Salary:</span>
                                    <input type="text" class="form-control-plaintext text-success fw-bold p-0 d-inline-block fs-4 w-auto" id="myProfileBasic" readonly value="RM 0.00">
                                </h4>
                            </div>
                            <div class="d-flex gap-3 text-end">
                                <div>
                                    <label class="text-muted small text-uppercase fw-bold mb-0" style="font-size:0.7rem;">Joined Date</label>
                                    <input type="text" class="form-control-plaintext text-end fw-semibold p-0 small" id="myProfileJoined" readonly value="-">
                                </div>
                                <div class="border-start ps-3">
                                    <label class="text-muted small text-uppercase fw-bold mb-0" style="font-size:0.7rem;">Confirmation Date</label>
                                    <input type="text" class="form-control-plaintext text-end fw-semibold p-0 small" id="myProfileConfirm" readonly value="-">
                                </div>
                            </div>
                        </div>

                        <div class="row g-2">
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileEpfNo">EPF Account No.</label>
                                <input type="text" class="form-control" id="myProfileEpfNo" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileSocsoNo">SOCSO / EIS No.</label>
                                <input type="text" class="form-control" id="myProfileSocsoNo" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileTaxNo">Income Tax No.</label>
                                <input type="text" class="form-control" id="myProfileTaxNo" readonly>
                            </div>
                            <div class="col-sm-6 col-md-3 profile-field-group">
                                <label for="myProfileBankNo">Bank Account No.</label>
                                <input type="text" class="form-control" id="myProfileBankNo" readonly>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab 4: Leave & Schedule -->
                <div class="tab-pane fade" id="myprofile-tab-schedule" role="tabpanel">
                    <div class="profile-card-section mb-3">
                        <div class="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
                            <h6 class="fw-bold text-dark mb-0"><i class="bi bi-calendar2-check text-primary me-2"></i>Leave Entitlements &amp; Roster Schedule</h6>
                            <span class="badge bg-light text-muted border small">Policy Year 2026</span>
                        </div>
                        <div class="row g-3 mb-3">
                            <div class="col-md-6">
                                <div class="profile-stat-tile">
                                    <div class="stat-num text-primary">
                                        <input type="text" class="form-control-plaintext text-center text-primary fw-bold p-0 fs-3" id="myProfileAl" readonly value="—">
                                    </div>
                                    <div class="stat-lbl">Annual Leave Entitlement (Days)</div>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="profile-stat-tile">
                                    <div class="stat-num text-info">
                                        <input type="text" class="form-control-plaintext text-center text-info fw-bold p-0 fs-3" id="myProfileMc" readonly value="—">
                                    </div>
                                    <div class="stat-lbl">Medical Leave Entitlement (Days)</div>
                                </div>
                            </div>
                        </div>
                        <div class="profile-field-group mt-2">
                            <label><i class="bi bi-moon-stars text-primary me-1"></i>Weekly Rest Days &amp; Shift Schedule</label>
                            <div id="myProfileRestDaysBadges" class="d-flex flex-wrap gap-2 p-2 border rounded bg-light"></div>
                        </div>
                    </div>
                </div>

                <!-- Tab 5: Documents & Drive -->
                <div class="tab-pane fade" id="myprofile-tab-docs" role="tabpanel">
                    <div class="profile-card-section mb-3">
                        <div class="d-flex align-items-center justify-content-between mb-3 border-bottom pb-2">
                            <div>
                                <h6 class="fw-bold text-dark mb-0"><i class="bi bi-google text-danger me-2"></i>Google Drive Employee Vault</h6>
                                <p class="text-muted small mb-0">Your private Google Drive folder where your documents, contracts, and profile photos are securely stored.</p>
                            </div>
                        </div>
                        <div id="myProfileFolderLink" class="mb-4">
                            <span class="text-muted small"><i class="spinner-border spinner-border-sm me-1"></i>Loading folder link...</span>
                        </div>
                        <div class="border-top pt-3">
                            <h6 class="fw-bold text-secondary small text-uppercase mb-2"><i class="bi bi-paperclip me-1"></i>Attached Documents &amp; Records</h6>
                            <div id="myProfileAttachmentList" class="p-3 border rounded bg-light d-flex flex-wrap gap-2">
                                <span class="text-muted small">No profile documents attached yet.</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Bottom Action Footer -->
            <div class="profile-card-section d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3">
                <div class="d-flex flex-wrap gap-2">
                    <button type="button" class="btn btn-outline-danger btn-sm" @click="logout(); sidebarOpen = false">
                        <i class="bi bi-box-arrow-right me-1"></i>Sign Out
                    </button>
                </div>
                <button class="btn btn-primary px-4 fw-bold shadow-sm" id="btnUpdateMyProfile" @click="updateMyProfile()">
                    <i class="bi bi-check-circle me-2"></i>Save Changes
                </button>
            </div>
        </div>

        <div id="staff-portal" class="tab-section" style="display:none;">
            
            <div id="leaveFeedback" role="status" aria-live="polite" class="alert" style="display:none;"></div>
            <div class="leave-balance-grid">
             <article class="leave-balance"><span><i class="bi bi-sun"/>Annual leave available</span><div><strong id="alBalanceDisplay">—</strong><small>days</small></div><p id="alEntitlementDisplay">Loading entitlement…</p></article>
             <article class="leave-balance"><span><i class="bi bi-heart-pulse"/>Medical leave available</span><div><strong id="mcBalanceDisplay">—</strong><small>days</small></div><p id="mcEntitlementDisplay">Loading entitlement…</p></article>
             <article class="leave-balance"><span><i class="bi bi-hourglass-split"/>Awaiting approval</span><div><strong id="myLeavePending">—</strong><small>requests</small></div><p>Includes withdrawal requests</p></article>
             <article class="leave-balance"><span><i class="bi bi-calendar-event"/>Next approved leave</span><div><strong class="leave-next-date" id="myNextLeave">—</strong></div><p id="myNextLeaveType">No upcoming leave</p></article>
            </div>
            <div id="leave-other-balances" class="leave-balance-grid"></div>
            <div class="leave-apply-layout"><div class="main-card p-4 leave-application">

                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
                    <h5 class="fw-bold text-primary mb-0"><i class="bi bi-calendar-plus me-2"></i>New leave request</h5>
                    <span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 small" id="inductionPolicyBadge">
                        <i class="bi bi-shield-check me-1"></i>Metrio Induction Policy FAM-23/G (Jul 2025) &amp; Employment Act 1955 Sec 60E
                    </span>
                </div>
                <p class="text-muted small">Choose your dates and review the calculated duration before submitting.</p>
                
                <div class="row g-3 mb-3">
                    <!-- Row 1: Leave Type (rearranged in logical order) -->
                    <div class="col-12">
                        <label class="form-label small fw-bold text-muted" for="leaveType">Leave Type</label>
                        <select class="form-select" id="leaveType" @change="handleLeaveTypeChange()">
                            <option value="AL">AL - Annual Leave</option>
                            <option value="EL">EL - Emergency Leave</option>
                            <option value="ML">ML - Medical Leave (MC)</option>
                            <option value="HPL">HPL - Hospitalisation Leave</option>
                            <option value="NPL">NPL - Non Pay Leave (Unpaid)</option>
                            <option value="fractional_split">Split Leave (Annual + Unpaid)</option>
                            <option value="RPL">RPL - Replacement Leave</option>
                            <option value="CPL">CPL - Compassionate Leave</option>
                            <option value="MRL">MRL - Marriage Leave</option>
                            <option value="MTL">MTL - Maternity Leave</option>
                            <option value="PL">PL - Paternity Leave</option>
                        </select>
                    </div>
                    <!-- Row 2: Start Date and End Date in 1 line side by side -->
                    <div class="col-md-6">
                        <label class="form-label small fw-bold text-muted" for="leaveStart">Start Date</label>
                        <input type="date" class="form-control" id="leaveStart" @change="calculateLeaveDays()" @input="calculateLeaveDays()">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label small fw-bold text-muted" for="leaveEnd">End Date</label>
                        <input type="date" class="form-control" id="leaveEnd" @change="calculateLeaveDays()" @input="calculateLeaveDays()">
                    </div>
                    <!-- Row 3: Requested days (auto-populated deducting PH and rest days) -->
                    <div class="col-md-6">
                        <div class="d-flex justify-content-between align-items-end mb-1">
                            <label class="form-label small fw-bold text-muted mb-0" for="leaveDays">Requested days</label>
                            <small class="text-danger fw-bold" id="leaveCalcNote"></small>
                        </div>
                        <div class="input-group">
                            <input type="number" step="0.5" class="form-control bg-light fw-bold text-primary" id="leaveDays" readonly placeholder="Calculated days">
                            <select class="form-select fw-bold text-primary border-primary" id="halfDaySelect" aria-label="Full or half day" style="display:none;" @change="handleHalfDayChange()">
                                <option value="1">Full Day (1.0)</option>
                                <option value="0.5_AM">Half Day AM (0.5)</option>
                                <option value="0.5_PM">Half Day PM (0.5)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Split Leave Offer Alert when days exceed AL balance -->
                <div id="splitLeaveNotice" class="alert alert-warning border border-warning-subtle p-3 mb-3" style="display:none;" role="alert">
                    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                        <div>
                            <i class="bi bi-exclamation-triangle-fill text-warning me-2"></i>
                            <strong>Annual Leave Balance Exceeded</strong>
                            <span class="text-muted small ms-2" id="alBalanceExceededText"></span>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-primary fw-bold" id="btnEnableSplitLeave" @click="enableSplitLeave()">
                            <i class="bi bi-scissors me-1"></i>Split Leave (Annual + Unpaid)
                        </button>
                    </div>
                    <p class="small mb-0 text-muted">
                        Under <span class="badge bg-light text-dark border">Metrio Induction Policy FAM-23/G (Jul 2025) &amp; Employment Act 1955 Sec 60E</span>, you can split your request between remaining Annual Leave and Unpaid Leave (NPL).
                    </p>
                </div>

                <!-- Split Leave Decimal Configuration Section -->
                <div id="splitLeaveSection" class="p-3 mb-3 bg-light rounded border border-primary-subtle" style="display:none;">
                    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
                        <h6 class="fw-bold text-primary mb-0"><i class="bi bi-pie-chart-fill me-2"></i>Split Leave Allocation (Annual + Unpaid)</h6>
                        <span class="badge bg-primary text-white" id="splitTotalBadge">Total: 0.00 Days</span>
                    </div>
                    <p class="small text-muted mb-3">Specify exact decimal portions down to 2 decimal places (e.g. 0.16 AL and 0.84 Unpaid). Annual Leave is deducted upon approval, and Unpaid Leave tagged for payroll deduction.</p>
                    <div class="row g-3">
                        <div class="col-md-6">
                            <label class="form-label small fw-bold text-dark" for="splitAnnualDays">Annual Leave Portion (Days)</label>
                            <input type="number" step="0.01" min="0" class="form-control" id="splitAnnualDays" placeholder="0.00" @input="handleSplitDaysInput('annual')">
                            <small class="text-muted" id="splitAnnualMaxHint"></small>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label small fw-bold text-dark" for="splitUnpaidDays">Unpaid Leave Portion (NPL Days)</label>
                            <input type="number" step="0.01" min="0" class="form-control" id="splitUnpaidDays" placeholder="0.00" @input="handleSplitDaysInput('unpaid')">
                            <small class="text-muted">Tagged for NPL salary deduction</small>
                        </div>
                    </div>
                </div>

                <div class="row g-3 mb-4">
                    <div class="col-12">
                        <label class="form-label small fw-bold text-muted" for="leaveReason">Reason</label>
                        <textarea class="form-control" id="leaveReason" rows="3" placeholder="Add context to help your approver review this request"></textarea>
                    </div>
                    <div class="col-12" id="mcUploadDiv">
                        <label class="form-label small fw-bold text-dark" for="leaveFile">Attachment <span class="text-danger" id="mcReqText" style="display:none;">*(Req for MC)</span></label>
                        <input type="file" class="form-control" id="leaveFile" @change="handleLeaveFileUpload($event)">
                    </div>
                </div>
                <div class="text-end">
                    <button class="btn btn-primary px-5 fw-bold shadow-sm w-100 w-md-auto" id="btnSubmitLeave" @click="submitLeaveApp()">
                        <i class="bi bi-send-fill me-2"></i>Submit Application
                    </button>
                </div>
            </div>
            
            <aside class="leave-guidance main-card p-4"><span class="eyebrow">BEFORE YOU SUBMIT</span><h5>Request checklist</h5><ol><li><strong>Choose leave and dates</strong><p>Duration follows the existing company calendar calculation. Check full-day or half-day where available.</p></li><li><strong>Add supporting details</strong><p id="leaveDocumentHint">Attach supporting documents where required. Maximum file size: 3 MB.</p></li><li><strong>Track the decision</strong><p>A submitted request is pending until approved. Withdrawal requests also need a decision.</p></li></ol><div class="leave-policy-note">Annual leave requested less than 3 days ahead is recorded as Emergency Leave by the current system rules.</div></aside></div>
            <div class="main-card p-4 leave-history">
                <div class="leave-section-heading"><div><h5>My requests</h5><p class="text-muted small">Request details, decision status and available actions.</p></div><span id="leaveHistoryCount" class="text-muted small"></span></div>
                <div class="leave-history-filters"><input id="leaveSearch" class="form-control" type="search" aria-label="Search my leave requests" placeholder="Search type, dates or reason…" @input="dashboardActions.renderMyLeaveHistory()"><select id="leaveStatusFilter" class="form-select" aria-label="Filter leave status" @change="dashboardActions.renderMyLeaveHistory()"><option value="">All statuses</option><option>Pending</option><option>Approved</option><option>Rejected</option><option>Withdrawal Requested</option><option>Withdrawn</option></select></div>
                
                <div class="table-responsive desktop-only">
                    <table class="table table-hover align-middle text-start" id="myLeaveTable">
                        <thead class="table-light">
                            <tr>
                                <th scope="col" style="width: 10%; min-width: 70px;">Type</th>
                                <th scope="col" style="width: 22%; min-width: 170px;">Dates</th>
                                <th scope="col" style="width: 10%; min-width: 70px;">Days</th>
                                <th scope="col" style="width: 26%; min-width: 150px;">Reason</th>
                                <th scope="col" style="width: 14%; min-width: 110px;">Document</th>
                                <th scope="col" style="width: 18%; min-width: 150px;">Status / action</th>
                            </tr>
                        </thead>
                        <tbody id="myLeaveTableBody"></tbody>
                    </table>
                </div>
                
                <div id="myLeaveCardsMobile" class="mobile-only"></div>
            </div>
        </div>

        <div id="leave-management" class="tab-section leave-management" style="display:none;">
            <span id="leaveTeamScope" style="display:none;"></span>
            <div id="leaveTeamFeedback" class="alert" role="status" style="display:none;"></div>
            <div class="leave-balance-grid leave-team-metrics"><article class="leave-balance"><span>Awaiting your decision</span><strong id="teamPending">—</strong></article><article class="leave-balance"><span>On leave today</span><strong id="teamToday">—</strong></article><article class="leave-balance"><span>Upcoming approved requests</span><strong id="teamUpcoming">—</strong></article></div>
            <ul class="nav nav-pills mb-4 gap-2" id="leaveTabs">
                <li class="nav-item">
                    <a class="nav-link active fw-bold" data-bs-toggle="pill" href="#pane-on-leave"><i class="bi bi-people-fill me-1"></i> Approved leave</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link fw-bold" data-bs-toggle="pill" href="#pane-approvals"><i class="bi bi-check2-square me-1"></i> Pending Approvals <span class="badge bg-danger ms-1" id="pendingCount">0</span></a>
                </li>
            </ul>

            <div class="tab-content">
                <div class="tab-pane fade show active" id="pane-on-leave">
                    <div class="main-card p-4">
                        <h5 class="fw-bold mb-4 text-secondary">Today & Upcoming Approved Leave</h5>
                        <div class="table-responsive"><table class="table align-middle text-start" id="onLeaveTable">
                            <thead class="table-light"><tr><th>Staff Name</th><th>Leave Type</th><th>Dates</th><th>Total Days</th><th>Status</th></tr></thead>
                            <tbody id="onLeaveTableBody"></tbody>
                        </table></div>
                    </div>
                </div>

                <div class="tab-pane fade" id="pane-approvals">
                    <div class="main-card p-4">
                        <h5 class="fw-bold mb-4 text-secondary">Requests awaiting your decision</h5>
                        <div class="table-responsive"><table class="table align-middle text-start" id="approvalTable">
                            <thead class="table-light"><tr><th>Staff</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Attachment</th><th>Action</th></tr></thead>
                            <tbody id="approvalTableBody"></tbody>
                        </table></div>
                    </div>
                </div>
            </div>
        </div>

        <div id="mobile-staff-on-leave" class="tab-section mobile-only" style="display:none;">
            <h4 class="fw-bold mb-4 text-secondary"><i class="bi bi-people me-2"></i>Staff On Leave</h4>
            <div id="mobileOnLeaveCardsContainer"></div>
        </div>

        <div id="mobile-leave-approval" class="tab-section mobile-only" style="display:none;">
            <h4 class="fw-bold mb-4 text-secondary"><i class="bi bi-check2-square me-2"></i>Leave Approvals</h4>
            <div id="mobileApprovalCardsContainer"></div>
        </div>

    </main> 
</div> 

<nav class="mobile-bottom-nav admin-only-element" id="adminBottomNav" aria-label="Mobile Navigation" style="display:none;">
    <button type="button" class="nav-item active" @click="switchMobileTab('summary-dashboard', $event.currentTarget)"><i class="bi bi-house-door"></i><span>Home</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('dashboard', $event.currentTarget)"><i class="bi bi-calendar-check"></i><span>Attendance</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('mobile-staff-on-leave', $event.currentTarget)"><i class="bi bi-file-earmark-text"></i><span>Requests</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('mobile-leave-approval', $event.currentTarget)"><i class="bi bi-inbox"></i><span>Inbox</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('my-profile', $event.currentTarget)"><i class="bi bi-person-circle"></i><span>Me</span></button>
</nav>

<nav class="mobile-bottom-nav staff-only-element" id="userBottomNav" aria-label="Mobile Navigation" style="display:none;">
    <button type="button" class="nav-item active" @click="switchMobileTab('summary-dashboard', $event.currentTarget)"><i class="bi bi-house-door"></i><span>Home</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('dashboard', $event.currentTarget)"><i class="bi bi-calendar-check"></i><span>Attendance</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('staff-portal', $event.currentTarget)"><i class="bi bi-file-earmark-text"></i><span>Requests</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('mobile-leave-approval', $event.currentTarget)"><i class="bi bi-inbox"></i><span>Inbox</span></button>
    <button type="button" class="nav-item" @click="switchMobileTab('my-profile', $event.currentTarget)"><i class="bi bi-person-circle"></i><span>Me</span></button>
</nav>

<div class="modal fade" id="leaveDecisionModal" tabindex="-1" aria-labelledby="leaveDecisionTitle" aria-hidden="true"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><form @submit.prevent="dashboardActions.confirmLeaveDecision()"><div class="modal-header"><h5 class="modal-title" id="leaveDecisionTitle">Review leave</h5><button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Close"/></div><div class="modal-body"><p id="leaveDecisionSummary" class="fw-semibold"></p><p id="leaveDecisionReason" class="text-muted"></p><label for="leaveDecisionNote" class="form-label">Decision note (required for rejection or event-leave approval)</label><textarea id="leaveDecisionNote" class="form-control" rows="3" placeholder="For event leave, record the eligibility and supporting evidence reviewed"></textarea><div id="leaveDecisionError" class="alert alert-danger mt-3" role="alert" style="display:none;"></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button><button id="leaveDecisionConfirm" type="submit" class="btn btn-primary">Confirm decision</button></div></form></div></div></div>
<div class="modal fade" id="editRowModal" tabindex="-1">
    <div class="modal-dialog modal-lg">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title fw-bold">Amend Attendance & Overrides</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
                <input type="hidden" id="editStaffId">
                <input type="hidden" id="editDate">
                
                <div class="row bg-light p-3 mb-3 rounded border">
                    <h6 class="fw-bold text-primary mb-3"><i class="bi bi-clock"></i> Time Entry</h6>
                    <div class="col-md-6 mb-3">
                        <label class="form-label fw-bold small text-muted" for="editIn">Clock In Time</label>
                        <input type="time" class="form-control" id="editIn">
                    </div>
                    <div class="col-md-6 mb-3">
                        <label class="form-label fw-bold small text-muted" for="editOut">Clock Out Time</label>
                        <input type="time" class="form-control" id="editOut">
                    </div>
                </div>

                <div class="row p-2 mb-2 g-2 rounded border bg-light-subtle">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <h6 class="fw-bold text-success mb-0 small"><i class="bi bi-currency-dollar"></i> Manual Overrides</h6>
                        <span class="badge bg-secondary" style="font-size: 0.7rem;">Leave blank for auto-calculation</span>
                    </div>

                    <div class="col-md-4">
                        <label class="form-label fw-bold small text-muted" for="editOverlap">Override Overlap (Hrs)</label>
                        <input type="number" step="0.5" class="form-control" id="editOverlap">
                    </div>
                    <div class="col-md-4">
                        <label class="form-label fw-bold small text-muted" for="editExtra">Override Extra OT (Hrs)</label>
                        <input type="number" step="0.5" class="form-control" id="editExtra">
                    </div>
                    <div class="col-md-4">
                        <label class="form-label fw-bold small text-muted" for="editOTPay">Override OT Pay (RM)</label>
                        <input type="number" step="0.01" class="form-control" id="editOTPay">
                    </div>
                </div>

                <div class="mb-2">
                    <label class="form-label fw-bold small text-muted" for="editShift">Shift Override (Force Wage Calculation)</label>
                    <select class="form-select" id="editShift">
                        <option value="AUTO">Auto (System Calculates)</option>
                        <optgroup label="SQ Schedules">
                            <option value="S1 (05:30-14:30)">S1 (05:30-14:30) · 8h</option>
                            <option value="S2 (08:30-17:30)">S2 (08:30-17:30) · 8h</option>
                            <option value="S3 (14:30-23:30)">S3 (14:30-23:30) · 8h</option>
                            <option value="S4 (23:00-08:00)">S4 (23:00-08:00) · 8h</option>
                            <option value="F1 (05:30-17:30)">F1 (05:30-17:30) · 10.5h</option>
                            <option value="F2 (11:30-23:30)">F2 (11:30-23:30) · 10.5h</option>
                        </optgroup>
                        <optgroup label="MS Schedules">
                            <option value="M1 (06:00-15:00)">M1 (06:00-15:00) · 8h</option>
                            <option value="M2 (08:00-17:00)">M2 (08:00-17:00) · 8h</option>
                            <option value="M3 (14:00-23:00)">M3 (14:00-23:00) · 8h</option>
                            <option value="M4 (23:00-08:00)">M4 (23:00-08:00) · 8h</option>
                            <option value="M (07:00-15:30)">M (07:00-15:30) · 7.5h</option>
                            <option value="A (15:00-23:30)">A (15:00-23:30) · 7.5h</option>
                            <option value="N (11:00-19:30)">N (11:00-19:30) · 7.5h</option>
                            <option value="A1 (13:00-23:30)">A1 (13:00-23:30) · 9.5h</option>
                        </optgroup>
                    </select>
                </div>

                <div class="mb-2">
                    <label class="form-label fw-bold small text-muted" for="editPayType">Pay Type Override</label>
                    <select class="form-select" id="editPayType">
                        <option value="AUTO">Auto (System Calculates)</option>
                        <option value="NM">Normal Day (NM)</option>
                        <option value="RD">Rest Day (RD)</option>
                        <option value="PH">Public Holiday (PH)</option>
                    </select>
                </div>
                
                <div class="mb-2">
                    <label class="form-label fw-bold small text-muted" for="editRemark">Admin Remark</label>
                    <input type="text" class="form-control" id="editRemark" placeholder="e.g. Approved OT by manager">
                </div>
            </div>
            <div class="modal-footer bg-light">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary fw-bold" @click="saveRowEdit()">Save & Sync</button>
            </div>
        </div>
    </div>
</div>

<div class="modal fade" id="staffProfileModal" tabindex="-1">
    <div class="modal-dialog modal-xl modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header py-2 px-3">
                <h6 class="modal-title fw-bold mb-0"><i class="bi bi-person-badge me-2 text-primary"></i>Staff Profile</h6>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            
            <div class="modal-body p-3">
                <input type="hidden" id="staffModalMode">
                <input type="hidden" id="staffOriginalName">

                <!-- Staff Profile Hero Header with Photo -->
                <div class="staff-modal-hero d-flex flex-wrap align-items-center justify-content-between p-3 mb-3 bg-light rounded-3 border">
                    <div class="d-flex align-items-center gap-3">
                        <div class="position-relative profile-modal-avatar-wrapper flex-shrink-0" style="width: 64px; height: 64px;">
                            <img id="staffModalAvatarImg" src="" class="rounded-circle object-fit-cover border shadow-sm w-100 h-100" alt="Staff Photo" style="display: none;" />
                            <div id="staffModalAvatarInitials" class="rounded-circle bg-primary-subtle text-primary border fw-bold d-flex align-items-center justify-content-center shadow-sm w-100 h-100" style="font-size: 1.4rem;">--</div>
                            <button type="button" class="btn btn-sm btn-primary rounded-circle position-absolute bottom-0 end-0 p-0 d-flex align-items-center justify-content-center shadow" id="btnUploadStaffModalPhoto" title="Upload or update profile photo (saves to staff Google Drive)" style="width: 24px; height: 24px; font-size: 11px;">
                                <i class="bi bi-camera-fill"></i>
                            </button>
                            <input type="file" id="staffModalPhotoFileInput" accept="image/png,image/jpeg,image/webp,image/jpg" style="display: none;" />
                        </div>
                        <div>
                            <div class="d-flex flex-wrap align-items-center gap-2">
                                <h5 class="fw-bold mb-0 text-dark text-uppercase" id="staffModalDisplayName">Staff Member</h5>
                                <span class="badge bg-success-subtle text-success border border-success-subtle" id="staffModalStatusBadge">Active</span>
                                <span class="badge bg-primary-subtle text-primary border border-primary-subtle" id="staffModalRoleBadge">Staff</span>
                            </div>
                            <div class="text-muted small mt-1" id="staffModalSubtitle">
                                <span id="staffModalSubEmpNo" class="badge bg-light text-secondary border font-monospace me-1">--</span>
                                <span id="staffModalSubJobTitle" class="fw-semibold text-dark">Employee</span>
                                <span id="staffModalSubDept" class="text-secondary ms-1"></span>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2 mt-2 mt-sm-0">
                        <div id="staffModalPhotoStatus" class="small fw-semibold text-muted text-end">
                            <span class="text-muted"><i class="bi bi-cloud-check text-success me-1"></i>Drive Sync</span>
                        </div>
                    </div>
                </div>

                <!-- Sub-tabs navigation -->
                <ul class="nav nav-pills nav-fill mb-2 p-1 bg-light rounded border staff-modal-tabs" id="staffModalTabs" role="tablist">
                    <li class="nav-item" role="presentation">
                        <button class="nav-link active py-1 px-2 fw-bold" id="staff-tab-personal-btn" data-bs-toggle="pill" data-bs-target="#staff-tab-personal" type="button" role="tab">
                            <i class="bi bi-person-fill me-1"></i>Personal &amp; Contact
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link py-1 px-2 fw-bold" id="staff-tab-employment-btn" data-bs-toggle="pill" data-bs-target="#staff-tab-employment" type="button" role="tab">
                            <i class="bi bi-building me-1"></i>Employment &amp; Org
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link py-1 px-2 fw-bold" id="staff-tab-salary-btn" data-bs-toggle="pill" data-bs-target="#staff-tab-salary" type="button" role="tab">
                            <i class="bi bi-cash-stack me-1"></i>Salary &amp; Statutory
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link py-1 px-2 fw-bold" id="staff-tab-schedule-btn" data-bs-toggle="pill" data-bs-target="#staff-tab-schedule" type="button" role="tab">
                            <i class="bi bi-calendar2-week me-1"></i>Leave &amp; Schedule
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link py-1 px-2 fw-bold" id="staff-tab-resources-btn" data-bs-toggle="pill" data-bs-target="#staff-tab-resources" type="button" role="tab">
                            <i class="bi bi-laptop me-1"></i>Resources
                        </button>
                    </li>
                    <li class="nav-item" role="presentation">
                        <button class="nav-link py-1 px-2 fw-bold" id="staff-tab-docs-btn" data-bs-toggle="pill" data-bs-target="#staff-tab-docs" type="button" role="tab">
                            <i class="bi bi-folder2-open me-1"></i>Documents
                        </button>
                    </li>
                </ul>
                
                <div class="tab-content" id="staffModalTabContent">
                    <!-- Tab 1: Personal & Contact -->
                    <div class="tab-pane fade show active" id="staff-tab-personal" role="tabpanel">
                        <div class="row g-2">
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffStatus">Status</label>
                                <select class="form-select fw-bold" id="staffStatus" @change="handleStatusChange()">
                                    <option value="Active" class="text-success">Active</option>
                                    <option value="Resigned" class="text-danger">Resigned</option>
                                </select>
                            </div>
                            <div class="col-md-3 col-sm-6" id="divResignDate" style="display:none;">
                                <label class="form-label fw-bold small text-danger" for="staffResignDate">Resignation Date</label>
                                <input type="date" class="form-control border-danger" id="staffResignDate">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffName">Full Name</label>
                                <input type="text" class="form-control text-uppercase" id="staffName" required>
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffIcNo">IC No.</label>
                                <input type="text" class="form-control" id="staffIcNo">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffGender">Gender</label>
                                <select class="form-select" id="staffGender">
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffRace">Race</label>
                                <select id="staffRace" class="form-select">
                                    <option value="">-- Select Race --</option>
                                    <option value="CHINESE">CHINESE</option>
                                    <option value="MALAY">MALAY</option>
                                    <option value="INDIAN">INDIAN</option>
                                    <option value="OTHERS">OTHERS</option>
                                </select>
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffAgeSource">Age (source snapshot)</label>
                                <input id="staffAgeSource" class="form-control" type="number" min="0" step="any">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffAcademicLevel">Academic level</label>
                                <input id="staffAcademicLevel" class="form-control" type="text">
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffUsername">Username</label>
                                <input type="text" class="form-control" id="staffUsername" placeholder="Login ID">
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffPassword">Password</label>
                                <input type="password" class="form-control" id="staffPassword" placeholder="Leave blank to keep existing password" autocomplete="new-password">
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffRole">Role</label>
                                <select class="form-select" id="staffRole">
                                    <option value="User">User</option>
                                    <option value="HR">HR</option>
                                    <option value="HOD">HOD (team approvals)</option>
                                    <option value="Admin">Superadmin (Admin)</option>
                                </select>
                            </div>
                            <div class="col-md-6 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffContact">Contact No.</label>
                                <input type="text" class="form-control" id="staffContact">
                            </div>
                            <div class="col-md-6 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffEmergency">Emergency Contact</label>
                                <input type="text" class="form-control" id="staffEmergency">
                            </div>
                            <div class="col-12">
                                <label class="form-label fw-bold small text-muted" for="staffAddress">Residential Address</label>
                                <textarea class="form-control" id="staffAddress" rows="1"></textarea>
                            </div>
                        </div>
                    </div>

                    <!-- Tab 2: Employment & Organisation -->
                    <div class="tab-pane fade" id="staff-tab-employment" role="tabpanel">
                        <div class="row g-2">
                            <div class="col-12">
                                <p class="small text-muted mb-1"><i class="bi bi-info-circle me-1"></i>One employee record for login, HR, attendance and payroll. Only Admin can assign roles.</p>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffEmployeeNo">Employee ID</label>
                                <input id="staffEmployeeNo" class="form-control" type="text">
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold text-primary small" for="staffBiometricId"><i class="bi bi-fingerprint me-1"></i>Biometric ID</label>
                                <div class="input-group">
                                    <input id="staffBiometricId" class="form-control" type="text" placeholder="e.g. 711011">
                                    <button type="button" class="btn btn-outline-primary btn-sm fw-bold px-2" id="btnQuickSaveBio" @click="saveBiometricLocally" title="Save Biometric ID directly"><i class="bi bi-check-lg me-1"></i>Save ID</button>
                                </div>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffEmail">Email</label>
                                <input id="staffEmail" class="form-control" type="email">
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffCompany">Company</label>
                                <select id="staffCompany" class="form-select"><option value="">Not assigned</option></select>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffJobTitle">Job title</label>
                                <select id="staffJobTitle" class="form-select"><option value="">Not assigned</option></select>
                                <small id="staffLegacyTitle" class="text-muted"></small>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffManager">Reporting manager</label>
                                <select id="staffManager" class="form-select"><option value="">Not assigned</option></select>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffDepartment">Department</label>
                                <select id="staffDepartment" class="form-select"><option value="">Not assigned</option></select>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffJobGrade">Job grade</label>
                                <select id="staffJobGrade" class="form-select"><option value="">Not assigned</option></select>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffWorkBase">Work base</label>
                                <select id="staffWorkBase" class="form-select">
                                    <option value="">Not assigned</option>
                                    <option value="OFFICE">OFFICE</option>
                                    <option value="SITE">SITE</option>
                                </select>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffLocation">Work location</label>
                                <select id="staffLocation" class="form-select">
                                    <option value="">Not assigned</option>
                                    <option value="PG">PG</option>
                                    <option value="SEL">SEL</option>
                                    <option value="KL">KL</option>
                                    <option value="NS">NS</option>
                                </select>
                            </div>
                            <div class="col-md-4 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffServiceYearsSource">Service years (source)</label>
                                <input id="staffServiceYearsSource" class="form-control" type="number" min="0" step="any">
                            </div>
                            <div class="col-12">
                                <label class="form-label fw-bold small text-muted" for="staffAssignedResources">Assigned resources</label>
                                <textarea id="staffAssignedResources" class="form-control" readonly rows="1"></textarea>
                            </div>
                        </div>
                    </div>

                    <!-- Tab 3: Salary & Statutory -->
                    <div class="tab-pane fade" id="staff-tab-salary" role="tabpanel">
                        <div class="row g-2">
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffBasic">Basic Salary (RM)</label>
                                <input type="number" class="form-control fw-bold text-success" id="staffBasic" step="0.01">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffFixedAllowance">Fixed Allowance (RM)</label>
                                <input type="number" class="form-control fw-bold text-primary bg-light" id="staffFixedAllowance" step="0.01" readonly placeholder="0.00" title="Auto-summed from fixed allowance breakdown below">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffJoined">Joined Date</label>
                                <input type="date" class="form-control" id="staffJoined">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffConfirm">Confirmation Date</label>
                                <input type="date" class="form-control" id="staffConfirm">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffEpfNo">EPF No.</label>
                                <input type="text" class="form-control" id="staffEpfNo">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffSocsoNo">SOCSO/EIS No.</label>
                                <input type="text" class="form-control" id="staffSocsoNo">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffTaxNo">TAX No.</label>
                                <input type="text" class="form-control" id="staffTaxNo">
                            </div>
                            <div class="col-md-3 col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffBankNo">Bank Acc No.</label>
                                <input type="text" class="form-control" id="staffBankNo">
                            </div>

                            <div class="col-12 mt-2">
                                <div class="d-flex flex-wrap align-items-center justify-content-between p-2 border rounded bg-light gap-2">
                                    <div class="d-flex align-items-center gap-2">
                                        <div class="form-check form-switch mb-0">
                                            <input class="form-check-input" type="checkbox" id="staffOtEligible" style="cursor: pointer; width: 2.2em; height: 1.2em;">
                                        </div>
                                        <div>
                                            <label class="form-check-label fw-bold small text-dark mb-0" for="staffOtEligible" style="cursor: pointer;">
                                                Overtime (OT) Eligible <span class="badge bg-white text-secondary border ms-1 small">EA 1955 Special Condition</span>
                                            </label>
                                            <div class="text-muted small" style="font-size: 0.76rem;">
                                                Staff earning &le; RM4,000/mo or site workers are automatically eligible. For executives or managers earning &gt; RM4,000, enable this switch to grant contractual OT entitlement.
                                            </div>
                                        </div>
                                    </div>
                                    <span class="badge bg-secondary-subtle text-secondary border small" id="staffOtStatusBadge">Auto (by salary)</span>
                                </div>
                            </div>

                            <!-- Fixed Allowance Breakdown Section -->
                            <div class="col-12 mt-3">
                                <div class="card border shadow-sm">
                                    <div class="card-header bg-light d-flex justify-content-between align-items-center py-2">
                                        <div>
                                            <span class="fw-bold small text-dark"><i class="bi bi-wallet2 me-1 text-primary"></i>Fixed Allowance Breakdown</span>
                                            <span class="badge bg-light text-secondary border ms-2 small">Malaysia Statutory Compliant</span>
                                        </div>
                                        <button type="button" class="btn btn-outline-primary btn-sm py-0 px-2 fw-semibold" id="btnAddStaffAllowance" onclick="addStaffAllowanceRow()">
                                            <i class="bi bi-plus-circle me-1"></i>Add Allowance
                                        </button>
                                    </div>
                                    <div class="card-body p-2">
                                        <p class="text-muted small mb-2">Select allowance category from droplist (Transportation, Communication, Business Travel, Other) and enter amount. System auto-sums total fixed allowance and captures statutory obligations (EPF, SOCSO, EIS, PCB) according to Malaysian law.</p>
                                        <div class="table-responsive">
                                            <table class="table table-sm table-bordered align-middle mb-0" id="staffAllowanceTable">
                                                <thead class="table-light small">
                                                    <tr>
                                                        <th style="width: 32%;">Allowance Category</th>
                                                        <th style="width: 23%;">Amount (RM)</th>
                                                        <th style="width: 35%;">Remarks / Reference</th>
                                                        <th style="width: 10%; text-align: center;">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody id="staffAllowanceTableBody">
                                                    <!-- Dynamic allowance rows -->
                                                </tbody>
                                                <tfoot class="table-light fw-bold">
                                                    <tr>
                                                        <td class="text-end">Total Fixed Allowance:</td>
                                                        <td class="text-primary font-monospace" id="staffAllowanceTotalDisplay">RM 0.00</td>
                                                        <td colspan="2" class="text-muted small fst-italic">Auto-summed &amp; captured for monthly payroll &amp; statutory computation</td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tab 4: Leave & Schedule -->
                    <div class="tab-pane fade" id="staff-tab-schedule" role="tabpanel">
                        <div class="row g-2">
                            <div class="col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffAlEntitlement">AL Entitlement (Static Override)</label>
                                <input type="number" class="form-control" id="staffAlEntitlement" placeholder="Auto if Joined Date is set">
                            </div>
                            <div class="col-sm-6">
                                <label class="form-label fw-bold small text-muted" for="staffMcEntitlement">MC Entitlement (Static Override)</label>
                                <input type="number" class="form-control" id="staffMcEntitlement" placeholder="Auto if Joined Date is set">
                            </div>
                            <div class="col-12 mt-2" id="staffScheduleSection">
                                <div class="d-flex justify-content-between align-items-center mb-1">
                                    <label class="form-label fw-bold small text-muted mb-0">Schedule</label>
                                    <span class="badge bg-light text-secondary border small" id="staffScheduleContextBadge">Based on Company &amp; Work Base</span>
                                </div>
                                <div class="border rounded p-2 bg-white" style="max-height: 120px; overflow-y: auto;" id="staffScheduleOptionsContainer">
                                    <span class="text-muted small">Loading schedules...</span>
                                </div>
                                <small class="text-muted">Select applicable shift schedule(s) for this staff member (multiple selection allowed).</small>
                            </div>
                            <div class="col-12 mt-1">
                                <label class="form-label fw-bold small text-muted mb-1">Working &amp; Rest Days</label>
                                <div class="alert alert-light border small text-muted p-2 mb-0 rounded">
                                    <i class="bi bi-info-circle text-primary me-1"></i>
                                    Working &amp; rest days are configured automatically via assigned <strong>Schedule Template</strong>.
                                </div>
                                <div id="staffRestDaysGroup" style="display:none;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Tab 5: Resources -->
                    <div class="tab-pane fade" id="staff-tab-resources" role="tabpanel">
                        <div class="row g-2">
                            <div class="col-12">
                                <div class="d-flex flex-wrap justify-content-between align-items-center mb-1 gap-2">
                                    <div>
                                        <h6 class="fw-bold text-dark mb-0 small"><i class="bi bi-laptop me-1 text-primary"></i>Company Resources &amp; Asset Custody</h6>
                                        <p class="text-muted small mb-0">Record company assets assigned to staff (laptop, access card, phone, vehicle, keys, etc.). When resignation is triggered, all resources must be marked Returned with Returned Date and Remarks before profile can be saved.</p>
                                    </div>
                                    <button type="button" class="btn btn-outline-primary btn-sm py-1 px-2 fw-semibold" id="btnAddStaffResource" onclick="addStaffResourceRow()">
                                        <i class="bi bi-plus-circle me-1"></i>Assign Resource
                                    </button>
                                </div>
                            </div>
                            <div class="col-12">
                                <div class="table-responsive border rounded bg-white">
                                    <table class="table table-sm table-bordered align-middle mb-0" id="staffResourcesTable">
                                        <thead class="table-light small">
                                            <tr>
                                                <th style="width: 22%;">Resource Name / Item</th>
                                                <th style="width: 18%;">Serial No. / Tag</th>
                                                <th style="width: 15%;">Date Issued</th>
                                                <th class="text-center" style="width: 10%;">Returned?</th>
                                                <th style="width: 15%;">Returned Date</th>
                                                <th style="width: 20%;">Return Remarks / Handover</th>
                                                <th class="text-center" style="width: 5%;">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody id="staffResourcesTableBody">
                                            <!-- Dynamic resource rows -->
                                        </tbody>
                                    </table>
                                </div>
                                <div class="alert alert-warning border small text-dark p-2 mt-2 mb-0 rounded" id="staffResourceResignNotice">
                                    <i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>
                                    <strong>Resignation Custody Gate:</strong> When Employment Status is set to <em>Resigned</em>, HR must tick <strong>Returned</strong>, select <strong>Returned Date</strong>, and fill in <strong>Return Remarks</strong> for every assigned resource before saving.
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tab 5: Documents -->
                    <div class="tab-pane fade" id="staff-tab-docs" role="tabpanel">
                        <div class="row g-2" id="staffDocumentsPanel">
                            <div class="col-12">
                                <h6 class="fw-bold text-primary mb-1 small"><i class="bi bi-folder-fill me-1"></i>Staff Google Drive Folder</h6>
                                <div id="staffFolderLink" class="mb-2"></div>
                            </div>
                            <div class="col-12">
                                <div id="staffDocumentUploadPanel" class="border rounded p-2 mb-2 bg-light">
                                    <label for="staffPayslipMonth" class="form-label fw-bold small text-muted">Save a published salary slip</label>
                                    <div class="d-flex gap-2 mb-2">
                                        <input type="month" id="staffPayslipMonth" class="form-control">
                                        <button type="button" id="staffPayslipSaveBtn" class="btn btn-outline-primary btn-sm fw-bold text-nowrap" @click="saveStaffPayslipToFolder()">Save PDF to staff folder</button>
                                    </div>
                                    <label for="staffDocumentCategory" class="form-label fw-bold small text-muted">Document category</label>
                                    <select id="staffDocumentCategory" class="form-select mb-2">
                                        <option value="payslip">Salary slip</option>
                                        <option value="MC">Medical certificate</option>
                                        <option value="letter">Letter</option>
                                        <option value="other">Other</option>
                                    </select>
                                    <label for="staffDocumentFile" class="form-label fw-bold small text-muted">Files (up to 3 MB each)</label>
                                    <input id="staffDocumentFile" type="file" multiple class="form-control mb-2">
                                    <button type="button" id="staffDocumentUploadBtn" class="btn btn-outline-primary btn-sm fw-bold" @click="uploadStaffDocuments()">Upload documents</button>
                                    <p id="staffDocumentStatus" role="status" aria-live="polite" class="small mt-1 mb-0"></p>
                                </div>
                            </div>
                            <div class="col-12">
                                <label class="form-label fw-bold small text-muted" for="staffFile">Profile attachment <span id="currentAttachment"></span></label>
                                <input type="file" class="form-control" id="staffFile" @change="handleStaffFileUpload($event)">
                                <small class="text-muted">This attachment is saved to the staff folder when you save the profile.</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="modal-footer py-2 px-3 bg-light">
                <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary btn-sm fw-bold px-3" id="saveStaffProfileBtn" @click="saveStaffProfile()">Save Profile</button>
            </div>
        </div>
    </div>
</div>
<StaffDossierModal v-if="showDossierModal"
    v-model="showDossierModal"
    :initial-employee="dossierTargetEmployee"
    :employees="allEmployeesForDossier"
    :current-user="effectiveUserForDossier"
/>
</template>
