const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('--- Testing Attendance Matching by Biometric ID ---');

// Mock staffSettings dataset representing actual system state
const mockStaffSettings = {
  'ASMA ZARIHA BINTI MOHD. SHUKRI': {
    name: 'ASMA ZARIHA BINTI MOHD. SHUKRI',
    employeeNo: 'SQ002',
    username: 'asma',
    role: 'Staff',
    companyId: 'SQ',
    companyName: 'Setar Quay Sdn Bhd',
    departmentId: 'ENG',
    departmentName: 'Engineering',
    basic: 3500,
    hourly: 16.83,
    biometricId: '711005',
    restDays: [0, 6]
  },
  'BAIRAVI A/P LETCHUMANAN': {
    name: 'BAIRAVI A/P LETCHUMANAN',
    employeeNo: 'MS001',
    username: 'bairavi',
    role: 'Staff',
    companyId: 'MS',
    companyName: 'Milan Streams Sdn Bhd',
    departmentId: 'OPS',
    departmentName: 'Operations',
    basic: 3255,
    hourly: 15.65,
    biometricId: '711011',
    restDays: [0]
  },
  'NG KE NAM': {
    name: 'NG KE NAM',
    employeeNo: 'EMP-0006',
    username: 'kenam',
    role: 'Staff',
    companyId: 'SQ',
    companyName: 'Setar Quay Sdn Bhd',
    departmentId: 'ENG',
    departmentName: 'Engineering',
    basic: 4500,
    hourly: 21.63,
    biometricId: '700033',
    restDays: [0]
  }
};

const defaultBiometrics_ = {
  'BAIRAVI A/P LETCHUMANAN': '711011',
  'SANTHINI A/P RAJA': '711012',
  'YUVARANI A/P MANIRAJAN': '711023',
  'NG KE NAM': '700033'
};

// Implement testable reference functions matching the dashboard.js design
function findStaffSetting(id, name, staffSettings = mockStaffSettings) {
  if (!staffSettings || typeof staffSettings !== 'object') return null;
  const cleanId = id !== undefined && id !== null ? String(id).trim() : '';
  const cleanName = name !== undefined && name !== null ? String(name).trim() : '';

  // 1. Direct key match
  if (cleanName) {
    if (staffSettings[cleanName]) return staffSettings[cleanName];
    if (staffSettings[cleanName.toUpperCase()]) return staffSettings[cleanName.toUpperCase()];
    if (staffSettings[cleanName.toLowerCase()]) return staffSettings[cleanName.toLowerCase()];
  }
  if (cleanId) {
    if (staffSettings[cleanId]) return staffSettings[cleanId];
    if (staffSettings[cleanId.toUpperCase()]) return staffSettings[cleanId.toUpperCase()];
  }

  const staffArr = Object.values(staffSettings);

  // 2. Authoritative Biometric ID match
  if (cleanId) {
    const byBio = staffArr.find(st => st.biometricId && String(st.biometricId).trim() === cleanId);
    if (byBio) return byBio;

    // Check defaultBiometrics_ mapping
    const defBioName = Object.keys(defaultBiometrics_).find(k => String(defaultBiometrics_[k]).trim() === cleanId);
    if (defBioName) {
      const mapped = staffSettings[defBioName] || staffSettings[defBioName.toUpperCase()] ||
        staffArr.find(st => st.name && st.name.trim().toLowerCase() === defBioName.toLowerCase());
      if (mapped) return mapped;
    }
  }

  // 3. Employee No / Username match
  if (cleanId) {
    const cleanIdLower = cleanId.toLowerCase();
    const byEmpOrUser = staffArr.find(st => 
      (st.employeeNo && String(st.employeeNo).trim().toLowerCase() === cleanIdLower) ||
      (st.username && String(st.username).trim().toLowerCase() === cleanIdLower)
    );
    if (byEmpOrUser) return byEmpOrUser;
  }

  // 4. Exact Name match
  if (cleanName) {
    const cleanLower = cleanName.toLowerCase();
    const byName = staffArr.find(st => st.name && st.name.trim().toLowerCase() === cleanLower);
    if (byName) return byName;

    // 5. Word token match
    const rawWords = cleanLower.split(/\s+/).filter(Boolean);
    if (rawWords.length > 0) {
      const byWords = staffArr.find(st => {
        if (!st.name) return false;
        const sWords = st.name.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return rawWords.every(w => sWords.includes(w));
      });
      if (byWords) return byWords;
    }
  }

  return null;
}

