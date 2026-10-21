<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { dashboardActions } from '../../services/dashboard';
import { compressImageToDataUrl } from '../../utils/imageCompressor';
import { STANDARD_RESOURCES } from '../../services/resourceCatalogue';
import { formatDateKL, formatDateTimeKL, formatDateOrTimeKL, formatRangeKL } from '../../utils/dateUtils';

const props = defineProps({
  user: { type: Object, required: true },
  records: { type: Object, default: () => ({}) },
  teamLeave: { type: Array, default: () => [] },
  launchAction: { type: Object, default: () => ({ kind: '', sequence: 0 }) }
});

const emit = defineEmits(['submit-leave', 'submit-claim', 'refresh']);

const activeTab = ref('leave'); // 'leave' | 'claims' | 'bookings' | 'loans'

// Wizard state
const showLeaveWizard = ref(false);
const showClaimWizard = ref(false);
const showBookingWizard = ref(false);
const showActionMenu = ref(false);
watch(() => props.launchAction?.sequence, () => {
  const kind = props.launchAction?.kind;
  if (!kind) return;
  showActionMenu.value = false;
  showLeaveWizard.value = kind === 'leave';
  showClaimWizard.value = kind === 'claim';
  showBookingWizard.value = kind === 'booking';
  activeTab.value = kind === 'claim' ? 'claims' : kind === 'booking' ? 'bookings' : 'leave';
}, { immediate: true });
const isCompressingPhoto = ref(false);
const isCompressingLeave = ref(false);

// Local draft keys
const LEAVE_DRAFT_KEY = `pploshr_draft_leave_${props.user?.username || props.user?.name || 'user'}`;
const CLAIM_DRAFT_KEY = `pploshr_draft_claim_${props.user?.username || props.user?.name || 'user'}`;

const leaveFileInput = ref(null);
const claimFileInput = ref(null);

// Local optimistic submissions
const localLeaves = ref([]);
const localClaims = ref([]);
const fetchedLeaves = ref(null);
let leaveLoadSequence = 0;

function getStorageKey(type) {
  const upper = String(props.user?.name || '').trim().toUpperCase();
  return upper ? `pploshr_local_${type}_${upper}` : '';
}

function loadPersistedRequests() {
  try {
    const lKey = getStorageKey('leaves');
    if (lKey) {
      const savedLeaves = JSON.parse(localStorage.getItem(lKey) || sessionStorage.getItem(lKey) || '[]');
      if (Array.isArray(savedLeaves)) localLeaves.value = savedLeaves;
    }
    const cKey = getStorageKey('claims');
    if (cKey) {
      const savedClaims = JSON.parse(localStorage.getItem(cKey) || sessionStorage.getItem(cKey) || '[]');
      if (Array.isArray(savedClaims)) localClaims.value = savedClaims;
    }
  } catch (_) {}
}

function persistLocalLeaves() {
  try {
    const key = getStorageKey('leaves');
    if (key) {
      localStorage.setItem(key, JSON.stringify(localLeaves.value));
      sessionStorage.setItem(key, JSON.stringify(localLeaves.value));
    }
  } catch (_) {}
}

function persistLocalClaims() {
  try {
    const key = getStorageKey('claims');
    if (key) {
      localStorage.setItem(key, JSON.stringify(localClaims.value));
      sessionStorage.setItem(key, JSON.stringify(localClaims.value));
    }
  } catch (_) {}
}

async function fetchRemoteLeaves(strict = false) {
  const sequence = ++leaveLoadSequence;
  if (!props.user?.name) return;
  try {
    const res = await dashboardActions.apiPost('getLeaveData', { scope: 'personal', staffName: props.user.name });
    if (res && res.status === 'success' && Array.isArray(res.data)) {
      if (sequence === leaveLoadSequence) fetchedLeaves.value = res.data;
    } else { throw Error(res?.message || "Leave refresh failed."); }
  } catch (error) { if (strict === true) throw error; }
}

// Detail Modal & State
const selectedLeave = ref(null);
const selectedClaim = ref(null);
const selectedBooking = ref(null);
const showReceiptZoom = ref(false);
const withdrawing = ref(false);

const showWithdrawModal = ref(false);
const withdrawReason = ref('');
const leaveToWithdraw = ref(null);

function openLeaveDetail(l) {
  selectedLeave.value = l;
}

function openClaimDetail(c) {
  selectedClaim.value = c;
}

function openBookingDetail(b) {
  selectedBooking.value = b;
}

function getResourceForBooking(b) {
  if (!b) return null;
  const list = [...(props.records?.resources || []), ...STANDARD_RESOURCES];
  return list.find(r => 
    (b.resourceId && (String(r.id).toLowerCase() === String(b.resourceId).toLowerCase() || String(r.code).toLowerCase() === String(b.resourceId).toLowerCase())) ||
    (b.resource && (String(r.title || '').toLowerCase() === String(b.resource).toLowerCase() || String(r.id).toLowerCase() === String(b.resource).toLowerCase() || String(r.code).toLowerCase() === String(b.resource).toLowerCase())) ||
    (b.title && (String(r.title || '').toLowerCase() === String(b.title).toLowerCase() || String(r.code || '').toLowerCase() === String(b.title).toLowerCase()))
  ) || null;
}

function getBookingCategory(b) {
  if (!b) return 'General Resource';
  if (b.category && String(b.category).trim()) return String(b.category).trim();
  const res = getResourceForBooking(b);
  if (res?.category && String(res.category).trim()) return String(res.category).trim();
  const s = String(b.resource || b.title || b.resourceId || '').toLowerCase();
  if (s.includes('uniform') || s.includes('attire') || s.includes('suit') || s.includes('shoe')) return 'Uniform';
  if (s.includes('car') || s.includes('van') || s.includes('vehicle') || s.includes('lorry') || s.includes('hilux') || s.includes('truck')) return 'Vehicle';
  if (s.includes('laptop') || s.includes('notebook') || s.includes('macbook') || s.includes('pc') || s.includes('desktop') || s.includes('computer')) return 'Laptop / IT';
  if (s.includes('phone') || s.includes('sim') || s.includes('mobile')) return 'Phone / Telco';
  if (s.includes('room') || s.includes('facility') || s.includes('hall')) return 'Facility';
  if (s.includes('tool') || s.includes('equipment') || s.includes('meter')) return 'Equipment';
  return 'Company Resource';
}

function getBookingResourceName(b) {
  if (!b) return 'Resource Request';
  const res = getResourceForBooking(b);
  if (res?.title) return res.title;
  return b.resource || b.title || 'Resource Request';
}

function canWithdrawLeave(l) {
  if (!l) return false;
  const st = String(l.status || '').toLowerCase().trim();
  // If already withdrawn, rejected, or cancelled, cannot withdraw
  if (st.includes('withdrawn') || st.includes('withdrawal') || st.includes('rejected') || st.includes('cancelled')) return false;
  // ONLY Annual Leave (AL) can be withdrawn
  const t = String(l.type || '').toUpperCase().trim();
  const isAL = t === 'AL' || t === 'ANNUAL' || t === 'ANNUAL LEAVE' || t.startsWith('AL ') || t.startsWith('AL-');
  if (!isAL) return false;
  // ONLY if the leave date is in the future (Malaysia time)
  const todayKl = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const startDate = String(l.start || l.startDate || l.date || '').slice(0, 10);
  if (!startDate || startDate <= todayKl) return false;
  // Allowed active statuses: pending, approved, pending manager, pending admin, open
  const isAllowedStatus = ['pending', 'approved', 'pending_hod', 'pending_admin', 'pending manager', 'pending admin', 'open'].includes(st) || st.startsWith('pending');
  return isAllowedStatus;
}

