<script setup>
import { computed, ref, watch, onMounted, onActivated } from 'vue';
import { dashboardActions } from '../../services/dashboard';
import { getMobileCached } from '../../services/mobileSessionCache';
import { resolveEmployeeShift } from '../../services/inductionPolicy.js';

const props = defineProps({
  user: { type: Object, required: true },
  records: { type: Object, default: () => ({}) },
  teamLeave: { type: Array, default: () => [] },
  employees: { type: Array, default: () => [] }
});

const emit = defineEmits(['navigate', 'open-leave-wizard', 'open-claim-wizard', 'open-booking-wizard']);

const role = computed(() => props.user?.role || 'User');
const isManager = computed(() => {
  const r = String(props.user?.role || role.value || '').trim().toLowerCase();
  if (['hod', 'supervisor', 'hr', 'admin', 'manager'].some(k => r.includes(k))) return true;
  const myName = String(props.user?.name || '').trim().toUpperCase();
  const hasSubordinates = (props.employees || []).some(e => String(e.manager || '').trim().toUpperCase() === myName);
  return hasSubordinates || pendingApprovalsCount.value > 0;
});

const firstName = computed(() => {
  const n = String(props.user?.name || '').trim();
  return n.split(' ')[0] || 'Team Member';
});

const greeting = computed(() => {
  const hr = new Date().getHours();
  if (hr < 12) return 'Good morning';
  if (hr < 18) return 'Good afternoon';
  return 'Good evening';
});

const todayDateStr = computed(() => {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date());
});

const myUpperName = computed(() => String(props.user?.name || '').trim().toUpperCase());

// Leave balances
const myLeaves = computed(() => {
  const upper = myUpperName.value;
  return (props.records?.leave || props.records?.leaves || props.teamLeave || []).filter((l) => {
    return String(l.employee || l.name || '').trim().toUpperCase() === upper;
  });
});

const confirmedAl = ref(null);
let balanceLoadSequence = 0;
async function loadVerifiedLeaveBalance(strict = false) {
  const sequence = ++balanceLoadSequence;
  if (!props.user?.name) return;
  const employee = props.user.employeeNo || props.user.name;
  try {
    const data = await getMobileCached(employee, 'leave-balance', async () => {
      let res;
      try {
        res = await dashboardActions.apiPost('leaveOverview', {});
      } catch (_) { res = null; }
      if (res?.status === 'success' && res.data) return res.data;

      const dosRes = await dashboardActions.apiPost('getStaffDossier', { employee: props.user.name });
      if (dosRes?.status === 'success' && dosRes.data?.leave) return dosRes.data.leave;

      throw Error(dosRes?.message || "Leave balance refresh failed.");
    }, 90000);
    if (sequence !== balanceLoadSequence || employee !== (props.user.employeeNo || props.user.name)) return;
    const annual = (data.leaveBalances || data.balances || []).find(b => b.category === 'Annual');
    const value = annual?.balance ?? data.alBalance;
    if (value != null && Number.isFinite(Number(value))) {
      confirmedAl.value = Number(value);
    }
  } catch (error) { if (strict === true) throw error; }
}
onMounted(loadVerifiedLeaveBalance);
onActivated(loadVerifiedLeaveBalance);
watch(() => props.user?.employeeNo || props.user?.name, loadVerifiedLeaveBalance);

const alAvailable = computed(() => {
  if (confirmedAl.value != null && Number.isFinite(Number(confirmedAl.value))) {
    return confirmedAl.value;
  }
  if (props.user?.alBalance != null && props.user.alBalance !== '—') {
    return props.user.alBalance;
  }
  const name = props.user?.name;
  let s = {};
  if (typeof window !== 'undefined' && window.staffSettings && name) {
    s = window.staffSettings[name] || {};
  }
  if (s.alBalance != null && s.alBalance !== '—') return s.alBalance;
  if (s.alEntitlement != null && s.alEntitlement !== '—') return s.alEntitlement;

  const emp = (props.employees || []).find(e => e.name === name || e.employee === name);
  if (emp?.alBalance != null && emp.alBalance !== '—') return emp.alBalance;
  if (emp?.alEntitlement != null && emp.alEntitlement !== '—') return emp.alEntitlement;

  if (props.user?.alEntitlement != null && props.user.alEntitlement !== '—') {
    return props.user.alEntitlement;
  }
  return '—';
});

