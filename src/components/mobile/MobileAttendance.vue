<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { dashboardActions } from '../../services/dashboard';
import { compressImageToDataUrl } from '../../utils/imageCompressor.js';
import { mergeAttendancePunches } from '../../utils/attendanceMerge.mjs';
import { resolveEmployeeShift } from '../../services/inductionPolicy.js';

const props = defineProps({
  user: { type: Object, required: true },
  records: { type: Object, default: () => ({}) }
});

const emit = defineEmits(['navigate']);

const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
const selectedMonth = ref(new Date().toISOString().slice(0, 7)); // YYYY-MM
const showCorrectionSheet = ref(false);
const correctionForm = ref({
  date: new Date().toISOString().slice(0, 10),
  timeIn: '09:00',
  timeOut: '18:00',
  reason: ''
});
const correctionSubmitted = ref(false);

// Offline Punch Storage & Background Sync
const OFFLINE_PUNCH_KEY = 'pploshr_offline_punches';
const offlinePunches = ref([]);
const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
const syncInProgress = ref(false);

// Mobile GPS clock-in is opt-in per employee and uses foreground location only.
const clockConfig = ref(null);
const clockLoading = ref(false);
const clockSubmitting = ref(false);
const clockPhase = ref('');
const clockMessage = ref('');
const clockError = ref('');
const gpsFix = ref(null);
const clockEvents = ref([]);
const showAllMobilePunches = ref(false);
const showAllAttendanceDays = ref(false);

const DEFAULT_CLOCK_LOCATIONS = [
  'ARCHITECT OFFICE',
  'BANK',
  'CLIENT/DEV OFFICE',
  'COUNCIL OFFICE',
  'CS ENGINEER OFFICE',
  'HARDWARE SHOP',
  'IWK OFFICE',
  'KWSP/SOCSO/INCOME TAX',
  'LAND OFFICE',
  'ME ENGINEER OFFICE',
  'OTHERS',
  'SITE',
  'TNB OFFICE',
  'VEHICLE MAINTENANCE'
];

const selectedCheckInLocation = ref('SITE');
const clockRemark = ref('');
const currentGpsAddress = ref('');
const isResolvingAddress = ref(false);

const clockLocations = computed(() => {
  const locs = clockConfig.value?.locations;
  if (Array.isArray(locs) && locs.length > 0) return locs;
  return DEFAULT_CLOCK_LOCATIONS;
});

// Persistent clock-in info cache so previous clock-in details load instantly without waiting
const empKey = computed(() => String(props.user?.employeeNo || props.user?.name || 'user').trim().toUpperCase());
const CLOCK_CACHE_KEY = computed(() => `pploshr_cached_clock_info_${encodeURIComponent(empKey.value)}`);

function clockConfigForStorage(config) {
  if (!config || typeof config !== 'object') return null;
  // Full attendance history remains in memory; retain only the existing clock cache.
  const { attendance, ...clockSettings } = config;
  return clockSettings;
}
function restoreCachedClockInfo() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(CLOCK_CACHE_KEY.value);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    if (cached && typeof cached === 'object') {
      if (cached.clockConfig) {
        clockConfig.value = clockConfigForStorage(cached.clockConfig);
        if ('attendance' in cached.clockConfig) {
          cached.clockConfig = clockConfig.value;
          localStorage.setItem(CLOCK_CACHE_KEY.value, JSON.stringify(cached));
        }
      }
      if (Array.isArray(cached.clockEvents) && cached.clockEvents.length) {
        clockEvents.value = cached.clockEvents;
      }
      if (cached.lastLocation) selectedCheckInLocation.value = cached.lastLocation;
      if (cached.lastAddress) currentGpsAddress.value = cached.lastAddress;
      if (cached.lastGpsFix) gpsFix.value = cached.lastGpsFix;
      return true;
    }
  } catch (_) {}
  return false;
}

function saveCachedClockInfo() {
  if (typeof window === 'undefined') return;
  try {
    const data = {
      clockConfig: clockConfigForStorage(clockConfig.value),
      clockEvents: clockEvents.value || [],
      lastLocation: selectedCheckInLocation.value,
      lastAddress: currentGpsAddress.value,
      lastGpsFix: gpsFix.value,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(CLOCK_CACHE_KEY.value, JSON.stringify(data));
  } catch (_) {}
}
const displayedRecentPunches = computed(() => {
  const events = [...clockEvents.value].sort((a,b) => Date.parse(b.serverTime || 0) - Date.parse(a.serverTime || 0));
  return showAllMobilePunches.value ? events : events.slice(0, 2);
});
const lastRequestId = ref(null);
const nowTicker = ref(Date.now());

// Calculates the timestamp (ms) of the most recent 4:00 AM in Asia/Kuala_Lumpur (UTC+8)
function getLatest4AmCutoffMs(now = new Date(nowTicker.value)) {
  const klOffsetMs = 8 * 60 * 60 * 1000;
  const klNow = new Date(now.getTime() + klOffsetMs);
  const klYear = klNow.getUTCFullYear();
  const klMonth = klNow.getUTCMonth();
  const klDate = klNow.getUTCDate();
  const klHour = klNow.getUTCHours();

  let cycleDate = klDate;
  if (klHour < 4) {
    cycleDate -= 1;
  }
  return Date.UTC(klYear, klMonth, cycleDate, 4, 0, 0, 0) - klOffsetMs;
}

const latestClock = computed(() => {
  const confirmed = clockEvents.value.filter(e => (!e.status || e.status === 'Recorded') && !e.isOffline);
  if (!confirmed.length) return null;
  return [...confirmed].sort((a,b) => Date.parse(b.serverTime || 0) - Date.parse(a.serverTime || 0))[0] || null;
});

// Latest punch specifically in the current 4:00 AM shift cycle
const currentCycleClock = computed(() => {
  const cutoff = getLatest4AmCutoffMs();
  const confirmed = clockEvents.value.filter(e => {
    if (e.status && e.status !== 'Recorded' && !e.isOffline) return false;
    const t = Date.parse(e.serverTime || e.clientCapturedAt || 0);
    return !isNaN(t) && t >= cutoff;
  });
  if (!confirmed.length) return null;
  return [...confirmed].sort((a,b) => Date.parse(b.serverTime || b.clientCapturedAt || 0) - Date.parse(a.serverTime || a.clientCapturedAt || 0))[0] || null;
});

const currentStatus = computed(() => {
  const cutoff = getLatest4AmCutoffMs();
  if (currentCycleClock.value) {
    return currentCycleClock.value.type === 'IN' ? 'Clocked In' : 'Clocked Out';
  }
  if (latestClock.value) {
    const latestTime = Date.parse(latestClock.value.serverTime || latestClock.value.clientCapturedAt || 0);
    if (!isNaN(latestTime) && latestTime < cutoff) {
      return 'Not Clocked In'; // Auto reset at 4am
    }
  }
  if (todayRecord.value?.isOpen) return 'Clocked In';
  if (todayRecord.value?.ClockOut && todayRecord.value.ClockOut !== '—') return 'Clocked Out';
  if (todayRecord.value?.ClockIn && todayRecord.value.ClockIn !== '—') return 'Clocked In';
  return 'Not Clocked In';
});

const currentDisplayTime = computed(() => {
  if (currentCycleClock.value) {
    return mobileTime(currentCycleClock.value);
  }
  const cutoff = getLatest4AmCutoffMs();
  if (latestClock.value) {
    const latestTime = Date.parse(latestClock.value.serverTime || latestClock.value.clientCapturedAt || 0);
    if (!isNaN(latestTime) && latestTime < cutoff) {
      return '—'; // Reset at 4am
    }
  }
  if (todayRecord.value?.latestIn) return todayRecord.value.latestIn;
  if (todayRecord.value?.ClockIn && todayRecord.value.ClockIn !== '—') return todayRecord.value.ClockIn;
  return '—';
});

const todayInPunches = computed(() => {
  const cutoff = getLatest4AmCutoffMs();
  return clockEvents.value
    .filter(e => e.type === 'IN' && Date.parse(e.serverTime || e.clientCapturedAt || 0) >= cutoff)
    .sort((a, b) => Date.parse(a.serverTime || 0) - Date.parse(b.serverTime || 0)); // earliest first -> 1st In
});
const mobileTodayIn = computed(() => todayInPunches.value[0] || null);

const todayOutPunches = computed(() => {
  const cutoff = getLatest4AmCutoffMs();
  return clockEvents.value
    .filter(e => e.type === 'OUT' && Date.parse(e.serverTime || e.clientCapturedAt || 0) >= cutoff)
    .sort((a, b) => Date.parse(b.serverTime || 0) - Date.parse(a.serverTime || 0)); // latest first -> Last Out
});
const mobileTodayOut = computed(() => todayOutPunches.value[0] || null);
const mobileTime = event => event ? new Date(event.serverTime).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }) : '—';
const clockMode = computed(() => clockConfig.value?.policy?.mode || 'OFF');
const clockEnabled = computed(() => clockMode.value !== 'OFF');
const assignedSite = computed(() => (clockConfig.value?.sites || []).find(site => site.id === clockConfig.value?.policy?.siteId) || null);

