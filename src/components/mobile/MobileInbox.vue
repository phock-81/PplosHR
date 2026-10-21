<script setup>
import { ref, computed } from 'vue';
import { formatDateKL, formatDateTimeKL, formatDateOrTimeKL, formatRangeKL } from '../../utils/dateUtils';

const props = defineProps({
  user: { type: Object, required: true },
  records: { type: Object, default: () => ({}) },
  teamLeave: { type: Array, default: () => [] },
  employees: { type: Array, default: () => [] }
});

const emit = defineEmits(['approve', 'reject']);

const role = computed(() => props.user?.role || 'User');
const isManager = computed(() => ['HOD', 'Supervisor', 'HR', 'Admin'].includes(role.value));

const filterType = ref('all'); // 'all' | 'pending' | 'unread'

// Persistent seen notifications keyed per user ID
const userKey = computed(() => props.user?.username || props.user?.email || props.user?.name || 'user');
const seenStorageKey = computed(() => `pploshr_mobile_inbox_seen_${encodeURIComponent(userKey.value)}`);
const seenIds = ref(new Set(JSON.parse(localStorage.getItem(seenStorageKey.value) || '[]')));

function markSeen(id) {
  seenIds.value.add(id);
  try {
    localStorage.setItem(seenStorageKey.value, JSON.stringify([...seenIds.value]));
  } catch (_) {}
}

function markAllRead() {
  const allIds = displayItems.value.map((i) => i.id);
  allIds.forEach((id) => seenIds.value.add(id));
  try {
    localStorage.setItem(seenStorageKey.value, JSON.stringify([...seenIds.value]));
  } catch (_) {}
}

// Decision Modal State for Managers
const showRejectModal = ref(false);
const activeRejectItem = ref(null);
const rejectReason = ref('');

// Detail Modal State
const showDetailModal = ref(false);
const activeDetailItem = ref(null);

function openItemDetail(item) {
  activeDetailItem.value = item;
  showDetailModal.value = true;
  markSeen(item.id);
}

function closeItemDetail() {
  showDetailModal.value = false;
  activeDetailItem.value = null;
}

function promptReject(item) {
  activeRejectItem.value = item;
  rejectReason.value = '';
  showRejectModal.value = true;
}

function confirmReject() {
  if (!rejectReason.value.trim()) {
    alert('Please state a reason for rejecting this request.');
    return;
  }
  emit('reject', { item: activeRejectItem.value, reason: rejectReason.value });
  markSeen(activeRejectItem.value.id);
  showRejectModal.value = false;
  if (showDetailModal.value) closeItemDetail();
}

function confirmApprove(item) {
  const targetDesc = item.employee ? `${item.employee}'s ${item.title}` : item.title;
  if (!confirm(`Confirm approval for ${targetDesc}?`)) return;
  emit('approve', { item });
  markSeen(item.id);
  if (showDetailModal.value) closeItemDetail();
}