const myPendingRequests = computed(() => {
  const upper = myUpperName.value;
  if (!upper) return 0;

  // 1. Claims from server
  const cPending = (props.records?.claims || []).filter(
    (c) => String(c.employee || c.name || '').trim().toUpperCase() === upper && /pending/i.test(c.status)
  ).length;

  // 2. Leaves from server
  const lPending = myLeaves.value.filter((l) => /pending/i.test(l.status)).length;

  // 3. Bookings / Resources from server
  const bPending = (props.records?.bookings || []).filter(
    (b) => String(b.employee || b.name || '').trim().toUpperCase() === upper && /pending/i.test(b.status)
  ).length;

  // 4. Loans from server
  const loanPending = (props.records?.loans || []).filter(
    (l) => String(l.employee || l.name || '').trim().toUpperCase() === upper && /pending/i.test(l.status)
  ).length;

  // 5. Synchronize with optimistic client-submitted requests in localStorage/sessionStorage
  let localLeaveCount = 0;
  let localClaimCount = 0;
  try {
    const rawLocalLeaves = JSON.parse(localStorage.getItem(`pploshr_local_leaves_${upper}`) || sessionStorage.getItem(`pploshr_local_leaves_${upper}`) || '[]');
    for (const ll of rawLocalLeaves) {
      const alreadyOnServer = myLeaves.value.some(sl => (sl.id && sl.id === ll.id) || (sl.start === ll.start && sl.type === ll.type));
      if (!alreadyOnServer && /pending/i.test(ll.status)) localLeaveCount++;
    }
    const rawLocalClaims = JSON.parse(localStorage.getItem(`pploshr_local_claims_${upper}`) || sessionStorage.getItem(`pploshr_local_claims_${upper}`) || '[]');
    for (const lc of rawLocalClaims) {
      const alreadyOnServer = (props.records?.claims || []).some(sc => (sc.id && sc.id === lc.id) || (sc.date === lc.date && sc.amount === lc.amount));
      if (!alreadyOnServer && /pending/i.test(lc.status)) localClaimCount++;
    }
  } catch (_) {}

  return cPending + lPending + bPending + loanPending + localLeaveCount + localClaimCount;
});

// Manager Pending Approvals
const pendingApprovalsCount = computed(() => {
  const r = String(props.user?.role || role.value || '').trim().toLowerCase();
  const myName = String(props.user?.name || '').trim().toUpperCase();
  const isHrOrAdmin = ['admin', 'hr'].some(k => r.includes(k));
  const isHodRole = ['hod', 'supervisor', 'manager'].some(k => r.includes(k));
  const hasSubordinates = (props.employees || []).some(e => String(e.manager || '').trim().toUpperCase() === myName);

  if (!isHrOrAdmin && !isHodRole && !hasSubordinates) return 0;

  let count = 0;
  // 1. Claims, loans, bookings
  for (const mod of ['claims', 'loans', 'bookings']) {
    for (const item of props.records[mod] || []) {
      const emp = String(item.employee || item.name || '').trim().toUpperCase();
      const st = String(item.status || '').trim();
      if (emp !== myName && /pending/i.test(st)) {
        if (mod === 'bookings' || mod === 'loans') {
          count++;
        } else if (isHrOrAdmin) {
          if (st === 'Pending admin' || st === 'Pending' || /pending/i.test(st)) count++;
        } else {
          if (st === 'Pending manager' || (st !== 'Pending admin' && /pending/i.test(st))) count++;
        }
      }
    }
  }

  // 2. Leaves (deduplicated by ID)
  const candidateLeaves = props.teamLeave?.length ? props.teamLeave : (props.records?.leave || props.records?.leaves || []);
  const seenLeaveIds = new Set();
  for (const l of candidateLeaves) {
    const emp = String(l.employee || l.name || '').trim().toUpperCase();
    const st = String(l.status || '').trim();
    const key = l.id || `${emp}_${l.start}_${l.type}`;
    if (!seenLeaveIds.has(key) && emp !== myName) {
      if (isHrOrAdmin) {
        if (['pending_admin', 'Pending', 'Withdrawal Requested'].includes(st)) {
          seenLeaveIds.add(key);
          count++;
        }
      } else {
        if (st === 'pending_hod') {
          seenLeaveIds.add(key);
          count++;
        }
      }
    }
  }
  return count;
});

const teamLeaveDay = ref('today');
const klDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const teamLeaveDate = computed(() => klDay(new Date(Date.now() + (teamLeaveDay.value === 'tomorrow' ? 86400000 : 0))));
const teamOnLeave = computed(() => (props.teamLeave || []).filter(l => {
  const start = String(l.start || '').slice(0, 10);
  const end = String(l.end || l.start || '').slice(0, 10);
  const isApproved = !l.status || l.status === 'Approved';
  return isApproved && start && end && start <= teamLeaveDate.value && teamLeaveDate.value <= end;
}));