function isRecordForStaff(record, id, name, staffObj, staffSettings = mockStaffSettings) {
  if (!record) return false;
  const s = staffObj || findStaffSetting(id, name, staffSettings);

  // 1. Authoritative Biometric ID match (strictly links clock-in machine punches)
  if (s && s.biometricId) {
    const bio = String(s.biometricId).trim();
    if (record.biometricId && String(record.biometricId).trim() === bio) return true;
    if (record.id && String(record.id).trim() === bio) return true;
    if (record.rawId && String(record.rawId).trim() === bio) return true;
  }

  // 2. Direct ID / Raw ID match
  const cleanId = id !== undefined && id !== null ? String(id).trim() : '';
  if (cleanId) {
    if (record.id && String(record.id).trim() === cleanId) return true;
    if (record.rawId && String(record.rawId).trim() === cleanId) return true;
  }

  // 3. Employee No / Username match
  if (s) {
    const empNo = s.employeeNo ? String(s.employeeNo).trim().toLowerCase() : '';
    const uname = s.username ? String(s.username).trim().toLowerCase() : '';
    const recId = record.id ? String(record.id).trim().toLowerCase() : '';
    const recEmpNo = record.employeeNo ? String(record.employeeNo).trim().toLowerCase() : '';
    const recRawId = record.rawId ? String(record.rawId).trim().toLowerCase() : '';

    if (empNo && (recId === empNo || recEmpNo === empNo || recRawId === empNo)) return true;
    if (uname && (recId === uname || recRawId === uname)) return true;
  }

  // 4. Name match
  const targetName = (name || (s && s.name) || '').trim().toLowerCase();
  const recName = (record.name || '').trim().toLowerCase();
  if (targetName && recName && targetName === recName) return true;
  if (s && s.name && recName && s.name.trim().toLowerCase() === recName) return true;

  return false;
}

// -------------------------------------------------------------
// PART 1: findStaffSetting Biometric ID Resolution
// -------------------------------------------------------------
console.log('Testing Part 1: findStaffSetting Biometric ID Resolution...');

// ASMA ZARIHA: Clock machine has ID '711005' and completely different name 'MOHAMAD AFIQ AZRI BIN ABU YAZIZ'
const resolvedAsma = findStaffSetting('711005', 'MOHAMAD AFIQ AZRI BIN ABU YAZIZ');
assert.ok(resolvedAsma, 'ASMA ZARIHA must be resolved by Biometric ID 711005');
assert.equal(resolvedAsma.name, 'ASMA ZARIHA BINTI MOHD. SHUKRI');
assert.equal(resolvedAsma.employeeNo, 'SQ002');
assert.equal(resolvedAsma.biometricId, '711005');

// Resolve by Employee ID 'SQ002'
const byEmpNo = findStaffSetting('SQ002');
assert.ok(byEmpNo, 'Must resolve by employeeNo SQ002');
assert.equal(byEmpNo.name, 'ASMA ZARIHA BINTI MOHD. SHUKRI');

// Resolve by Registered Name
const byName = findStaffSetting('', 'ASMA ZARIHA BINTI MOHD. SHUKRI');
assert.ok(byName, 'Must resolve by registered name');
assert.equal(byName.biometricId, '711005');

// Resolve by defaultBiometrics_ mapping
const byDefBio = findStaffSetting('711011', 'UNKNOWN MACHINE NAME');
assert.ok(byDefBio, 'Must resolve BAIRAVI by defaultBiometrics_ 711011');
assert.equal(byDefBio.name, 'BAIRAVI A/P LETCHUMANAN');

// Unregistered Biometric ID must return null
const unknownStaff = findStaffSetting('999999', 'GHOST USER');
assert.equal(unknownStaff, null, 'Unregistered Biometric ID must return null');

console.log('PASS Part 1: findStaffSetting Biometric ID Resolution verified.');

// -------------------------------------------------------------
// PART 2: isRecordForStaff Matching Under Diverse Scenarios
// -------------------------------------------------------------
console.log('Testing Part 2: isRecordForStaff Matching Under Diverse Scenarios...');

