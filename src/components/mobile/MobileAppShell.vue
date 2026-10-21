<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { dashboardActions } from '../../services/dashboard';
import { clearMobileSessionCache } from '../../services/mobileSessionCache';
import MobileHome from './MobileHome.vue';
import MobileAttendance from './MobileAttendance.vue';
import MobileRequests from './MobileRequests.vue';
import MobileInbox from './MobileInbox.vue';
import MobileMe from './MobileMe.vue';

const props = defineProps({
  user: { type: Object, required: true },
  refreshData: { type: Function, required: true },
  records: { type: Object, default: () => ({}) },
  teamLeave: { type: Array, default: () => [] },
  employees: { type: Array, default: () => [] }
});

const emit = defineEmits(['logout', 'open-dossier', 'submit-leave', 'submit-claim', 'refresh']);

const requestAction = ref({ kind: '', sequence: 0 });
const meSelection = ref({ section: 'leave', sequence: 0 });
const currentTab = ref('home'); // 'home' | 'attendance' | 'requests' | 'inbox' | 'me'

const tabTitles = {
  home: 'PplosHR',
  attendance: 'My Attendance',
  requests: 'Requests & Applications',
  inbox: 'Inbox & Approvals',
  me: 'Account & Settings'
};

const userInitials = computed(() => {
  const parts = String(props.user?.name || '').trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || 'U').toUpperCase();
});

// Messenger-style in-app notification banner & vibration
const notification = ref({
  visible: false,
  title: '',
  message: '',
  type: 'info',
  icon: 'bi-bell-fill'
});
let toastTimer = null;

function showToast({ title, message, type = 'info', icon = '' }) {
  if (toastTimer) clearTimeout(toastTimer);
  const iconMap = {
    success: 'bi-check-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    danger: 'bi-x-circle-fill',
    info: 'bi-chat-dots-fill'
  };
  notification.value = {
    visible: true,
    title: title || 'PplosHR Notification',
    message: message || '',
    type,
    icon: icon || iconMap[type] || 'bi-bell-fill'
  };
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  } catch (_) {}
  toastTimer = setTimeout(() => {
    notification.value.visible = false;
  }, 4500);
}

function onMobileNotify(e) {
  if (e.detail) showToast(e.detail);
}

// Background polling for real-time HOD / HR approval notifications
let pollTimer = null;
let lastKnownTotal = -1;

async function checkPendingApprovalUpdates() {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (!['HOD', 'Supervisor', 'HR', 'Admin'].includes(props.user?.role)) return;
  try {
    const res = await dashboardActions.apiPost('getActionCount', { staffName: props.user?.name });
    if (res && res.status === 'success' && res.data) {
      const currentTotal = Number(res.data.total || 0);
      if (lastKnownTotal !== -1 && currentTotal > lastKnownTotal) {
        const diff = currentTotal - lastKnownTotal;
        const recent = res.data.recentPendingItems && res.data.recentPendingItems[0];
        const detailMsg = recent ? `${recent.employee} submitted ${recent.title}` : `You have ${diff} new approval request${diff > 1 ? 's' : ''}.`;
        showToast({
          title: 'New Pending Approval',
          message: detailMsg,
          type: 'info'
        });
        triggerManualRefresh();
      }
      lastKnownTotal = currentTotal;
    }
  } catch (_) {}
}

const activeScreen = ref(null);
const isRefreshing = ref(false);
const hasPendingUpdate = ref(false);
let lastRefreshedAt = Date.now();

async function triggerManualRefresh() {
  if (isRefreshing.value) return;
  isRefreshing.value = true;
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        }
      } catch (_) {}
    }
    clearMobileSessionCache();
    await props.refreshData();
    await nextTick();
    await activeScreen.value?.refresh?.();
    hasPendingUpdate.value = false;
    lastRefreshedAt = Date.now();
    window.dispatchEvent(new CustomEvent('hr-mobile-refreshed'));
  } catch (error) {
    hasPendingUpdate.value = true;
    showToast({ title: 'Refresh failed', message: error?.message || 'Please try refreshing again.', type: 'danger' });
  } finally {
    isRefreshing.value = false;
  }
}

