// Persistent Caching & State Synchronization for PeopleOS HR
// Caches previous & locked months, multi-month attendance history, templates, and bootstrap data.

const CACHE_KEYS = {
  BOOTSTRAP: 'peopleos_cache_bootstrap_v2',
  LOCKED_MONTHS: 'peopleos_cache_locked_months_v2',
  ATTENDANCE_HISTORY: 'peopleos_cache_attendance_history_v2',
  HR_RECORDS: 'peopleos_cache_hr_records_v2',
  PAYROLL_OVERVIEW: 'peopleos_cache_payroll_overview_v2',
  TEAM_LEAVE: 'peopleos_cache_team_leave_v2'
};

function safeGet(key) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn(`[CacheManager] Failed to read key ${key}:`, e);
    return null;
  }
}

function safeSet(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // If quota exceeded, clean up old non-critical caches
    if (e.name === 'QuotaExceededError') {
      try {
        localStorage.removeItem(CACHE_KEYS.PAYROLL_OVERVIEW);
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {}
    }
    console.warn(`[CacheManager] Failed to write key ${key}:`, e);
  }
}

export const CacheManager = {
  getBootstrap() {
    return safeGet(CACHE_KEYS.BOOTSTRAP);
  },

  saveBootstrap(data) {
    if (!data || typeof data !== 'object') return;
    const existing = safeGet(CACHE_KEYS.BOOTSTRAP) || {};
    const payload = {
      ...existing,
      ...data,
      timestamp: Date.now()
    };
    safeSet(CACHE_KEYS.BOOTSTRAP, payload);
    this.notifyUpdate('bootstrap');
  },

  getLockedMonths() {
    return safeGet(CACHE_KEYS.LOCKED_MONTHS) || {};
  },

  saveLockedMonths(lockedData, replace = false) {
    if (!lockedData || typeof lockedData !== 'object') return;
    if (replace) {
      safeSet(CACHE_KEYS.LOCKED_MONTHS, lockedData);
    } else {
      const existing = safeGet(CACHE_KEYS.LOCKED_MONTHS) || {};
      const merged = { ...existing, ...lockedData };
      safeSet(CACHE_KEYS.LOCKED_MONTHS, merged);
    }
    this.notifyUpdate('lockedMonths');
  },

  getAttendanceHistory() {
    return safeGet(CACHE_KEYS.ATTENDANCE_HISTORY) || [];
  },

  saveAttendanceRows(newRows) {
    if (!Array.isArray(newRows) || newRows.length === 0) return;
    const existing = safeGet(CACHE_KEYS.ATTENDANCE_HISTORY) || [];
    const index = new Map();
    // Index existing
    existing.forEach(r => {
      const key = `${r.id || r.rawId || r.name}_${r.date}`;
      index.set(key, r);
    });
    // Merge new rows (newest overwrites)
    newRows.forEach(r => {
      const key = `${r.id || r.rawId || r.name}_${r.date}`;
      index.set(key, { ...(index.get(key) || {}), ...r });
    });
    // Keep up to 6000 rows across all months
    const merged = Array.from(index.values()).slice(-6000);
    safeSet(CACHE_KEYS.ATTENDANCE_HISTORY, merged);
    this.notifyUpdate('attendance');
  },

  getHrRecords() {
    return safeGet(CACHE_KEYS.HR_RECORDS);
  },

  saveHrRecords(data) {
    if (!data || typeof data !== 'object') return;
    const existing = safeGet(CACHE_KEYS.HR_RECORDS) || {};
    const payload = {
      ...existing,
      ...data,
      timestamp: Date.now()
    };
    safeSet(CACHE_KEYS.HR_RECORDS, payload);
    this.notifyUpdate('hrRecords');
  },

  getTeamLeave() {
    return safeGet(CACHE_KEYS.TEAM_LEAVE) || [];
  },

  saveTeamLeave(data) {
    if (!Array.isArray(data)) return;
    safeSet(CACHE_KEYS.TEAM_LEAVE, data);
    this.notifyUpdate('teamLeave');
  },

  notifyUpdate(type) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('peopleos-cache-sync', { detail: { type, timestamp: Date.now() } }));
    }
  },

  clearAll() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    Object.values(CACHE_KEYS).forEach(k => localStorage.removeItem(k));
  }
};

if (typeof window !== 'undefined') {
  window.PeopleOSCache = CacheManager;
}