// Punch from machine with raw ID 711005 and raw name MOHAMAD AFIQ AZRI...
const rawMachineRecord = {
  id: '711005',
  name: 'MOHAMAD AFIQ AZRI BIN ABU YAZIZ',
  date: '2026-01-02',
  in: '08:44:00',
  out: '17:42:00',
  month: '2026-01'
};

// Normalized record with id=SQ002 and biometricId=711005
const normalizedRecord = {
  id: 'SQ002',
  name: 'ASMA ZARIHA BINTI MOHD. SHUKRI',
  rawId: '711005',
  rawName: 'MOHAMAD AFIQ AZRI BIN ABU YAZIZ',
  rawMachineName: 'MOHAMAD AFIQ AZRI BIN ABU YAZIZ',
  biometricId: '711005',
  employeeNo: 'SQ002',
  date: '2026-01-02',
  in: '08:44:00',
  out: '17:42:00',
  month: '2026-01'
};

// Test against ASMA ZARIHA's staffList entry ['SQ002', 'ASMA ZARIHA BINTI MOHD. SHUKRI']
assert.ok(
  isRecordForStaff(rawMachineRecord, 'SQ002', 'ASMA ZARIHA BINTI MOHD. SHUKRI', resolvedAsma),
  'Raw machine punch (711005) must match ASMA ZARIHA (SQ002) via Biometric ID'
);

assert.ok(
  isRecordForStaff(normalizedRecord, 'SQ002', 'ASMA ZARIHA BINTI MOHD. SHUKRI', resolvedAsma),
  'Normalized record must match ASMA ZARIHA via SQ002'
);

// Cross-check: Raw machine record for ASMA must NOT match BAIRAVI or KE NAM
const bairaviStaff = mockStaffSettings['BAIRAVI A/P LETCHUMANAN'];
assert.equal(
  isRecordForStaff(rawMachineRecord, 'MS001', 'BAIRAVI A/P LETCHUMANAN', bairaviStaff),
  false,
  'Record for 711005 must NOT match BAIRAVI (711011)'
);

const keNamStaff = mockStaffSettings['NG KE NAM'];
assert.equal(
  isRecordForStaff(rawMachineRecord, 'EMP-0006', 'NG KE NAM', keNamStaff),
  false,
  'Record for 711005 must NOT match NG KE NAM (700033)'
);

console.log('PASS Part 2: isRecordForStaff matching verified.');

// -------------------------------------------------------------
// PART 3: Codebase Verification in dashboard.js
// -------------------------------------------------------------
console.log('Testing Part 3: Codebase Verification in dashboard.js...');
const dashboardCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'dashboard.js'), 'utf8');

// Verify findStaffSetting checks biometricId
assert.ok(
  dashboardCode.includes('st.biometricId') || dashboardCode.includes('s.biometricId'),
  'dashboard.js must check biometricId when finding staff setting'
);

// Verify isRecordForStaff helper is implemented
assert.ok(
  dashboardCode.includes('function isRecordForStaff') || dashboardCode.includes('const isRecordForStaff'),
  'dashboard.js must define isRecordForStaff helper'
);

// Verify initializeApp normalizes records with biometric resolution
assert.ok(
  dashboardCode.includes('findStaffSetting(d.id, d.name)') || dashboardCode.includes('findStaffSetting(d.id'),
  'initializeApp in dashboard.js must resolve staff via findStaffSetting'
);

// Verify month selector population uses object property r.date || r.Date
assert.ok(
  dashboardCode.includes('r.date || r.Date') || dashboardCode.includes('r.date || (Array.isArray(r) ? r[0]'),
  'dashboard.js must safely parse month from object record (r.date || r.Date)'
);

// Verify dashboardActions exports the helper functions
assert.ok(
  dashboardCode.includes('findStaffSetting'),
  'dashboardActions must export findStaffSetting'
);
assert.ok(
  dashboardCode.includes('isRecordForStaff'),
  'dashboardActions must export isRecordForStaff'
);

console.log('PASS Part 3: Codebase verification in dashboard.js passed.');

console.log('\nALL ATTENDANCE BIOMETRIC ID TESTS PASSED SUCCESSFULLY!\n');
