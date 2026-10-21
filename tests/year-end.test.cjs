const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing Year-End Rollover Tool (Backend & Authorization) ---');

const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
const r = runtime(gasCode);

function staff(name, role, joinedDate = '2024-01-01', alEntitlement = 14, companyId = 'CMP1') {
  const row = Array(43).fill('');
  Object.assign(row, {
    0: name,
    1: 'Active',
    2: name.toLowerCase(),
    3: 'pass123',
    4: role,
    5: 3500,
    12: joinedDate,
    13: joinedDate,
    21: alEntitlement,
    24: 'EMP-' + name,
    25: companyId,
    30: 1
  });
  return row;
}

r.set('Staff', [
  Array(43).fill('header'),
  staff('ADMIN', 'Admin', '2020-01-01', 16, 'CMP1'),
  staff('HR_USER', 'HR', '2022-01-01', 14, 'CMP1'),
  staff('MANAGER', 'HOD', '2021-01-01', 15, 'CMP1'),
  staff('ALICE', 'User', '2024-01-01', 12, 'CMP1'), // 3 completed years in 2027 -> 14 days new entitlement
  staff('BOB', 'User', '2026-06-01', 12, 'CMP1')
]);

r.set('Leave', [Array(15).fill('header')]);
r.set('Holidays', [['Date', 'Name']]);
r.set('Data', [Array(7).fill('header')]);
r.set('Attendance', [Array(15).fill('header')]);
r.set('LockedMonths', [['Month', 'Data JSON']]);
r.set('Payroll', [Array(16).fill('header')]);

// Seed ALICE with 18 days unutilized leave for 2026 in HR_leaveOpeningBalances
r.set('HR_leaveOpeningBalances', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  [
    'op-alice-2026',
    1,
    'ALICE',
    'Active',
    JSON.stringify({
      id: 'op-alice-2026',
      employee: 'ALICE',
      year: 2026,
      category: 'Annual',
      effectiveDate: '2026-01-01',
      days: 18.0,
      title: '2026 Opening'
    }),
    '2026-01-01T00:00:00Z',
    'ADMIN'
  ]
]);

const tokens = {};
for (const name of ['ADMIN', 'HR_USER', 'MANAGER', 'ALICE', 'BOB']) {
  const loginRes = r.request('login', { username: name.toLowerCase(), password: 'pass123' });
  assert.equal(loginRes.status, 'success', `Login failed for ${name}`);
  tokens[name] = loginRes.sessionToken;
}

const req = (who, action, payload = {}) => r.request(action, payload, tokens[who]);

// 1. Authorization checks: only Admin or HR can call previewYearEndClose and executeYearEndClose
console.log('Testing authorization checks...');

const unauthPreview = r.request('previewYearEndClose', { companyId: 'CMP1', fromYear: 2026, toYear: 2027 }, 'bad-token');
assert.equal(unauthPreview.status, 'error', 'Unauthenticated previewYearEndClose must be rejected');

const alicePreview = req('ALICE', 'previewYearEndClose', { companyId: 'CMP1', fromYear: 2026, toYear: 2027 });
assert.equal(alicePreview.status, 'error', 'Non-admin/non-HR user ALICE must be rejected from previewYearEndClose');
assert.match(alicePreview.message, /Admin|HR|unauthorized|access/i);

const managerPreview = req('MANAGER', 'previewYearEndClose', { companyId: 'CMP1', fromYear: 2026, toYear: 2027 });
assert.equal(managerPreview.status, 'error', 'HOD user MANAGER must be rejected from previewYearEndClose');

const aliceExecute = req('ALICE', 'executeYearEndClose', { companyId: 'CMP1', fromYear: 2026, toYear: 2027 });
assert.equal(aliceExecute.status, 'error', 'Non-admin/non-HR user ALICE must be rejected from executeYearEndClose');

// 2. previewYearEndClose by HR_USER and ADMIN
console.log('Testing previewYearEndClose...');

