const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runtime } = require('./backend.test.cjs');

console.log('--- Testing Biometric ID Save & Reporting Line Cycle Recovery ---');

// -------------------------------------------------------------
// PART 1: Backend GAS_payroll.js Cycle Detection Verification
// -------------------------------------------------------------
console.log('Testing Part 1: Backend reporting line cycle detection and root self-loops...');

const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
const b = runtime(gasCode);

function employee(name, role, manager = '', biometricId = '') {
  const row = Array(44).fill('');
  Object.assign(row, {
    0: name,
    1: 'Active',
    2: name.toLowerCase(),
    3: 'pass123',
    4: role,
    5: 3500,
    23: '[]',
    24: 'EMP-' + name,
    27: manager,
    30: 1,
    43: biometricId
  });
  return row;
}

// Setup staff where ADMIN reports to ADMIN (self-reporting root)
b.set('Staff', [
  Array(44).fill('header'),
  employee('ADMIN', 'Admin', 'ADMIN'), // Self-reporting top root
  employee('HOD_KENNY', 'HOD', 'ADMIN'),
  employee('SQ002', 'User', 'HOD_KENNY', '711005'),
  employee('SUB_MGR', 'HOD', 'SQ002')
]);

const adminLogin = b.request('login', { username: 'admin', password: 'pass123' });
assert.equal(adminLogin.status, 'success');
const adminToken = adminLogin.sessionToken;

// 1. Saving SQ002 whose manager chain has a self-reporting root (ADMIN -> ADMIN) must succeed!
const saveSq002Res = b.request('saveSingleStaff', {
  name: 'SQ002',
  biometricId: '711005',
  manager: 'HOD_KENNY',
  status: 'Active'
}, adminToken);
assert.equal(saveSq002Res.status, 'success', `Saving SQ002 should succeed with self-reporting root: ${saveSq002Res.message}`);

const staffData = b.get('getStaff').data;
assert.equal(staffData['SQ002'].biometricId, '711005', 'SQ002 biometric ID must be saved');

// 2. Direct cycle (SQ002 tries to report to SUB_STAFF who reports to SQ002) must be strictly caught!
const cycleRes = b.request('saveSingleStaff', {
  name: 'SQ002',
  biometricId: '711005',
  manager: 'SUB_MGR',
  status: 'Active'
}, adminToken);
assert.equal(cycleRes.status, 'error', 'Cycle must be rejected');
assert.match(cycleRes.message, /Reporting lines cannot contain a cycle/, 'Must return cycle error message');

// 3. Testing isQuickSave with biometricId
const quickSaveRes = b.request('saveSingleStaff', {
  name: 'SQ002',
  biometricId: '711099',
  isQuickSave: true
}, adminToken);
assert.equal(quickSaveRes.status, 'success', 'isQuickSave should succeed');
const staffData2 = b.get('getStaff').data;
assert.equal(staffData2['SQ002'].biometricId, '711099', 'isQuickSave must update biometricId');

console.log('PASS Part 1: Cycle detection, root self-reporting, and quickSave verified.');

// -------------------------------------------------------------
// PART 2: Frontend Markup & dashboardActions Verification
// -------------------------------------------------------------
console.log('Testing Part 2: Frontend button and actions integration...');

const vueSource = fs.readFileSync(path.join(__dirname, '../src/components/PayrollDashboard.vue'), 'utf8');
assert.ok(vueSource.includes('id="btnQuickSaveBio"'), 'btnQuickSaveBio must exist in PayrollDashboard.vue');
assert.ok(vueSource.includes('saveBiometricLocally'), 'saveBiometricLocally must be bound in PayrollDashboard.vue');

const jsSource = fs.readFileSync(path.join(__dirname, '../src/services/dashboard.js'), 'utf8');
assert.ok(jsSource.includes('async function saveBiometricLocally()'), 'saveBiometricLocally must be implemented in dashboard.js');
assert.ok(jsSource.includes('saveBiometricLocally,'), 'saveBiometricLocally must be exported in dashboardActions');
assert.ok(jsSource.includes('Reporting line cycle conflict detected'), 'Graceful cycle prompt must exist in saveStaffProfile');
assert.ok(jsSource.includes('title="Biometric Clock Machine ID"'), 'Biometric ID badge must be rendered in staff management listing');

console.log('PASS Part 2: Frontend markup, action bindings, and recovery handlers verified.');

console.log('\nALL BIOMETRIC CYCLE & RECOVERY TESTS PASSED SUCCESSFULLY!\n');