const canClockOut = computed(() => {
  const cutoff = getLatest4AmCutoffMs();
  // If user has a mobile punch in the current 4 AM cycle:
  if (currentCycleClock.value) {
    return currentCycleClock.value.type === 'IN';
  }
  // If latest mobile clock was before today's 4am cycle cutoff, auto-reset to Clock In!
  if (latestClock.value) {
    const latestTime = Date.parse(latestClock.value.serverTime || latestClock.value.clientCapturedAt || 0);
    if (!isNaN(latestTime) && latestTime < cutoff) return false;
    if (latestClock.value.type === 'OUT') return false;
  }
  const today = userPunches.value.find(r => r.Date === todayStr);
  const openCombined = today && today.ClockIn !== '—' && (today.ClockOut === '—' || today.isOpen);
  return Boolean(openCombined);
});
const gpsLink = computed(() => gpsFix.value ? `https://www.google.com/maps?q=${encodeURIComponent(gpsFix.value.latitude + ',' + gpsFix.value.longitude)}` : '');

// Camera & Selfie Verification State
const showCameraModal = ref(false);
const pendingPunchType = ref('IN');
const capturedPhoto = ref('');
const cameraStream = ref(null);
const videoEl = ref(null);
const cameraActive = ref(false);
const cameraError = ref('');
const isCapturing = ref(false);
const viewingPunchPhoto = ref(null);
const imgLoadFailed = ref(false);

function handleImgError() {
  imgLoadFailed.value = true;
}

