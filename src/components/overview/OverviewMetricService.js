/**
 * OverviewMetricService.js
 * 
 * Pure, tested calculation service implementing PplosHR Web Overview 2.0 KPI Data Dictionary.
 * Complies with MYT (Asia/Kuala_Lumpur) timezone boundaries, authorized role scoping,
 * and robust data normalization (no fake runtime data).
 */

const TIMEZONE = 'Asia/Kuala_Lumpur';

/**
 * Returns today's date string in MYT format (YYYY-MM-DD).
 */
export function getMytToday() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

/**
 * Normalizes any date value to YYYY-MM-DD string.
 */
export function normalizeDate(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.test(s)) {
    const clean = s.split(/[T\s]/)[0];
    const parts = clean.split(/[-/]/);
    return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
  }
  if (/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.test(s)) {
    const clean = s.split(/[T\s]/)[0];
    const parts = clean.split(/[-/]/);
    return `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
  }
  try {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const f = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
      return f.format(dt);
    }
  } catch (e) {}
  return s.slice(0, 10);
}

/**
 * Computes age in calendar days from a given date string to today (MYT).
 */
export function computeAgeDays(dateVal) {
  const norm = normalizeDate(dateVal);
  if (!norm) return 0;
  const target = new Date(norm + 'T00:00:00');
  const today = new Date(getMytToday() + 'T00:00:00');
  if (isNaN(target.getTime())) return 0;
  const diffMs = today.getTime() - target.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return isNaN(days) ? 0 : Math.max(0, days);
}

/**
 * Normalizes role for authorization and display.
 */
export function normalizeRole(role) {
  const r = String(role || '').trim();
  if (r === 'Staff') return 'User';
  if (r === 'Supervisor') return 'HOD';
  return r || 'User';
}

/**
 * M01: Annual Leave available for User.
 */
export function computeUserAlBalance(user, leaveSummary) {
  // Opening records are starting points, never an available balance. Use the
  // authenticated leaveOverview ledger calculation, including usage/adjustments.
  const annual = leaveSummary?.leaveBalances?.find(balance => balance.category === 'Annual');
  const value = annual ? annual.balance : leaveSummary?.alBalance;
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(2));
}

/**
 * M02: User today's attendance state.
 */
export function computeUserAttendanceState(user, todayRecords = [], hasSchedule = true) {
  const uName = String(user?.name || '').toUpperCase();
  const rec = (todayRecords || []).find(r => 
    String(r.name || r.employee || '').toUpperCase() === uName ||
    (user?.biometricId && String(r.id || r.biometricId) === String(user.biometricId))
  );
  if (rec && rec.in && rec.in !== '-') {
    return {
      status: 'Recorded',
      inTime: rec.in,
      outTime: rec.out && rec.out !== '-' ? rec.out : null,
      lateIn: rec.lateIn && rec.lateIn !== '-' ? rec.lateIn : null,
      isException: Boolean(rec.lateIn && rec.lateIn !== '-')
    };
  }
  if (!hasSchedule) {
    return { status: 'Unavailable', reason: 'No shift schedule configured' };
  }
  return { status: 'Pending sync', reason: 'Not clocked in yet today' };
}

/**
 * M03: User pending requests count.
 */
export function computeUserPendingRequests(user, records = {}) {
  const uName = String(user?.name || '').trim().toUpperCase();
  let count = 0;
  const breakdown = { leave: 0, claims: 0, loans: 0, bookings: 0 };

  (records.leave || []).forEach(leave => {
    const owner = String(leave.name || leave.employee || '').trim().toUpperCase();
    const status = String(leave.status || '').trim().toLowerCase();
    if (uName && owner === uName && ['pending', 'pending_hod', 'pending_admin', 'withdrawal requested'].includes(status)) {
      count++;
      breakdown.leave++;
    }
  });

  (records.claims || []).forEach(c => {
    if (String(c.employee || '').toUpperCase() === uName && String(c.status || '').startsWith('Pending')) {
      count++;
      breakdown.claims++;
    }
  });

  (records.loans || []).forEach(l => {
    if (String(l.employee || '').toUpperCase() === uName && String(l.status || '').startsWith('Pending')) {
      count++;
      breakdown.loans++;
    }
  });

  (records.bookings || []).forEach(b => {
    if (String(b.employee || '').toUpperCase() === uName && String(b.status || '').startsWith('Pending')) {
      count++;
      breakdown.bookings++;
    }
  });

  return { total: count, breakdown };
}

/**
 * M04: User remaining claim limits under Induction Policy FAM-23/G.
 */
export function computeUserClaimLimits(user, claims = [], policies = []) {
  let grade = String(user?.gradeId || user?.gradeCode || user?.grade || '').trim().toUpperCase();
  if (!grade && typeof window !== 'undefined' && window.dashboardActions && typeof window.dashboardActions.getStaffSettings === 'function') {
    const settings = window.dashboardActions.getStaffSettings() || {};
    const s = settings[user?.name];
    if (s && (s.gradeId || s.gradeCode)) {
      grade = String(s.gradeId || s.gradeCode).trim().toUpperCase();
    }
  }
  let cap = null;
  if (Array.isArray(policies) && policies.length > 0) {
    const pol = policies.find(p => 
      (!p.gradeId || String(p.gradeId).toUpperCase() === grade) &&
      (!p.category || ['Medical', 'Dental', 'Optical', 'Flexi-Wellness'].includes(p.category)) &&
      p.availability !== 'Inactive'
    );
    if (pol && (pol.annualLimit != null || pol.limit != null)) {
      cap = Number(pol.annualLimit ?? pol.limit);
    }
  }
  if (cap == null) {
    const caps = { S: 1500, M: 1000, E: 600, C: 600, W: 600 };
    cap = (grade && caps[grade] != null) ? caps[grade] : 600;
  }
  const curYear = getMytToday().slice(0, 4);
  const uName = String(user?.name || '').toUpperCase();

  const spent = (claims || [])
    .filter(c => 
      String(c.employee || '').toUpperCase() === uName && 
      String(c.date || '').slice(0, 4) === curYear &&
      ['Pending manager', 'Pending admin', 'Approved', 'Paid'].includes(c.status) &&
      ['Medical', 'Dental', 'Optical'].includes(c.category)
    )
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  const remaining = Math.max(0, cap - spent);
  return {
    cap: Number(cap.toFixed(2)),
    spent: Number(spent.toFixed(2)),
    remaining: Number(remaining.toFixed(2)),
    configured: true
  };
}

/**
 * M07: HOD Authorized Active Team Headcount.
 */
export function computeTeamHeadcount(managerUser, employees = []) {
  const mName = String(managerUser?.name || '').toUpperCase();
  const team = (employees || []).filter(e => 
    String(e.manager || '').toUpperCase() === mName && 
    e.status !== 'Resigned'
  );
  return {
    count: team.length,
    members: team
  };
}

/**
 * M08: HOD On Approved Leave Today.
 */
export function computeTeamOnLeaveToday(teamEmployees = [], teamLeave = []) {
  const today = getMytToday();
  const teamNames = new Set(teamEmployees.map(e => String(e.name || e.employee || '').toUpperCase()));
  const onLeave = (teamLeave || []).filter(l => {
    const emp = String(l.name || l.employee || '').toUpperCase();
    if (!teamNames.has(emp)) return false;
    const start = normalizeDate(l.start);
    const end = normalizeDate(l.end);
    const st = String(l.status || '').toLowerCase();
    return ['approved', 'approved'].includes(st) && start <= today && end >= today;
  });
  return {
    count: onLeave.length,
    records: onLeave
  };
}

/**
 * M10: Deduplicated Unified Action Inbox builder.
 * Returns only records that the current viewer can ACTUALLY action right now.
 */
export function buildUnifiedActionInbox(actor, records = {}, pendingAttendance = [], teamLeave = [], employees = []) {
  const actorName = String(actor?.name || '').toUpperCase();
  const role = normalizeRole(actor?.role);
  const isAdmin = ['Admin', 'HR'].includes(role);
  const items = [];
  const seenKeys = new Set();

  const teamMemberNames = new Set();
  (employees || []).forEach(e => {
    const mgr = String(e.manager || '').trim().toUpperCase();
    if (mgr && mgr === actorName) {
      teamMemberNames.add(String(e.name || e.employee || '').trim().toUpperCase());
    }
  });
  (teamLeave || []).forEach(l => {
    const empName = String(l.employee || l.name || '').trim().toUpperCase();
    if (empName && empName !== actorName) {
      teamMemberNames.add(empName);
    }
  });

  function addItem(module, id, title, employee, date, actionType, urgency = 'Normal', meta = {}) {
    const key = `${module}:${id}:${actionType}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const ageDays = computeAgeDays(date);
    items.push({
      key,
      id,
      module,
      title,
      employee,
      date: normalizeDate(date),
      ageDays,
      actionType,
      urgency: ageDays >= 3 ? 'High' : urgency,
      ...meta
    });
  }

  // 1. Claims
  (records.claims || []).forEach(c => {
    const isSelf = String(c.employee || '').toUpperCase() === actorName;
    if (isSelf) return; // Cannot approve self
    const cManager = String(c.manager || '').toUpperCase();
    const isSubordinate = cManager === actorName || teamMemberNames.has(String(c.employee || '').toUpperCase()) || isAdmin;

    if (c.status === 'Pending manager' && isSubordinate) {
      addItem('claims', c.id, `Claim: RM ${Number(c.amount||0).toFixed(2)} (${c.category||'General'})`, c.employee, c.date, 'Recommend', 'Normal', { amount: c.amount, raw: c });
    } else if (c.status === 'Pending admin' && isAdmin) {
      addItem('claims', c.id, `Claim Approval: RM ${Number(c.amount||0).toFixed(2)} (${c.category||'General'})`, c.employee, c.date, 'Approve', 'High', { amount: c.amount, raw: c });
    } else if (c.status === 'Approved' && isAdmin && !c.paymentReference) {
      addItem('claims', c.id, `Pending Payment: RM ${Number(c.amount||0).toFixed(2)}`, c.employee, c.date, 'Record Payment', 'Normal', { amount: c.amount, raw: c });
    }
  });

  // 2. Loans
  (records.loans || []).forEach(l => {
    const isSelf = String(l.employee || '').toUpperCase() === actorName;
    if (isSelf) return;
    const lManager = String(l.manager || '').toUpperCase();
    const isSubordinate = lManager === actorName || teamMemberNames.has(String(l.employee || '').toUpperCase()) || isAdmin;

    if (l.status === 'Pending manager' && isSubordinate) {
      addItem('loans', l.id, `Loan: RM ${Number(l.amount||0).toFixed(2)}`, l.employee, l.date || l.createdAt, 'Recommend', 'Normal', { raw: l });
    } else if (l.status === 'Pending admin' && isAdmin) {
      addItem('loans', l.id, `Loan Approval: RM ${Number(l.amount||0).toFixed(2)}`, l.employee, l.date || l.createdAt, 'Approve', 'High', { raw: l });
    }
  });

  // 3. Resources
  (records.bookings || []).forEach(b => {
    const isSelf = String(b.employee || '').toUpperCase() === actorName;
    if (isSelf) return;
    const bManager = String(b.manager || '').toUpperCase();
    const isSubordinate = bManager === actorName || teamMemberNames.has(String(b.employee || '').toUpperCase()) || isAdmin;

    if (/pending/i.test(b.status) && (b.status === 'Pending manager' || b.status === 'Pending') && isSubordinate) {
      addItem('bookings', b.id, `Resource: ${b.title || b.resourceId || 'Item'}`, b.employee, b.date || b.start || b.createdAt, 'Recommend', 'Normal', { raw: b });
    } else if (b.status === 'Pending admin' && isAdmin) {
      addItem('bookings', b.id, `Resource: ${b.title || b.resourceId || 'Item'}`, b.employee, b.date || b.start || b.createdAt, 'Approve', 'Normal', { raw: b });
    }
  });

  // 4. Appraisals
  (records.appraisals || []).forEach(a => {
    const aManager = String(a.manager || '').toUpperCase();
    const isSubordinate = aManager === actorName || teamMemberNames.has(String(a.employee || '').toUpperCase()) || isAdmin;
    if (a.status === 'Pending manager' && isSubordinate) {
      addItem('appraisals', a.id, `Appraisal Evaluation: ${a.employee}`, a.employee, a.date || a.createdAt, 'Review', 'Normal', { raw: a });
    }
  });

  // 5. Attendance Approvals
  (pendingAttendance || []).forEach(att => {
    addItem('attendance', att.month || att.id, `Attendance Approval · ${att.month}`, att.company || 'All Companies', att.date || att.month, att.status === 'pending_hod' ? 'Recommend' : 'Approve', 'High', { isAttendance: true, month: att.month, raw: att });
  });

  // 6. Leave Requests (teamLeave or records.leave)
  const leaveSource = (teamLeave && teamLeave.length) ? teamLeave : (records.leave || []);
  (leaveSource || []).forEach(l => {
    const applicantName = String(l.employee || l.name || '').trim().toUpperCase();
    if (!applicantName || applicantName === actorName) return; // Cannot approve self leave
    const st = String(l.status || '').trim();
    const stLower = st.toLowerCase();
    const isPendingHod = ['pending_hod', 'withdrawal requested', 'withdrawal_pending_hod'].includes(stLower);
    const isPendingAdmin = ['pending_admin', 'pending', 'withdrawal requested', 'withdrawal_pending_hr'].includes(stLower);

    const isSubordinate = teamMemberNames.has(applicantName) || role === 'HOD' || isAdmin;
    if (isPendingHod && (role === 'HOD' || isAdmin) && isSubordinate) {
      addItem('leave', l.id || `leave-${applicantName}-${l.start}`, `Leave: ${l.type || 'Leave'} (${l.days || 1}d)`, l.employee || l.name, l.date || l.start, 'Recommend', 'Normal', { raw: l, isLeave: true });
    } else if (isPendingAdmin && isAdmin) {
      addItem('leave', l.id || `leave-${applicantName}-${l.start}`, `Leave Approval: ${l.type || 'Leave'} (${l.days || 1}d)`, l.employee || l.name, l.date || l.start, 'Approve', 'High', { raw: l, isLeave: true });
    }
  });

  // Sort by aging descending (oldest first)
  items.sort((a, b) => b.ageDays - a.ageDays);
  return items;
}

