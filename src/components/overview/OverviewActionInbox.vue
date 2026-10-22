<template>
  <div class="overview-action-inbox bg-white border border-light-subtle rounded-3 p-3 mb-4 shadow-sm">
    <div class="d-flex align-items-center justify-content-between mb-3 pb-2 border-bottom">
      <div class="d-flex align-items-center gap-2">
        <div class="inbox-icon-badge rounded-circle d-flex align-items-center justify-content-center">
          <i class="bi bi-inbox-fill text-primary"></i>
        </div>
        <div>
          <h6 class="fw-bold mb-0 text-dark">Needs your attention</h6>
          <span class="text-muted extra-small">Review details, evidence and history before taking action.</span>
        </div>
      </div>
      <span class="badge rounded-pill" :class="items.length ? 'bg-danger-subtle text-danger border border-danger-subtle' : 'bg-light text-muted border'">
        {{ items.length }} actionable
      </span>
    </div>

    <!-- Empty State -->
    <div v-if="!items.length" class="text-center py-4 text-muted">
      <i class="bi bi-check2-circle fs-2 text-success mb-2 d-block"></i>
      <div class="fw-semibold text-dark">You're all caught up!</div>
      <div class="extra-small">No outstanding decisions, claims, or attendance approvals waiting for your action.</div>
    </div>

    <!-- Items List -->
    <div v-else class="list-group list-group-flush">
      <div 
        v-for="item in items" 
        :key="item.key"
        class="list-group-item d-flex align-items-center justify-content-between flex-wrap gap-2 px-3 py-3 border-light-subtle action-item-row"
        @click="openDetails(item)"
      >
        <div class="d-flex align-items-start gap-3">
          <span 
            class="badge mt-1 text-uppercase" 
            :class="moduleBadgeClass(item.module)"
          >
            {{ moduleLabel(item.module) }}
          </span>
          <div>
            <div class="fw-bold text-dark text-truncate" style="max-width: 450px;">
              {{ item.title }}
            </div>
            <div class="d-flex align-items-center gap-2 extra-small text-muted mt-1 flex-wrap">
              <span v-if="item.employee" class="fw-semibold text-secondary">
                <i class="bi bi-person me-1"></i>{{ item.employee }}
              </span>
              <span>•</span>
              <span><i class="bi bi-calendar3 me-1"></i>{{ item.date || 'Pending' }}</span>
              <span>•</span>
              <span :class="item.ageDays >= 3 ? 'text-danger fw-bold' : 'text-muted'">
                <i class="bi bi-hourglass-split me-1"></i>{{ item.ageDays === 0 ? 'Today' : `${item.ageDays}d old` }}
              </span>
              <span v-if="item.urgency === 'High'" class="badge bg-danger-subtle text-danger px-1 py-0">
                SLA Alert
              </span>
            </div>
          </div>
        </div>

        <div class="d-flex align-items-center gap-2">
          <button 
            class="btn btn-primary btn-sm fw-bold px-3 shadow-sm"
            type="button"
            @click.stop="openDetails(item)"
          >
            <i class="bi bi-card-checklist me-1"></i>Review
          </button>
        </div>
      </div>
    </div>

    <!-- Detailed Request Approval Pop-up Modal -->
    <Teleport to="body">
      <div v-if="selectedItem" class="inbox-modal-backdrop" @click.self="closeDetails">
        <div class="inbox-modal-dialog">
          <div class="modal-content shadow-lg border-0 rounded-4 overflow-hidden">
            <!-- Modal Header -->
            <div class="modal-header bg-light border-bottom px-4 py-3 align-items-center">
              <div class="d-flex align-items-center gap-2">
                <span class="badge text-uppercase px-2 py-1" :class="moduleBadgeClass(selectedItem.module)">
                  {{ moduleLabel(selectedItem.module) }}
                </span>
                <h5 class="modal-title fw-bold text-dark mb-0 fs-6">
                  Review &amp; Approve Request
                </h5>
              </div>
              <button type="button" class="btn-close" aria-label="Close" :disabled="isSubmitting" @click="closeDetails"></button>
            </div>

            <!-- Modal Body -->
            <div class="modal-body p-4">
              <!-- Alert feedback -->
              <div v-if="actionSuccess" class="alert alert-success d-flex align-items-center gap-2 py-2 px-3 mb-3 small">
                <i class="bi bi-check-circle-fill"></i>
                <div>{{ actionSuccess }}</div>
              </div>
              <div v-if="actionError" class="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 mb-3 small">
                <i class="bi bi-exclamation-triangle-fill"></i>
                <div>{{ actionError }}</div>
              </div>

              <!-- Applicant Summary Card -->
              <div class="card bg-light border-0 rounded-3 p-3 mb-3">
                <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                  <div>
                    <div class="text-uppercase text-muted extra-small fw-bold">Applicant</div>
                    <div class="fw-bold text-dark fs-6">{{ selectedItem.employee || 'N/A' }}</div>
                    <div class="text-muted extra-small">
                      Submitted: <strong>{{ selectedItem.date || 'Pending' }}</strong>
                      <span class="ms-1 badge bg-secondary-subtle text-secondary">{{ selectedItem.ageDays === 0 ? 'Today' : `${selectedItem.ageDays}d old` }}</span>
                    </div>
                  </div>
                  <span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1">
                    {{ selectedItem.raw?.status || 'Pending Approval' }}
                  </span>
                </div>
              </div>

              <!-- Request Specific Details -->
              <div class="details-section mb-3">
                <h6 class="fw-bold text-dark mb-2 border-bottom pb-1 small">
                  <i class="bi bi-info-circle me-1 text-primary"></i>Request Details
                </h6>

                <!-- Claims Details -->
                <div v-if="selectedItem.module === 'claims'" class="row g-2 small">
                  <div class="col-6">
                    <span class="text-muted d-block">Category</span>
                    <strong class="text-dark">{{ selectedItem.raw?.category || 'General' }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Claim Amount</span>
                    <span class="fs-5 fw-bold text-success">RM {{ Number(selectedItem.raw?.amount || selectedItem.amount || 0).toFixed(2) }}</span>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Receipt No.</span>
                    <strong class="text-dark">{{ selectedItem.raw?.receiptNo || '—' }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Expense Date</span>
                    <strong class="text-dark">{{ selectedItem.raw?.date || selectedItem.date }}</strong>
                  </div>
                  <div class="col-12" v-if="selectedItem.raw?.title || selectedItem.raw?.description || selectedItem.raw?.notes">
                    <span class="text-muted d-block">Purpose / Description</span>
                    <div class="p-2 bg-light rounded border text-dark">
                      {{ selectedItem.raw?.title || selectedItem.raw?.description || selectedItem.raw?.notes }}
                    </div>
                  </div>
                  <!-- Receipt / Attachment Document -->
                  <div class="col-12 mt-2" v-if="selectedItem.raw?.attachment || selectedItem.raw?.url || selectedItem.raw?.receiptUrl">
                    <span class="text-muted d-block mb-1">Receipt Attachment</span>
                    <div v-if="isImageAttachment(selectedItem.raw)" class="mb-2">
                      <img :src="getAttachmentUrl(selectedItem.raw)" alt="Receipt Preview" class="img-thumbnail" style="max-height: 200px; cursor: pointer;" @click="openReceiptWindow(getAttachmentUrl(selectedItem.raw))" />
                    </div>
                    <a :href="getAttachmentUrl(selectedItem.raw)" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary">
                      <i class="bi bi-box-arrow-up-right me-1"></i>View / Download Full Receipt
                    </a>
                  </div>
                </div>

                <!-- Resource Request Details -->
                <div v-else-if="selectedItem.module === 'bookings' || selectedItem.module === 'resource' || selectedItem.module === 'resources'" class="row g-2 small">
                  <div class="col-6">
                    <span class="text-muted d-block">Resource Item</span>
                    <strong class="text-dark">{{ selectedItem.raw?.title || selectedItem.raw?.resourceTitle || selectedItem.title }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Resource Category / Code</span>
                    <strong class="text-dark">{{ selectedItem.raw?.category || selectedItem.raw?.resourceCategory || selectedItem.raw?.code || 'Equipment' }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Required Date</span>
                    <strong class="text-dark">{{ selectedItem.raw?.start || selectedItem.raw?.date || selectedItem.date }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Quantity / Units</span>
                    <strong class="text-dark">{{ selectedItem.raw?.quantity || 1 }}</strong>
                  </div>
                  <div class="col-12" v-if="selectedItem.raw?.location">
                    <span class="text-muted d-block">Location / Branch</span>
                    <strong class="text-dark">{{ selectedItem.raw?.location }}</strong>
                  </div>
                  <div class="col-12" v-if="selectedItem.raw?.notes || selectedItem.raw?.reason">
                    <span class="text-muted d-block">Reason / Justification</span>
                    <div class="p-2 bg-light rounded border text-dark">
                      {{ selectedItem.raw?.notes || selectedItem.raw?.reason }}
                    </div>
                  </div>
                </div>

                <!-- Loans Details -->
                <div v-else-if="selectedItem.module === 'loans'" class="row g-2 small">
                  <div class="col-6">
                    <span class="text-muted d-block">Requested Amount</span>
                    <span class="fs-5 fw-bold text-primary">RM {{ Number(selectedItem.raw?.amount || 0).toFixed(2) }}</span>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Repayment Plan</span>
                    <strong class="text-dark">{{ selectedItem.raw?.installments ? `${selectedItem.raw.installments} months` : 'Standard deduction' }}</strong>
                  </div>
                  <div class="col-12" v-if="selectedItem.raw?.purpose || selectedItem.raw?.reason">
                    <span class="text-muted d-block">Purpose</span>
                    <div class="p-2 bg-light rounded border text-dark">
                      {{ selectedItem.raw?.purpose || selectedItem.raw?.reason }}
                    </div>
                  </div>
                </div>

                <!-- Leave Details -->
                <div v-else-if="selectedItem.module === 'leave' || selectedItem.isLeave" class="row g-2 small">
                  <div class="col-6">
                    <span class="text-muted d-block">Leave Type</span>
                    <strong class="text-dark">{{ selectedItem.raw?.type || 'Leave' }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Duration</span>
                    <strong class="text-primary">{{ selectedItem.raw?.days || 1 }} day(s)</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Start Date</span>
                    <strong class="text-dark">{{ selectedItem.raw?.start || '—' }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">End Date</span>
                    <strong class="text-dark">{{ selectedItem.raw?.end || '—' }}</strong>
                  </div>
                  <div class="col-12" v-if="selectedItem.raw?.reason">
                    <span class="text-muted d-block">Reason / Notes</span>
                    <div class="p-2 bg-light rounded border text-dark">
                      {{ selectedItem.raw?.reason }}
                    </div>
                  </div>
                  <div class="col-12" v-if="selectedItem.raw?.attachment">
                    <span class="text-muted d-block mb-1">Attachment</span>
                    <a :href="selectedItem.raw.attachment" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary">
                      <i class="bi bi-paperclip me-1"></i>View Supporting Document
                    </a>
                  </div>
                </div>

                <!-- Attendance Details -->
                <div v-else-if="selectedItem.module === 'attendance'" class="row g-2 small">
                  <div class="col-6">
                    <span class="text-muted d-block">Attendance Month</span>
                    <strong class="text-dark">{{ selectedItem.month || selectedItem.date }}</strong>
                  </div>
                  <div class="col-6">
                    <span class="text-muted d-block">Scope</span>
                    <strong class="text-dark">{{ selectedItem.employee || 'All Companies' }}</strong>
                  </div>
                  <div class="col-12 mt-2">
                    <button type="button" class="btn btn-sm btn-outline-primary" @click="handleReview(selectedItem)">
                      <i class="bi bi-clock-history me-1"></i>Open Attendance Approval Center
                    </button>
                  </div>
                </div>

                <!-- Generic Fallback -->
                <div v-else class="row g-2 small">
                  <div class="col-12">
                    <span class="text-muted d-block">Subject</span>
                    <strong class="text-dark">{{ selectedItem.title }}</strong>
                  </div>
                </div>
              </div>

              <!-- Reviewer Remarks / Feedback Form -->
              <div class="mb-3 pt-2 border-top">
                <label for="actionInboxRemarks" class="form-label extra-small fw-bold text-secondary mb-1">
                  Reviewer Comments / Rejection Reason
                </label>
                <textarea 
                  id="actionInboxRemarks" 
                  v-model="reviewerRemarks" 
                  rows="2" 
                  class="form-control form-control-sm" 
                  placeholder="Optional note for approval; required if rejecting..."
                  :disabled="isSubmitting"
                ></textarea>
              </div>
            </div>

            <!-- Modal Footer with Decision Actions -->
            <div class="modal-footer bg-light border-top px-4 py-3 d-flex justify-content-between align-items-center">
              <button 
                type="button" 
                class="btn btn-outline-secondary btn-sm" 
                :disabled="isSubmitting"
                @click="closeDetails"
              >
                Close
              </button>

              <div class="d-flex align-items-center gap-2">
                <button 
                  type="button" 
                  class="btn btn-outline-danger btn-sm"
                  :disabled="isSubmitting"
                  @click="handleReject(selectedItem)"
                >
                  <i class="bi bi-x-circle me-1"></i>Reject
                </button>
                <button 
                  type="button" 
                  class="btn btn-success btn-sm fw-bold px-3 shadow-sm"
                  :disabled="isSubmitting"
                  @click="handleApprove(selectedItem)"
                >
                  <span v-if="isSubmitting" class="spinner-border spinner-border-sm me-1" role="status"></span>
                  <i v-else class="bi bi-check-circle-fill me-1"></i>
                  {{ selectedItem.actionType === 'Recommend' ? 'Recommend Approval' : 'Approve Request' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { dashboardActions } from '../../services/dashboard';
import { CacheManager } from '../../services/cacheManager';

defineProps({
  items: { type: Array, default: () => [] }
});

const emit = defineEmits(['review', 'refresh']);

// Detail Modal State
const selectedItem = ref(null);
const reviewerRemarks = ref('');
const isSubmitting = ref(false);
const actionError = ref('');
const actionSuccess = ref('');

function openDetails(item) {
  selectedItem.value = item;
  reviewerRemarks.value = '';
  actionError.value = '';
  actionSuccess.value = '';
}

function closeDetails() {
  if (isSubmitting.value) return;
  selectedItem.value = null;
  reviewerRemarks.value = '';
  actionError.value = '';
  actionSuccess.value = '';
}

function isImageAttachment(raw) {
  if (!raw) return false;
  const url = raw.attachment || raw.url || raw.receiptUrl || '';
  return url.startsWith('data:image') || /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(url);
}

function getAttachmentUrl(raw) {
  if (!raw) return '';
  return raw.attachment || raw.url || raw.receiptUrl || '';
}

function openReceiptWindow(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function handleApprove(item) {
  if (item.isAttendance || item.module === 'attendance') {
    emit('review', item);
    closeDetails();
    return;
  }
  if (item.isLeave || item.module === 'leave') {
    isSubmitting.value = true;
    actionError.value = '';
    actionSuccess.value = '';
    try {
      const curStatus = String(item.raw?.status || '').trim();
      const isHod = item.actionType === 'Recommend';
      const isWithdrawal = curStatus === 'Withdrawal Requested' || curStatus.startsWith('withdrawal_');
      let newStatus = isWithdrawal ? (isHod ? 'withdrawal_pending_hr' : 'Withdrawn') : 'Approved';
      const res = await dashboardActions.apiPost('updateLeaveStatus', {
        rowIndex: item.raw?.rowIndex,
        requestId: item.raw?.id || item.id,
        expectedStatus: curStatus,
        newStatus,
        approverRemark: reviewerRemarks.value || 'Approved via Action Inbox'
      });
      if (res && res.status === 'success') {
        actionSuccess.value = '✓ Successfully recorded leave decision for ' + (item.employee || 'staff') + '.';
        if (typeof dashboardActions.fetchActionCount === 'function') dashboardActions.fetchActionCount();
        setTimeout(() => {
          closeDetails();
          emit('refresh');
        }, 150);
      } else {
        actionError.value = res?.message || 'Leave decision could not be saved.';
      }
    } catch (err) {
      actionError.value = err?.message || 'Server error while recording leave decision.';
    } finally {
      isSubmitting.value = false;
    }
    return;
  }
  isSubmitting.value = true;
  actionError.value = '';
  actionSuccess.value = '';

  try {
    const mod = item.module === 'resource' || item.module === 'resources' ? 'bookings' : item.module;
    const recId = item.raw?.id || item.id;
    const version = item.raw?.version || 1;
    const res = await dashboardActions.apiPost('hrTransition', {
      module: mod,
      id: recId,
      version: version,
      command: 'approve',
      comments: reviewerRemarks.value || 'Approved via Action Inbox'
    });

    if (res && res.status === 'success') {
      actionSuccess.value = `✓ Successfully approved request for ${item.employee || 'staff'}.`;
      try {
        const cachedHr = CacheManager.getHrRecords() || {};
        let updated = false;
        Object.keys(cachedHr).forEach(sc => {
          if (cachedHr[sc]?.records?.[mod]) {
            const list = cachedHr[sc].records[mod];
            const idx = list.findIndex(r => r.id === recId);
            if (idx > -1) {
              list[idx] = res.data || { ...list[idx], status: 'Approved' };
              updated = true;
            }
          }
        });
        if (updated) CacheManager.saveHrRecords(cachedHr);
      } catch (_) {}
      setTimeout(() => {
        closeDetails();
        emit('refresh');
      }, 150);
    } else {
      actionError.value = res?.message || 'Approval action failed. Please retry.';
    }
  } catch (err) {
    actionError.value = err?.message || 'Server error while recording approval.';
  } finally {
    isSubmitting.value = false;
  }
}

async function handleReject(item) {
  if (!reviewerRemarks.value.trim()) {
    actionError.value = 'Please provide a reason for rejecting this request.';
    return;
  }
  if (item.isLeave || item.module === 'leave') {
    isSubmitting.value = true;
    actionError.value = '';
    actionSuccess.value = '';
    try {
      const curStatus = String(item.raw?.status || '').trim();
      const isWithdrawal = curStatus === 'Withdrawal Requested' || curStatus.startsWith('withdrawal_');
      const newStatus = isWithdrawal ? 'Approved' : 'Rejected';
      const res = await dashboardActions.apiPost('updateLeaveStatus', {
        rowIndex: item.raw?.rowIndex,
        requestId: item.raw?.id || item.id,
        expectedStatus: curStatus,
        newStatus,
        approverRemark: reviewerRemarks.value
      });
      if (res && res.status === 'success') {
        actionSuccess.value = '✓ Successfully rejected leave request for ' + (item.employee || 'staff') + '.';
        if (typeof dashboardActions.fetchActionCount === 'function') dashboardActions.fetchActionCount();
        setTimeout(() => {
          closeDetails();
          emit('refresh');
        }, 150);
      } else {
        actionError.value = res?.message || 'Leave rejection could not be saved.';
      }
    } catch (err) {
      actionError.value = err?.message || 'Server error while rejecting leave.';
    } finally {
      isSubmitting.value = false;
    }
    return;
  }
  isSubmitting.value = true;
  actionError.value = '';
  actionSuccess.value = '';

  try {
    const mod = item.module === 'resource' || item.module === 'resources' ? 'bookings' : item.module;
    const recId = item.raw?.id || item.id;
    const version = item.raw?.version || 1;
    const res = await dashboardActions.apiPost('hrTransition', {
      module: mod,
      id: recId,
      version: version,
      command: 'reject',
      comments: reviewerRemarks.value
    });

    if (res && res.status === 'success') {
      actionSuccess.value = `✓ Request rejected with feedback note.`;
      try {
        const cachedHr = CacheManager.getHrRecords() || {};
        let updated = false;
        Object.keys(cachedHr).forEach(sc => {
          if (cachedHr[sc]?.records?.[mod]) {
            const list = cachedHr[sc].records[mod];
            const idx = list.findIndex(r => r.id === recId);
            if (idx > -1) {
              list[idx] = res.data || { ...list[idx], status: 'Rejected' };
              updated = true;
            }
          }
        });
        if (updated) CacheManager.saveHrRecords(cachedHr);
      } catch (_) {}
      setTimeout(() => {
        closeDetails();
        emit('refresh');
      }, 150);
    } else {
      actionError.value = res?.message || 'Rejection action failed. Please retry.';
    }
  } catch (err) {
    actionError.value = err?.message || 'Server error while recording rejection.';
  } finally {
    isSubmitting.value = false;
  }
}

function handleReview(item) {
  emit('review', item);
  closeDetails();
}

function moduleLabel(mod) {
  const m = String(mod || '').toLowerCase();
  if (m === 'bookings' || m === 'resource' || m === 'resources') return 'RESOURCE';
  return String(mod || '').toUpperCase();
}

function moduleBadgeClass(mod) {
  const m = String(mod || '').toLowerCase();
  if (m === 'leave') return 'bg-success-subtle text-success border border-success-subtle';
  if (m === 'claims') return 'bg-warning-subtle text-warning-emphasis border border-warning-subtle';
  if (m === 'attendance') return 'bg-danger-subtle text-danger border border-danger-subtle';
  if (m === 'loans') return 'bg-info-subtle text-info-emphasis border border-info-subtle';
  if (m === 'bookings' || m === 'resource' || m === 'resources') return 'bg-primary-subtle text-primary border border-primary-subtle';
  if (m === 'appraisals') return 'bg-purple-subtle text-purple border';
  return 'bg-secondary-subtle text-secondary';
}
</script>

<style scoped>
.inbox-icon-badge {
  width: 32px;
  height: 32px;
  background-color: rgba(var(--bs-primary-rgb), 0.1);
}
.extra-small {
  font-size: 0.75rem;
}
.bg-purple-subtle {
  background-color: #f3e8ff;
}
.text-purple {
  color: #7e22ce;
}
.action-item-row {
  cursor: pointer;
  transition: background-color 0.15s ease-in-out;
}
.action-item-row:hover {
  background-color: #f8fafc;
}
.inbox-modal-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.inbox-modal-dialog {
  max-width: 560px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
.modal-content {
  overflow-y: auto;
}
</style>
