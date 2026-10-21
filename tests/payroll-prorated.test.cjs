const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing Pro-Rated Payroll Engine & Month-Lock Integration ---');

const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
const r = runtime(gasCode);

function staffMember(name, role, basic, options = {}) {
  const row = Array(43).fill('');
  Object.assign(row, {
    0: name,
    1: options.status || 'Active',
    2: name.toLowerCase(),
    3: 'pass123',
    4: role,
    5: basic,
    6: parseFloat((basic / 26 / 8).toFixed(2)),
    8: options.icNo || (name + '-IC'),
    12: options.joinedDate || '2024-01-01',
    13: options.confirmDate !== undefined ? options.confirmDate : '2024-04-01',
    14: options.resignDate || '',
    23: '[]',
    24: 'EMP-' + name,
    27: options.manager || '',
    30: 1,
    36: options.age !== undefined ? options.age : 30
  });
  return row;
}

r.set('Staff', [
  Array(43).fill('header'),
  staffMember('ADMIN', 'Admin', 6000),
  staffMember('ALICE', 'User', 5200, { confirmDate: '2024-04-01', age: 30 }),
  staffMember('BOB', 'User', 4000, { joinedDate: '2026-10-14', confirmDate: '', age: 28 }),
  staffMember('SENIOR', 'User', 6000, { joinedDate: '2020-01-01', confirmDate: '2020-04-01', age: 62 }),
  staffMember('CHARLIE', 'User', 3500, { joinedDate: '2025-01-01', confirmDate: '2025-04-01', age: 25 })
]);

r.set('Leave', [
  Array(15).fill('header'),
  // ALICE: approved split leave with 1.84 days unpaid in Oct 2026
  ['REQ-1', 'ALICE', 'fractional_split', '2026-10-05', '2026-10-06', 2.0, 'Full Day', 'Medical split', 'approved', 'Admin', '', '', 0.16, 1.84, 'TAGGED_NPL_DEDUCTION'],
  // CHARLIE: approved MC leave in Dec 2026
  ['REQ-2', 'CHARLIE', 'MC', '2026-12-02', '2026-12-02', 1.0, 'Full Day', 'Fever', 'approved', 'Admin', '', '', 0, 0, '']
]);

r.set('HR_claims', [
  ['ID', 'Version', 'Employee', 'Status', 'Record JSON', 'Updated At', 'Updated By'],
  // ALICE Claim 1: Approved, on or before 20th cutoff (2026-10-15) -> RM 150.00
  ['CLM-1', 1, 'ALICE', 'Approved', JSON.stringify({
    id: 'CLM-1', version: 1, employee: 'ALICE', category: 'Medical',
    date: '2026-10-15', amount: 150.00, status: 'Approved'
  }), '2026-10-15T10:00:00Z', 'ADMIN'],
  // ALICE Claim 2: Approved, after 20th cutoff (2026-10-25) -> RM 200.00 (excluded from Oct payroll)
  ['CLM-2', 1, 'ALICE', 'Approved', JSON.stringify({
    id: 'CLM-2', version: 1, employee: 'ALICE', category: 'Optical',
    date: '2026-10-25', amount: 200.00, status: 'Approved'
  }), '2026-10-25T10:00:00Z', 'ADMIN'],
  // ALICE Claim 3: Pending manager, submitted on 2026-10-10 -> RM 80.00 (excluded, not approved)
  ['CLM-3', 1, 'ALICE', 'Pending manager', JSON.stringify({
    id: 'CLM-3', version: 1, employee: 'ALICE', category: 'Dental',
    date: '2026-10-10', amount: 80.00, status: 'Pending manager'
  }), '2026-10-10T10:00:00Z', 'ALICE']
]);

r.set('Holidays', [['Date', 'Name']]);
r.set('Data', [Array(7).fill('header')]);
r.set('Attendance', [Array(15).fill('header')]);
r.set('LockedMonths', [['Month', 'Data JSON']]);
r.set('Payroll', [Array(16).fill('header')]);

