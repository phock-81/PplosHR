const { runtime } = require('./backend.test.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

console.log('--- Testing Statutory Settings Backend & Permissions ---');

const gasCode = fs.readFileSync(path.join(__dirname, '../backend/GAS_payroll.js'), 'utf8');
const r = runtime(gasCode);

function staff(name, role) {
  const a = Array(43).fill('');
  Object.assign(a, { 0: name, 1: 'Active', 2: name.toLowerCase(), 3: 'pass', 4: role, 5: 3000, 8: name + '-IC' });
  return a;
}

r.set('Staff', [
  Array(43).fill('header'),
  staff('ADMIN', 'Admin'),
  staff('HR_USER', 'HR'),
  staff('MANAGER', 'HOD'),
  staff('ALICE', 'Staff')
]);
r.set('Leave', [Array(12).fill('header')]);
r.set('Holidays', [['Date', 'Name']]);
r.set('Data', [Array(7).fill('header')]);
r.set('Attendance', [Array(15).fill('header')]);
r.set('LockedMonths', [['Month', 'Data JSON']]);
r.set('Payroll', [Array(16).fill('header')]);

const tokens = Object.fromEntries(['ADMIN', 'HR_USER', 'MANAGER', 'ALICE'].map(name => {
  const x = r.request('login', { username: name.toLowerCase(), password: 'pass' });
  assert.equal(x.status, 'success', `Login failed for ${name}`);
  assert.ok(x.sessionToken, `Missing session token for ${name}`);
  return [name, x.sessionToken];
}));

const req = (who, action, payload = {}) => r.request(action, payload, tokens[who]);

// 1. Unauthenticated requests to saveStatutorySettings should fail
const unauthSave = r.request('saveStatutorySettings', { socsoCeiling: 7000 }, 'invalid-token');
assert.equal(unauthSave.status, 'error', 'Unauthenticated saveStatutorySettings must be rejected');

// 2. Initial getStatutorySettings when HR_statutorySettings sheet is empty
const initialRes = req('ALICE', 'getStatutorySettings');
assert.equal(initialRes.status, 'success', `getStatutorySettings failed: ${initialRes.message}`);
const initialSettings = initialRes.data;
assert.ok(initialSettings, 'Settings data must be returned');

// Verify default statutory values
assert.equal(initialSettings.socsoCeiling, 6000.0, 'Default SOCSO ceiling should be 6,000');
assert.equal(initialSettings.eisCeiling, 6000.0, 'Default EIS ceiling should be 6,000');
assert.equal(initialSettings.epfEmployeeStandardRate, 0.11, 'Default EPF EE rate should be 11%');
assert.equal(initialSettings.epfEmployerLowWageRate, 0.13, 'Default EPF ER low wage rate should be 13%');
assert.equal(initialSettings.epfEmployerHighWageRate, 0.12, 'Default EPF ER high wage rate should be 12%');
assert.equal(initialSettings.epfEmployerSeniorRate, 0.04, 'Default EPF senior rate should be 4%');

// Verify default TP1 relief caps
assert.ok(initialSettings.tp1Caps, 'tp1Caps object must exist');
assert.equal(initialSettings.tp1Caps.lifestyle_sports, 1000.0, 'TP1 Sports cap should be RM 1,000');
assert.equal(initialSettings.tp1Caps.lifestyle_general, 2500.0, 'TP1 Lifestyle cap should be RM 2,500');
assert.equal(initialSettings.tp1Caps.parent_medical, 8000.0, 'TP1 Parent medical cap should be RM 8,000');

// Verify default Overtime ceilings
assert.ok(initialSettings.overtimeCeilings, 'overtimeCeilings object must exist');
assert.equal(initialSettings.overtimeCeilings.general, 4000.0, 'General OT ceiling should be RM 4,000');
assert.equal(initialSettings.overtimeCeilings.site, 7000.0, 'Site OT ceiling should be RM 7,000');

// Verify default Induction benefits
assert.ok(initialSettings.inductionBenefits, 'inductionBenefits object must exist');
assert.equal(initialSettings.inductionBenefits.mileageCar, 0.50, 'Mileage car should be RM 0.50/km');
assert.equal(initialSettings.inductionBenefits.mileageMotorcycle, 0.20, 'Mileage bike should be RM 0.20/km');
assert.equal(initialSettings.inductionBenefits.zeroMcAward, 300.0, 'Zero MC award should be RM 300');
assert.equal(initialSettings.inductionBenefits.wellnessByGrade.S, 1500.0, 'Grade S flexi-wellness should be RM 1,500');
assert.equal(initialSettings.inductionBenefits.wellnessByGrade.M, 1000.0, 'Grade M flexi-wellness should be RM 1,000');
assert.equal(initialSettings.inductionBenefits.wellnessByGrade.E, 600.0, 'Grade E flexi-wellness should be RM 600');
assert.equal(initialSettings.inductionBenefits.checkupByGrade.S, 800.0, 'Grade S checkup should be RM 800');
assert.equal(initialSettings.inductionBenefits.checkupByGrade.M, 500.0, 'Grade M checkup should be RM 500');

// Verify regulations list is exposed
assert.ok(Array.isArray(initialSettings.regulations), 'regulations array should be provided');
assert.ok(initialSettings.regulations.some(r => r.act.includes('Act 452')), 'Must include Act 452 citation');
assert.ok(initialSettings.regulations.some(r => r.act.includes('Act 4')), 'Must include Act 4 citation');
assert.ok(initialSettings.regulations.some(r => r.act.includes('Act 800')), 'Must include Act 800 citation');
assert.ok(initialSettings.regulations.some(r => r.act.includes('Section 60A')), 'Must include Section 60A citation');
assert.ok(initialSettings.regulations.some(r => r.act.includes('FAM-23/G')), 'Must include Metrio Induction Policy citation');

// 3. Authorization: Non-admin/non-HR users cannot save settings
const aliceSave = req('ALICE', 'saveStatutorySettings', { socsoCeiling: 7000 });
assert.equal(aliceSave.status, 'error', 'Staff user ALICE must not be allowed to save statutory settings');
assert.match(aliceSave.message, /Admin|HR|unauthorized|forbidden/i);

const managerSave = req('MANAGER', 'saveStatutorySettings', { socsoCeiling: 7000 });
assert.equal(managerSave.status, 'error', 'HOD user MANAGER must not be allowed to save statutory settings');

// 4. Admin user can save settings
const updatedPayload = {
  ...initialSettings,
  socsoCeiling: 7000.0,
  eisCeiling: 7000.0,
  inductionBenefits: {
    ...initialSettings.inductionBenefits,
    mileageCar: 0.60
  }
};

const adminSave = req('ADMIN', 'saveStatutorySettings', updatedPayload);
assert.equal(adminSave.status, 'success', `Admin save failed: ${adminSave.message}`);

// Verify sheet HR_statutorySettings tab was created and written
assert.ok(r.sheets.HR_statutorySettings, 'HR_statutorySettings sheet tab must exist');
const sheetRows = r.sheets.HR_statutorySettings.rows;
assert.ok(sheetRows.length >= 2, 'HR_statutorySettings must contain header and data row');
const savedRecord = JSON.parse(sheetRows[1][4]);
assert.equal(savedRecord.socsoCeiling, 7000.0, 'Saved record in sheet must reflect updated SOCSO ceiling');
assert.equal(savedRecord.inductionBenefits.mileageCar, 0.60, 'Saved record must reflect updated mileage');

// Verify HR_audit tab logged the change
assert.ok(r.sheets.HR_audit, 'HR_audit sheet tab must exist');
const auditRows = r.sheets.HR_audit.rows;
assert.ok(auditRows.some(row => row[3] === 'Updated' || (row[4] && row[4].includes('statutorySettings'))), 'Audit log must record statutorySettings update');

// 5. Verify getStatutorySettings now returns the updated values
const updatedRes = req('ALICE', 'getStatutorySettings');
assert.equal(updatedRes.status, 'success');
assert.equal(updatedRes.data.socsoCeiling, 7000.0, 'getStatutorySettings must return newly saved SOCSO ceiling');
assert.equal(updatedRes.data.eisCeiling, 7000.0, 'getStatutorySettings must return newly saved EIS ceiling');
assert.equal(updatedRes.data.inductionBenefits.mileageCar, 0.60, 'getStatutorySettings must return updated mileage');

// 6. HR role can also save settings
const hrSave = req('HR_USER', 'saveStatutorySettings', {
  ...updatedRes.data,
  inductionBenefits: {
    ...updatedRes.data.inductionBenefits,
    zeroMcAward: 350.0
  }
});
assert.equal(hrSave.status, 'success', `HR_USER save failed: ${hrSave.message}`);
const finalRes = req('ADMIN', 'getStatutorySettings');
assert.equal(finalRes.data.inductionBenefits.zeroMcAward, 350.0);

console.log('PASS: statutory-settings.test.cjs - Backend actions & role authorization verified.');

// 7. Verify Frontend Files exist and meet brief criteria
console.log('--- Testing Frontend Modal & Integration ---');
const modalPath = path.join(__dirname, '../src/components/StatutorySettingsModal.vue');
assert.ok(fs.existsSync(modalPath), 'src/components/StatutorySettingsModal.vue must exist');
const modalSrc = fs.readFileSync(modalPath, 'utf8');

// Regulatory badges check
const requiredBadges = [
  'Employees Provident Fund Act 1991 (Act 452)',
  "Employees' Social Security Act 1969 (Act 4)",
  'Employment Insurance System Act 2017 (Act 800)',
  'Income Tax Act 1967 (Form TP1 & PCB)',
  'Employment Act 1955 (Section 60A Overtime)',
  'Metrio Induction Policy (FAM-23/G Jul 2025)'
];
for (const badge of requiredBadges) {
  assert.ok(modalSrc.includes(badge), `StatutorySettingsModal.vue must display regulatory citation: ${badge}`);
}

// Field presence check
const requiredFields = [
  'socsoCeiling',
  'eisCeiling',
  'epfEmployeeStandardRate',
  'lifestyle_sports',
  'lifestyle_general',
  'parent_medical',
  'mileageCar',
  'zeroMcAward'
];
for (const field of requiredFields) {
  assert.ok(modalSrc.includes(field), `StatutorySettingsModal.vue must include form binding/field: ${field}`);
}

// Check integration into HrWorkspace.vue
const workspacePath = path.join(__dirname, '../src/components/HrWorkspace.vue');
const workspaceSrc = fs.readFileSync(workspacePath, 'utf8');
assert.ok(workspaceSrc.includes('StatutorySettingsModal'), 'HrWorkspace.vue must import StatutorySettingsModal');
assert.ok(workspaceSrc.includes('<StatutorySettingsModal'), 'HrWorkspace.vue must mount StatutorySettingsModal template tag');
assert.ok(
  workspaceSrc.includes('openStatutorySettings') || workspaceSrc.includes('statutoryModal') || workspaceSrc.includes('Statutory & Policy Settings') || workspaceSrc.includes('Statutory Settings'),
  'HrWorkspace.vue must have button/trigger to open StatutorySettingsModal'
);

console.log('PASS: Frontend component and HrWorkspace integration verified.');