// Items:
// For Managers: Pending approvals + Actionable alerts
// For Staff: Own submitted request updates & announcements
const displayItems = computed(() => {
  const list = [];
  const currentRole = props.user?.role || 'User';
  const myName = props.user?.name || '';
  const myUpperName = String(myName).trim().toUpperCase();

  function isLeaveAwaitingMyApproval(l) {
    const st = String(l.status || '').trim();
    const stLower = st.toLowerCase();
    const applicantName = String(l.employee || l.name || '').trim().toUpperCase();
    if (['Admin', 'HR'].includes(currentRole)) {
      return ['pending_admin', 'pending', 'withdrawal requested', 'withdrawal_pending_hr'].includes(stLower);
    }
    if (['HOD', 'Supervisor'].includes(currentRole)) {
      const isTargetStatus = ['pending_hod', 'withdrawal requested', 'withdrawal_pending_hod'].includes(stLower);
      if (!isTargetStatus) return false;
      if (applicantName === myUpperName) return false;
      const emp = (props.employees || []).find((e) => String(e.name || e.employee || '').trim().toUpperCase() === applicantName);
      if (emp && String(emp.manager || '').trim().toUpperCase() === myUpperName) return true;
      const myEmp = (props.employees || []).find((e) => String(e.name || e.employee || '').trim().toUpperCase() === myUpperName);
      if (myEmp && myEmp.departmentId && emp && emp.departmentId === myEmp.departmentId) return true;
      return true; // Included in team scope
    }
    return false;
  }

  if (isManager.value) {
    // 1. Team Leaves pending approval
    const candidateLeaves = props.records?.leave || props.records?.leaves || props.teamLeave || [];
    for (const l of candidateLeaves) {
      if (isLeaveAwaitingMyApproval(l)) {
        const isWithdrawal = String(l.status || '').toLowerCase().includes('withdrawal');
        const formattedRange = formatRangeKL(l.start, l.end, 'display');
        const reasonText = l.withdrawRemark || l.decisionRemark || l.reason || 'None';
        list.push({
          id: `leave-${l.id || l.rowIndex || l.start}`,
          type: isWithdrawal ? 'Leave Withdrawal Request' : 'Leave Approval',
          category: 'leave',
          employee: l.employee || l.name,
          title: `${isWithdrawal ? '[Withdrawal Request] ' : 'Leave: '}${l.type || 'Annual'} (${l.days} day${Number(l.days) > 1 ? 's' : ''})`,
          detail: `${formattedRange}. ${isWithdrawal ? 'Withdrawal Reason' : 'Reason'}: ${reasonText}. Status: ${l.status}`,
          date: formatDateKL(l.start, 'display') || 'Today',
          status: l.status,
          isWithdrawal: isWithdrawal,
          withdrawRemark: l.withdrawRemark || l.decisionRemark,
          isActionable: true,
          raw: l
        });
      }
    }

    // 2. Team Claims pending
    for (const c of props.records.claims || []) {
      const isClaimAwaiting = ['Admin', 'HR'].includes(currentRole)
        ? c.status === 'Pending admin'
        : c.status === 'Pending manager' || /pending/i.test(c.status);
      if (isClaimAwaiting) {
        list.push({
          id: `claim-${c.id}`,
          type: 'Claim Approval',
          category: 'claim',
          employee: c.employee,
          title: `Claim: RM ${Number(c.amount || 0).toFixed(2)} (${c.category || 'General'})`,
          detail: `Submitted on ${formatDateKL(c.date, 'display') || 'recently'}. Note: ${c.notes || 'No note'}`,
          date: formatDateKL(c.date, 'display') || 'Today',
          status: c.status,
          isActionable: true,
          raw: c
        });
      }
    }

    // 3. Team Resources pending
    for (const b of props.records.bookings || []) {
      if (/pending/i.test(b.status)) {
        list.push({
          id: `resource-${b.id}`,
          type: 'Resource Approval',
          category: 'resource',
          employee: b.employee,
          title: `Resource: ${b.title || b.resource || 'Equipment/Asset'}`,
          detail: formatRangeKL(b.start, b.end, 'display'),
          date: formatDateOrTimeKL(b.start, 'display') || 'Today',
          status: b.status,
          isActionable: true,
          raw: b
        });
      }
    }
  }

  // Personal updates for Staff & Managers (Own status notifications)
  const myLeaves = (props.records?.leave || props.records?.leaves || props.teamLeave || [])
    .filter((l) => String(l.employee || l.name).trim().toUpperCase() === myUpperName);

  for (const l of myLeaves) {
    list.push({
      id: `myleave-${l.id || l.start}`,
      type: 'Leave Application',
      category: 'leave-status',
      employee: props.user?.name,
      title: `${l.type || 'Annual Leave'} (${formatRangeKL(l.start, l.end, 'display')})`,
      detail: `Current status: ${l.status || 'Submitted'}.`,
      date: formatDateKL(l.start, 'display'),
      status: l.status,
      isActionable: false,
      raw: l
    });
  }

  // Add system welcome announcement
  list.push({
    id: 'announcement-pwa-welcome',
    type: 'System Announcement',
    category: 'info',
    employee: 'PplosHR System',
    title: 'Mobile PWA 2.0 Live',
    detail: 'Welcome to your enhanced PplosHR mobile app. Faster navigation, offline shell and instant request tracking.',
    date: '16 Oct 2026',
    status: 'Notice',
    isActionable: false
  });

  return list;
});

const filteredItems = computed(() => {
  return displayItems.value.filter((i) => {
    if (filterType.value === 'pending') return i.isActionable || /pending/i.test(i.status);
    if (filterType.value === 'unread') return !seenIds.value.has(i.id);
    return true;
  });
});

const unreadCount = computed(() => {
  return displayItems.value.filter((i) => !seenIds.value.has(i.id)).length;
});
</script>