function handleExternalRefresh() {
  triggerManualRefresh();
}

// Pull to refresh touch tracking
const mainContentRef = ref(null);
const pullDistance = ref(0);
const pullThreshold = 65;
let touchStartY = 0;
let isPulling = false;

function onTouchStart(e) {
  if (isRefreshing.value) return;
  const target = mainContentRef.value;
  const scrollTop = target ? target.scrollTop : (window.pageYOffset || document.documentElement.scrollTop);
  if (scrollTop <= 2 && e.touches.length === 1) {
    touchStartY = e.touches[0].clientY;
    isPulling = true;
  } else {
    isPulling = false;
  }
}

function onTouchMove(e) {
  if (!isPulling || isRefreshing.value) return;
  const currentY = e.touches[0].clientY;
  const diff = currentY - touchStartY;
  if (diff > 0) {
    pullDistance.value = Math.min(diff * 0.45, 90);
  } else {
    pullDistance.value = 0;
  }
}

function onTouchEnd() {
  if (!isPulling) return;
  isPulling = false;
  if (pullDistance.value >= pullThreshold) {
    triggerManualRefresh();
  }
  pullDistance.value = 0;
}

function checkBackgroundUpdate() {
  if (Date.now() - lastRefreshedAt > 180000) {
    hasPendingUpdate.value = true;
  }
}

function onVisibilityChange() {
  if (typeof document !== 'undefined' && !document.hidden) {
    checkPendingApprovalUpdates();
    checkBackgroundUpdate();
  }
}

onMounted(() => {
  window.addEventListener('hr-mobile-notify', onMobileNotify);
  window.addEventListener('hr-mobile-refresh', handleExternalRefresh);
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      hasPendingUpdate.value = true;
    });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (['HOD', 'Supervisor', 'HR', 'Admin'].includes(props.user?.role)) {
    checkPendingApprovalUpdates();
    pollTimer = setInterval(checkPendingApprovalUpdates, 35000);
  }
});

onUnmounted(() => {
  window.removeEventListener('hr-mobile-notify', onMobileNotify);
  window.removeEventListener('hr-mobile-refresh', handleExternalRefresh);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  if (pollTimer) clearInterval(pollTimer);
  if (toastTimer) clearTimeout(toastTimer);
});

// Count unread items for Inbox tab badge
const userKey = computed(() => props.user?.username || props.user?.email || props.user?.name || 'user');
const seenStorageKey = computed(() => `pploshr_mobile_inbox_seen_${encodeURIComponent(userKey.value)}`);
const unreadInboxCount = computed(() => {
  const seen = new Set(JSON.parse(localStorage.getItem(seenStorageKey.value) || '[]'));
  let totalPending = 0;
  const currentRole = props.user?.role || 'User';
  const myUpperName = String(props.user?.name || '').trim().toUpperCase();

  if (['HOD', 'Supervisor', 'HR', 'Admin'].includes(currentRole)) {
    // 1. Claims and Bookings
    for (const mod of ['claims', 'bookings']) {
      for (const r of props.records[mod] || []) {
        if (/pending/i.test(r.status)) {
          if (['Admin', 'HR'].includes(currentRole)) {
            totalPending++;
          } else {
            // HOD: must be subordinate or direct manager
            const rManager = String(r.manager || '').trim().toUpperCase();
            const rEmp = String(r.employee || '').trim().toUpperCase();
            if (rEmp !== myUpperName && (rManager === myUpperName || (props.employees || []).some(e => String(e.name || '').trim().toUpperCase() === rEmp && String(e.manager || '').trim().toUpperCase() === myUpperName))) {
              totalPending++;
            }
          }
        }
      }
    }
    // 2. Pending Leaves
    const candidateLeaves = props.records?.leave || props.records?.leaves || props.teamLeave || [];
    for (const l of candidateLeaves) {
      const st = String(l.status || '').trim();
      const applicantName = String(l.employee || l.name || '').trim().toUpperCase();
      if (['Admin', 'HR'].includes(currentRole)) {
        if (['pending_admin', 'Pending', 'Withdrawal Requested', 'withdrawal_pending_hr'].includes(st)) {
          totalPending++;
        }
      } else if (['HOD', 'Supervisor'].includes(currentRole)) {
        if (['pending_hod', 'Withdrawal Requested', 'withdrawal_pending_hod'].includes(st) && applicantName !== myUpperName) {
          totalPending++;
        }
      }
    }
  }
  return totalPending;
});