const adminLogin = r.request('login', { username: 'admin', password: 'pass123' });
assert.equal(adminLogin.status, 'success');
const adminToken = adminLogin.sessionToken;
const req = (action, payload = {}) => r.request(action, payload, adminToken);

// --- TEST 1: Pro-Rated Basic & NPL Deduction Calculations (Pure Unit Logic) ---
const statutory = require('../src/services/statutory.cjs');

// Test 1a: Pro-rated basic calculation
// Basic RM 4,000 / 26 days * 13 worked days = RM 2,000.00
const basicSalary = 4000;
const workedDays = 13;
const totalWorkingDays = 26;
const proratedBasic = Math.round((basicSalary * (workedDays / totalWorkingDays)) * 100) / 100;
assert.equal(proratedBasic, 2000.00, 'Pro-rated basic for 13/26 days should be RM 2,000.00');

// Test 1b: Fractional NPL deduction
// Basic RM 5,200 / 26 days = RM 200.00 daily rate
// 1.84 unpaid days * RM 200.00 = RM 368.00 deduction
// Pro-rated gross = RM 5,200 - RM 368 = RM 4,832.00
const aliceBasic = 5200;
const unpaidDays = 1.84;
const dailyRate = aliceBasic / 26;
const nplDeduction = Math.round(dailyRate * unpaidDays * 100) / 100;
const proratedGross = aliceBasic - nplDeduction;
assert.equal(dailyRate, 200.00, 'Daily rate should be RM 200.00');
assert.equal(nplDeduction, 368.00, 'NPL deduction should be RM 368.00');
assert.equal(proratedGross, 4832.00, 'Pro-rated gross should be RM 4,832.00');

// --- TEST 2: lockMonth Integration for October 2026 ---
// Pass workedDays overrides in payload if needed, or let engine calculate
const lockOctRes = req('lockMonth', {
  month: '2026-10',
  workedDays: {
    BOB: 13 // BOB joined mid-month (13 of 26 working days)
  }
});

assert.equal(lockOctRes.status, 'success', `lockMonth failed: ${lockOctRes.message}`);

// Verify Leave sheet NPL tag transition: TAGGED_NPL_DEDUCTION -> LOCKED_NPL_DEDUCTED
const leaveRows = r.sheets.Leave.rows;
const aliceLeave = leaveRows.find(row => row[1] === 'ALICE' && row[0] === 'REQ-1');
assert.ok(aliceLeave, 'ALICE leave record must exist');
assert.equal(aliceLeave[14], 'LOCKED_NPL_DEDUCTED', 'Unpaid leave tag must transition to LOCKED_NPL_DEDUCTED');

// Verify HR_claims: CLM-1 (<= 20th) transitioned to Paid with ref PAYROLL-2026-10
const claimRows = r.sheets.HR_claims.rows.slice(1);
const clm1Row = claimRows.find(row => row[0] === 'CLM-1');
assert.ok(clm1Row, 'CLM-1 must exist');
assert.equal(clm1Row[3], 'Paid', 'CLM-1 status must transition to Paid');
const clm1Json = JSON.parse(clm1Row[4]);
assert.equal(clm1Json.status, 'Paid', 'CLM-1 record JSON status must be Paid');
assert.equal(clm1Json.paymentReference, 'PAYROLL-2026-10', 'CLM-1 paymentReference must be PAYROLL-2026-10');

// Verify CLM-2 (> 20th) remains Approved and unpaid
const clm2Row = claimRows.find(row => row[0] === 'CLM-2');
assert.equal(clm2Row[3], 'Approved', 'CLM-2 submitted after 20th must remain Approved');

// Verify CLM-3 (Pending manager) remains Pending manager
const clm3Row = claimRows.find(row => row[0] === 'CLM-3');
assert.equal(clm3Row[3], 'Pending manager', 'CLM-3 must remain Pending manager');

// Verify Payroll Sheet records
const payrollRows = r.sheets.Payroll.rows.slice(1);
assert.ok(payrollRows.length >= 4, 'Payroll records should be generated for active staff');