function initiateWithdraw(leaveItem) {
  leaveToWithdraw.value = leaveItem;
  withdrawReason.value = '';
  showWithdrawModal.value = true;
}

function withdrawSubmittedLeave(leaveItem, reason = 'Withdrawn by applicant') {
  leaveToWithdraw.value = leaveItem;
  withdrawReason.value = reason;
  return confirmWithdrawLeave();
}

async function confirmWithdrawLeave() {
  const leaveItem = leaveToWithdraw.value;
  if (!leaveItem || withdrawing.value) return;
  const reason = withdrawReason.value.trim();
  if (!reason) {
    alert('Please enter your reason for withdrawing this leave application.');
    return;
  }
  withdrawing.value = true;
  try {
    const res = await dashboardActions.apiPost('updateLeaveStatus', {
      rowIndex: Number(leaveItem.rowIndex) || 0,
      requestId: leaveItem.requestId || leaveItem.id,
      expectedStatus: leaveItem.status,
      newStatus: 'Withdrawal Requested',
      withdrawRemark: reason,
      approver: props.user?.name
    });
    if (res && res.status === 'success') {
      leaveItem.status = 'Withdrawal Requested';
      leaveItem.withdrawRemark = reason;
      leaveItem.decisionRemark = reason;
      const localIdx = localLeaves.value.findIndex(l => (l.id && l.id === leaveItem.id) || (l.start === leaveItem.start && l.type === leaveItem.type));
      if (localIdx !== -1) {
        localLeaves.value[localIdx].status = 'Withdrawal Requested';
        localLeaves.value[localIdx].decisionRemark = reason;
        persistLocalLeaves();
      }
      showWithdrawModal.value = false;
      selectedLeave.value = null;
      leaveToWithdraw.value = null;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hr-mobile-notify', {
          detail: {
            title: 'Withdrawal Requested',
            message: `Your leave request withdrawal has been sent to your manager for approval.`,
            type: 'warning'
          }
        }));
      }
      alert('Withdrawal request submitted with reason. Sent to your manager for approval.');
      emit('refresh');
    } else {
      alert(res?.message || 'Could not withdraw leave. Please contact HR.');
    }
  } catch (err) {
    alert('Error withdrawing leave: ' + (err.message || String(err)));
  } finally {
    withdrawing.value = false;
  }
}

const LEAVE_TYPE_MAP = {
  'Annual Leave': 'AL',
  'Medical Leave': 'ML',
  'Hospitalization Leave': 'HPL',
  'Hospitalisation Leave': 'HPL',
  'Emergency Leave': 'EL',
  'Unpaid Leave': 'NPL',
  'Replacement Leave': 'RPL',
  'Compassionate Leave': 'CPL',
  'Marriage Leave': 'MRL',
  'Maternity Leave': 'MTL',
  'Paternity Leave': 'PL'
};

// Leave Form State
const leaveForm = ref({
  type: 'AL',
  start: '',
  end: '',
  halfDay: false,
  reason: '',
  attachmentName: '',
  attachmentDataUrl: ''
});

// Claim Form State
const claimRequestId = ref(null);
const claimForm = ref({
  category: 'Medical',
  amount: '',
  date: new Date().toISOString().slice(0, 10),
  merchant: '',
  notes: '',
  evidenceDataUrl: '',
  evidenceName: ''
});

function normalizeDateStr(val) {
  if (!val) return new Date().toISOString().slice(0, 10);
  const s = String(val).trim();
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function resetLeaveForm() {
  leaveForm.value = {
    type: 'AL',
    start: '',
    end: '',
    halfDay: false,
    reason: '',
    attachmentName: '',
    attachmentDataUrl: ''
  };
  try {
    localStorage.removeItem(LEAVE_DRAFT_KEY);
  } catch (_) {}
  if (leaveFileInput.value) {
    leaveFileInput.value.value = '';
  }
}

function resetClaimForm() {
  claimRequestId.value = null;
  claimForm.value = {
    category: 'Medical',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    merchant: '',
    notes: '',
    evidenceDataUrl: '',
    evidenceName: ''
  };
  try {
    localStorage.removeItem(CLAIM_DRAFT_KEY);
  } catch (_) {}
  if (claimFileInput.value) {
    claimFileInput.value.value = '';
  }
}

const bookingForm = ref({ resourceId: '', start: '', end: '', title: '' });
const bookingError = ref('');
const bookingRequestId = ref(null);
const availableResources = computed(() => {
  const backendList = (props.records?.resources || []).filter(r => r.availability === 'Available' && r.id);
  const baseList = backendList.length > 0 ? backendList : STANDARD_RESOURCES;
  // Prioritize catalog entries that have formal resource codes
  const list = [...baseList].sort((a, b) => (b.code ? 1 : 0) - (a.code ? 1 : 0));
  const seenCode = new Set();
  const seenTitle = new Set();
  const deduped = [];
  for (const r of list) {
    const code = String(r.code || '').trim().toUpperCase();
    const title = String(r.title || '').trim().toLowerCase();
    if (code && seenCode.has(code)) continue;
    if (title && seenTitle.has(title)) continue;
    if (code) seenCode.add(code);
    if (title) seenTitle.add(title);
    deduped.push(r);
  }
  return deduped;
});
async function submitBooking() {
  bookingError.value = '';
  if (submitting.value) return;
  const b = bookingForm.value;
  if (!b.resourceId || !b.start || !b.end || !b.title.trim()) {
    bookingError.value = 'Select a resource, start time, end time and purpose.'; return;
  }
  const start = new Date(b.start + ':00+08:00');
  const end = new Date(b.end + ':00+08:00');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    bookingError.value = 'End time must be later than start time (Malaysia time).'; return;
  }
  submitting.value = true;
  try {
    // Backend stores booking datetimes as Malaysia wall time, without timezone conversion.
    const resObj = availableResources.value.find(r => r.id === b.resourceId || r.code === b.resourceId);
    const record = {
      employee: props.user?.name,
      resourceId: b.resourceId,
      start: b.start,
      end: b.end,
      title: b.title.trim(),
      resource: resObj?.title || '',
      category: resObj?.category || '',
      resourceCode: resObj?.code || ''
    };
    if (!bookingRequestId.value) bookingRequestId.value = globalThis.crypto?.randomUUID?.() || `booking-${Date.now()}`;
    const res = await dashboardActions.apiPost('hrSave', { module: 'bookings', record, requestId: bookingRequestId.value });
    if (res?.status !== 'success') throw Error(res?.message || 'Resource request was not saved.');
    showBookingWizard.value = false;
    bookingForm.value = { resourceId: '', start: '', end: '', title: '' };
    bookingRequestId.value = null;
    emit('refresh');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hr-mobile-refresh'));
    }
  } catch (err) { bookingError.value = err?.message || 'Unable to submit resource request.'; }
  finally { submitting.value = false; }
}

