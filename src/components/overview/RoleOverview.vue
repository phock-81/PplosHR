<template>
  <div class="role-overview-container">
    <header class="phr-overview-intro">
      <div>
        <div class="phr-date">{{ getMytToday() }} · MYT</div>
        <h3>{{ normalizedRole === 'User' ? 'Your working day.' : normalizedRole === 'HOD' ? 'Your team, at a glance.' : 'People, at a glance.' }}</h3>
        <p>{{ normalizedRole === 'User' ? 'Attendance, leave and requests — all in one place.' : 'Your team, requests and priorities in one place.' }}</p>
      </div>
    </header>
    <!-- Filter & Header Bar -->
    <OverviewFilterBar
      :role="currentRole"
      :companies="records.companies || []"
      :departments="records.departments || []"
      v-model:selected-company="selectedCompany"
      v-model:selected-department="selectedDepartment"
      v-model:selected-period="selectedPeriod"
      :refreshing="refreshing"
      @refresh="onRefresh"
      @reset="onReset"
    />

    <!-- KPI Grid -->
    <OverviewKpiGrid 
      :kpis="currentKpis" 
      @drilldown="handleDrilldown"
    />

    <div class="phr-overview-body">
    <!-- Unified Deduplicated Action Inbox (Shown for HOD, HR, Admin, or if User has pending items) -->
    <OverviewActionInbox 
      v-if="actionInboxItems.length || ['HOD', 'HR', 'Admin'].includes(normalizedRole)"
      :items="actionInboxItems"
      @review="handleActionReview"
      @refresh="onRefresh"
    />

    <!-- Role-Tailored Visual Insights & Charts -->
    <OverviewInsights
      :role="currentRole"
      :user="user"
      :employees="filteredEmployees"
      :companies="records.companies || []"
      :departments="records.departments || []"
      :team-leave="teamLeave"
      :user-leave="userLeave"
      :workforce="workforceMetrics"
      :claims-summary="claimsMetrics"
      :data-gaps="dataQualityGaps"
      @nav="handleNavShortcut"
    />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import OverviewFilterBar from './OverviewFilterBar.vue';
import OverviewKpiGrid from './OverviewKpiGrid.vue';
import OverviewActionInbox from './OverviewActionInbox.vue';
import OverviewInsights from './OverviewInsights.vue';
import { getOverviewConfigForRole } from './overviewRoleConfig';
import { 
  normalizeRole, 
  getMytToday, 
  computeUserAlBalance,
  computeUserAttendanceState,
  computeUserPendingRequests,
  computeUserClaimLimits,
  computeTeamHeadcount,
  computeTeamOnLeaveToday,
  buildUnifiedActionInbox,
  computeWorkforceMetrics,
  computeJoinersAndLeavers,
  computeClaimsByWorkflowState,
  computeStaffDataQualityGaps
} from './OverviewMetricService';

const props = defineProps({
  user: { type: Object, default: () => ({ role: 'User' }) },
  records: { type: Object, default: () => ({}) },
  employees: { type: Array, default: () => [] },
  teamLeave: { type: Array, default: () => [] },
  audit: { type: Array, default: () => [] },
  pendingAttendanceList: { type: Array, default: () => [] },
  refreshing: { type: Boolean, default: false },
  leaveSummary: { type: Object, default: null },
  leaveSummaryError: { type: String, default: '' },
  leaveSummaryLoading: { type: Boolean, default: false }
});

const emit = defineEmits([
  'navigate-module',
  'open-dossier',
  'open-modal',
  'review-action',
  'refresh'
]);

const selectedCompany = ref('all');
const selectedDepartment = ref('all');
const selectedPeriod = ref('thisMonth');

const currentRole = computed(() => props.user?.role || 'User');
const normalizedRole = computed(() => normalizeRole(currentRole.value));
const roleConfig = computed(() => getOverviewConfigForRole(normalizedRole.value));

// Filtered employees based on company/department selector
const filteredEmployees = computed(() => {
  let list = props.employees || [];
  if (selectedCompany.value && selectedCompany.value !== 'all') {
    list = list.filter(e => 
      String(e.companyId) === String(selectedCompany.value) || 
      String(e.company) === String(selectedCompany.value)
    );
  }
  if (selectedDepartment.value && selectedDepartment.value !== 'all') {
    list = list.filter(e => 
      String(e.departmentId) === String(selectedDepartment.value) || 
      String(e.department) === String(selectedDepartment.value)
    );
  }
  return list;
});

// User-specific Leave Summary
const userLeave = computed(() => {
  const uName = String(props.user?.name || '').toUpperCase();
  const summary = props.leaveSummary;
  const annual = summary?.leaveBalances?.find(balance => balance.category === 'Annual');
  const bal = computeUserAlBalance(props.user, summary);
  const numberOrNull = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    alBalance: bal,
    alEntitlement: numberOrNull(annual ? annual.entitlement : summary?.alEntitlement),
    alUsed: numberOrNull(annual?.used),
    error: props.leaveSummaryError,
    loading: props.leaveSummaryLoading,
    applications: (props.teamLeave || []).filter(l => String(l.name || l.employee || '').toUpperCase() === uName)
  };
});

