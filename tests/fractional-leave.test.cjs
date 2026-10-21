const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing Backend Fractional Split Leave & Two-Tier Approval ---');

const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
const r = runtime(gasCode);

function employee(name, role, manager = '') {
  const row = Array(43).fill('');
  Object.assign(row, {
    0: name,
    1: 'Active',
    2: name.toLowerCase(),
    3: 'pass123',
    4: role,
    5: 3500,
    12: '2024-01-01',
    13: '2024-04-01',
    23: '[]',
    24: 'EMP-' + name,
    27: manager,
    30: 1
  });
  return row;
}

r.set('Staff', [
  Array(43).fill('header'),
  employee('ADMIN', 'Admin'),
  employee('MANAGER', 'HOD'),
  employee('ALICE', 'User', 'MANAGER'),
  employee('BOB', 'User', '')
]);

r.set('Leave', [Array(15).fill('header')]);
r.set('Holidays', [['Date', 'Name']]);
r.set('Data', [Array(7).fill('header')]);
r.set('Attendance', [Array(15).fill('header')]);
r.set('LockedMonths', [['Month', 'Data JSON']]);
r.set('Payroll', [Array(16).fill('header')]);

const tokens = {};
for (const name of ['ADMIN', 'MANAGER', 'ALICE', 'BOB']) {
  const loginRes = r.request('login', { username: name.toLowerCase(), password: 'pass123' });
  assert.equal(loginRes.status, 'success', `Login failed for ${name}`);
  tokens[name] = loginRes.sessionToken;
}

const req = (who, action, payload = {}) => r.request(action, payload, tokens[who]);
const ok = res => {
  assert.equal(res.status, 'success', res.message || 'Operation failed');
  return res.data;
};

// Seed verified Annual Leave opening balances of 10.0 days for ALICE and BOB
ok(req('ADMIN', 'hrSave', {
  module: 'leaveOpeningBalances',
  record: {
    employee: 'ALICE',
    year: 2026,
    category: 'Annual',
    effectiveDate: '2026-01-01',
    days: 10.0,
    historyMode: 'Exclude existing test records',
    title: 'Verified 2026 opening'
  }
}));

ok(req('ADMIN', 'hrSave', {
  module: 'leaveOpeningBalances',
  record: {
    employee: 'BOB',
    year: 2026,
    category: 'Annual',
    effectiveDate: '2026-01-01',
    days: 10.0,
    historyMode: 'Exclude existing test records',
    title: 'Verified 2026 opening'
  }
}));

// Verify initial AL balances
const aliceInit = ok(req('ALICE', 'leaveOverview'));
assert.equal(aliceInit.alBalance, 10.0, 'ALICE initial AL balance should be 10.0');

const bobInit = ok(req('BOB', 'leaveOverview'));
assert.equal(bobInit.alBalance, 10.0, 'BOB initial AL balance should be 10.0');

// --- Test 1: Fractional Split Leave Submission for employee with Manager (ALICE -> MANAGER -> ADMIN) ---
const splitPayload = {
  type: 'fractional_split',
  leaveType: 'fractional_split',
  startDate: '2026-11-10',
  endDate: '2026-11-10',
  totalDays: 1.0,
  annualDays: 0.16,
  unpaidDays: 0.84,
  reason: 'Medical procedure split'
};

const submitAlice = req('ALICE', 'submitLeave', splitPayload);
assert.equal(submitAlice.status, 'success', `Submit split leave failed: ${submitAlice.message}`);

let rowIdx = r.sheets.Leave.rows.length;
let leaveRow = r.sheets.Leave.rows[rowIdx - 1];

// Verify initial status is pending_hod because ALICE reports to MANAGER
assert.equal(leaveRow[8], 'pending_hod', 'Employee with manager must start at pending_hod');
assert.equal(Number(leaveRow[12]), 0.16, 'annualDays must be stored in col 13');
assert.equal(Number(leaveRow[13]), 0.84, 'unpaidDays must be stored in col 14');

// Tier 1: HOD Approval (MANAGER)
// ALICE cannot approve own leave
const selfApprove = req('ALICE', 'updateLeaveStatus', { rowIndex: rowIdx, newStatus: 'Approved' });
assert.equal(selfApprove.status, 'error', 'ALICE cannot approve own leave');

// MANAGER approves -> status transitions to pending_admin
const hodApprove = req('MANAGER', 'updateLeaveStatus', {
  rowIndex: rowIdx,
  newStatus: 'Approved',
  approverRemark: 'HOD endorsed'
});
assert.equal(hodApprove.status, 'success', `HOD approval failed: ${hodApprove.message}`);

leaveRow = r.sheets.Leave.rows[rowIdx - 1];
assert.equal(leaveRow[8], 'pending_admin', 'HOD approval must transition pending_hod to pending_admin');

// At pending_admin, AL balance must NOT yet be deducted
const aliceMid = ok(req('ALICE', 'leaveOverview'));
assert.equal(aliceMid.alBalance, 10.0, 'AL balance must not be deducted while pending admin');

// Tier 2: Admin Approval (ADMIN)
const adminApprove = req('ADMIN', 'updateLeaveStatus', {
  rowIndex: rowIdx,
  newStatus: 'Approved',
  approverRemark: 'Admin final approval'
});
assert.equal(adminApprove.status, 'success', `Admin approval failed: ${adminApprove.message}`);