// Load drafts and persisted requests on mount
onMounted(() => {
  try {
    loadPersistedRequests();
    fetchRemoteLeaves();
    const lDraft = localStorage.getItem(LEAVE_DRAFT_KEY);
    if (lDraft) {
      Object.assign(leaveForm.value, JSON.parse(lDraft));
      if (leaveForm.value.type && LEAVE_TYPE_MAP[leaveForm.value.type]) {
        leaveForm.value.type = LEAVE_TYPE_MAP[leaveForm.value.type];
      }
    }
    const cDraft = localStorage.getItem(CLAIM_DRAFT_KEY);
    if (cDraft) Object.assign(claimForm.value, JSON.parse(cDraft));
  } catch (_) {}
});

watch(() => props.user?.name, () => {
  fetchedLeaves.value = null;
  localLeaves.value = [];
  localClaims.value = [];
  loadPersistedRequests();
  fetchRemoteLeaves();
});

function saveLeaveDraft() {
  try {
    localStorage.setItem(LEAVE_DRAFT_KEY, JSON.stringify(leaveForm.value));
  } catch (_) {}
}

function saveClaimDraft() {
  try {
    localStorage.setItem(CLAIM_DRAFT_KEY, JSON.stringify(claimForm.value));
  } catch (_) {}
}

// User-scoped records (with case-insensitive matching)
const userUpper = computed(() => String(props.user?.name || '').trim().toUpperCase());

const myLeaves = computed(() => {
  const u = userUpper.value;
  const server = (fetchedLeaves.value ?? props.records?.leave ?? props.records?.leaves ?? props.teamLeave ?? [])
    .filter((l) => String(l.employee || l.name || '').trim().toUpperCase() === u);

  // Prune local leaves if server now authoritatively reflects them
  if (server.length > 0 && localLeaves.value.length > 0) {
    const unconfirmed = localLeaves.value.filter(ll => !server.some(sl => (sl.id && sl.id === ll.id) || (sl.start === ll.start && sl.type === ll.type)));
    if (unconfirmed.length !== localLeaves.value.length) {
      localLeaves.value = unconfirmed;
      persistLocalLeaves();
    }
  }

  const all = [...localLeaves.value, ...server];
  const unique = [];
  const seen = new Set();
  for (const item of all) {
    const key = `${item.start}_${item.end}_${item.type}_${item.id || ''}`;
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }
  return unique.sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')) || String(b.id || '').localeCompare(String(a.id || '')));
});

const myClaims = computed(() => {
  const u = userUpper.value;
  const server = (props.records?.claims || [])
    .filter((c) => String(c.employee || c.name || '').trim().toUpperCase() === u);

  // Prune local claims if server now authoritatively reflects them
  if (server.length > 0 && localClaims.value.length > 0) {
    const unconfirmed = localClaims.value.filter(lc => !server.some(sc => (sc.id && sc.id === lc.id) || (sc.date === lc.date && Number(sc.amount) === Number(lc.amount))));
    if (unconfirmed.length !== localClaims.value.length) {
      localClaims.value = unconfirmed;
      persistLocalClaims();
    }
  }

  const all = [...localClaims.value, ...server];
  const unique = [];
  const seen = new Set();
  for (const item of all) {
    const key = `${item.date}_${item.amount}_${item.title || item.category}_${item.id || ''}`;
    if (!seen.has(key)) { seen.add(key); unique.push(item); }
  }
  return unique.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || '')));
});

const myBookings = computed(() => {
  const u = userUpper.value;
  return (props.records?.bookings || [])
    .filter((b) => String(b.employee || b.name || '').trim().toUpperCase() === u)
    .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')) || String(b.id || '').localeCompare(String(a.id || '')));
});

const myLoans = computed(() => {
  const u = userUpper.value;
  return (props.records?.loans || [])
    .filter((l) => String(l.employee || l.name || '').trim().toUpperCase() === u)
    .sort((a, b) => String(b.date || b.start || '').localeCompare(String(a.date || a.start || '')) || String(b.id || '').localeCompare(String(a.id || '')));
});

// Supporting Document File Capture for Leave
async function onLeaveFileCapture(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    alert('Attachment exceeds 20MB limit. Please choose a smaller file.');
    return;
  }
  leaveForm.value.attachmentName = file.name;
  isCompressingLeave.value = true;
  try {
    const dataUrl = await compressImageToDataUrl(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.65, maxChars: 250000 });
    leaveForm.value.attachmentDataUrl = dataUrl;
    saveLeaveDraft();
  } catch (err) {
    console.error('Leave attachment error:', err);
  } finally {
    isCompressingLeave.value = false;
  }
}

// Camera & File Capture for Claims
async function onClaimCameraCapture(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    alert('Receipt file exceeds 25MB limit. Please take a smaller photo.');
    return;
  }
  claimForm.value.evidenceName = file.name;
  isCompressingPhoto.value = true;
  try {
    const dataUrl = await compressImageToDataUrl(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.65, maxChars: 250000 });
    claimForm.value.evidenceDataUrl = dataUrl;
    saveClaimDraft();
  } catch (err) {
    console.error('Receipt camera error:', err);
  } finally {
    isCompressingPhoto.value = false;
  }
}

// Submit Handlers
const submitting = ref(false);

async function submitLeave() {
  if (!leaveForm.value.start) {
    alert('Please select a start date.');
    return;
  }
  submitting.value = true;
  try {
    const sDate = normalizeDateStr(leaveForm.value.start);
    const eDate = normalizeDateStr(leaveForm.value.end || leaveForm.value.start);
    let days = 1;
    if (leaveForm.value.halfDay) {
      days = 0.5;
    } else if (sDate && eDate) {
      const d1 = new Date(sDate + 'T00:00:00');
      const d2 = new Date(eDate + 'T00:00:00');
      const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
      days = Math.max(1, diff);
    }
    const payload = {
      staffName: props.user?.name,
      leaveType: leaveForm.value.type,
      type: leaveForm.value.type,
      startDate: sDate,
      endDate: eDate,
      totalDays: days,
      reason: leaveForm.value.reason || '',
      fileName: leaveForm.value.attachmentName || '',
      fileData: leaveForm.value.attachmentDataUrl || ''
    };
    const res = await dashboardActions.apiPost('submitLeave', payload);
    if (res && res.status === 'success') {
      localLeaves.value.unshift({
        id: res?.id || res?.leaveId || `local-leave-${Date.now()}`,
        employee: props.user?.name,
        name: props.user?.name,
        type: leaveForm.value.type,
        start: sDate,
        end: eDate,
        days: days,
        reason: leaveForm.value.reason || '',
        status: 'Pending manager'
      });
      persistLocalLeaves();
      resetLeaveForm();
      showLeaveWizard.value = false;
      alert('Leave request submitted successfully and saved to backend.');
      emit('submit-leave', payload);
      emit('refresh');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hr-mobile-refresh'));
      }
      fetchRemoteLeaves();
    } else {
      alert(res?.message || 'Failed to submit leave. Please check your dates and try again.');
    }
  } catch (err) {
    alert('Error submitting leave: ' + (err.message || String(err)));
  } finally {
    submitting.value = false;
  }
}