<template>
  <div class="m-inbox-root">
    <!-- Header with Unread Counter -->
    <div class="d-flex justify-content-between align-items-center mb-1">
      <div>
        <h3 class="m-section-title mb-0">Inbox & Approvals</h3>
        <small class="text-muted">
          {{ isManager ? 'Team approval tasks and personal updates' : 'Personal status updates and notifications' }}
        </small>
      </div>
      <button v-if="unreadCount > 0" type="button" class="btn btn-outline-secondary btn-sm" @click="markAllRead">
        Mark all read
      </button>
    </div>

    <!-- Filter Pills -->
    <div class="m-tab-pills">
      <button :class="['m-pill-btn', { active: filterType === 'all' }]" @click="filterType = 'all'">
        All ({{ displayItems.length }})
      </button>
      <button :class="['m-pill-btn', { active: filterType === 'unread' }]" @click="filterType = 'unread'">
        Unread ({{ unreadCount }})
      </button>
      <button v-if="isManager" :class="['m-pill-btn', { active: filterType === 'pending' }]" @click="filterType = 'pending'">
        Actionable Approvals
      </button>
    </div>

    <!-- Items List -->
    <div v-if="!filteredItems.length" class="m-empty-card">
      <i class="bi bi-inbox fs-2 text-muted mb-2 d-block"></i>
      <p class="mb-0 fw-bold">Inbox is Clear</p>
      <small class="text-muted">No pending approvals or unread notifications.</small>
    </div>
    <div v-else class="m-inbox-list">
      <article
        v-for="item in filteredItems"
        :key="item.id"
        :class="['m-inbox-card', { unread: !seenIds.has(item.id), actionable: item.isActionable }]"
        style="cursor: pointer;"
        @click="openItemDetail(item)"
      >
        <div class="d-flex justify-content-between align-items-start mb-1">
          <div class="d-flex align-items-center gap-2">
            <span v-if="!seenIds.has(item.id)" class="m-unread-dot"></span>
            <span class="m-type-tag">{{ item.type }}</span>
          </div>
          <small class="text-muted">{{ item.date }}</small>
        </div>

        <h5 class="m-item-title mb-1">{{ item.title }}</h5>
        <div v-if="item.employee && isManager && item.isActionable" class="m-applicant-line mb-1">
          <i class="bi bi-person-fill text-muted me-1"></i>Applicant: <strong>{{ item.employee }}</strong>
        </div>
        <p class="m-item-detail mb-2">{{ item.detail }}</p>

        <!-- Actionable Buttons for Managers -->
        <div v-if="item.isActionable && isManager" class="d-flex gap-2 mt-2 pt-2 border-top">
          <button type="button" class="btn btn-outline-primary btn-sm flex-fill" @click.stop="openItemDetail(item)">
            <i class="bi bi-eye me-1"></i>Details
          </button>
          <button type="button" class="btn btn-success btn-sm flex-fill fw-bold" @click.stop="confirmApprove(item)">
            <i class="bi bi-check-lg me-1"></i>Approve
          </button>
          <button type="button" class="btn btn-outline-danger btn-sm flex-fill" @click.stop="promptReject(item)">
            <i class="bi bi-x-lg me-1"></i>Reject
          </button>
        </div>
      </article>
    </div>

    <!-- Request Details Modal / Bottom Sheet -->
    <div v-if="showDetailModal && activeDetailItem" class="m-sheet-backdrop" @click.self="closeItemDetail">
      <div class="m-sheet-card" style="max-height: 85vh; overflow-y: auto;">
        <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
          <div class="d-flex align-items-center gap-2">
            <span class="m-type-tag">{{ activeDetailItem.type }}</span>
            <h5 class="fw-bold mb-0 text-dark fs-6">Request Details</h5>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="closeItemDetail"></button>
        </div>

        <div class="bg-light p-2 rounded mb-3 small">
          <div v-if="activeDetailItem.employee">
            <span class="text-muted">Applicant:</span> <strong>{{ activeDetailItem.employee }}</strong>
          </div>
          <div><span class="text-muted">Date:</span> <strong>{{ activeDetailItem.date }}</strong></div>
          <div v-if="activeDetailItem.status"><span class="text-muted">Status:</span> <span class="badge bg-secondary-subtle text-secondary">{{ activeDetailItem.status }}</span></div>
        </div>

        <div class="mb-3 small">
          <h6 class="fw-bold text-dark mb-1">{{ activeDetailItem.title }}</h6>
          <p class="text-muted mb-2">{{ activeDetailItem.detail }}</p>

          <!-- Claim receipt or attachment preview if available -->
          <div v-if="activeDetailItem.raw?.attachment || activeDetailItem.raw?.url || activeDetailItem.raw?.receiptUrl" class="mt-2 pt-2 border-top">
            <span class="fw-bold text-dark d-block mb-1">Receipt / Supporting Document:</span>
            <div v-if="(activeDetailItem.raw?.attachment || activeDetailItem.raw?.url || '').startsWith('data:image')" class="mb-2">
              <img :src="activeDetailItem.raw?.attachment || activeDetailItem.raw?.url" alt="Receipt" class="img-thumbnail" style="max-height: 200px;" />
            </div>
            <a :href="activeDetailItem.raw?.attachment || activeDetailItem.raw?.url || activeDetailItem.raw?.receiptUrl" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary w-100">
              <i class="bi bi-box-arrow-up-right me-1"></i>Open Attached File
            </a>
          </div>
        </div>

        <!-- Action Buttons inside Detail Sheet -->
        <div v-if="activeDetailItem.isActionable && isManager" class="d-flex gap-2 pt-2 border-top">
          <button type="button" class="btn btn-outline-danger flex-fill" @click="promptReject(activeDetailItem)">
            <i class="bi bi-x-lg me-1"></i>Reject
          </button>
          <button type="button" class="btn btn-success flex-fill fw-bold" @click="confirmApprove(activeDetailItem)">
            <i class="bi bi-check-lg me-1"></i>Approve
          </button>
        </div>
        <button v-else type="button" class="btn btn-outline-secondary w-100 mt-2" @click="closeItemDetail">
          Close
        </button>
      </div>
    </div>

    <!-- Reject Reason Bottom Sheet -->
    <div v-if="showRejectModal" class="m-sheet-backdrop" @click.self="showRejectModal = false">
      <div class="m-sheet-card">
        <h5 class="fw-bold mb-2 text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Reject Request</h5>
        <p class="small text-muted mb-3">Please provide a reason to the employee so they can adjust and resubmit.</p>
        <div class="mb-3">
          <label class="form-label small fw-bold">Rejection Note</label>
          <textarea v-model="rejectReason" rows="3" class="form-control" placeholder="e.g. Schedule clash; insufficient documentation" required></textarea>
        </div>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-outline-secondary flex-fill" @click="showRejectModal = false">Cancel</button>
          <button type="button" class="btn btn-danger flex-fill fw-bold" @click="confirmReject">Confirm Rejection</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-inbox-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 24px;
}
.m-section-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1c1c1e;
}
.m-tab-pills {
  display: flex;
  gap: 6px;
  overflow-x: auto;
}
.m-pill-btn {
  background: #f2f2f7;
  border: none;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 0.76rem;
  font-weight: 600;
  color: #6e6e73;
  white-space: nowrap;
  cursor: pointer;
}
.m-pill-btn.active {
  background: #1c1c1e;
  color: #fff;
}
.m-inbox-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-inbox-card {
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 16px;
  padding: 14px 16px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.03);
  position: relative;
}
.m-inbox-card.unread {
  border-left: 4px solid #0071e3;
  background: #fbfdff;
}
.m-inbox-card.actionable {
  border-left: 4px solid #b7791f;
}
.m-unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #0071e3;
  display: inline-block;
}
.m-type-tag {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #6e6e73;
  letter-spacing: 0.03em;
}
.m-item-title {
  font-size: 0.92rem;
  font-weight: 700;
  color: #1c1c1e;
}
.m-applicant-line {
  font-size: 0.78rem;
  color: #3a3a3c;
}
.m-item-detail {
  font-size: 0.8rem;
  color: #6e6e73;
  margin: 0;
}
.m-empty-card {
  background: #fff;
  border: 1px dashed #d1d1d6;
  border-radius: 16px;
  padding: 28px 16px;
  text-align: center;
}
.m-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.m-sheet-card {
  width: 100%;
  max-width: 500px;
  background: #fff;
  border-radius: 20px;
  padding: 22px;
  margin: auto;
  box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  max-height: calc(100dvh - 120px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
</style>