// Workforce Metrics
const workforceMetrics = computed(() => {
  return computeWorkforceMetrics(filteredEmployees.value, props.records?.companies, props.records?.departments);
});

// Joiners & Leavers
const joinersLeavers = computed(() => {
  return computeJoinersAndLeavers(filteredEmployees.value);
});

// Claims Metrics
const claimsMetrics = computed(() => {
  let list = props.records?.claims || [];
  if (selectedCompany.value && selectedCompany.value !== 'all') {
    const compStaffNames = new Set(filteredEmployees.value.map(e => String(e.name || '').toUpperCase()));
    list = list.filter(c => compStaffNames.has(String(c.employee || '').toUpperCase()));
  }
  return computeClaimsByWorkflowState(list);
});

// Staff Data Quality Gaps
const dataQualityGaps = computed(() => {
  return computeStaffDataQualityGaps(filteredEmployees.value);
});

// Action Inbox Items
const actionInboxItems = computed(() => {
  return buildUnifiedActionInbox(props.user, props.records, props.pendingAttendanceList, props.teamLeave, props.employees);
});

// Dynamic KPI Computation
const currentKpis = computed(() => {
  const cfg = roleConfig.value;
  const role = normalizedRole.value;

  if (role === 'User') {
    const userReqs = computeUserPendingRequests(props.user, props.records);
    const pendingLabels = { leave: 'leave', claims: 'claims', loans: 'loans', bookings: 'bookings' };
    const pendingSubtitle = Object.entries(userReqs.breakdown).filter(([, count]) => count > 0).map(([type, count]) => `${count} ${pendingLabels[type]}`).join(', ') || 'No pending requests';
    const claimLims = computeUserClaimLimits(props.user, props.records?.claims, props.records?.claimPolicies);
    const todayAttendance = (props.records?.attendance || []).filter(r => r.date === getMytToday());
    const attState = computeUserAttendanceState(props.user, todayAttendance);
    const alDays = userLeave.value.alBalance;

    return [
      { id: 'M01', label: 'Annual Leave Balance', value: alDays != null ? alDays : '—', unit: alDays != null ? 'days' : '', icon: 'calendar-check', drilldown: 'myLeave', subtitle: props.leaveSummaryError ? (alDays != null ? 'Last loaded balance · refresh failed' : 'Balance unavailable · retry refresh') : alDays != null ? 'Verified ledger balance' : props.leaveSummaryLoading ? 'Loading balance' : 'Balance unavailable' },
      { id: 'M02', label: 'Today Attendance', value: attState.status, unit: '', icon: 'clock', drilldown: 'myAttendance', subtitle: attState.reason || 'Punch recorded' },
      { id: 'M03', label: 'My Pending Requests', value: userReqs.total, unit: 'requests', icon: 'inbox', drilldown: 'myRequests', subtitle: pendingSubtitle },
      { id: 'M04', label: 'Flexi-Wellness Remaining', value: claimLims.remaining, unit: 'RM', icon: 'heart-pulse', drilldown: 'myClaims', subtitle: `Cap: RM ${claimLims.cap}` }
    ];
  }

  if (role === 'HOD') {
    const team = computeTeamHeadcount(props.user, props.employees);
    const onLeave = computeTeamOnLeaveToday(team.members, props.teamLeave);

    const teamNames = new Set(team.members.map(e => String(e.name || '').toUpperCase()));
    const today = getMytToday();
    const nextWeekDate = new Date();
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    const nextWeekStr = nextWeekDate.toISOString().slice(0, 10);
    const upcomingCount = (props.teamLeave || []).filter(l => {
      const name = String(l.name || l.employee || '').toUpperCase();
      if (!teamNames.has(name)) return false;
      const start = normalizeDate(l.start || l.date);
      return start > today && start <= nextWeekStr;
    }).length;

    return [
      { id: 'M07', label: 'Supervised Team', value: team.count, unit: 'people', icon: 'people', drilldown: 'teamDirectory', subtitle: 'Active subordinates' },
      { id: 'M08', label: 'On Leave Today', value: onLeave.count, unit: 'people', icon: 'person-dash', drilldown: 'teamLeave', subtitle: 'Approved absence' },
      { id: 'M09', label: 'Upcoming Leave (7d)', value: upcomingCount, unit: 'people', icon: 'calendar-week', drilldown: 'teamLeave', subtitle: 'Next 7 days coverage' },
      { id: 'M10', label: 'Actionable Approvals', value: actionInboxItems.value.length, unit: 'requests', icon: 'check2-square', drilldown: 'actionInbox', subtitle: 'Awaiting your review' }
    ];
  }

  if (role === 'HR') {
    const certsExpiring = (props.records?.training || []).filter(t => t.status === 'Planned').length;
    const candidates = (props.records?.recruitment || []).filter(r => !['Hired', 'Rejected'].includes(r.status)).length;

    return [
      { id: 'M13', label: 'Active Headcount', value: workforceMetrics.value.total, unit: 'people', icon: 'buildings', drilldown: 'directory', subtitle: 'Scoped employees' },
      { id: 'M14', label: 'Net Workforce Change', value: joinersLeavers.value.netChange, unit: 'people', icon: 'arrow-left-right', drilldown: 'directory', subtitle: `+${joinersLeavers.value.joinersCount} / -${joinersLeavers.value.leaversCount}` },
      { id: 'M16', label: 'Approved Claims (YTD)', value: claimsMetrics.value.approvedRM, unit: 'RM', icon: 'cash-stack', drilldown: 'claims', subtitle: `Paid: RM ${claimsMetrics.value.paidRM}` },
      { id: 'M18', label: 'Training / Certs', value: certsExpiring, unit: 'records', icon: 'award', drilldown: 'training', subtitle: 'Planned & active' },
      { id: 'M19', label: 'Recruitment Pipeline', value: candidates, unit: 'candidates', icon: 'person-plus', drilldown: 'recruitment', subtitle: 'In interview / screening' }
    ];
  }

  // Admin
  const companyCount = (props.records?.companies || []).length;
  const lockedMonths = props.records?.lockedMonths || {};
  const currentMonth = getMytToday().slice(0, 7);
  const isMonthLocked = Boolean(lockedMonths[currentMonth]);
  const lockStatus = isMonthLocked ? 'Month locked' : 'Unlocked / Pending';

  return [
    { id: 'M21', label: 'Operating Companies', value: companyCount, unit: 'entities', icon: 'building', drilldown: 'companies', subtitle: 'Multi-entity corporate' },
    { id: 'M13', label: 'Enterprise Headcount', value: workforceMetrics.value.total, unit: 'people', icon: 'people-fill', drilldown: 'directory', subtitle: 'All active employees' },
    { id: 'M22', label: 'Payroll Processing', value: lockStatus, unit: '', icon: isMonthLocked ? 'lock-fill' : 'unlock', drilldown: 'payroll', subtitle: `${currentMonth} status` },
    { id: 'M24', label: 'Data Quality Gaps', value: dataQualityGaps.value.missingDeptCount + dataQualityGaps.value.missingManagerCount, unit: 'gaps', icon: 'shield-exclamation', drilldown: 'dataGaps', subtitle: `${dataQualityGaps.value.missingManagerCount} missing manager` },
    { id: 'M23', label: 'Data Freshness (MYT)', value: props.refreshing ? 'Refreshing…' : 'Live', unit: '', icon: 'cloud-check', drilldown: 'syncDetails', subtitle: getMytToday() }
  ];
});