async function submitClaim() {
  if (submitting.value) return;
  if (!claimForm.value.amount || Number(claimForm.value.amount) <= 0) {
    alert('Please enter a valid claim amount.');
    return;
  }
  if (isCompressingPhoto.value) {
    alert('Receipt photo is currently optimizing. Please wait a brief moment.');
    return;
  }
  submitting.value = true;
  try {
    let evidence = claimForm.value.evidenceDataUrl || '';
    // Extra safeguard: if image exceeds 250,000 characters, compress further
    if (evidence.startsWith('data:image/') && evidence.length > 42000) {
      try {
        const blob = await (await fetch(evidence)).blob();
        evidence = await compressImageToDataUrl(blob, { maxWidth: 800, maxHeight: 800, quality: 0.5, maxChars: 40000 });
      } catch (err) {}
    }
    const cDate = normalizeDateStr(claimForm.value.date);
    const claimRecord = {
      employee: props.user?.name,
      category: claimForm.value.category || 'Medical',
      title: claimForm.value.merchant || claimForm.value.category || 'General Claim',
      receiptNo: 'REC-' + Date.now().toString().slice(-6),
      date: cDate,
      amount: Number(claimForm.value.amount),
      evidenceUrl: evidence,
      notes: claimForm.value.notes || ''
    };
    if (!claimRequestId.value) claimRequestId.value = globalThis.crypto?.randomUUID?.() || `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await dashboardActions.apiPost('hrSave', {
      module: 'claims',
      requestId: claimRequestId.value,
      record: claimRecord
    });
    if (res && res.status === 'success') {
      localClaims.value.unshift({
        id: res?.id || res?.claimId || `local-claim-${Date.now()}`,
        employee: props.user?.name,
        category: claimRecord.category,
        merchant: claimRecord.title,
        date: claimRecord.date,
        amount: claimRecord.amount,
        notes: claimRecord.notes,
        status: 'Pending manager'
      });
      persistLocalClaims();
      resetClaimForm();
      showClaimWizard.value = false;
      alert('Claim submitted successfully with receipt and saved to backend.');
      emit('submit-claim', claimRecord);
      emit('refresh');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('hr-mobile-refresh'));
      }
    } else {
      alert(res?.message || 'Failed to submit claim. Please try again.');
    }
  } catch (err) {
    alert('Error submitting claim: ' + (err.message || String(err)));
  } finally {
    submitting.value = false;
  }
}

const statusBadge = (s) => {
  const st = String(s || '').toLowerCase();
  if (st.includes('approved') || st === 'paid') return 'badge bg-success-subtle text-success border border-success-subtle';
  if (st.includes('pending') || st.includes('submitted')) return 'badge bg-warning-subtle text-warning border border-warning-subtle';
  if (st.includes('reject')) return 'badge bg-danger-subtle text-danger border border-danger-subtle';
  return 'badge bg-light text-secondary border';
};
defineExpose({ refresh: () => fetchRemoteLeaves(true) });
</script>

<template>
  <div class="m-req-root">
    <!-- Top Action Bar -->
    <div class="d-flex justify-content-between align-items-center mb-1">
      <h3 class="m-section-title mb-0">My Requests</h3>
      <button type="button" class="btn btn-primary btn-sm rounded-pill px-3 fw-bold" @click="showActionMenu = true">
        <i class="bi bi-plus-lg me-1"></i>New Request
      </button>
    </div>

    <!-- Category Pill Sub-Tabs -->
    <div class="m-tab-pills">
      <button :class="['m-pill-btn', { active: activeTab === 'leave' }]" @click="activeTab = 'leave'">
        Leave ({{ myLeaves.length }})
      </button>
      <button :class="['m-pill-btn', { active: activeTab === 'claims' }]" @click="activeTab = 'claims'">
        Claims ({{ myClaims.length }})
      </button>
      <button :class="['m-pill-btn', { active: activeTab === 'bookings' }]" @click="activeTab = 'bookings'">
        Resources ({{ myBookings.length }})
      </button>
      <button :class="['m-pill-btn', { active: activeTab === 'loans' }]" @click="activeTab = 'loans'">
        Loans ({{ myLoans.length }})
      </button>
    </div>

    <!-- TAB 1: LEAVE LIST -->
    <div v-if="activeTab === 'leave'" class="m-list-wrap">
      <div v-if="!myLeaves.length" class="m-empty-card">
        <i class="bi bi-calendar2-check fs-2 text-muted mb-2 d-block"></i>
        <p class="mb-1 fw-bold">No Leave Applications</p>
        <small class="text-muted">Tap "+ New Request" to apply for annual, medical or replacement leave.</small>
      </div>
      <article
        v-for="(l, idx) in myLeaves"
        :key="idx"
        class="m-req-card cursor-pointer"
        role="button"
        tabindex="0"
        @click="openLeaveDetail(l)"
      >
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <strong class="d-block">{{ l.type || 'Annual Leave' }}</strong>
            <small class="text-muted">{{ formatRangeKL(l.start, l.end, 'display') }}</small>
          </div>
          <span :class="statusBadge(l.status)">{{ l.status || 'Pending' }}</span>
        </div>
        <p v-if="l.reason" class="m-req-reason mb-0">{{ l.reason }}</p>
      </article>
    </div>

    <!-- TAB 2: CLAIMS LIST -->
    <div v-if="activeTab === 'claims'" class="m-list-wrap">
      <div v-if="!myClaims.length" class="m-empty-card">
        <i class="bi bi-receipt fs-2 text-muted mb-2 d-block"></i>
        <p class="mb-1 fw-bold">No Expense Claims</p>
        <small class="text-muted">Submit medical, dental, optical or outstation claims with receipt photo.</small>
      </div>
      <article
        v-for="(c, idx) in myClaims"
        :key="idx"
        class="m-req-card cursor-pointer"
        role="button"
        tabindex="0"
        @click="openClaimDetail(c)"
      >
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <strong class="d-block">{{ c.category || 'General Claim' }}</strong>
            <small class="text-muted">{{ formatDateKL(c.date, 'display') }} · {{ c.merchant || 'Expense' }}</small>
          </div>
          <div class="text-end">
            <span class="d-block fw-bold text-primary">RM {{ Number(c.amount || 0).toFixed(2) }}</span>
            <span :class="statusBadge(c.status)">{{ c.status || 'Pending' }}</span>
          </div>
        </div>
        <p v-if="c.notes" class="m-req-reason mb-0">{{ c.notes }}</p>
      </article>
    </div>

    <!-- TAB 3: RESOURCES / BOOKINGS LIST -->
    <div v-if="activeTab === 'bookings'" class="m-list-wrap">
      <div v-if="!myBookings.length" class="m-empty-card">
        <i class="bi bi-calendar2-range fs-2 text-muted mb-2 d-block"></i>
        <p class="mb-1 fw-bold">No Resource Requests</p>
        <small class="text-muted">Request company vehicles, devices, equipment or facilities.</small>
      </div>
      <article
        v-for="(b, idx) in myBookings"
        :key="idx"
        class="m-req-card cursor-pointer"
        role="button"
        tabindex="0"
        @click="openBookingDetail(b)"
      >
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <strong class="d-block">{{ getBookingResourceName(b) }}</strong>
            <div class="d-flex align-items-center gap-2 mt-1">
              <span class="badge bg-light text-primary border small" style="font-size: 0.72rem;">
                <i class="bi bi-tag-fill me-1"></i>{{ getBookingCategory(b) }}
              </span>
              <small class="text-muted">{{ formatRangeKL(b.start, b.end, 'display') }}</small>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span :class="statusBadge(b.status)">{{ b.status || 'Confirmed' }}</span>
            <i class="bi bi-chevron-right text-muted small"></i>
          </div>
        </div>
      </article>
    </div>

    <!-- TAB 4: LOANS LIST -->
    <div v-if="activeTab === 'loans'" class="m-list-wrap">
      <div v-if="!myLoans.length" class="m-empty-card">
        <i class="bi bi-wallet2 fs-2 text-muted mb-2 d-block"></i>
        <p class="mb-1 fw-bold">No Active Loans</p>
        <small class="text-muted">Company advance loans appear here when approved.</small>
      </div>
      <article v-for="(ln, idx) in myLoans" :key="idx" class="m-req-card">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <strong class="d-block">{{ ln.type || 'Staff Advance' }}</strong>
            <small class="text-muted">Balance: RM {{ Number(ln.balance || 0).toFixed(2) }}</small>
          </div>
          <span :class="statusBadge(ln.status)">{{ ln.status || 'Active' }}</span>
        </div>
      </article>
    </div>

    <!-- Action Sheet Picker -->
    <div v-if="showActionMenu" class="m-sheet-backdrop" @click.self="showActionMenu = false">
      <div class="m-sheet-card">
        <h5 class="fw-bold mb-3">Create New Request</h5>
        <div class="d-grid gap-2">
          <button type="button" class="btn btn-light text-start p-3 border d-flex align-items-center gap-3" @click="showActionMenu = false; showLeaveWizard = true">
            <div class="m-picker-icon bg-info-subtle text-info"><i class="bi bi-calendar-plus"></i></div>
            <div>
              <strong class="d-block">Apply for Leave</strong>
              <small class="text-muted">Annual, Medical, Emergency or Unpaid Leave</small>
            </div>
          </button>
          <button type="button" class="btn btn-light text-start p-3 border d-flex align-items-center gap-3" @click="showActionMenu = false; showClaimWizard = true">
            <div class="m-picker-icon bg-success-subtle text-success"><i class="bi bi-camera-fill"></i></div>
            <div>
              <strong class="d-block">Submit Claim / Expense</strong>
              <small class="text-muted">Attach receipt photo directly via phone camera</small>
            </div>
          </button>
          <button type="button" class="btn btn-light text-start p-3 border d-flex align-items-center gap-3" @click="showActionMenu = false; showBookingWizard = true">
            <div class="m-picker-icon bg-warning-subtle text-warning"><i class="bi bi-calendar2-range"></i></div>
            <div>
              <strong class="d-block">Request Resources</strong>
              <small class="text-muted">Reserve company assets and meeting facilities</small>
            </div>
          </button>
        </div>
        <button type="button" class="btn btn-outline-secondary w-100 mt-3 py-2" @click="showActionMenu = false">Cancel</button>
      </div>
    </div>

    <!-- LEAVE WIZARD BOTTOM SHEET -->
    <div v-if="showLeaveWizard" class="m-sheet-backdrop" @click.self="showLeaveWizard = false">
      <div class="m-sheet-card">
        <div class="m-sheet-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0 fw-bold">Leave Application Wizard</h5>
          <div class="d-flex align-items-center gap-2">
            <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-1" @click="resetLeaveForm" title="Clear form data">
              <i class="bi bi-trash3 me-1"></i>Clear
            </button>
            <button type="button" class="btn-close" @click="showLeaveWizard = false"></button>
          </div>
        </div>
        <form @submit.prevent="submitLeave" class="m-sheet-body">
          <div class="mb-3">
            <label class="form-label small fw-bold">Leave Type</label>
            <select v-model="leaveForm.type" class="form-select" @change="saveLeaveDraft">
              <option value="AL">Annual Leave (AL)</option>
              <option value="ML">Medical Leave (MC)</option>
              <option value="HPL">Hospitalization Leave (HPL)</option>
              <option value="EL">Emergency Leave (EL)</option>
              <option value="NPL">Unpaid Leave (NPL)</option>
              <option value="RPL">Replacement Leave (RPL)</option>
              <option value="CPL">Compassionate Leave (CPL)</option>
              <option value="MRL">Marriage Leave (MRL)</option>
              <option value="MTL">Maternity Leave (MTL)</option>
              <option value="PL">Paternity Leave (PL)</option>
            </select>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-bold">Start Date</label>
              <input type="date" v-model="leaveForm.start" class="form-control" required @input="saveLeaveDraft" />
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold">End Date</label>
              <input type="date" v-model="leaveForm.end" class="form-control" @input="saveLeaveDraft" />
            </div>
          </div>
          <div class="form-check form-switch mb-3">
            <input class="form-check-input" type="checkbox" id="halfDaySw" v-model="leaveForm.halfDay" @change="saveLeaveDraft">
            <label class="form-check-label small fw-bold" for="halfDaySw">Half Day Request (0.5 day)</label>
          </div>
          <div class="mb-3">
            <label class="form-label small fw-bold">Reason / Notes</label>
            <textarea v-model="leaveForm.reason" rows="2" class="form-control" placeholder="Optional notes for manager" @input="saveLeaveDraft"></textarea>
          </div>
          <div class="mb-3">
            <label class="form-label small fw-bold">Supporting Document (Optional / MC)</label>
            <input ref="leaveFileInput" type="file" class="form-control form-control-sm" accept="image/*,application/pdf" @change="onLeaveFileCapture" :disabled="isCompressingLeave" />
            <div v-if="isCompressingLeave" class="text-primary small mt-1">
              <span class="spinner-border spinner-border-sm me-1" role="status"></span>
              Optimizing document...
            </div>
            <div v-else-if="leaveForm.attachmentName" class="mt-1 d-flex align-items-center justify-content-between bg-light p-2 rounded">
              <small class="text-success text-truncate me-2"><i class="bi bi-paperclip me-1"></i>{{ leaveForm.attachmentName }}</small>
              <button type="button" class="btn btn-sm btn-link text-danger p-0" @click="leaveForm.attachmentName=''; leaveForm.attachmentDataUrl=''; if (leaveFileInput) leaveFileInput.value=''; saveLeaveDraft();">Remove</button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary w-100 py-2 fw-bold" :disabled="submitting || isCompressingLeave">
            {{ submitting ? 'Submitting…' : isCompressingLeave ? 'Optimizing…' : 'Submit Leave Request' }}
          </button>
        </form>
      </div>
    </div>

    <!-- CLAIM WIZARD WITH REAL CAMERA CAPTURE -->
    <div v-if="showClaimWizard" class="m-sheet-backdrop" @click.self="showClaimWizard = false">
      <div class="m-sheet-card">
        <div class="m-sheet-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0 fw-bold">Submit Claim (with Camera Receipt)</h5>
          <div class="d-flex align-items-center gap-2">
            <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-1" @click="resetClaimForm" title="Clear form data">
              <i class="bi bi-trash3 me-1"></i>Clear
            </button>
            <button type="button" class="btn-close" @click="showClaimWizard = false"></button>
          </div>
        </div>
        <form @submit.prevent="submitClaim" class="m-sheet-body">
          <div class="mb-3">
            <label class="form-label small fw-bold">Claim Category</label>
            <select v-model="claimForm.category" class="form-select" @change="saveClaimDraft">
              <option value="Medical">Medical Reimbursement</option>
              <option value="Dental">Dental Care</option>
              <option value="Optical">Optical (Glasses/Contact Lens)</option>
              <option value="Mileage">Mileage Reimbursement</option>
              <option value="Outstation Meals">Outstation Meal Allowance</option>
              <option value="General">General Office Expense</option>
            </select>
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-bold">Amount (RM)</label>
              <input type="number" step="0.01" v-model="claimForm.amount" class="form-control" placeholder="0.00" required @input="saveClaimDraft" />
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold">Receipt Date</label>
              <input type="date" v-model="claimForm.date" class="form-control" required @input="saveClaimDraft" />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label small fw-bold">Merchant / Clinic Name</label>
            <input type="text" v-model="claimForm.merchant" class="form-control" placeholder="e.g. Poliklinik Jaya" @input="saveClaimDraft" />
          </div>

          <!-- Camera Capture Field -->
          <div class="mb-3">
            <label class="form-label small fw-bold"><i class="bi bi-camera me-1"></i>Receipt Photo (Camera / Upload)</label>
            <input ref="claimFileInput" type="file" accept="image/*" capture="environment" class="form-control" @change="onClaimCameraCapture" :disabled="isCompressingPhoto" />
            <div v-if="isCompressingPhoto" class="text-primary small mt-1">
              <span class="spinner-border spinner-border-sm me-1" role="status"></span>
              Optimizing camera receipt for upload...
            </div>
            <div v-else-if="claimForm.evidenceDataUrl" class="mt-2 text-center">
              <img :src="claimForm.evidenceDataUrl" alt="Receipt preview" class="img-thumbnail" style="max-height: 140px; border-radius: 8px;" />
              <div class="d-flex justify-content-center align-items-center gap-2 mt-1">
                <small class="text-success"><i class="bi bi-check-circle me-1"></i>Receipt attached: {{ claimForm.evidenceName }}</small>
                <button type="button" class="btn btn-sm btn-link text-danger p-0" @click="claimForm.evidenceDataUrl=''; claimForm.evidenceName=''; if (claimFileInput) claimFileInput.value=''; saveClaimDraft();">Remove</button>
              </div>
            </div>
          </div>

          <button type="submit" class="btn btn-primary w-100 py-2 fw-bold" :disabled="submitting || isCompressingPhoto">
            {{ submitting ? 'Uploading & Submitting…' : isCompressingPhoto ? 'Optimizing Photo…' : 'Submit Claim' }}
          </button>
        </form>
      </div>
    </div>
    <!-- Dedicated resource request sheet; uses existing server-side availability/conflict validation. -->
    <div v-if="showBookingWizard" class="m-sheet-backdrop" @click.self="showBookingWizard = false">
      <div class="m-sheet-card" role="dialog" aria-modal="true" aria-label="Request Resources">
        <div class="m-sheet-header">
          <h5 class="mb-0 fw-bold">Request Resources</h5>
          <button type="button" class="btn-close" aria-label="Close resource request" @click="showBookingWizard = false"></button>
        </div>
        <p class="small text-muted">Request a room, vehicle or equipment. Approval and conflicts are checked by HR.</p>
        <div v-if="bookingError" class="alert alert-danger small" role="alert">{{ bookingError }}</div>
        <form @submit.prevent="submitBooking">
          <label class="form-label small fw-bold" for="mobileResourceId">Resource *</label>
          <select id="mobileResourceId" v-model="bookingForm.resourceId" class="form-select mb-3" required>
            <option value="" disabled>Select an available resource</option>
            <option v-for="r in availableResources" :key="r.id" :value="r.id">{{ r.code ? `[${r.code}] ` : '' }}{{ r.title || r.code || 'Resource' }} · {{ r.category || 'Other' }}</option>
          </select>
          <p v-if="!availableResources.length" class="small text-muted">No available resources are published for your account.</p>
          <label class="form-label small fw-bold" for="mobileResourceStart">Start (Malaysia time) *</label>
          <input id="mobileResourceStart" v-model="bookingForm.start" type="datetime-local" class="form-control mb-3" required />
          <label class="form-label small fw-bold" for="mobileResourceEnd">End (Malaysia time) *</label>
          <input id="mobileResourceEnd" v-model="bookingForm.end" type="datetime-local" :min="bookingForm.start" class="form-control mb-3" required />
          <label class="form-label small fw-bold" for="mobileResourcePurpose">Purpose *</label>
          <input id="mobileResourcePurpose" v-model="bookingForm.title" type="text" maxlength="200" class="form-control mb-3" required />
          <button type="submit" class="btn btn-primary w-100 py-2 fw-bold" :disabled="submitting || !availableResources.length">{{ submitting ? 'Submitting…' : 'Submit Resource Request' }}</button>
        </form>
      </div>
    </div>

    <!-- LEAVE DETAIL BOTTOM SHEET -->
    <div v-if="selectedLeave" class="m-sheet-backdrop" @click.self="selectedLeave = null">
      <div class="m-sheet-card" role="dialog" aria-modal="true" aria-label="Leave Details">
        <div class="m-sheet-header">
          <div class="d-flex align-items-center gap-2">
            <div class="m-picker-icon bg-info-subtle text-info"><i class="bi bi-calendar2-check"></i></div>
            <div>
              <h5 class="mb-0 fw-bold">{{ selectedLeave.type || 'Leave' }}</h5>
              <small class="text-muted">{{ formatRangeKL(selectedLeave.start, selectedLeave.end, 'display') }}</small>
            </div>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="selectedLeave = null"></button>
        </div>

        <div class="m-sheet-body">
          <div class="d-flex justify-content-between align-items-center mb-3 p-3 bg-light rounded-3">
            <div>
              <span class="text-muted small d-block">Current Status</span>
              <span :class="statusBadge(selectedLeave.status)" class="fs-6">{{ selectedLeave.status || 'Pending' }}</span>
            </div>
            <div class="text-end">
              <span class="text-muted small d-block">Duration</span>
              <strong class="fs-6 text-dark">{{ selectedLeave.days || selectedLeave.totalDays || 1 }} day(s)</strong>
            </div>
          </div>

          <!-- Multi-tier approval path hierarchy -->
          <div class="mb-3 p-3 border rounded-3 bg-white">
            <span class="small fw-bold text-muted d-block mb-2">Approval Hierarchy (Staff &rarr; HOD &rarr; HR)</span>
            <div class="d-flex align-items-center justify-content-between text-center small">
              <div class="flex-fill">
                <div class="badge bg-success rounded-pill px-2 py-1 mb-1"><i class="bi bi-check-lg"></i></div>
                <div class="fw-bold">Staff</div>
                <small class="text-muted">Submitted</small>
              </div>
              <div class="text-muted px-1">&rarr;</div>
              <div class="flex-fill">
                <div :class="['badge rounded-pill px-2 py-1 mb-1', String(selectedLeave.status || '').toLowerCase().includes('pending manager') ? 'bg-warning text-dark' : String(selectedLeave.status || '').toLowerCase().includes('approved') || String(selectedLeave.status || '').toLowerCase().includes('pending admin') ? 'bg-success' : 'bg-secondary']">
                  <i :class="String(selectedLeave.status || '').toLowerCase().includes('pending manager') ? 'bi bi-clock-history' : 'bi bi-check-lg'"></i>
                </div>
                <div class="fw-bold">HOD</div>
                <small class="text-muted">{{ String(selectedLeave.status || '').toLowerCase().includes('pending manager') ? 'Pending' : 'Endorsed' }}</small>
              </div>
              <div class="text-muted px-1">&rarr;</div>
              <div class="flex-fill">
                <div :class="['badge rounded-pill px-2 py-1 mb-1', String(selectedLeave.status || '').toLowerCase().includes('approved') ? 'bg-success' : String(selectedLeave.status || '').toLowerCase().includes('pending admin') ? 'bg-warning text-dark' : 'bg-secondary']">
                  <i :class="String(selectedLeave.status || '').toLowerCase().includes('approved') ? 'bi bi-check-lg' : 'bi bi-hourglass-split'"></i>
                </div>
                <div class="fw-bold">HR</div>
                <small class="text-muted">{{ String(selectedLeave.status || '').toLowerCase().includes('approved') ? 'Approved' : 'Pending' }}</small>
              </div>
            </div>
          </div>

          <div v-if="selectedLeave.reason" class="mb-3">
            <label class="small fw-bold text-muted">Reason / Justification</label>
            <p class="mb-0 p-2 bg-light rounded small">{{ selectedLeave.reason }}</p>
          </div>

          <!-- Attachment -->
          <div v-if="selectedLeave.attachment || selectedLeave.fileUrl || selectedLeave.fileName || selectedLeave.fileData || selectedLeave.evidenceUrl" class="mb-3">
            <label class="small fw-bold text-muted">Supporting Document</label>
            <div class="d-flex align-items-center justify-content-between gap-2 p-2 border rounded bg-light">
              <div class="d-flex align-items-center gap-2 text-truncate">
                <i class="bi bi-file-earmark-medical text-primary fs-5"></i>
                <span class="text-truncate small fw-semibold">
                  {{ selectedLeave.fileName || 'Leave Supporting Document' }}
                </span>
              </div>
              <a
                v-if="selectedLeave.attachment || selectedLeave.fileUrl || selectedLeave.fileData || selectedLeave.evidenceUrl"
                :href="selectedLeave.attachment || selectedLeave.fileUrl || selectedLeave.fileData || selectedLeave.evidenceUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-sm btn-primary px-3 py-1 fw-bold text-nowrap"
              >
                <i class="bi bi-box-arrow-up-right me-1"></i>View
              </a>
            </div>
          </div>

          <!-- Leave Withdrawal Action -->
          <div v-if="canWithdrawLeave(selectedLeave)" class="pt-2">
            <button
              type="button"
              class="btn btn-outline-danger w-100 py-2 fw-bold"
              :disabled="withdrawing"
              @click="initiateWithdraw(selectedLeave)"
            >
              <i class="bi bi-x-circle me-1"></i>{{ withdrawing ? 'Withdrawing...' : 'Withdraw Leave Application' }}
            </button>
            <small class="text-muted d-block text-center mt-1">Submit withdrawal with reason for manager and HR approval.</small>
          </div>
          <div v-else-if="String(selectedLeave.status || '').toLowerCase().includes('withdrawal')" class="alert alert-warning small mb-0 mt-2">
            <i class="bi bi-hourglass-split me-1"></i><strong>Withdrawal Requested:</strong> Awaiting manager & HR approval. Entitlement will be restored upon approval.
            <div v-if="selectedLeave.withdrawRemark || selectedLeave.decisionRemark" class="mt-1">
              <em>"{{ selectedLeave.withdrawRemark || selectedLeave.decisionRemark }}"</em>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- CLAIM DETAIL BOTTOM SHEET -->
    <div v-if="selectedClaim" class="m-sheet-backdrop" @click.self="selectedClaim = null">
      <div class="m-sheet-card" role="dialog" aria-modal="true" aria-label="Claim Details">
        <div class="m-sheet-header">
          <div class="d-flex align-items-center gap-2">
            <div class="m-picker-icon bg-success-subtle text-success"><i class="bi bi-receipt"></i></div>
            <div>
              <h5 class="mb-0 fw-bold">{{ selectedClaim.category || 'Claim' }}</h5>
              <small class="text-muted">{{ formatDateKL(selectedClaim.date, 'display') }} · {{ selectedClaim.merchant || selectedClaim.title || 'Expense' }}</small>
            </div>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="selectedClaim = null"></button>
        </div>

        <div class="m-sheet-body">
          <div class="d-flex justify-content-between align-items-center mb-3 p-3 bg-light rounded-3">
            <div>
              <span class="text-muted small d-block">Status</span>
              <span :class="statusBadge(selectedClaim.status)" class="fs-6">{{ selectedClaim.status || 'Pending' }}</span>
            </div>
            <div class="text-end">
              <span class="text-muted small d-block">Claim Amount</span>
              <strong class="fs-5 text-primary">RM {{ Number(selectedClaim.amount || 0).toFixed(2) }}</strong>
            </div>
          </div>

          <!-- Multi-tier approval path hierarchy -->
          <div class="mb-3 p-3 border rounded-3 bg-white">
            <span class="small fw-bold text-muted d-block mb-2">Approval Hierarchy (Staff &rarr; HOD &rarr; HR)</span>
            <div class="d-flex align-items-center justify-content-between text-center small">
              <div class="flex-fill">
                <div class="badge bg-success rounded-pill px-2 py-1 mb-1"><i class="bi bi-check-lg"></i></div>
                <div class="fw-bold">Staff</div>
                <small class="text-muted">Submitted</small>
              </div>
              <div class="text-muted px-1">&rarr;</div>
              <div class="flex-fill">
                <div :class="['badge rounded-pill px-2 py-1 mb-1', String(selectedClaim.status || '').toLowerCase().includes('pending manager') ? 'bg-warning text-dark' : String(selectedClaim.status || '').toLowerCase().includes('approved') || String(selectedClaim.status || '').toLowerCase().includes('paid') || String(selectedClaim.status || '').toLowerCase().includes('pending admin') ? 'bg-success' : 'bg-secondary']">
                  <i :class="String(selectedClaim.status || '').toLowerCase().includes('pending manager') ? 'bi bi-clock-history' : 'bi bi-check-lg'"></i>
                </div>
                <div class="fw-bold">HOD</div>
                <small class="text-muted">{{ String(selectedClaim.status || '').toLowerCase().includes('pending manager') ? 'Pending' : 'Endorsed' }}</small>
              </div>
              <div class="text-muted px-1">&rarr;</div>
              <div class="flex-fill">
                <div :class="['badge rounded-pill px-2 py-1 mb-1', String(selectedClaim.status || '').toLowerCase().includes('paid') || String(selectedClaim.status || '').toLowerCase().includes('approved') ? 'bg-success' : 'bg-secondary']">
                  <i :class="String(selectedClaim.status || '').toLowerCase().includes('paid') || String(selectedClaim.status || '').toLowerCase().includes('approved') ? 'bi bi-check-lg' : 'bi bi-hourglass-split'"></i>
                </div>
                <div class="fw-bold">HR / Payout</div>
                <small class="text-muted">{{ String(selectedClaim.status || '').toLowerCase().includes('paid') ? 'Paid' : String(selectedClaim.status || '').toLowerCase().includes('approved') ? 'Approved' : 'Pending' }}</small>
              </div>
            </div>
          </div>

          <!-- Receipt Thumbnail with zoom -->
          <div v-if="selectedClaim.evidenceUrl || selectedClaim.evidenceDataUrl" class="mb-3">
            <label class="small fw-bold text-muted d-block mb-1">Receipt / Evidence Photo</label>
            <div class="position-relative d-inline-block border rounded p-1" style="max-width: 140px; cursor: pointer;" @click="showReceiptZoom = true">
              <img :src="selectedClaim.evidenceUrl || selectedClaim.evidenceDataUrl" alt="Receipt preview" class="img-fluid rounded" style="max-height: 120px; object-fit: cover;" />
              <div class="position-absolute bottom-0 end-0 m-1 bg-dark bg-opacity-75 text-white rounded px-1 py-0" style="font-size: 0.65rem;">
                <i class="bi bi-arrows-fullscreen me-1"></i>Zoom
              </div>
            </div>
          </div>

          <div v-if="selectedClaim.notes" class="mb-3">
            <label class="small fw-bold text-muted">Notes / Justification</label>
            <p class="mb-0 p-2 bg-light rounded small">{{ selectedClaim.notes }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- FULLSCREEN RECEIPT ZOOM MODAL -->
    <div v-if="showReceiptZoom && selectedClaim" class="m-zoom-backdrop" @click="showReceiptZoom = false">
      <button type="button" class="btn btn-dark btn-sm position-absolute top-0 end-0 m-3 z-3 rounded-pill px-3" @click.stop="showReceiptZoom = false">
        <i class="bi bi-x-lg me-1"></i>Close
      </button>
      <div class="m-zoom-content" @click.stop>
        <img :src="selectedClaim.evidenceUrl || selectedClaim.evidenceDataUrl" alt="Receipt full zoom" class="m-zoom-img" />
      </div>
    </div>

    <!-- RESOURCE BOOKING DETAIL MODAL -->
    <div v-if="selectedBooking" class="m-sheet-backdrop" @click.self="selectedBooking = null">
      <div class="m-sheet-card" role="dialog" aria-modal="true" aria-label="Resource Request Details">
        <div class="m-sheet-header">
          <div class="d-flex align-items-center gap-2">
            <div class="m-picker-icon bg-info-subtle text-info">
              <i class="bi bi-calendar2-range"></i>
            </div>
            <div>
              <h5 class="mb-0 fw-bold">{{ getBookingResourceName(selectedBooking) }}</h5>
              <small class="text-muted">{{ formatRangeKL(selectedBooking.start, selectedBooking.end, 'display') }}</small>
            </div>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="selectedBooking = null"></button>
        </div>

        <div class="m-sheet-body">
          <div class="row g-2 mb-3">
            <div class="col-6">
              <div class="p-2 border rounded bg-light">
                <label class="small text-muted d-block">Status</label>
                <span :class="statusBadge(selectedBooking.status)" class="d-inline-block mt-1">{{ selectedBooking.status || 'Confirmed' }}</span>
              </div>
            </div>
            <div class="col-6">
              <div class="p-2 border rounded bg-light">
                <label class="small text-muted d-block">Applicant</label>
                <strong class="small text-dark d-block text-truncate mt-1">{{ selectedBooking.employee || props.user?.name || '-' }}</strong>
              </div>
            </div>
          </div>

          <div class="mb-3">
            <label class="small fw-bold text-muted">Start (Kuala Lumpur Time)</label>
            <div class="p-2 bg-light rounded small fw-semibold">{{ formatDateTimeKL(selectedBooking.start, 'display') }}</div>
          </div>

          <div class="mb-3">
            <label class="small fw-bold text-muted">End (Kuala Lumpur Time)</label>
            <div class="p-2 bg-light rounded small fw-semibold">{{ formatDateTimeKL(selectedBooking.end, 'display') }}</div>
          </div>

          <div class="mb-3">
            <label class="small fw-bold text-muted">Purpose / Details Filled In</label>
            <p class="mb-0 p-2 bg-light rounded small">{{ selectedBooking.title || selectedBooking.purpose || selectedBooking.notes || 'No description provided' }}</p>
          </div>

          <div class="mb-3">
            <label class="small fw-bold text-muted">Resource Category</label>
            <div class="p-2 bg-light rounded small fw-semibold text-primary d-flex align-items-center gap-2">
              <i class="bi bi-tag-fill text-primary"></i>
              <span>{{ getBookingCategory(selectedBooking) }}</span>
            </div>
          </div>

          <div class="pt-2">
            <button type="button" class="btn btn-secondary w-100 py-2 fw-bold rounded-3" @click="selectedBooking = null">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- LEAVE WITHDRAWAL REASON MODAL -->
    <div v-if="showWithdrawModal && leaveToWithdraw" class="m-sheet-backdrop" @click.self="showWithdrawModal = false">
      <div class="m-sheet-card" role="dialog" aria-modal="true" aria-label="Withdraw Leave Application">
        <div class="m-sheet-header">
          <div class="d-flex align-items-center gap-2">
            <div class="m-picker-icon bg-danger-subtle text-danger">
              <i class="bi bi-x-circle-fill"></i>
            </div>
            <div>
              <h5 class="mb-0 fw-bold">Withdraw Leave Request</h5>
              <small class="text-muted">{{ leaveToWithdraw.type || 'Leave' }} ({{ formatRangeKL(leaveToWithdraw.start, leaveToWithdraw.end, 'display') }})</small>
            </div>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="showWithdrawModal = false"></button>
        </div>

        <form @submit.prevent="confirmWithdrawLeave" class="m-sheet-body">
          <div class="alert alert-warning small mb-3">
            <i class="bi bi-info-circle me-1"></i>
            Please provide a reason for withdrawal. This request will be submitted to your manager for approval.
          </div>

          <div class="mb-3">
            <label class="form-label small fw-bold">Reason for Withdrawal <span class="text-danger">*</span></label>
            <textarea
              v-model="withdrawReason"
              rows="3"
              class="form-control"
              placeholder="e.g. Schedule changed, emergency resolved, wrong date..."
              required
            ></textarea>
          </div>

          <div class="d-flex gap-2">
            <button type="button" class="btn btn-light flex-fill py-2" @click="showWithdrawModal = false">
              Cancel
            </button>
            <button type="submit" class="btn btn-danger flex-fill py-2 fw-bold" :disabled="withdrawing || !withdrawReason.trim()">
              {{ withdrawing ? 'Submitting...' : 'Submit Withdrawal' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-req-root {
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
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  background: #f2f2f7;
  padding: 4px;
  border-radius: 12px;
}
.m-pill-btn {
  background: transparent;
  border: none;
  border-radius: 8px;
  padding: 8px 2px;
  font-size: 0.72rem;
  font-weight: 600;
  color: #6e6e73;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.m-pill-btn.active {
  background: #fff;
  color: #1c1c1e;
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  font-weight: 700;
}
.cursor-pointer {
  cursor: pointer;
}
.m-zoom-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  z-index: 2500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.m-zoom-content {
  max-width: 100%;
  max-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.m-zoom-img {
  max-width: 100%;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
}
.m-list-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-req-card {
  background: #fff;
  border: 1px solid #e5e5ea;
  border-radius: 16px;
  padding: 14px 16px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.03);
}
.m-req-reason {
  font-size: 0.78rem;
  color: #6e6e73;
  border-top: 1px dashed #f2f2f7;
  padding-top: 8px;
  margin-top: 8px;
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
.m-sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  border-bottom: 1px solid #e5e5ea;
  padding-bottom: 12px;
}
.m-picker-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  flex-shrink: 0;
}
</style>