/**
 * M13: HR Current Active Headcount & Department Distribution.
 */
export function computeWorkforceMetrics(employees = [], companies = [], departments = []) {
  const activeStaff = (employees || []).filter(e => e.status !== 'Resigned');
  const total = activeStaff.length;

  const deptMap = new Map();
  (departments || []).forEach(d => {
    const label = d.code && d.title && d.code !== d.title ? `${d.title} (${d.code})` : (d.title || d.code || d.id);
    deptMap.set(String(d.id), label);
    if (d.code) deptMap.set(String(d.code), label);
    if (d.name) deptMap.set(String(d.name), label);
    if (d.title) deptMap.set(String(d.title), label);
  });

  const compMap = new Map();
  (companies || []).forEach(c => {
    const label = c.title || c.name || c.code || c.id;
    compMap.set(String(c.id), label);
    if (c.code) compMap.set(String(c.code), label);
    if (c.name) compMap.set(String(c.name), label);
    if (c.title) compMap.set(String(c.title), label);
  });

  const byDept = {};
  const byGrade = {};
  const byCompany = {};
  const staffByDept = {};
  const staffByCompany = {};
  const deptBreakdownByCompany = {};
  const staffByCompanyAndDept = {};

  activeStaff.forEach(e => {
    let deptName = 'Unassigned';
    const rawDept = e.departmentId || e.department || e.departmentName || '';
    if (rawDept) {
      if (deptMap.has(String(rawDept))) {
        deptName = deptMap.get(String(rawDept));
      } else if (e.department && !deptMap.has(String(e.departmentId)) && !/^[0-9a-f-]{10,}$/i.test(e.department)) {
        deptName = e.department;
      } else {
        const matched = (departments || []).find(d => d.id === rawDept || d.code === rawDept || d.title === rawDept);
        deptName = matched ? (matched.title || matched.code || matched.id) : (rawDept === 'Unassigned' ? 'Unassigned' : rawDept);
      }
    }
    byDept[deptName] = (byDept[deptName] || 0) + 1;
    if (!staffByDept[deptName]) staffByDept[deptName] = [];
    staffByDept[deptName].push(e);

    let compName = 'Unassigned';
    const rawComp = e.companyId || e.company || e.companyName || '';
    if (rawComp) {
      if (compMap.has(String(rawComp))) {
        compName = compMap.get(String(rawComp));
      } else if (e.company && !compMap.has(String(e.companyId)) && !/^[0-9a-f-]{10,}$/i.test(e.company)) {
        compName = e.company;
      } else {
        const matched = (companies || []).find(c => c.id === rawComp || c.code === rawComp || c.title === rawComp);
        compName = matched ? (matched.title || matched.name || matched.code || matched.id) : rawComp;
      }
    }
    byCompany[compName] = (byCompany[compName] || 0) + 1;
    if (!staffByCompany[compName]) staffByCompany[compName] = [];
    staffByCompany[compName].push(e);

    if (!deptBreakdownByCompany[compName]) deptBreakdownByCompany[compName] = {};
    deptBreakdownByCompany[compName][deptName] = (deptBreakdownByCompany[compName][deptName] || 0) + 1;

    if (!staffByCompanyAndDept[compName]) staffByCompanyAndDept[compName] = {};
    if (!staffByCompanyAndDept[compName][deptName]) staffByCompanyAndDept[compName][deptName] = [];
    staffByCompanyAndDept[compName][deptName].push(e);

    const grade = e.gradeId || e.gradeCode || 'Ungraded';
    byGrade[grade] = (byGrade[grade] || 0) + 1;
  });

  return {
    total,
    activeCount: total,
    byDept,
    byGrade,
    byCompany,
    staffByDept,
    staffByCompany,
    deptBreakdownByCompany,
    staffByCompanyAndDept
  };
}