// ALICE Payroll verification
const alicePay = payrollRows.find(row => row[2] === 'ALICE' && row[0] === '2026-10');
assert.ok(alicePay, 'ALICE payroll row must exist');
assert.equal(Number(alicePay[3]), 5200, 'Basic salary should be 5200');
// Gross pay = 5200 - 368 (NPL) = 4832
assert.equal(Number(alicePay[6]), 4832.00, 'ALICE gross pay must reflect NPL deduction: 5200 - 368 = 4832.00');

// Statutory calculations on gross RM 4,832.00
const expAliceEpf = statutory.calculateEpf(4832, 30);
const expAliceSocso = statutory.calculateSocso(4832, 30);
const expAliceEis = statutory.calculateEis(4832, 30);
const expAlicePcb = statutory.calculatePcb(4832, expAliceEpf.employee, 0, 30);

assert.equal(Number(alicePay[7]), expAliceEpf.employee, 'ALICE EPF EE deduction');
assert.equal(Number(alicePay[8]), expAliceSocso.employee, 'ALICE SOCSO EE deduction');
assert.equal(Number(alicePay[9]), expAliceEis.employee, 'ALICE EIS EE deduction');
assert.equal(Number(alicePay[11]), expAliceEpf.employer, 'ALICE EPF ER contribution');
assert.equal(Number(alicePay[12]), expAliceSocso.employer, 'ALICE SOCSO ER contribution');
assert.equal(Number(alicePay[13]), expAliceEis.employer, 'ALICE EIS ER contribution');

// Nett pay = gross - epfEE - socsoEE - eisEE - pcb + claimsReimbursement (150.00)
const expAliceTotalDed = expAliceEpf.employee + expAliceSocso.employee + expAliceEis.employee + expAlicePcb;
const expAliceNett = Math.round((4832 - expAliceTotalDed + 150.00) * 100) / 100;
assert.equal(Number(alicePay[15]), expAliceNett, `ALICE nett pay must include RM 150 claim reimbursement: expected ${expAliceNett}, got ${alicePay[15]}`);

// BOB Payroll verification (Mid-month joiner: 13 / 26 days -> RM 2,000.00)
const bobPay = payrollRows.find(row => row[2] === 'BOB' && row[0] === '2026-10');
assert.ok(bobPay, 'BOB payroll row must exist');
assert.equal(Number(bobPay[4]), 13, 'BOB worked days should be 13');
assert.equal(Number(bobPay[6]), 2000.00, 'BOB pro-rated gross pay should be 2000.00');

// SENIOR Payroll verification (Age 62 senior tiers)
const seniorPay = payrollRows.find(row => row[2] === 'SENIOR' && row[0] === '2026-10');
assert.ok(seniorPay, 'SENIOR payroll row must exist');
assert.equal(Number(seniorPay[7]), 0, 'SENIOR EPF EE should be 0% for age >= 60');
assert.equal(Number(seniorPay[11]), 240, 'SENIOR EPF ER should be 4% of 6000 = 240');
assert.equal(Number(seniorPay[8]), 0, 'SENIOR SOCSO EE should be 0 for Cat 2 (age >= 60)');
assert.ok(Number(seniorPay[12]) > 0, 'SENIOR SOCSO ER should be Cat 2 employer contribution');
assert.equal(Number(seniorPay[9]), 0, 'SENIOR EIS EE should be 0 for age >= 60');
assert.equal(Number(seniorPay[13]), 0, 'SENIOR EIS ER should be 0 for age >= 60');

// Verify LockedMonths sheet
const lockedSheetRows = r.sheets.LockedMonths.rows.slice(1);
assert.ok(lockedSheetRows.some(row => row[0] === '2026-10'), 'LockedMonths must contain 2026-10 entry');

// --- TEST 3: December Payroll & Zero-MC Award ---
const lockDecRes = req('lockMonth', { month: '2026-12' });
assert.equal(lockDecRes.status, 'success');

const decPayrollRows = r.sheets.Payroll.rows.slice(1).filter(row => row[0] === '2026-12');
assert.ok(decPayrollRows.length > 0, 'Dec payroll rows must exist');