const hrPreviewRes = req('HR_USER', 'previewYearEndClose', { companyId: 'CMP1', fromYear: 2026, toYear: 2027 });
assert.equal(hrPreviewRes.status, 'success', `HR previewYearEndClose failed: ${hrPreviewRes.message}`);

const previewRes = req('ADMIN', 'previewYearEndClose', { companyId: 'CMP1', fromYear: 2026, toYear: 2027 });
assert.equal(previewRes.status, 'success', `Admin previewYearEndClose failed: ${previewRes.message}`);

const previewList = Array.isArray(previewRes.data) ? previewRes.data : previewRes.data.preview;
assert.ok(Array.isArray(previewList), 'Preview must return an array of employee rows');

const aliceRow = previewList.find(row => (row.employee || row.employeeName) === 'ALICE');
assert.ok(aliceRow, 'ALICE must be present in preview list');

// Verify unutilized AL = 18 days
const unutilized = Number(aliceRow.unutilized ?? aliceRow.unutilizedAL);
assert.equal(unutilized, 18.0, 'ALICE unutilized AL should be 18.0 days');

// Verify standard carry forward <= 14 days, expiry <toYear>-12-31
assert.equal(Number(aliceRow.standardCarryForward), 14.0, 'Standard carry forward must cap at 14 days');
assert.equal(aliceRow.standardExpiryDate, '2027-12-31', 'Standard carry forward must expire 2027-12-31');

// Verify excess carry forward = 4 days (18 - 14), expiry <toYear>-04-30
assert.equal(Number(aliceRow.excessCarryForward), 4.0, 'Excess carry forward must be 4 days (18 - 14)');
assert.equal(aliceRow.excessExpiryDate, '2027-04-30', 'Excess carry forward must expire 2027-04-30');

// Verify new entitlement calculated from service years (12-26 days)
// Joined 2024-01-01, rolling to 2027: 3 completed years -> 14 days
assert.equal(Number(aliceRow.serviceYears), 3, 'ALICE service years in 2027 should be 3');
assert.equal(Number(aliceRow.newEntitlement), 14.0, 'ALICE new entitlement for 3 years service should be 14 days');

// Verify total opening balance = standard (14) + excess (4) + newEntitlement (14) = 32 days
const totalOpening = Number(aliceRow.totalOpeningBalance);
assert.equal(totalOpening, 32.0, 'Total opening balance should be 14 + 4 + 14 = 32.0 days');

// 3. executeYearEndClose
console.log('Testing executeYearEndClose...');

const execRes = req('ADMIN', 'executeYearEndClose', {
  companyId: 'CMP1',
  fromYear: 2026,
  toYear: 2027,
  records: previewList
});
assert.equal(execRes.status, 'success', `executeYearEndClose failed: ${execRes.message}`);

// Verify opening balances inserted into HR_leaveOpeningBalances
const openingRows = r.sheets.HR_leaveOpeningBalances.rows.slice(1);
const aliceOpening = openingRows.find(r => {
  try {
    const data = JSON.parse(r[4]);
    return data.employee === 'ALICE' && data.year === 2027 && data.category === 'Annual';
  } catch {
    return false;
  }
});
assert.ok(aliceOpening, 'ALICE 2027 opening balance record must be committed to HR_leaveOpeningBalances');

const aliceRecord = JSON.parse(aliceOpening[4]);
assert.equal(aliceRecord.days, 32.0, 'Committed opening balance days should be 32.0');
assert.equal(aliceRecord.standardCarryForward, 14.0, 'Committed record must retain standardCarryForward 14');
assert.equal(aliceRecord.standardExpiryDate, '2027-12-31', 'Committed record standardExpiryDate must be 2027-12-31');
assert.equal(aliceRecord.excessCarryForward, 4.0, 'Committed record must retain excessCarryForward 4');
assert.equal(aliceRecord.excessExpiryDate, '2027-04-30', 'Committed record excessExpiryDate must be 2027-04-30');
assert.equal(aliceRecord.newEntitlement, 14.0, 'Committed record newEntitlement must be 14');