/**
 * M14: Joiners and Leavers within selected period.
 */
export function computeJoinersAndLeavers(employees = [], periodFrom, periodTo) {
  const from = periodFrom || '2026-01-01';
  const to = periodTo || getMytToday();

  const joiners = (employees || []).filter(e => {
    const j = normalizeDate(e.joinedDate);
    return j && j >= from && j <= to;
  });

  const leavers = (employees || []).filter(e => {
    const r = normalizeDate(e.resignDate);
    return r && r >= from && r <= to;
  });

  return {
    joinersCount: joiners.length,
    leaversCount: leavers.length,
    netChange: joiners.length - leavers.length,
    joiners,
    leavers
  };
}

/**
 * M16: HR Claims by Workflow State.
 */
export function computeClaimsByWorkflowState(claims = [], periodYear) {
  const yr = String(periodYear || getMytToday().slice(0, 4));
  const scoped = (claims || []).filter(c => String(c.date || '').slice(0, 4) === yr);

  let requestedRM = 0;
  let approvedRM = 0;
  let paidRM = 0;

  scoped.forEach(c => {
    const amt = Number(c.amount) || 0;
    if (['Pending manager', 'Pending admin'].includes(c.status)) {
      requestedRM += amt;
    } else if (c.status === 'Approved') {
      approvedRM += amt;
    } else if (c.status === 'Paid') {
      paidRM += amt;
    }
  });

  return {
    year: yr,
    requestedRM: Number(requestedRM.toFixed(2)),
    approvedRM: Number(approvedRM.toFixed(2)),
    paidRM: Number(paidRM.toFixed(2)),
    totalRM: Number((requestedRM + approvedRM + paidRM).toFixed(2))
  };
}

/**
 * M24: Admin Staff Data Quality Gaps.
 */
export function computeStaffDataQualityGaps(employees = []) {
  const active = (employees || []).filter(e => e.status !== 'Resigned');
  const missingDept = [];
  const missingManager = [];
  const missingGrade = [];
  const missingBiometric = [];

  active.forEach(e => {
    if (!e.departmentId && !e.department) missingDept.push(e);
    if (!e.manager && e.role !== 'Admin') missingManager.push(e);
    if (!e.gradeId && !e.gradeCode) missingGrade.push(e);
    if (!e.biometricId) missingBiometric.push(e);
  });

  return {
    totalActive: active.length,
    missingDeptCount: missingDept.length,
    missingManagerCount: missingManager.length,
    missingGradeCount: missingGrade.length,
    missingBiometricCount: missingBiometric.length,
    hasGaps: missingDept.length > 0 || missingManager.length > 0 || missingGrade.length > 0 || missingBiometric.length > 0
  };
}