// Approval / Rejection Handlers from MobileInbox
async function handleInboxApprove({ item }) {
  try {
    if (item.category === 'leave') {
      const rowIndex = item.raw.rowIndex || item.raw.id;
      const isWithdrawal = item.isWithdrawal || String(item.raw.status || '').toLowerCase().includes('withdrawal');
      const currentRole = props.user?.role || 'User';

      let nextStatus = 'Approved';
      let toastTitle = 'Request Approved';
      let toastMsg = `Approved leave application for ${item.employee || 'staff'}.`;

      if (isWithdrawal) {
        if (['Admin', 'HR'].includes(currentRole)) {
          nextStatus = 'Withdrawn';
          toastTitle = 'Withdrawal Approved';
          toastMsg = `Approved leave withdrawal for ${item.employee || 'staff'}. Entitlement restored.`;
        } else {
          nextStatus = 'withdrawal_pending_hr';
          toastTitle = 'Withdrawal Endorsed';
          toastMsg = `Endorsed leave withdrawal for ${item.employee || 'staff'} to HR.`;
        }
      }

      const res = await dashboardActions.apiPost('updateLeaveStatus', {
        rowIndex: rowIndex,
        requestId: item.raw.requestId || item.raw.id,
        expectedStatus: item.raw.status,
        newStatus: nextStatus,
        approver: props.user?.name,
        role: currentRole
      });
      if (res && res.status === 'success') {
        showToast({
          title: toastTitle,
          message: toastMsg,
          type: 'success'
        });
        triggerManualRefresh();
      } else {
        alert(res?.message || 'Failed to update leave status.');
      }
    } else if (['claim', 'booking', 'resource', 'loan'].includes(item.category)) {
      const mod = item.category === 'claim' ? 'claims' : (item.category === 'booking' || item.category === 'resource') ? 'bookings' : 'loans';
      const res = await dashboardActions.apiPost('hrTransition', {
        module: mod,
        id: item.raw.id,
        version: item.raw.version,
        command: 'approve',
        comments: 'Approved via Mobile PWA'
      });
      if (res && res.status === 'success') {
        showToast({
          title: 'Request Approved',
          message: `Approved ${mod === 'bookings' ? 'resource request' : mod.slice(0, -1)} for ${item.employee || 'staff'}.`,
          type: 'success'
        });
        triggerManualRefresh();
      } else {
        alert(res?.message || 'Failed to update record.');
      }
    }
  } catch (err) {
    alert('Action error: ' + (err.message || String(err)));
  }
}

async function handleInboxReject({ item, reason }) {
  try {
    if (item.category === 'leave') {
      const rowIndex = item.raw.rowIndex || item.raw.id;
      const isWithdrawal = item.isWithdrawal || String(item.raw.status || '').toLowerCase().includes('withdrawal');
      // If rejecting a withdrawal, the leave returns to its approved status
      const nextStatus = isWithdrawal ? 'Approved' : 'Rejected';
      const res = await dashboardActions.apiPost('updateLeaveStatus', {
        rowIndex: rowIndex,
        requestId: item.raw.requestId || item.raw.id,
        expectedStatus: item.raw.status,
        newStatus: nextStatus,
        approver: props.user?.name,
        approverRemark: reason ? (isWithdrawal ? `Withdrawal Rejected: ${reason}` : reason) : (isWithdrawal ? 'Withdrawal Rejected' : 'Rejected')
      });
      if (res && res.status === 'success') {
        showToast({
          title: isWithdrawal ? 'Withdrawal Rejected' : 'Request Rejected',
          message: isWithdrawal ? `Rejected leave withdrawal. The leave remains approved.` : `Rejected leave application with feedback note.`,
          type: 'info'
        });
        triggerManualRefresh();
      } else {
        alert(res?.message || 'Failed to reject leave.');
      }
    } else if (['claim', 'booking', 'resource', 'loan'].includes(item.category)) {
      const mod = item.category === 'claim' ? 'claims' : (item.category === 'booking' || item.category === 'resource') ? 'bookings' : 'loans';
      const res = await dashboardActions.apiPost('hrTransition', {
        module: mod,
        id: item.raw.id,
        version: item.raw.version,
        command: 'reject',
        comments: reason
      });
      if (res && res.status === 'success') {
        showToast({
          title: 'Request Rejected',
          message: `Rejected ${mod.slice(0, -1)} with feedback note.`,
          type: 'info'
        });
        triggerManualRefresh();
      } else {
        alert(res?.message || 'Failed to reject record.');
      }
    }
  } catch (err) {
    alert('Action error: ' + (err.message || String(err)));
  }
}