// Verify audit logging in HR_audit
assert.ok(r.sheets.HR_audit, 'HR_audit sheet must exist');
const auditRows = r.sheets.HR_audit.rows.slice(1);
const rolloverAudit = auditRows.filter(r => {
  try {
    const data = JSON.parse(r[4]);
    return data.employee === 'ALICE' || data.module === 'leaveOpeningBalances' || data.module === 'yearEndClose';
  } catch {
    return false;
  }
});
assert.ok(rolloverAudit.length > 0, 'HR_audit must contain audit log records for the year-end close action');

console.log('PASS: year-end.test.cjs - Backend actions and authorization verified.');

// 4. Verify Frontend Files exist and meet brief criteria
console.log('--- Testing Frontend YearEndModal Component & HrWorkspace Integration ---');

const modalPath = path.join(__dirname, '../src/components/YearEndModal.vue');
assert.ok(fs.existsSync(modalPath), 'src/components/YearEndModal.vue must exist');
const modalSrc = fs.readFileSync(modalPath, 'utf8');

// Governing policy badge citation
const requiredPolicyBadge = 'Metrio Induction Policy FAM-23/G (Carry Forward Rules) & Employment Act 1955 Sec 60E';
assert.ok(modalSrc.includes(requiredPolicyBadge), `YearEndModal.vue must display governing policy citation: ${requiredPolicyBadge}`);

// Dual window carry forward rules mention
assert.ok(modalSrc.includes('31-Dec') || modalSrc.includes('31-dec'), 'YearEndModal.vue must mention 31-Dec standard carry forward expiry');
assert.ok(modalSrc.includes('30-April') || modalSrc.includes('30-Apr'), 'YearEndModal.vue must mention 30-April excess carry forward expiry');

// Form controls presence
assert.ok(modalSrc.includes('companyFilter'), 'YearEndModal.vue must include company filter');
assert.ok(modalSrc.includes('fromYear'), 'YearEndModal.vue must include fromYear control');
assert.ok(modalSrc.includes('toYear'), 'YearEndModal.vue must include toYear control');

// Table headers / columns
assert.ok(modalSrc.includes('Employee Name'), 'Preview table must have Employee Name column');
assert.ok(modalSrc.includes('Unutilized AL'), 'Preview table must have Unutilized AL column');
assert.ok(modalSrc.includes('Standard CF'), 'Preview table must have Standard CF column');
assert.ok(modalSrc.includes('Excess CF'), 'Preview table must have Excess CF column');
assert.ok(modalSrc.includes('New Entitlement'), 'Preview table must have New Entitlement column');
assert.ok(modalSrc.includes('Total Opening'), 'Preview table must have Total Opening column');

// Commit button and confirmation prompt
assert.ok(modalSrc.includes('Commit Year-End Rollover'), 'YearEndModal.vue must include Commit Year-End Rollover button');
assert.ok(modalSrc.includes('confirming'), 'YearEndModal.vue must include confirmation state/prompt before commit');

// Check integration in HrWorkspace.vue
const workspacePath = path.join(__dirname, '../src/components/HrWorkspace.vue');
assert.ok(fs.existsSync(workspacePath), 'src/components/HrWorkspace.vue must exist');
const workspaceSrc = fs.readFileSync(workspacePath, 'utf8');

assert.ok(workspaceSrc.includes('YearEndModal'), 'HrWorkspace.vue must import YearEndModal');
assert.ok(workspaceSrc.includes('<YearEndModal'), 'HrWorkspace.vue must mount <YearEndModal');
assert.ok(
  workspaceSrc.includes('openYearEndModal') || workspaceSrc.includes('showYearEndModal') || workspaceSrc.includes('Year-End Leave Rollover'),
  'HrWorkspace.vue must provide trigger button for Year-End Leave Rollover under Administration'
);

console.log('PASS: year-end.test.cjs - All Year-End Rollover backend & frontend integration tests passed.');

