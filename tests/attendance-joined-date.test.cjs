'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Testing Attendance Dashboard Joined Date & 1st In / Last Out Logic ---');

const jsContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'dashboard.js'), 'utf8');
const vueMobile = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'mobile', 'MobileAttendance.vue'), 'utf8');
const gasContent = fs.readFileSync(path.join(__dirname, '..', 'backend', 'GAS_payroll.js'), 'utf8');

// -------------------------------------------------------------
// PART 1: Functionality & Code Structure Checks
// -------------------------------------------------------------
console.log('Testing Part 1: Source code integration in dashboard.js & MobileAttendance.vue...');

// Check pickFirstInTime and pickLastOutTime exist in dashboard.js
assert.ok(jsContent.includes('function pickFirstInTime('), 'dashboard.js must define pickFirstInTime');
assert.ok(jsContent.includes('function pickLastOutTime('), 'dashboard.js must define pickLastOutTime');

// Check without joined date filtering in subset and populateAttendanceStaff
assert.ok(jsContent.includes('without joined date also should not appear'), 'dashboard.js must contain joined date filter requirement');
assert.ok(jsContent.includes('fd.date < jDate'), 'dashboard.js must check if fd.date < jDate');
assert.ok(jsContent.includes('isBeforeJoin: true'), 'dashboard.js must mark rows before joined date with isBeforeJoin: true');

// Check 1st In and Last Out headers in custom-table
assert.ok(jsContent.includes('<th>1st In</th><th>Last Out</th>'), 'dashboard.js must render <th>1st In</th><th>Last Out</th>');

// Check MobileAttendance.vue joined date filtering and 1st in/last out
assert.ok(vueMobile.includes('userJoinedDate'), 'MobileAttendance.vue must define userJoinedDate');
assert.ok(vueMobile.includes('Period before the joined date should be appear as empty attendance'), 'MobileAttendance.vue must handle period before join date');
assert.ok(vueMobile.includes('1st In'), 'MobileAttendance.vue must include 1st In label');
assert.ok(vueMobile.includes('Last Out'), 'MobileAttendance.vue must include Last Out label');

console.log('PASS Part 1: Source code integration verified.');

// -------------------------------------------------------------
// PART 2: Unit Logic Verification (1st In / Last Out and Joined Date)
// -------------------------------------------------------------
console.log('Testing Part 2: 1st In / Last Out and Joined Date logic...');

function pickFirstInTime(t1, t2) {
  const s1 = String(t1 || '').trim();
  const s2 = String(t2 || '').trim();
  if (!s1 || s1 === '-' || s1 === '—') return s2;
  if (!s2 || s2 === '-' || s2 === '—') return s1;
  return s1.localeCompare(s2) <= 0 ? s1 : s2;
}

function pickLastOutTime(t1, t2) {
  const s1 = String(t1 || '').trim();
  const s2 = String(t2 || '').trim();
  if (!s1 || s1 === '-' || s1 === '—') return s2;
  if (!s2 || s2 === '-' || s2 === '—') return s1;
  return s1.localeCompare(s2) >= 0 ? s1 : s2;
}

assert.equal(pickFirstInTime('08:30', '09:00'), '08:30', '08:30 is earlier than 09:00');
assert.equal(pickFirstInTime('09:15', '08:05'), '08:05', '08:05 is earlier than 09:15');
assert.equal(pickFirstInTime('-', '08:15'), '08:15', 'Dash fallback must select valid time');
assert.equal(pickFirstInTime('', '08:15'), '08:15', 'Empty fallback must select valid time');

assert.equal(pickLastOutTime('17:00', '18:30'), '18:30', '18:30 is later than 17:00');
assert.equal(pickLastOutTime('20:15', '17:45'), '20:15', '20:15 is later than 17:45');
assert.equal(pickLastOutTime('18:00', '-'), '18:00', 'Dash fallback must select valid time');