function handleNavigate(targetTab) {
  if (targetTab === 'me-leave' || targetTab === 'me') {
    meSelection.value = { section: 'leave', sequence: meSelection.value.sequence + 1 };
    currentTab.value = 'me';
  } else {
    currentTab.value = targetTab;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Pass a reactive intent through KeepAlive: no fragile child-ref/setTimeout or hidden tab step.
function openRequest(kind) {
  requestAction.value = { kind, sequence: requestAction.value.sequence + 1 };
  currentTab.value = 'requests';
}
const openLeaveWizard = () => openRequest('leave');
const openClaimWizard = () => openRequest('claim');
const openBookingWizard = () => openRequest('booking');
</script>

<template>
  <div class="m-app-shell">
    <!-- Messenger-style Slide-down Notification Banner -->
    <transition name="toast-slide">
      <div v-if="notification.visible" class="m-messenger-toast" role="alert" @click="notification.visible = false">
        <div class="m-toast-icon" :class="notification.type">
          <i :class="notification.icon"></i>
        </div>
        <div class="m-toast-body">
          <div class="m-toast-title">{{ notification.title }}</div>
          <div class="m-toast-msg">{{ notification.message }}</div>
        </div>
        <button type="button" class="m-toast-close" aria-label="Dismiss">
          <i class="bi bi-x"></i>
        </button>
      </div>
    </transition>

    <!-- Top Mobile Header Bar -->
    <header class="m-header-bar">
      <div class="m-brand-box">
        <div class="m-logo-icon"><i class="bi bi-grid-1x2-fill"></i></div>
        <span class="m-header-title">{{ tabTitles[currentTab] }}</span>
      </div>
      <div class="d-flex align-items-center gap-2">
        <button
          type="button"
          class="m-icon-btn"
          :class="{ 'm-refresh-spinning': isRefreshing }"
          @click="triggerManualRefresh"
          :disabled="isRefreshing"
          :aria-busy="isRefreshing"
          aria-label="Refresh mobile data"
          title="Refresh"
        >
          <i class="bi bi-arrow-clockwise"></i>
        </button>
        <button type="button" class="m-icon-btn position-relative" @click="handleNavigate('inbox')" aria-label="Inbox">
          <i class="bi bi-bell"></i>
          <span v-if="unreadInboxCount > 0" class="m-badge-pill">{{ unreadInboxCount }}</span>
        </button>
        <button type="button" class="m-avatar-btn overflow-hidden p-0" @click="handleNavigate('me')" aria-label="My Account">
          <img v-if="user?.photo || user?.photoUrl" :src="user.photo || user.photoUrl" class="w-100 h-100 object-fit-cover rounded-circle" alt="Account" />
          <template v-else>{{ userInitials }}</template>
        </button>
      </div>
    </header>

    <!-- Update Prompt Banner / Pill -->
    <transition name="m-slide-down">
      <div
        v-if="hasPendingUpdate"
        class="m-update-pill-banner"
        @click="triggerManualRefresh"
        role="button"
        tabindex="0"
      >
        <div class="d-flex align-items-center gap-2">
          <span class="m-update-dot"></span>
          <span class="fw-semibold text-dark" style="font-size: 0.85rem;">New updates available</span>
        </div>
        <div class="d-flex align-items-center gap-1 text-primary fw-bold" style="font-size: 0.82rem;">
          <span>Tap to refresh</span>
          <i class="bi bi-arrow-clockwise"></i>
        </div>
      </div>
    </transition>

    <!-- Pull Down to Refresh Visual Indicator -->
    <div
      v-if="pullDistance > 0 || isRefreshing"
      class="m-pull-indicator"
      :style="{ transform: `translateY(${Math.min(pullDistance, 70)}px)` }"
    >
      <div class="m-pull-spinner" :class="{ 'is-refreshing': isRefreshing }">
        <i
          class="bi"
          :class="isRefreshing ? 'bi-arrow-repeat m-spin text-primary' : pullDistance >= pullThreshold ? 'bi-arrow-up-circle-fill text-primary' : 'bi-arrow-down text-secondary'"
        ></i>
      </div>
      <span class="m-pull-text">
        {{ isRefreshing ? 'Refreshing data...' : pullDistance >= pullThreshold ? 'Release to refresh' : 'Pull down to refresh' }}
      </span>
    </div>

    <!-- Main Mobile Content Area with Stacked Scroll & Pull to Refresh -->
    <main
      ref="mainContentRef"
      class="m-main-content"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <KeepAlive>
        <component
          ref="activeScreen"
          :is="currentTab === 'home' ? MobileHome : currentTab === 'attendance' ? MobileAttendance : currentTab === 'requests' ? MobileRequests : currentTab === 'inbox' ? MobileInbox : MobileMe"
          :user="user"
          :records="records"
          :team-leave="teamLeave"
          :employees="employees"
          v-bind="currentTab === 'requests' ? { launchAction: requestAction } : currentTab === 'me' ? { meSelection } : {}"
          @navigate="handleNavigate"
          @open-leave-wizard="openLeaveWizard"
          @open-claim-wizard="openClaimWizard"
          @open-booking-wizard="openBookingWizard"
          @open-dossier="(name) => emit('open-dossier', name)"
          @submit-leave="(data) => { emit('submit-leave', data); triggerManualRefresh(); }"
          @submit-claim="(data) => { emit('submit-claim', data); triggerManualRefresh(); }"
          @submit-booking="() => triggerManualRefresh()"
          @approve="handleInboxApprove"
          @reject="handleInboxReject"
          @refresh="triggerManualRefresh"
          @logout="emit('logout')"
        />
      </KeepAlive>
    </main>

    <!-- Persistent Bottom Tab Bar with Safe-Area Padding -->
    <nav class="m-bottom-bar" aria-label="Mobile Navigation">
      <button
        type="button"
        :class="['m-nav-tab', { active: currentTab === 'home' }]"
        @click="handleNavigate('home')"
      >
        <i class="bi bi-house-door-fill"></i>
        <span>Home</span>
      </button>

      <button
        type="button"
        :class="['m-nav-tab', { active: currentTab === 'attendance' }]"
        @click="handleNavigate('attendance')"
      >
        <i class="bi bi-calendar2-check-fill"></i>
        <span>Attendance</span>
      </button>

      <button
        type="button"
        :class="['m-nav-tab', { active: currentTab === 'requests' }]"
        @click="handleNavigate('requests')"
      >
        <i class="bi bi-file-earmark-plus-fill"></i>
        <span>Requests</span>
      </button>

      <button
        type="button"
        :class="['m-nav-tab', { active: currentTab === 'inbox' }]"
        @click="handleNavigate('inbox')"
      >
        <div class="position-relative">
          <i class="bi bi-inbox-fill"></i>
          <span v-if="unreadInboxCount > 0" class="m-tab-badge"></span>
        </div>
        <span>Inbox</span>
      </button>

      <button
        type="button"
        :class="['m-nav-tab', { active: currentTab === 'me' }]"
        @click="handleNavigate('me')"
      >
        <i class="bi bi-person-fill"></i>
        <span>Me</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.m-app-shell {
  height: 100dvh;
  max-height: 100dvh;
  width: 100vw;
  max-width: 100vw;
  overflow: hidden;
  overscroll-behavior: none;
  background: #f8f9fa;
  color: #1c1c1e;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  position: relative;
}
.m-header-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: max(12px, env(safe-area-inset-top)) 16px 12px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  position: sticky;
  top: 0;
  z-index: 1000;
  flex-shrink: 0;
}
.m-brand-box {
  display: flex;
  align-items: center;
  gap: 10px;
}
.m-logo-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #1c1c1e;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}
.m-header-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: #1c1c1e;
  letter-spacing: -0.02em;
}
.m-icon-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #f2f2f7;
  border: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1c1c1e;
  font-size: 1.1rem;
  cursor: pointer;
  position: relative;
  transition: all 0.15s ease;
}
.m-avatar-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0071e3, #42a5f5);
  border: 2px solid #ffffff;
  color: #ffffff;
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 113, 227, 0.25);
  cursor: pointer;
  transition: transform 0.15s ease;
}
.m-badge-pill {
  position: absolute;
  top: -2px;
  right: -2px;
  background: #ff3b30;
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border: 2px solid #ffffff;
}
.m-main-content {
  flex: 1;
  position: relative;
  z-index: 1;
  padding: 16px;
  padding-bottom: calc(76px + env(safe-area-inset-bottom));
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-y: contain;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}
/* Messenger-style Notification Toast */
.m-messenger-toast {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  left: 12px;
  right: 12px;
  max-width: 460px;
  margin: 0 auto;
  z-index: 2500;
  background: rgba(28, 28, 30, 0.94);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: #ffffff;
  border-radius: 18px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  user-select: none;
}
.m-toast-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
  flex-shrink: 0;
}
.m-toast-icon.success { background: #34c759; color: #fff; }
.m-toast-icon.warning { background: #ff9500; color: #fff; }
.m-toast-icon.danger { background: #ff3b30; color: #fff; }
.m-toast-icon.info { background: #0071e3; color: #fff; }
.m-toast-body {
  flex: 1;
  min-width: 0;
}
.m-toast-title {
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.2;
}
.m-toast-msg {
  font-size: 0.76rem;
  color: #d1d1d6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.m-toast-close {
  background: transparent;
  border: none;
  color: #8e8e93;
  font-size: 1.2rem;
  padding: 0 4px;
  cursor: pointer;
}
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-slide-enter-from {
  transform: translateY(-120%);
  opacity: 0;
}
.toast-slide-leave-to {
  transform: translateY(-120%);
  opacity: 0;
}
.m-bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1100;
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  height: calc(62px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  display: flex;
  justify-content: space-around;
  align-items: center;
}
.m-nav-tab {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  background: transparent;
  border: none;
  color: #8e8e93;
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
  min-height: 48px;
  transition: color 0.15s ease;
}
.m-nav-tab i {
  font-size: 1.25rem;
  line-height: 1;
}
.m-nav-tab.active {
  color: #0071e3;
}
.m-tab-badge {
  position: absolute;
  top: -2px;
  right: -4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff3b30;
}
.m-refresh-spinning i {
  display: inline-block;
  animation: mSpin 0.75s linear infinite;
  color: #0071e3;
}
@keyframes mSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.m-spin {
  animation: mSpin 0.75s linear infinite;
  display: inline-block;
}
.m-pull-indicator {
  position: fixed;
  top: 54px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  pointer-events: none;
  z-index: 990;
  transition: transform 0.1s ease-out;
}
.m-pull-spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  border: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
}
.m-pull-spinner.is-refreshing i {
  animation: mSpin 0.75s linear infinite;
  color: #0071e3;
}
.m-pull-text {
  font-size: 0.72rem;
  font-weight: 600;
  color: #64748b;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  padding: 3px 12px;
  border-radius: 12px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}
.m-update-pill-banner {
  background: #ffffff;
  border: 1px solid #bfdbfe;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.15);
  border-radius: 9999px;
  padding: 8px 16px;
  margin: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  z-index: 999;
  position: sticky;
  top: 58px;
  animation: pillSlideDown 0.25s ease-out;
}
.m-update-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2563eb;
  animation: pulseDot 1.5s infinite;
}
@keyframes pulseDot {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(37, 99, 235, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
}
@keyframes pillSlideDown {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
.m-slide-down-enter-active,
.m-slide-down-leave-active {
  transition: all 0.25s ease-out;
}
.m-slide-down-enter-from,
.m-slide-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