function handleDrilldown(target) {
  if (!target) return;
  if (['claims', 'loans', 'training', 'recruitment', 'companies', 'departments', 'workSchedules'].includes(target)) {
    const s = ['claims', 'loans'].includes(target) && normalizedRole.value === 'User' ? 'personal' : undefined;
    emit('navigate-module', target, s);
    return;
  }
  if (target === 'myLeave') {
    navigateToTab('staff-portal');
    return;
  }
  if (target === 'teamLeave') {
    navigateToTab('leave-management');
    return;
  }
  if (target === 'myAttendance') {
    navigateToTab('my-attendance');
    return;
  }
  if (target === 'myRequests' || target === 'myClaims') {
    emit('navigate-module', 'claims', 'personal');
    return;
  }
  if (target === 'directory' || target === 'teamDirectory' || target === 'dataGaps') {
    navigateToTab('staff-mgmt');
    return;
  }
  if (target === 'actionInbox') {
    if (normalizedRole.value === 'HOD') {
      navigateToTab('leave-management');
    }
    return;
  }
  if (target === 'payroll') {
    navigateToTab('summary-dashboard');
    return;
  }
}

function handleActionReview(item) {
  emit('review-action', item);
}

function navigateToTab(tabId) {
  if (typeof window !== 'undefined' && typeof window.switchTab === 'function') {
    window.switchTab(tabId);
    return;
  }
  const link = document.querySelector(`[data-page="${tabId}"]`);
  if (link) {
    let parent = link.parentElement;
    while (parent) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
    link.click();
  }
}

function handleNavShortcut(action) {
  if (action === 'applyLeave') {
    navigateToTab('staff-portal');
  } else if (action === 'submitClaim') {
    emit('navigate-module', 'claims');
    const claimLink = document.querySelector('[data-hr-module="claims"]');
    if (claimLink) {
      let parent = claimLink.parentElement;
      while (parent) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        parent = parent.parentElement;
      }
      claimLink.click();
    }
  } else if (action === 'myPayslips') {
    navigateToTab('payslips-portal');
  } else if (action === 'myAttendance') {
    navigateToTab('my-attendance');
  }
}

function onRefresh() {
  emit('refresh');
}

function onReset() {
  selectedCompany.value = 'all';
  selectedDepartment.value = 'all';
  selectedPeriod.value = 'thisMonth';
}
</script>

<style scoped>
.role-overview-container {
  width: 100%;
  margin: 0 auto;
}
</style>