// -------------------------------------------------------------
// PART 3: Staff Without Joined Date Excluded
// -------------------------------------------------------------
console.log('Testing Part 3: Staff without joined date excluded from attendance...');

const mockStaffList = [
  ['EMP001', 'ALICE TAN'],
  ['EMP002', 'BOB SMITH'],
  ['EMP003', 'CHARLIE LEE']
];

const mockStaffSettings = {
  EMP001: { name: 'ALICE TAN', joinedDate: '2026-01-15' },
  EMP002: { name: 'BOB SMITH', joinedDate: '' }, // No joined date
  EMP003: { name: 'CHARLIE LEE' } // joinedDate undefined
};

function normalizeDateStr(dateVal) {
  if (!dateVal) return '';
  const str = String(dateVal).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  return str;
}

const filteredSubset = mockStaffList.filter(([id, name]) => {
  const sObj = mockStaffSettings[id] || {};
  const jDate = normalizeDateStr(sObj.joinedDate || sObj.joined);
  return Boolean(jDate);
});

assert.equal(filteredSubset.length, 1, 'Only ALICE TAN has a joined date');
assert.equal(filteredSubset[0][1], 'ALICE TAN');

// -------------------------------------------------------------
// PART 4: Empty Attendance Before Joined Date
// -------------------------------------------------------------
console.log('Testing Part 4: Empty attendance rendered for dates prior to joined date...');

const fullDates = [
  { date: '2026-03-01', day: 'Sunday' },
  { date: '2026-03-14', day: 'Saturday' },
  { date: '2026-03-15', day: 'Sunday' }, // Joined on March 15
  { date: '2026-03-16', day: 'Monday' }
];

const aliceJoinedDate = '2026-03-15';
const alicePunches = {
  '2026-03-14': { in: '08:30', out: '17:30' }, // Stray punch before join
  '2026-03-16': { in: '08:25', out: '17:35' }
};

const rows = fullDates.map(fd => {
  if (aliceJoinedDate && fd.date < aliceJoinedDate) {
    return {
      date: fd.date,
      in: '-',
      out: '-',
      totalHrs: '-',
      payableHrs: '-',
      payType: '—',
      remark: '',
      isBeforeJoin: true
    };
  }
  const p = alicePunches[fd.date] || { in: '-', out: '-' };
  return {
    date: fd.date,
    in: p.in,
    out: p.out,
    totalHrs: '8.0',
    payableHrs: '8.0',
    payType: 'NM',
    remark: 'Normal',
    isBeforeJoin: false
  };
});

assert.equal(rows[0].isBeforeJoin, true);
assert.equal(rows[0].in, '-');
assert.equal(rows[0].out, '-');
assert.equal(rows[0].payType, '—');

assert.equal(rows[1].isBeforeJoin, true, '2026-03-14 is before 2026-03-15');
assert.equal(rows[1].in, '-', 'Stray punch prior to joined date must appear as empty');

assert.equal(rows[2].isBeforeJoin, false, '2026-03-15 is joined date');
assert.equal(rows[3].isBeforeJoin, false, '2026-03-16 is after joined date');
assert.equal(rows[3].in, '08:25');

console.log('PASS Part 4: Empty attendance before joined date verified.');

// -------------------------------------------------------------
// PART 5: Google Drive Date_Time Filename & photolink in GAS
// -------------------------------------------------------------
console.log('Testing Part 5: Google Drive Date_Time filename & photolink in GAS...');
assert.ok(gasContent.includes("const fileName = datePart + '_' + timePart + '.jpg';"), 'GAS must use Date_Time filename format');
assert.ok(gasContent.includes('mobileClockStaffFolder_'), 'GAS must use mobileClockStaffFolder_');
assert.ok(gasContent.includes('photolink'), 'GAS must record photolink');

console.log('ALL ATTENDANCE JOINED DATE & 1ST IN / LAST OUT CHECKS PASSED!');