// ALICE: Confirmed, 0 MC days in 2026 -> Receives RM 300 Zero-MC award token
const aliceDecPay = decPayrollRows.find(row => row[2] === 'ALICE');
assert.ok(aliceDecPay, 'ALICE Dec payroll must exist');
// ALICE basic 5200 + 300 zero MC = 5500 gross (assuming 0 NPL in Dec)
assert.equal(Number(aliceDecPay[6]), 5500.00, 'ALICE Dec gross pay should include RM 300 Zero-MC award (5200 + 300 = 5500)');

// CHARLIE: Confirmed, but took 1 MC in Dec 2026 -> 0 Zero-MC award (basic 3500)
const charlieDecPay = decPayrollRows.find(row => row[2] === 'CHARLIE');
assert.ok(charlieDecPay, 'CHARLIE Dec payroll must exist');
assert.equal(Number(charlieDecPay[6]), 3500.00, 'CHARLIE Dec gross should NOT include Zero-MC award due to 1 MC day');

// BOB: Unconfirmed (confirmDate is '') -> 0 Zero-MC award
const bobDecPay = decPayrollRows.find(row => row[2] === 'BOB');
assert.ok(bobDecPay, 'BOB Dec payroll must exist');
assert.equal(Number(bobDecPay[6]), 4000.00, 'BOB (unconfirmed) should NOT receive Zero-MC award');

// --- TEST 4: Frontend dashboard.js Statutory & Payroll Engine Integration ---
const dashboardSource = fs.readFileSync(path.join(__dirname, '../src/services/dashboard.js'), 'utf8');

// Verify statutory imports in dashboard.js
assert.match(dashboardSource, /import\s*\{\s*calculateEpf,\s*calculateSocso,\s*calculateEis,\s*calculatePcb,\s*DEFAULT_STATUTORY_CONFIG\s*\}\s*from\s*'\.\/statutory'/, 'dashboard.js must import statutory calculation engine');

// Test frontend calcStatutory function in a Node VM context
const vm = require('node:vm');
const statCtx = vm.createContext({
  calculateEpf: statutory.calculateEpf,
  calculateSocso: statutory.calculateSocso,
  calculateEis: statutory.calculateEis,
  calculatePcb: statutory.calculatePcb,
  DEFAULT_STATUTORY_CONFIG: statutory.DEFAULT_STATUTORY_CONFIG
});

const calcStatutoryCode = dashboardSource.slice(
  dashboardSource.indexOf('function calcStatutory('),
  dashboardSource.indexOf('function calculatePeriodDataRange(')
);
vm.runInContext(calcStatutoryCode, statCtx);

// Test standard age 30 calculation
const feStat30 = statCtx.calcStatutory(4832, 30);
assert.equal(feStat30.epfEmp, 532);
assert.equal(feStat30.socsoEmp, 24.25);
assert.equal(feStat30.eisEmp, 9.66);
assert.ok(feStat30.pcb !== undefined, 'PCB must be present in calcStatutory return');

// Test senior age 62 calculation (EPF EE 0, SOCSO Cat 2, EIS 0)
const feStat62 = statCtx.calcStatutory(6000, 62);
assert.equal(feStat62.epfEmp, 0, 'EPF EE 0 for senior');
assert.equal(feStat62.epfEmpr, 240, 'EPF ER 4% for senior');
assert.equal(feStat62.socsoEmp, 0, 'SOCSO EE 0 for Cat 2 senior');
assert.equal(feStat62.eisEmp, 0, 'EIS EE 0 for senior');
assert.equal(feStat62.eisEmpr, 0, 'EIS ER 0 for senior');

// Verify dashboard.js generatePayrollData contains NPL and Zero-MC logic
assert.match(dashboardSource, /nplDeduction\s*=\s*Math\.round/, 'generatePayrollData must calculate nplDeduction');
assert.match(dashboardSource, /zeroMcAward\s*=\s*300/, 'generatePayrollData must support RM 300 Zero-MC award in December');
assert.match(dashboardSource, /claimsReimbursement/, 'generatePayrollData must support claims reimbursement');

console.log('PASS: payroll-prorated.test.cjs - All pro-rated basic, fractional NPL, lockMonth integration, claims reimbursement, and Dec Zero-MC tests verified.');