leaveRow = r.sheets.Leave.rows[rowIdx - 1];
assert.equal(leaveRow[8], 'approved', 'Admin approval must transition pending_admin to approved');

// On final approval: annualDays (0.16) deducted from AL balance -> 9.84
const aliceFinal = ok(req('ALICE', 'leaveOverview'));
assert.equal(aliceFinal.alBalance, 9.84, 'Annual leave balance must deduct exact fractional 0.16 days to 9.84');

// Verify unpaidDays (0.84) tagged for NPL salary deduction
assert.equal(Number(leaveRow[13]), 0.84, 'Unpaid days must remain 0.84');
assert.ok(leaveRow[14] && leaveRow[14].includes('NPL'), 'Must be tagged for NPL deduction');

// --- Test 2: Employee without manager directly starts at pending_admin (BOB) ---
const bobPayload = {
  type: 'fractional_split',
  leaveType: 'fractional_split',
  startDate: '2026-11-12',
  endDate: '2026-11-12',
  totalDays: 1.0,
  annualDays: 0.50,
  unpaidDays: 0.50,
  reason: 'Family matters'
};

const submitBob = req('BOB', 'submitLeave', bobPayload);
assert.equal(submitBob.status, 'success', `Submit bob split failed: ${submitBob.message}`);

rowIdx = r.sheets.Leave.rows.length;
leaveRow = r.sheets.Leave.rows[rowIdx - 1];

// BOB has no manager -> starts directly at pending_admin
assert.equal(leaveRow[8], 'pending_admin', 'Employee without manager must start at pending_admin');

// Admin approves BOB
const adminApproveBob = req('ADMIN', 'updateLeaveStatus', {
  rowIndex: rowIdx,
  newStatus: 'Approved'
});
assert.equal(adminApproveBob.status, 'success');

leaveRow = r.sheets.Leave.rows[rowIdx - 1];
assert.equal(leaveRow[8], 'approved', 'Admin approval transitions pending_admin to approved');

const bobFinal = ok(req('BOB', 'leaveOverview'));
assert.equal(bobFinal.alBalance, 9.50, 'BOB AL balance deducted by 0.50 to 9.50');

// --- Test 3: Rejection Workflow ---
const rejectPayload = {
  type: 'fractional_split',
  leaveType: 'fractional_split',
  startDate: '2026-11-25',
  endDate: '2026-11-25',
  totalDays: 1.0,
  annualDays: 0.20,
  unpaidDays: 0.80,
  reason: 'Personal'
};

ok(req('ALICE', 'submitLeave', rejectPayload));
rowIdx = r.sheets.Leave.rows.length;

// MANAGER rejects
const rejectRes = req('MANAGER', 'updateLeaveStatus', {
  rowIndex: rowIdx,
  newStatus: 'Rejected',
  approverRemark: 'Critical sprint deadline'
});
assert.equal(rejectRes.status, 'success');

leaveRow = r.sheets.Leave.rows[rowIdx - 1];
assert.equal(leaveRow[8], 'rejected', 'Rejection must set status to rejected');

// Balance remains 9.84 (no deduction on rejection)
const aliceAfterReject = ok(req('ALICE', 'leaveOverview'));
assert.equal(aliceAfterReject.alBalance, 9.84, 'AL balance must remain unchanged after rejection');

// --- Test 4: Validation & Boundary Checks ---
// 1. Exceeding available AL balance in annualDays
const overBalPayload = {
  type: 'fractional_split',
  leaveType: 'fractional_split',
  startDate: '2026-12-01',
  endDate: '2026-12-10',
  totalDays: 10.0,
  annualDays: 9.90, // Alice only has 9.84 left
  unpaidDays: 0.10,
  reason: 'Excess'
};
const overBalRes = req('ALICE', 'submitLeave', overBalPayload);
assert.equal(overBalRes.status, 'error', 'annualDays exceeding AL balance must be rejected');
assert.match(overBalRes.message, /balance/i);

// 2. Mismatched total days (annualDays + unpaidDays !== totalDays)
const mismatchPayload = {
  type: 'fractional_split',
  leaveType: 'fractional_split',
  startDate: '2026-12-15',
  endDate: '2026-12-15',
  totalDays: 1.0,
  annualDays: 0.16,
  unpaidDays: 0.50, // 0.16 + 0.50 = 0.66 !== 1.0
  reason: 'Mismatch'
};
const mismatchRes = req('ALICE', 'submitLeave', mismatchPayload);
assert.equal(mismatchRes.status, 'error', 'Mismatched split days must be rejected');

// 3. Negative split values
const negPayload = {
  type: 'fractional_split',
  leaveType: 'fractional_split',
  startDate: '2026-12-20',
  endDate: '2026-12-20',
  totalDays: 1.0,
  annualDays: -0.5,
  unpaidDays: 1.5,
  reason: 'Negative'
};
const negRes = req('ALICE', 'submitLeave', negPayload);
assert.equal(negRes.status, 'error', 'Negative split days must be rejected');

console.log('PASS: fractional-leave.test.cjs - All fractional split and two-tier approval tests verified.');