function driveImageUrl(url) {
  if (!url) return '';
  if (/^data:image\//.test(url)) return url;
  const match = String(url).match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || String(url).match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w600`;
  }
  return url;
}

function formatPunchTime(serverTime) {
  if (!serverTime) return '—';
  try {
    const d = new Date(serverTime);
    const dateStr = d.toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit' });
    const timeStr = d.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hour12: true });
    return `${dateStr}, ${timeStr}`;
  } catch (_) {
    return String(serverTime);
  }
}

function openPunchPhotoModal(evt) {
  imgLoadFailed.value = false;
  const serverDate = evt.serverTime ? new Date(evt.serverTime) : new Date();
  const timeFormatted = serverDate.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateFormatted = serverDate.toLocaleDateString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric' });
  viewingPunchPhoto.value = {
    ...evt,
    photolink: evt.photolink || evt.photo || '',
    photo: evt.photo || evt.photolink || '',
    Date: evt.date || dateFormatted,
    timeStr: `${dateFormatted} ${timeFormatted}`,
    ClockIn: evt.type === 'IN' ? timeFormatted : '—',
    ClockOut: evt.type === 'OUT' ? timeFormatted : '—',
  };
}

function loadOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_PUNCH_KEY);
    offlinePunches.value = raw ? JSON.parse(raw) : [];
  } catch (_) {
    offlinePunches.value = [];
  }
}

function saveOfflineQueue() {
  try {
    localStorage.setItem(OFFLINE_PUNCH_KEY, JSON.stringify(offlinePunches.value));
  } catch (_) {}
}

async function syncOfflinePunches() {
  if (typeof window === 'undefined' || !navigator.onLine || syncInProgress.value) return;
  loadOfflineQueue();
  if (!offlinePunches.value.length) return;
  syncInProgress.value = true;
  const remaining = [];
  let syncedCount = 0;
  for (const item of offlinePunches.value) {
    try {
      const res = await dashboardActions.apiPost('mobileClockPunch', {
        type: item.type,
        requestId: item.id,
        latitude: item.latitude,
        longitude: item.longitude,
        accuracyM: item.accuracyM,
        address: item.address || '',
        checkInLocation: item.checkInLocation || '',
        remark: item.remark || '',
        capturedAt: item.clientCapturedAt,
        photo: item.photo || ''
      });
      if (res?.status === 'success' || res?.duplicate) {
        syncedCount++;
        const evtIdx = clockEvents.value.findIndex(e => e.id === item.id);
        if (evtIdx >= 0) {
          clockEvents.value[evtIdx].status = 'Recorded';
          clockEvents.value[evtIdx].isOffline = false;
        }
      } else {
        remaining.push(item);
      }
    } catch (_) {
      remaining.push(item);
    }
  }
  offlinePunches.value = remaining;
  saveOfflineQueue();
  syncInProgress.value = false;
  if (syncedCount > 0) {
    clockMessage.value = `✓ Synced ${syncedCount} offline punch(es) to server.`;
    void loadClockConfig();
  }
}

let clockLoadSequence = 0;
async function loadClockConfig(isSilent = false, strict = false) {
  const sequence = ++clockLoadSequence;
  if (!props.user?.name) return;
  const hasCache = clockConfig.value != null || clockEvents.value.length > 0;
  if (!hasCache && !isSilent) {
    clockLoading.value = true;
  }
  clockError.value = '';
  loadOfflineQueue();
  try {
    const result = await dashboardActions.apiPost('mobileClockConfig', {});
    if (result?.status !== 'success') throw new Error(result?.message || 'Could not load clock permissions.');
    if (sequence !== clockLoadSequence) return;
    clockConfig.value = result.data;
    const serverEvents = result.data.events || [];
    // Merge offline pending punches with server events
    const all = [...serverEvents];
    for (const off of offlinePunches.value) {
      if (!all.some(e => e.id === off.id)) {
        all.unshift(off);
      }
    }
    clockEvents.value = all;
    saveCachedClockInfo();
    // Attempt background sync if online
    if (navigator.onLine && offlinePunches.value.length) {
      void syncOfflinePunches();
    }
  } catch (err) {
    if (!hasCache) {
      clockError.value = err?.message || 'Unable to load mobile clock-in permissions.';
      clockConfig.value = null;
    }
    // Still display offline cached punches if server unreachable
    if (offlinePunches.value.length) {
      clockEvents.value = [...offlinePunches.value];
    }
    if (strict) throw err;
  } finally {
    if (sequence === clockLoadSequence) clockLoading.value = false;
  }
}

function captureGps() {
  if (typeof window !== 'undefined' && !window.isSecureContext) return Promise.reject(new Error('GPS requires HTTPS or a secure app origin.'));
  if (!navigator.geolocation) return Promise.reject(new Error('GPS is not supported on this device.'));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    position => resolve({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: position.coords.accuracy,
      capturedAt: new Date(position.timestamp).toISOString()
    }),
    err => reject(new Error(err.code === 1 ? 'Location access denied. Enable precise location for PplosHR in device settings.' :
      err.code === 3 ? 'GPS timed out. Move to an open area and try again.' : 'Unable to obtain your GPS position.')),
    { enableHighAccuracy: true, timeout: 20000, maximumAge:0 }
  ));
}

const addressCache = new Map();

async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return '';
  const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (addressCache.has(key)) return addressCache.get(key);

  try {
    const cachedItem = localStorage.getItem(`pploshr_geo_addr_${key}`);
    if (cachedItem) {
      addressCache.set(key, cachedItem);
      return cachedItem;
    }
  } catch (_) {}

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const a = data.address || {};
    const road = a.road || a.street || a.residential || a.pedestrian || a.subway || '';
    const suburb = a.suburb || a.neighbourhood || a.village || a.town || a.city || a.county || '';
    const postcode = a.postcode || '';
    const parts = [road, suburb, postcode].filter(Boolean);
    const formatted = parts.length > 0 ? parts.join(' , ') : (data.display_name || `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`);
    
    addressCache.set(key, formatted);
    try {
      localStorage.setItem(`pploshr_geo_addr_${key}`, formatted);
    } catch (_) {}
    return formatted;
  } catch (err) {
    console.warn('Reverse geocoding notice:', err);
    return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  }
}

async function refreshGpsAddress() {
  if (isResolvingAddress.value) return;
  isResolvingAddress.value = true;
  try {
    const fix = await captureGps();
    gpsFix.value = fix;
    const addr = await reverseGeocode(fix.latitude, fix.longitude);
    if (addr) {
      currentGpsAddress.value = addr;
    }
    saveCachedClockInfo();
  } catch (err) {
    console.warn('GPS location acquisition notice:', err);
    if (!currentGpsAddress.value) {
      currentGpsAddress.value = 'GPS location unavailable';
    }
  } finally {
    isResolvingAddress.value = false;
  }
}

// Front Camera Selfie Handlers
async function openCameraModal(type) {
  pendingPunchType.value = type;
  capturedPhoto.value = '';
  cameraError.value = '';
  showCameraModal.value = true;
  await nextTick();
  startCamera();
}

async function startCamera() {
  cameraActive.value = false;
  cameraError.value = '';
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    cameraError.value = 'Front camera is required for face verification. Please allow camera permissions.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
      audio: false
    });
    cameraStream.value = stream;
    if (videoEl.value) {
      videoEl.value.srcObject = stream;
      await videoEl.value.play();
    }
    cameraActive.value = true;
  } catch (err) {
    console.warn('Front camera stream error:', err);
    cameraError.value = 'Camera permission needed. Please allow camera access in browser settings to clock in/out.';
  }
}

function stopCamera() {
  if (cameraStream.value) {
    cameraStream.value.getTracks().forEach(t => t.stop());
    cameraStream.value = null;
  }
  cameraActive.value = false;
}

function closeCameraModal() {
  stopCamera();
  showCameraModal.value = false;
  capturedPhoto.value = '';
}

async function captureSnapshot() {
  if (isCapturing.value || clockSubmitting.value) return;
  isCapturing.value = true;
  cameraError.value = '';
  
  let photo = '';
  try {
    if (!videoEl.value || !cameraActive.value) throw new Error('Camera is not ready. Allow the camera and try again.');
    if (videoEl.value && cameraActive.value) {
      const video = videoEl.value;
      const canvas = document.createElement('canvas');
      const size = Math.min(video.videoWidth || 480, video.videoHeight || 480);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      
      // Mirror horizontally for selfie orientation
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
      
      // Center crop
      const sx = ((video.videoWidth || size) - size) / 2;
      const sy = ((video.videoHeight || size) - size) / 2;
      ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
      
      // The compressor requires a Blob/File, NOT a data: URL string.
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Camera could not encode an image.')), 'image/jpeg', 0.8));
      photo = await compressImageToDataUrl(blob, { maxWidth: 360, maxHeight: 360, quality: 0.65, maxChars: 100000 });
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) throw new Error('Camera image could not be encoded. Please retry.');
      capturedPhoto.value = photo;
    }
  } catch (err) {
    console.warn('Snapshot error:', err);
    cameraError.value = err?.message || 'Could not capture a photo. Please retry.';
    isCapturing.value = false;
    return; // Never submit a punch with a missing selfie.
  } finally {
    isCapturing.value = false;
  }

  const type = pendingPunchType.value;
  stopCamera();
  showCameraModal.value = false;

  // Directly capture GPS and clock out / in without intermediate confirmation
  await clockPunch(type, photo);
}

function queueOfflinePunch(payload) {
  const offlineEvt = {
    id: payload.requestId,
    type: payload.type,
    serverTime: new Date().toISOString(),
    date: todayStr,
    latitude: payload.latitude,
    longitude: payload.longitude,
    accuracyM: payload.accuracyM,
    address: payload.address || currentGpsAddress.value || '',
    checkInLocation: payload.checkInLocation || selectedCheckInLocation.value || '',
    remark: payload.remark || clockRemark.value || '',
    siteId: assignedSite.value?.id || '',
    siteName: assignedSite.value?.name || (payload.isBasement ? 'Basement' : 'Offline'),
    distanceM: null,
    mode: clockMode.value,
    clientCapturedAt: payload.capturedAt,
    photo: payload.photo || '',
    source: 'mobile-offline-cache',
    status: 'Queued (Offline)',
    isOffline: true
  };
  loadOfflineQueue();
  if (!offlinePunches.value.some(p => p.id === offlineEvt.id)) {
    offlinePunches.value.push(offlineEvt);
    saveOfflineQueue();
  }
  if (!clockEvents.value.some(e => e.id === offlineEvt.id)) {
    clockEvents.value.unshift(offlineEvt);
  }
  const timeStr = new Date(offlineEvt.serverTime).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
  clockMessage.value = `${payload.type === 'IN' ? 'Clock In' : 'Clock Out'} saved locally (Offline / Basement mode) at ${timeStr}. Will auto-upload once connected.`;
}

async function clockPunch(type, photo = '') {
  if (!clockEnabled.value || clockSubmitting.value) return;
  clockSubmitting.value = true;
  clockPhase.value = 'Getting GPS…';
  clockMessage.value = '';
  clockError.value = '';

  const requestId = lastRequestId.value?.type === type ? lastRequestId.value.id :
    (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
  lastRequestId.value = { id: requestId, type };

  let fix = null;
  try {
    // Geolocation is requested ONLY after the user taps Clock In / Clock Out.
    fix = await captureGps();
    gpsFix.value = fix;
    if (!currentGpsAddress.value || currentGpsAddress.value === 'GPS location unavailable' || currentGpsAddress.value.includes('Detecting')) {
      // Address is display metadata; validated GPS coordinates are sufficient for the punch.
      void reverseGeocode(fix.latitude, fix.longitude).then(addr => {
        if (addr && gpsFix.value === fix) currentGpsAddress.value = addr;
      }).catch(() => {});
    }
  } catch (gpsErr) {
    // Do not fabricate worksite coordinates when GPS is unavailable.
    clockError.value = gpsErr.message + ' A valid device GPS fix is required; contact HR for a manual exception.';
    clockSubmitting.value = false;
    clockPhase.value = '';
    return;
  }

  if (!Number.isFinite(fix.accuracyM) || fix.accuracyM > (clockConfig.value?.maxAccuracyM || 100)) {
    clockError.value = `GPS accuracy is ${Math.round(fix.accuracyM)} m. Move outdoors until accuracy is within ${clockConfig.value?.maxAccuracyM || 100} m.`;
    clockSubmitting.value = false;
    clockPhase.value = '';
    return;
  }

  clockPhase.value = 'Recording…';
  const selfie = photo || capturedPhoto.value || '';
  if (!/^data:image\/jpeg;base64,/.test(selfie)) {
    clockError.value = 'A clear verification photo is required to clock in/out.';
    clockSubmitting.value = false;
    clockPhase.value = '';
    return;
  }
  const punchPayload = {
    type,
    requestId,
    photo: selfie,
    address: currentGpsAddress.value || '',
    checkInLocation: selectedCheckInLocation.value || '',
    remark: clockRemark.value || '',
    ...fix
  };

  // A delayed offline GPS sample cannot meet the backend's freshness check.
  // Never tell staff an unverified punch was recorded.
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    clockError.value = 'No network connection. Clock-in was NOT recorded. Please reconnect or contact HR.';
    clockSubmitting.value = false;
    clockPhase.value = '';
    return;
  }

  try {
    const res = await dashboardActions.apiPost('mobileClockPunch', punchPayload);
    if (res?.status !== 'success') throw new Error(res?.message || 'Save not confirmed. Check punch history before retrying.');
    lastRequestId.value = null;
    const timeStr = new Date(res.data.serverTime).toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
    clockMessage.value = `${type === 'IN' ? 'Clocked in' : 'Clocked out'} at ${timeStr} (Malaysia time).`;
    const newEvt = {
      ...res.data,
      photo: res.data.photolink || res.data.photo || '',
      location: { latitude: res.data.latitude, longitude: res.data.longitude, accuracyM: res.data.accuracyM }
    };
    if (!clockEvents.value.some(e => e.id === res.data.id)) {
      clockEvents.value.unshift(newEvt);
    }
    saveCachedClockInfo();
    // Fetch authoritative event times/history after save, without delaying confirmation.
    void loadClockConfig(true);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hr-mobile-refresh'));
    }
  } catch (err) {
    // Network ambiguity: the server may have saved the request. Preserve requestId
    // for an idempotent retry, but never mark it as a confirmed offline punch.
    clockError.value = (err?.message || 'Server did not confirm this punch.') + ' Refresh punch history before retrying.';
  } finally {
    clockSubmitting.value = false;
    clockPhase.value = '';
  }
}

function handleOnline() {
  isOnline.value = true;
  void syncOfflinePunches();
}

function handleOffline() {
  isOnline.value = false;
}

let tickerInterval = null;

function handleVisibility() {
  nowTicker.value = Date.now();
  if (document.visibilityState === 'visible' && navigator.onLine) {
    void syncOfflinePunches();
    void loadClockConfig(true);
  }
}

onMounted(() => {
  restoreCachedClockInfo();
  loadClockConfig(true);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    tickerInterval = setInterval(() => {
      nowTicker.value = Date.now();
    }, 30000);
  }
  if (typeof navigator !== 'undefined' && navigator.geolocation && !currentGpsAddress.value) {
    void refreshGpsAddress();
  }
});

onBeforeUnmount(() => {
  stopCamera();
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibility);
  }
});

watch(() => props.user?.name, () => {
  gpsFix.value = null;
  lastRequestId.value = null;
  loadClockConfig();
});

const userName = computed(() => String(props.user?.name || '').trim().toUpperCase());
const userBioId = computed(() => String(props.user?.biometricId || props.user?.bioId || ''));

const userJoinedDate = computed(() => {
  const direct = props.user?.joinedDate || props.user?.joined || '';
  if (direct) return String(direct).slice(0, 10);
  if (typeof window !== 'undefined' && window.staffSettings) {
    const s = window.staffSettings[userName.value] || window.staffSettings[props.user?.name];
    if (s?.joinedDate) return String(s.joinedDate).slice(0, 10);
  }
  return '';
});

const userResignDate = computed(() => {
  const direct = props.user?.resignDate || props.user?.resignationDate || '';
  if (direct) return String(direct).slice(0, 10);
  if (typeof window !== 'undefined' && window.staffSettings) {
    const s = window.staffSettings[userName.value] || window.staffSettings[props.user?.name];
    if (s?.resignDate || s?.resignationDate) return String(s.resignDate || s.resignationDate).slice(0, 10);
  }
  return '';
});

function parseTimeToMinutes(t) {
  if (!t || t === '-' || t === '—') return null;
  const str = String(t).trim();
  const m12 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = parseInt(m12[2], 10);
    const ampm = m12[3].toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const m24 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m24) {
    return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
  }
  return null;
}

// Period before the joined date should be appear as empty attendance: filtered in mergeAttendancePunches
// One read-only attendance timeline; do not write GPS events into biometric/payroll tables.
// Every record is aggregated using earliest IN and latest OUT from either source.
const authorizedAttendance = computed(() => {
  const rows = Array.isArray(clockConfig.value?.attendance) ? clockConfig.value.attendance :
    (Array.isArray(props.records?.attendance) ? props.records.attendance : []);
  return rows.filter(r => {
    const employeeNo = String(r.employeeNo || r.EmployeeNo || '').trim();
    const biometricId = String(r.BiometricID || r.biometricId || r.ACNo || '').trim();
    const name = String(r.Name || r.name || r.employee || '').trim().toUpperCase();
    if (employeeNo && props.user?.employeeNo) return employeeNo === String(props.user.employeeNo).trim();
    if (biometricId && userBioId.value) return biometricId === userBioId.value;
    return Boolean(name && name === userName.value);
  }).map(r => ({ ...r, Date: r.Date || r.date, In: r.In || r.clockIn || r.in, Out: r.Out || r.clockOut || r.out }));
});
const userPunches = computed(() => {
  const imported = authorizedAttendance.value;
  const verifiedEvents = clockEvents.value.filter(evt => {
    if (evt.isOffline || evt.status === 'Queued (Offline)') return false;
    return true;
  });
  const merged = mergeAttendancePunches({ imported, mobileEvents: verifiedEvents, joinedDate: userJoinedDate.value, resignDate: userResignDate.value, month: selectedMonth.value, employeeName: props.user?.name || '' });
  return merged.map(r => ({
    ...r,
    inSource: r.clockInSource || (r.mobileIn ? 'Mobile GPS' : 'Biometric'),
    outSource: r.clockOutSource || (r.mobileOut ? 'Mobile GPS' : 'Biometric')
  }));
});

const displayedAttendanceDays = computed(() => showAllAttendanceDays.value ? userPunches.value : userPunches.value.slice(0, 2));
watch(selectedMonth, () => { showAllAttendanceDays.value = false; });

const todayRecord = computed(() => {
  if (selectedMonth.value === todayStr.slice(0,7)) return userPunches.value.find(r => r.Date === todayStr) || null;
  // Header always describes TODAY, even when browsing another month.
  const imported = authorizedAttendance.value;
  return mergeAttendancePunches({imported,mobileEvents:clockEvents.value,joinedDate:userJoinedDate.value,resignDate:userResignDate.value,month:todayStr.slice(0,7),employeeName:props.user?.name||''}).find(r=>r.Date===todayStr)||null;
});

const todayFirstIn = computed(() => {
  const bioIn = todayRecord.value?.ClockIn && todayRecord.value.ClockIn !== '—' && todayRecord.value.ClockIn !== '-' ? todayRecord.value.ClockIn : null;
  const mobIn = mobileTodayIn.value ? mobileTime(mobileTodayIn.value) : null;
  if (bioIn && mobIn) {
    // Biometric superceeds if and only if earlier than mobile clock in
    const bioMins = parseTimeToMinutes(bioIn);
    const mobMins = parseTimeToMinutes(mobIn);
    if (bioMins != null && mobMins != null) {
      return bioMins <= mobMins 
        ? { time: bioIn, source: todayRecord.value?.clockInSource || 'Biometric' } 
        : { time: mobIn, source: 'Mobile GPS' };
    }
  }
  if (mobIn) return { time: mobIn, source: 'Mobile GPS' };
  if (bioIn) return { time: bioIn, source: todayRecord.value?.clockInSource || 'Biometric' };
  return { time: '—', source: '' };
});

const todayLastOut = computed(() => {
  const bioOut = todayRecord.value?.ClockOut && todayRecord.value.ClockOut !== '—' && todayRecord.value.ClockOut !== '-' ? todayRecord.value.ClockOut : null;
  const mobOut = mobileTodayOut.value ? mobileTime(mobileTodayOut.value) : null;
  if (bioOut && mobOut) {
    const bioMins = parseTimeToMinutes(bioOut);
    const mobMins = parseTimeToMinutes(mobOut);
    if (bioMins != null && mobMins != null) {
      return bioMins >= mobMins 
        ? { time: bioOut, source: todayRecord.value?.clockOutSource || 'Biometric' } 
        : { time: mobOut, source: 'Mobile GPS' };
    }
  }
  if (mobOut) return { time: mobOut, source: 'Mobile GPS' };
  if (bioOut) return { time: bioOut, source: todayRecord.value?.clockOutSource || 'Biometric' };
  return { time: '—', source: '' };
});

const expectedShiftText = computed(() => {
  const rDays = Array.isArray(props.user?.restDays) ? props.user.restDays : [];
  const dayOfWeek = new Date().getDay();
  if (rDays.includes(dayOfWeek) || (rDays.length === 0 && (dayOfWeek === 0 || dayOfWeek === 6))) {
    return 'Rest Day / Off Day';
  }
  const matchingShift = resolveEmployeeShift(props.user, props.records?.workSchedules);
  if (matchingShift) {
    return `Expected Shift: ${matchingShift.start} - ${matchingShift.end} (${matchingShift.title})`;
  }
  return 'Expected Shift: 08:30 - 17:30 (Scheduled)';
});

function submitCorrection() {
  if (!correctionForm.value.reason) {
    alert('Please provide a reason for the attendance correction.');
    return;
  }
  correctionSubmitted.value = true;
  setTimeout(() => {
    correctionSubmitted.value = false;
    showCorrectionSheet.value = false;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hr-mobile-refresh'));
    }
    alert('Attendance correction submitted for Manager review.');
  }, 600);
}
defineExpose({ refresh: () => loadClockConfig(false, true) });
</script>

<template>
  <div class="m-att-root">
    <!-- Today's Status Header Card -->
    <div class="m-today-punch-card">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div>
          <span class="m-pill-badge"><i class="bi bi-clock-history me-1"></i>Today's Status</span>
          <h3 class="m-punch-time mb-0">{{ currentDisplayTime }}</h3>
          <small class="text-muted">{{ expectedShiftText }}</small>
        </div>
        <span :class="['badge px-2 py-1', currentStatus === 'Clocked In' ? 'bg-success-subtle text-success border border-success-subtle' : currentStatus === 'Clocked Out' ? 'bg-secondary-subtle text-secondary border' : 'bg-light text-secondary border']">
          {{ currentStatus }}
        </span>
      </div>
      <div class="m-punch-grid">
        <div class="m-punch-slot">
          <small class="text-muted">1st In</small>
          <strong>{{ todayFirstIn.time }} <small v-if="todayFirstIn.source" class="text-muted">({{ todayFirstIn.source }})</small></strong>
          <div v-if="mobileTodayIn?.address || todayRecord?.inAddress" class="text-muted mt-1 text-truncate" style="font-size:0.75rem; line-height: 1.2;" :title="mobileTodayIn?.address || todayRecord?.inAddress">
            <i class="bi bi-geo-alt-fill text-danger me-1"></i>{{ mobileTodayIn?.address || todayRecord?.inAddress }}
            <span v-if="mobileTodayIn?.checkInLocation" class="badge bg-secondary-subtle text-secondary ms-1">{{ mobileTodayIn.checkInLocation }}</span>
          </div>
        </div>
        <div class="m-punch-slot">
          <small class="text-muted">Last Out</small>
          <strong>{{ todayLastOut.time }} <small v-if="todayLastOut.source && todayLastOut.time !== '—'" class="text-muted">({{ todayLastOut.source }})</small></strong>
          <div v-if="(mobileTodayOut?.address || todayRecord?.outAddress) && todayLastOut.time !== '—'" class="text-muted mt-1 text-truncate" style="font-size:0.75rem; line-height: 1.2;" :title="mobileTodayOut?.address || todayRecord?.outAddress">
            <i class="bi bi-geo-alt-fill text-danger me-1"></i>{{ mobileTodayOut?.address || todayRecord?.outAddress }}
            <span v-if="mobileTodayOut?.checkInLocation" class="badge bg-secondary-subtle text-secondary ms-1">{{ mobileTodayOut.checkInLocation }}</span>
          </div>
        </div>
        <div class="m-punch-slot">
          <small class="text-muted">OT Claimable</small>
          <strong>{{ todayRecord?.OT || '0.0' }}h</strong>
        </div>
      </div>
      <button type="button" class="btn btn-outline-primary btn-sm w-100 mt-3" @click="showCorrectionSheet = true">
        <i class="bi bi-pencil-square me-1"></i>Request Time Correction / OT Claim
      </button>
    </div>

    <!-- Dedicated, explicitly permissioned mobile GPS clock-in panel. -->
    <section class="m-gps-card" aria-labelledby="gpsClockTitle">
      <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
        <h4 id="gpsClockTitle" class="m-section-title mb-0"><i class="bi bi-geo-alt me-1"></i>Mobile GPS Clock</h4>
        <div class="d-flex align-items-center gap-1">
          <span v-if="!isOnline" class="badge bg-warning text-dark border"><i class="bi bi-wifi-off me-1"></i>Offline</span>
          <span class="badge" :class="clockEnabled ? 'bg-success-subtle text-success border' : 'bg-light text-secondary border'">
            {{ clockLoading ? 'Loading' : clockMode==='GEOFENCED' ? (assignedSite ? `${assignedSite.name}` : 'Geofenced') : clockMode==='ANYWHERE' ? 'Anywhere' : 'Not enabled' }}
          </span>
        </div>
      </div>
      
      <!-- Offline Basement Notice Banner -->
      <div v-if="offlinePunches.length" class="alert alert-warning small p-2 mb-2 d-flex justify-content-between align-items-center rounded-3">
        <div>
          <i class="bi bi-cloud-arrow-up-fill me-1 text-warning"></i>
          <strong>{{ offlinePunches.length }} offline punch(es) cached.</strong>
          <div class="text-muted" style="font-size:0.75rem">Auto-uploading when connection is restored.</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline-warning py-0 px-2" :disabled="syncInProgress" @click="syncOfflinePunches">
          {{ syncInProgress ? 'Syncing…' : 'Sync' }}
        </button>
      </div>

      <template v-if="clockEnabled">
        <!-- GPS Address, Check In Location Dropdown, & Remark Fields -->
        <div class="m-clock-fields-card border rounded-3 p-2 bg-light mb-3">
          <!-- GPS Loc Row -->
          <div class="mb-2">
            <div class="d-flex align-items-center justify-content-between mb-1">
              <label class="form-label small fw-bold mb-0 text-dark">
                <i class="bi bi-geo-alt-fill text-danger me-1"></i>GPS Loc :
              </label>
              <button
                type="button"
                class="btn btn-sm btn-link text-decoration-none py-0 px-1 text-primary d-flex align-items-center gap-1"
                :disabled="isResolvingAddress"
                @click="refreshGpsAddress"
                title="Refresh GPS Address"
              >
                <i class="bi bi-arrow-repeat" :class="{'spin-icon': isResolvingAddress}"></i>
                <span style="font-size: 0.75rem;">{{ isResolvingAddress ? 'Detecting…' : 'Refresh' }}</span>
              </button>
            </div>
            <div class="input-group input-group-sm">
              <input
                type="text"
                class="form-control form-control-sm bg-white"
                :value="currentGpsAddress || (isResolvingAddress ? 'Detecting current GPS address…' : 'Tap Refresh to detect address')"
                readonly
                placeholder="GPS Address (Road, Suburb, Postcode)"
                style="font-size: 0.82rem;"
              />
              <a
                v-if="gpsLink && !gpsFix?.isBasement"
                :href="gpsLink"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-outline-secondary btn-sm"
                title="View on Google Maps"
              >
                <i class="bi bi-map"></i>
              </a>
            </div>
            <small v-if="gpsFix" class="text-muted d-block mt-1" style="font-size: 0.72rem;">
              ±{{ Math.round(gpsFix.accuracyM) }} m accuracy · Lat: {{ gpsFix.latitude.toFixed(5) }}, Lng: {{ gpsFix.longitude.toFixed(5) }}
            </small>
          </div>

          <!-- Check In Location Dropdown -->
          <div class="mb-2">
            <label class="form-label small fw-bold mb-1 text-dark" for="checkInLocSelect">
              <i class="bi bi-building me-1 text-primary"></i>Check In Location :
            </label>
            <select
              id="checkInLocSelect"
              v-model="selectedCheckInLocation"
              class="form-select form-select-sm"
              :disabled="clockSubmitting"
            >
              <option v-for="loc in clockLocations" :key="loc" :value="loc">
                {{ loc }}
              </option>
            </select>
          </div>

          <!-- Remark Input -->
          <div>
            <label class="form-label small fw-bold mb-1 text-dark" for="clockRemarkInput">
              <i class="bi bi-chat-left-text me-1 text-secondary"></i>Remark :
            </label>
            <input
              id="clockRemarkInput"
              v-model.trim="clockRemark"
              type="text"
              class="form-control form-control-sm"
              placeholder="e.g. Client meeting / Site inspection / Urgent repair"
              maxlength="200"
              :disabled="clockSubmitting"
            />
          </div>
        </div>

        <div class="d-grid gap-2" style="grid-template-columns:1fr 1fr">
          <button type="button" :class="canClockOut ? 'btn btn-outline-success' : 'btn btn-success'" :disabled="clockSubmitting || clockLoading || canClockOut" @click="openCameraModal('IN')">
            <i class="bi bi-camera me-1"></i>{{ clockSubmitting && pendingPunchType === 'IN' ? clockPhase : 'Clock In' }}
          </button>
          <button type="button" :class="canClockOut ? 'btn btn-primary' : 'btn btn-outline-primary'" :disabled="clockSubmitting || clockLoading || !canClockOut" @click="openCameraModal('OUT')">
            <i class="bi bi-camera me-1"></i>{{ clockSubmitting && pendingPunchType === 'OUT' ? clockPhase : 'Clock Out' }}
          </button>
        </div>
      </template>
      <div v-else-if="!clockLoading" class="small text-muted">Mobile clock-in is disabled for your profile. Ask HR to enable geofenced or unrestricted clock-in.</div>
      <div v-if="clockMessage" class="m-clock-status-banner alert alert-success d-flex align-items-center gap-2 py-2 px-3 rounded-3 border-0 bg-success-subtle mt-2 mb-0" role="status">
        <span class="bg-success text-white rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style="width:22px; height:22px; font-size:12px;">
          <i class="bi bi-check-lg"></i>
        </span>
        <div class="small fw-medium text-success-emphasis flex-grow-1">{{ clockMessage }}</div>
      </div>
      <div v-if="clockError" class="alert alert-danger small mt-2 mb-0" role="alert">{{ clockError }}</div>

      <!-- Redesigned Recent Mobile Punches Feed -->
      <div v-if="clockEvents.length" class="mt-3 pt-2 border-top">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="d-flex align-items-center gap-2">
            <span class="small fw-bold text-dark text-uppercase" style="font-size:0.75rem; letter-spacing:0.5px;">Recent Mobile Punches</span>
            <span class="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill px-2 py-0" style="font-size:0.7rem;">{{ clockEvents.length }}</span>
          </div>
          <button type="button" class="btn btn-sm btn-link text-decoration-none p-0 text-muted d-flex align-items-center gap-1" :disabled="clockLoading || clockSubmitting" @click="loadClockConfig" title="Refresh punches" style="font-size:0.8rem;">
            <i class="bi bi-arrow-clockwise" :class="{ 'spin-icon': clockLoading }"></i> Refresh
          </button>
        </div>

        <div class="d-flex flex-column gap-2">
          <div
            v-for="evt in displayedRecentPunches"
            :key="evt.id"
            class="p-2 rounded-3 border bg-white shadow-2xs position-relative"
            :class="evt.type === 'IN' ? 'border-success-subtle' : 'border-primary-subtle'"
          >
            <!-- Top Row: Type Badge, Mode, Offline Status, Time -->
            <div class="d-flex justify-content-between align-items-center mb-1">
              <div class="d-flex align-items-center gap-1 flex-wrap">
                <span
                  class="badge rounded-pill px-2 py-1"
                  :class="evt.type === 'IN' ? 'bg-success text-white' : 'bg-primary text-white'"
                  style="font-size:0.74rem;"
                >
                  <i :class="evt.type === 'IN' ? 'bi bi-box-arrow-in-right' : 'bi bi-box-arrow-right'" class="me-1"></i>
                  {{ evt.type === 'IN' ? 'Clock In' : 'Clock Out' }}
                </span>
                <span class="badge bg-light text-secondary border rounded-pill" style="font-size:0.68rem;">
                  {{ evt.mode === 'ANYWHERE' ? 'Anywhere' : 'Geofenced' }}
                </span>
                <span v-if="evt.isOffline" class="badge bg-warning-subtle text-warning border rounded-pill" style="font-size:0.68rem;">
                  Queued Offline
                </span>
              </div>
              <span class="small fw-bold text-dark flex-shrink-0" style="font-size:0.78rem;">
                {{ formatPunchTime(evt.serverTime) }}
              </span>
            </div>

            <!-- Bottom Row: Location, Address, Remark, and In-App Selfie Trigger -->
            <div class="d-flex align-items-center justify-content-between gap-2 mt-1">
              <div class="small text-muted flex-grow-1" style="font-size:0.76rem; line-height:1.35; min-width:0;">
                <div v-if="evt.checkInLocation" class="mb-0.5">
                  <span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle px-1 py-0 me-1" style="font-size:0.7rem;">
                    <i class="bi bi-geo-alt-fill text-danger me-1"></i>{{ evt.checkInLocation }}
                  </span>
                </div>
                <div v-if="evt.address" class="text-dark text-truncate" :title="evt.address">
                  <i class="bi bi-pin-map text-secondary me-1"></i>{{ evt.address }}
                </div>
                <div v-else-if="evt.location" class="text-secondary">
                  <i class="bi bi-crosshair text-secondary me-1"></i>{{ evt.location.latitude?.toFixed(5) }}, {{ evt.location.longitude?.toFixed(5) }}
                </div>
                <div v-if="evt.remark" class="fst-italic text-secondary text-truncate mt-0.5" :title="evt.remark">
                  <i class="bi bi-chat-left-text me-1"></i>"{{ evt.remark }}"
                </div>
              </div>

              <!-- In-App Selfie Preview Button -->
              <div v-if="evt.photolink || evt.photo" class="flex-shrink-0">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-primary d-flex flex-column align-items-center justify-content-center p-1 rounded-3"
                  style="width:46px; height:46px;"
                  @click="openPunchPhotoModal(evt)"
                  title="View verification selfie"
                >
                  <i class="bi bi-person-bounding-box fs-6 text-primary"></i>
                  <span style="font-size:0.62rem; line-height:1;" class="mt-0.5">Selfie</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="clockEvents.length > 2" class="d-flex justify-content-center mt-2">
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary rounded-pill px-3 py-1"
            style="font-size:0.75rem;"
            @click="showAllMobilePunches = !showAllMobilePunches"
          >
            <i :class="showAllMobilePunches ? 'bi bi-chevron-up' : 'bi bi-chevron-down'" class="me-1"></i>
            {{ showAllMobilePunches ? 'Show Latest 2 Only' : `View All ${clockEvents.length} Punches` }}
          </button>
        </div>
      </div>
    </section>

    <!-- Front Camera Selfie Capture Modal -->
    <Teleport to="body">
      <div v-if="showCameraModal" class="m-sheet-backdrop" @click.self="closeCameraModal">
        <div class="m-sheet-card m-camera-card">
          <div class="m-sheet-header">
            <div>
              <h5 class="mb-0 fw-bold"><i class="bi bi-camera-fill me-2 text-primary"></i>Face Verification</h5>
              <small class="text-muted">Take a front-camera selfie to verify {{ pendingPunchType === 'IN' ? 'Clock In' : 'Clock Out' }}</small>
            </div>
            <button type="button" class="btn-close" @click="closeCameraModal"></button>
          </div>

          <div class="m-camera-body text-center">
            <div class="m-viewfinder-container">
              <div class="m-viewfinder-wrapper position-relative mx-auto mb-3">
                <video ref="videoEl" autoplay playsinline muted class="m-camera-video"></video>
                <div class="m-face-oval-guide">
                  <span class="m-face-guide-text">Align face here</span>
                </div>
              </div>
              
              <div v-if="cameraError" class="alert alert-warning small p-2 mb-3">
                <div>{{ cameraError }}</div>
                <button type="button" class="btn btn-sm btn-outline-secondary mt-2" @click="startCamera">
                  <i class="bi bi-arrow-repeat me-1"></i>Retry Camera
                </button>
              </div>
              
              <div class="d-flex justify-content-center mb-2">
                <button
                  v-if="cameraActive"
                  type="button"
                  class="btn btn-primary px-4 py-2 fw-bold shadow-sm d-flex align-items-center justify-content-center gap-2"
                  style="min-width: 220px;"
                  :disabled="isCapturing || clockSubmitting"
                  @click="captureSnapshot"
                >
                  <span v-if="isCapturing || clockSubmitting" class="spinner-border spinner-border-sm" role="status"></span>
                  <i v-else class="bi bi-camera-fill fs-5"></i>
                  <span>{{ isCapturing ? 'Capturing…' : (clockSubmitting ? clockPhase : `Take Selfie & ${pendingPunchType === 'IN' ? 'Clock In' : 'Clock Out'}`) }}</span>
                </button>
                <div v-else-if="!cameraError" class="text-muted small py-2 d-flex align-items-center justify-content-center gap-2">
                  <span class="spinner-border spinner-border-sm text-primary" role="status"></span>
                  <span>Starting front camera…</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- View Punch Photo Modal -->
    <Teleport to="body">
      <div v-if="viewingPunchPhoto" class="m-sheet-backdrop" @click.self="viewingPunchPhoto = null">
        <div class="m-sheet-card text-center" style="max-width: 420px; border-radius: 16px; overflow: hidden;">
          <div class="m-sheet-header border-bottom py-2 px-3 bg-light d-flex justify-content-between align-items-center">
            <h5 class="mb-0 fw-bold fs-6 text-dark"><i class="bi bi-person-bounding-box me-2 text-primary"></i>Punch Verification</h5>
            <button type="button" class="btn-close" @click="viewingPunchPhoto = null"></button>
          </div>
          <div class="p-3">
            <!-- In-App Image Display -->
            <div class="position-relative mx-auto mb-3" style="max-width: 260px; height: 260px; border-radius: 14px; overflow: hidden; background: #1a1a1a;">
              <img
                v-if="!imgLoadFailed"
                :src="driveImageUrl(viewingPunchPhoto.photolink || viewingPunchPhoto.photo || viewingPunchPhoto.inPhoto || viewingPunchPhoto.outPhoto || '')"
                alt="Verification selfie"
                class="w-100 h-100 shadow-sm"
                style="object-fit: cover;"
                @error="handleImgError"
              />
              <div v-else class="w-100 h-100 d-flex flex-column align-items-center justify-content-center text-white p-3 text-center">
                <i class="bi bi-person-bounding-box fs-1 mb-2 text-primary"></i>
                <div class="small fw-semibold mb-1">Selfie Verification</div>
                <div class="text-white-50 small" style="font-size:0.75rem;">Punch photo recorded securely</div>
              </div>
            </div>

            <div class="d-flex justify-content-center gap-1 mb-2 flex-wrap">
              <span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1 rounded-pill" style="font-size:0.72rem;">
                <i class="bi bi-check-circle-fill me-1"></i>Photo Verified
              </span>
              <span class="badge bg-light text-secondary border px-2 py-1 rounded-pill" style="font-size:0.72rem;">
                {{ viewingPunchPhoto.type === 'IN' ? 'Clock In' : 'Clock Out' }}
              </span>
              <span v-if="viewingPunchPhoto.isOffline" class="badge bg-warning-subtle text-warning border px-2 py-1 rounded-pill" style="font-size:0.72rem;">
                <i class="bi bi-cloud-arrow-up me-1"></i>Queued Offline
              </span>
            </div>

            <div class="text-start bg-light rounded-3 p-3 small mb-3 border" style="font-size:0.8rem;">
              <div class="d-flex justify-content-between mb-1">
                <span class="text-muted">Staff:</span>
                <span class="fw-bold">{{ viewingPunchPhoto.Name || viewingPunchPhoto.name || props.user.name }}</span>
              </div>
              <div class="d-flex justify-content-between mb-1">
                <span class="text-muted">Timestamp:</span>
                <span class="fw-semibold">{{ viewingPunchPhoto.timeStr || viewingPunchPhoto.serverTime || viewingPunchPhoto.Date }}</span>
              </div>
              <div v-if="viewingPunchPhoto.checkInLocation || viewingPunchPhoto.inCheckInLocation || viewingPunchPhoto.outCheckInLocation" class="d-flex justify-content-between mb-1">
                <span class="text-muted">Check-In Location:</span>
                <span class="badge bg-secondary-subtle text-secondary-emphasis">{{ viewingPunchPhoto.checkInLocation || viewingPunchPhoto.inCheckInLocation || viewingPunchPhoto.outCheckInLocation }}</span>
              </div>
              <div v-if="viewingPunchPhoto.address || viewingPunchPhoto.inAddress || viewingPunchPhoto.outAddress" class="mt-1 pt-1 border-top">
                <span class="text-muted d-block" style="font-size:0.72rem;">GPS Address:</span>
                <span class="text-dark">{{ viewingPunchPhoto.address || viewingPunchPhoto.inAddress || viewingPunchPhoto.outAddress }}</span>
              </div>
              <div v-if="viewingPunchPhoto.remark || viewingPunchPhoto.inRemark || viewingPunchPhoto.outRemark" class="mt-1 pt-1 border-top">
                <span class="text-muted d-block" style="font-size:0.72rem;">Remark:</span>
                <span class="fst-italic text-secondary">"{{ viewingPunchPhoto.remark || viewingPunchPhoto.inRemark || viewingPunchPhoto.outRemark }}"</span>
              </div>
            </div>

            <div class="d-grid gap-2">
              <button type="button" class="btn btn-secondary btn-sm rounded-pill" @click="viewingPunchPhoto = null">Close</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Attendance History Header & Month Filter -->
    <div class="d-flex justify-content-between align-items-center mt-2 mb-1">
      <h4 class="m-section-title mb-0">Attendance Timeline</h4>
      <input type="month" v-model="selectedMonth" class="form-control form-control-sm m-month-input" />
    </div>

    <!-- Timeline List -->
    <div v-if="!userJoinedDate" class="m-empty-att alert alert-warning border-0 p-3 text-center my-2 rounded-3">
      <i class="bi bi-person-exclamation fs-2 text-warning mb-2 d-block"></i>
      <h6 class="fw-bold mb-1">Joined Date Not Configured</h6>
      <p class="small text-muted mb-0">Your profile does not have a joined date set. Please contact HR to set your joined date before attendance records can be displayed.</p>
    </div>
    <div v-else-if="!userPunches.length" class="m-empty-att">
      <i class="bi bi-calendar-x fs-2 text-muted mb-2 d-block"></i>
      <p class="mb-0">No attendance records available for {{ selectedMonth }}.</p>
      <small class="text-muted">Only attendance returned by the server and confirmed mobile punches are shown. Refresh to check for updates.</small>
    </div>
    <div v-else class="m-timeline-list">
      <article v-for="(p, idx) in displayedAttendanceDays" :key="idx" class="m-timeline-item">
        <div class="m-timeline-date">
          <span class="m-day-num">{{ String(p.Date || p.date).slice(8, 10) }}</span>
          <span class="m-day-mon">{{ String(p.Date || p.date).slice(5, 7) }}</span>
        </div>
        <div class="m-timeline-info">
          <div class="d-flex justify-content-between align-items-center mb-1 flex-wrap gap-1">
            <strong>{{ p.Date || p.date }}</strong>
            <div class="d-flex align-items-center gap-1">
              <span v-if="p.isBeforeJoin" class="badge bg-light text-muted border">
                Prior to Join Date
              </span>
              <span v-else-if="p.hasMobilePunch" class="badge bg-success-subtle text-success border">
                <i class="bi bi-geo-alt-fill me-1"></i>Mobile GPS
              </span>
              <span v-if="p.isOffline" class="badge bg-warning-subtle text-warning border">
                <i class="bi bi-cloud-arrow-up me-1"></i>Offline
              </span>
              <span v-if="!p.isBeforeJoin" :class="['badge', p.Late ? 'bg-danger-subtle text-danger' : 'bg-light text-dark border']">
                {{ p.Late ? 'Late' : 'Normal' }}
              </span>
            </div>
          </div>
          <div class="m-punch-times align-items-center flex-wrap gap-2">
            <span title="1st In across biometric + mobile"><i class="bi bi-box-arrow-in-right text-success me-1"></i>{{ p.ClockIn || p.In || '—' }}<small v-if="p.clockInSource || p.inSource" class="text-muted ms-1">({{ p.clockInSource || p.inSource }})</small></span>
            <span>→</span>
            <span title="Last Out across biometric + mobile"><i class="bi bi-box-arrow-right text-danger me-1"></i>{{ p.ClockOut || p.Out || '—' }}<small v-if="p.clockOutSource || p.outSource" class="text-muted ms-1">({{ p.clockOutSource || p.outSource }})</small></span>
            <span v-if="Number(p.OT) > 0" class="text-primary fw-bold">+{{ p.OT }}h OT</span>
            <button v-if="p.photo || p.inPhoto || p.outPhoto" type="button" class="btn btn-sm btn-outline-primary py-0 px-2 ms-auto" @click="viewingPunchPhoto = p">
              <i class="bi bi-person-bounding-box me-1"></i>Selfie
            </button>
          </div>
          <div v-if="p.inAddress || p.outAddress || p.inCheckInLocation || p.outCheckInLocation" class="text-muted small mt-1" style="font-size:0.75rem">
            <div v-if="p.inAddress || p.inCheckInLocation" class="text-truncate" :title="p.inAddress">
              <i class="bi bi-geo-alt text-success me-1"></i>In: 
              <span v-if="p.inCheckInLocation" class="badge bg-light text-dark border me-1">{{ p.inCheckInLocation }}</span>
              <span>{{ p.inAddress }}</span>
            </div>
            <div v-if="(p.outAddress || p.outCheckInLocation) && p.ClockOut!=='—'" class="text-truncate" :title="p.outAddress">
              <i class="bi bi-geo-alt text-danger me-1"></i>Out: 
              <span v-if="p.outCheckInLocation" class="badge bg-light text-dark border me-1">{{ p.outCheckInLocation }}</span>
              <span>{{ p.outAddress }}</span>
            </div>
          </div>
        </div>
      </article>
    </div>

    <button v-if="userPunches.length > 2" type="button" class="btn btn-outline-secondary w-100 mt-2 rounded-pill" @click="showAllAttendanceDays = !showAllAttendanceDays">
      {{ showAllAttendanceDays ? 'Show latest 2 attendance days' : `Show more attendance days (${userPunches.length - 2})` }}
      <i :class="showAllAttendanceDays ? 'bi bi-chevron-up' : 'bi bi-chevron-down'" class="ms-1"></i>
    </button>

    <!-- Correction Bottom Sheet Modal -->
    <div v-if="showCorrectionSheet" class="m-sheet-backdrop" @click.self="showCorrectionSheet = false">
      <div class="m-sheet-card">
        <div class="m-sheet-header">
          <h5 class="mb-0 fw-bold">Attendance Correction</h5>
          <button type="button" class="btn-close" @click="showCorrectionSheet = false"></button>
        </div>
        <form @submit.prevent="submitCorrection" class="m-sheet-body">
          <p class="small text-muted mb-3">Submit correction if you forgot to punch or worked verified overtime.</p>
          <div class="mb-3">
            <label class="form-label small fw-bold">Date</label>
            <input type="date" v-model="correctionForm.date" class="form-control" required />
          </div>
          <div class="row g-2 mb-3">
            <div class="col-6">
              <label class="form-label small fw-bold">Adjusted In</label>
              <input type="time" v-model="correctionForm.timeIn" class="form-control" required />
            </div>
            <div class="col-6">
              <label class="form-label small fw-bold">Adjusted Out</label>
              <input type="time" v-model="correctionForm.timeOut" class="form-control" required />
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label small fw-bold">Reason for Amendment</label>
            <textarea v-model="correctionForm.reason" class="form-control" rows="3" placeholder="Reason (e.g. Site meeting, reader error)..." required></textarea>
          </div>
          <button type="submit" class="btn btn-primary w-100" :disabled="correctionSubmitted">
            {{ correctionSubmitted ? 'Submitting...' : 'Submit Request' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-gps-card{background:white;border:1px solid #e5e5ea;border-radius:18px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.04)}
.m-gps-card button{min-height:48px}

.m-att-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}
.m-today-punch-card {
  background: #ffffff;
  border: 1px solid #e5e5ea;
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}
.m-pill-badge {
  display: inline-flex;
  align-items: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: #007aff;
  background: rgba(0, 122, 255, 0.1);
  padding: 3px 8px;
  border-radius: 12px;
  margin-bottom: 6px;
}
.m-punch-time {
  font-size: 1.85rem;
  font-weight: 800;
  letter-spacing: -0.5px;
  color: #1c1c1e;
}
.m-punch-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 14px;
  background: #f2f2f7;
  padding: 12px;
  border-radius: 12px;
}
.m-punch-slot {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-punch-slot small {
  font-size: 0.7rem;
}
.m-punch-slot strong {
  font-size: 0.95rem;
  color: #1c1c1e;
}
.m-section-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #1c1c1e;
}
.m-month-input {
  max-width: 135px;
  border-radius: 8px;
}
.m-timeline-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.m-timeline-item {
  display: flex;
  align-items: center;
  gap: 14px;
  background: #ffffff;
  border: 1px solid #e5e5ea;
  border-radius: 14px;
  padding: 14px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02);
}
.m-timeline-date {
  width: 44px;
  height: 44px;
  background: #f2f2f7;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.m-day-num {
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1;
  color: #1c1c1e;
}
.m-day-mon {
  font-size: 0.62rem;
  color: #8e8e93;
  text-transform: uppercase;
  font-weight: 600;
}
.m-timeline-info {
  flex: 1;
}
.m-punch-times {
  font-size: 0.78rem;
  color: #3a3a3c;
  display: flex;
  align-items: center;
}
.m-empty-att {
  background: #fff;
  border: 1px dashed #d1d1d6;
  border-radius: 16px;
  padding: 24px;
  text-align: center;
  font-size: 0.85rem;
}
.m-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.m-sheet-card {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  max-height: calc(100dvh - 120px);
  margin: auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.m-camera-card {
  padding-bottom: 24px;
}
.m-sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  border-bottom: 1px solid #e5e5ea;
  padding-bottom: 12px;
}

/* Front Camera Viewfinder & Selfie Styles */
.m-viewfinder-wrapper {
  width: min(240px, 55vw);
  height: min(240px, 55vw);
  border-radius: 50%;
  overflow: hidden;
  border: 4px solid #007aff;
  box-shadow: 0 4px 16px rgba(0, 122, 255, 0.2);
  background: #000;
}
.m-camera-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1); /* Mirror selfie preview */
}
.m-face-oval-guide {
  position: absolute;
  inset: 16px;
  border: 2px dashed rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  pointer-events: none;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 12px;
}
.m-face-guide-text {
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
}
.m-captured-img {
  width: 220px;
  height: 220px;
  border-radius: 50%;
  object-fit: cover;
  border: 4px solid #34c759;
}
.spin-icon {
  animation: spin-kf 1s linear infinite;
  display: inline-block;
}
@keyframes spin-kf {
  100% { transform: rotate(360deg); }
}
.shadow-2xs {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
</style>