const todaySchedule = computed(() => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday

  // 1. Check if user has an approved leave today
  const myApprovedLeave = myLeaves.value.find((l) => {
    const s = String(l.start || '').slice(0, 10);
    const e = String(l.end || l.start || '').slice(0, 10);
    return s <= today && today <= e && /approved/i.test(l.status || '');
  });
  if (myApprovedLeave) {
    return {
      status: 'leave',
      label: "Today's Schedule",
      value: `On Leave · ${myApprovedLeave.type || 'Annual Leave'}`,
      isRest: true
    };
  }

  // 2. Check if today is a Public Holiday
  const hList = (typeof window !== 'undefined' && Array.isArray(window.holidays)) ? window.holidays : (props.records?.holidays || []);
  const holiday = hList.find((h) => String(h.date || '').slice(0, 10) === today);
  if (holiday) {
    return {
      status: 'holiday',
      label: "Today's Schedule",
      value: `Public Holiday · ${holiday.name || 'Holiday'}`,
      isRest: true
    };
  }

  // 3. Check if today is the user's rest day
  const rDays = Array.isArray(props.user?.restDays) ? props.user.restDays : [];
  if (rDays.includes(dayOfWeek) || (rDays.length === 0 && (dayOfWeek === 0 || dayOfWeek === 6))) {
    return {
      status: 'rest',
      label: "Today's Schedule",
      value: 'Rest Day / Off Day',
      isRest: true
    };
  }

  // 4. Derive from working schedule templates
  const matchingShift = resolveEmployeeShift(props.user, props.records?.workSchedules);

  if (matchingShift) {
    return {
      status: 'work',
      label: "Today's Schedule",
      value: `${matchingShift.start} - ${matchingShift.end} · ${matchingShift.title}`,
      isRest: false
    };
  }

  return {
    status: 'work',
    label: "Today's Schedule",
    value: '08:30 - 17:30 · Office Shift',
    isRest: false
  };
});
defineExpose({ refresh: () => loadVerifiedLeaveBalance(true) });
</script>

<template>
  <div class="m-home-root">
    <!-- Welcome Header -->
    <header class="m-hero-card">
      <div class="m-hero-welcome">
        <span class="m-date-badge"><i class="bi bi-calendar3 me-1"></i>{{ todayDateStr }}</span>
        <h2 class="m-greeting-title">{{ greeting }}, {{ firstName }}!</h2>
        <p class="m-greeting-sub">{{ user.jobTitle || 'Team Member' }} · {{ user.department || user.company || 'Metrio Group' }}</p>
      </div>
    </header>

    <!-- Quick Stats Grid -->
    <div class="m-stats-grid">
      <button type="button" class="m-stat-card" @click="emit('navigate', 'me-leave')">
        <span class="m-stat-icon text-success"><i class="bi bi-sun"></i></span>
        <span class="m-stat-num">{{ alAvailable }}</span>
        <span class="m-stat-label">AL Balance (days)</span>
      </button>
      <div class="m-stat-card" @click="emit('navigate', 'requests')">
        <span class="m-stat-icon text-primary"><i class="bi bi-hourglass-split"></i></span>
        <span class="m-stat-num">{{ myPendingRequests }}</span>
        <span class="m-stat-label">Pending Requests</span>
      </div>
      <div v-if="isManager" class="m-stat-card cursor-pointer" role="button" tabindex="0" @click="emit('navigate', 'inbox')">
        <span class="m-stat-icon text-warning"><i class="bi bi-clock-history"></i></span>
        <span class="m-stat-num">{{ pendingApprovalsCount }}</span>
        <span class="m-stat-label">Pending Approval</span>
        <small class="text-muted" style="font-size: 0.6rem; line-height: 1; margin-top: 2px;">(outstanding approval)</small>
      </div>
      <div v-else class="m-stat-card cursor-pointer" role="button" tabindex="0" @click="emit('navigate', 'me')">
        <span class="m-stat-icon text-warning"><i class="bi bi-receipt"></i></span>
        <span class="m-stat-num">Payslip</span>
        <span class="m-stat-label">Latest Available</span>
      </div>
    </div>

    <!-- 4 Quick Action Large Touch Tiles (48px+ targets) -->
    <section class="m-section">
      <h3 class="m-section-title">Quick Actions</h3>
      <div class="m-actions-grid">
        <button type="button" class="m-action-btn" @click="emit('open-leave-wizard')">
          <div class="m-btn-icon bg-info-subtle text-info"><i class="bi bi-calendar-plus"></i></div>
          <span>Apply Leave</span>
        </button>
        <button type="button" class="m-action-btn" @click="emit('open-claim-wizard')">
          <div class="m-btn-icon bg-success-subtle text-success"><i class="bi bi-camera-fill"></i></div>
          <span>Submit Claim</span>
        </button>
        <button type="button" class="m-action-btn" @click="emit('open-booking-wizard')">
          <div class="m-btn-icon bg-warning-subtle text-warning"><i class="bi bi-calendar2-range"></i></div>
          <span>Request Resources</span>
        </button>
        <button type="button" class="m-action-btn" @click="emit('navigate', 'attendance')">
          <div class="m-btn-icon bg-primary-subtle text-primary"><i class="bi bi-clock-history"></i></div>
          <span>My Attendance</span>
        </button>
      </div>
    </section>

    <!-- Read-only, server-authorized team availability; no leave reasons or documents. -->
    <section class="m-section" aria-label="Team members on leave">
      <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
        <h3 class="m-section-title mb-0">Team Members on Leave</h3>
        <span class="badge bg-secondary-subtle text-dark">{{ teamOnLeave.length }} away</span>
      </div>
      <div class="d-flex gap-2 mb-2" role="group" aria-label="Leave day">
        <button type="button" class="btn btn-sm rounded-pill" :class="teamLeaveDay === 'today' ? 'btn-dark' : 'btn-outline-secondary'" @click="teamLeaveDay = 'today'">Today</button>
        <button type="button" class="btn btn-sm rounded-pill" :class="teamLeaveDay === 'tomorrow' ? 'btn-dark' : 'btn-outline-secondary'" @click="teamLeaveDay = 'tomorrow'">Tomorrow</button>
      </div>
      <div v-if="!teamOnLeave.length" class="m-empty-card">
        <i class="bi bi-people me-2"></i>No approved team leave shown for {{ teamLeaveDay }}.
      </div>
      <div v-else class="m-list-card">
        <div v-for="(tl, idx) in teamOnLeave.slice(0, 5)" :key="tl.id || idx" class="m-list-item">
          <div class="m-avatar-sm">{{ tl.employee?.slice(0, 1) }}</div>
          <div class="m-item-main">
            <strong>{{ tl.employee }}</strong>
            <small class="text-muted d-block">Away · {{ tl.start }} to {{ tl.end }}</small>
          </div>
          <span class="badge bg-light text-secondary border">Approved</span>
        </div>
        <small v-if="teamOnLeave.length > 5" class="d-block p-2 text-muted">+{{ teamOnLeave.length - 5 }} additional team member(s)</small>
      </div>
    </section>
  </div>
</template>

<style scoped>
.m-home-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}
.m-hero-card {
  background: linear-gradient(135deg, #1c1c1e 0%, #2c2c2e 100%);
  color: #fff;
  border-radius: 20px;
  padding: 22px 20px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12);
}
.m-date-badge {
  display: inline-block;
  background: rgba(255,255,255,0.15);
  font-size: 0.72rem;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 999px;
  margin-bottom: 8px;
}
.m-greeting-title {
  font-size: 1.45rem;
  font-weight: 700;
  margin: 0 0 4px;
  letter-spacing: -0.02em;
}
.m-greeting-sub {
  font-size: 0.78rem;
  color: rgba(255,255,255,0.7);
  margin-bottom: 14px;
}
.m-shift-pill {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.m-shift-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #34c759;
  box-shadow: 0 0 8px #34c759;
}
.m-shift-label {
  font-size: 0.68rem;
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  font-weight: 600;
}
.m-shift-val {
  font-size: 0.84rem;
  font-weight: 600;
  color: #fff;
}
.m-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.m-stat-card {
  cursor: pointer;
  font: inherit;
  color: inherit;
  text-align: center;
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 16px;
  padding: 14px 10px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.m-stat-card:active {
  transform: scale(0.97);
}
.m-stat-icon {
  font-size: 1.25rem;
  margin-bottom: 4px;
}
.m-stat-num {
  font-size: 1.2rem;
  font-weight: 700;
  color: #1c1c1e;
  line-height: 1.2;
}
.m-stat-label {
  font-size: 0.65rem;
  color: #6e6e73;
  margin-top: 2px;
}
.m-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-section-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #1c1c1e;
  margin: 0;
}
.m-actions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.m-action-btn {
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 16px;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  min-height: 92px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #1c1c1e;
  transition: all 0.15s ease;
}
.m-action-btn:active {
  background: #f5f5f7;
  transform: scale(0.97);
}
.m-btn-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3rem;
}
.m-list-card {
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 16px;
  overflow: hidden;
}
.m-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f2f2f7;
}
.m-list-item:last-child {
  border-bottom: none;
}
.m-avatar-sm {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #e5e5ea;
  color: #1c1c1e;
  font-weight: 700;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-item-main {
  flex: 1;
}
.m-empty-card {
  background: #fff;
  border: 1px dashed #d1d1d6;
  border-radius: 14px;
  padding: 16px;
  text-align: center;
  font-size: 0.82rem;
  color: #8e8e93;
}
</style>
