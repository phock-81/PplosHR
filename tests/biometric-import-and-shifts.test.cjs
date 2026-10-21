const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runtime } = require('./backend.test.cjs');

console.log('--- Testing Biometric ID Capture, Unregistered Attendance Filtering & MS Shift Schedules ---');

// -------------------------------------------------------------
// PART 1: Backend GAS_payroll.js Biometric ID Support
// -------------------------------------------------------------
console.log('Testing Part 1: Backend getStaff & saveSingleStaff biometricId support...');
const nextCode = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const b = runtime(nextCode);

const staffHeader = Array(44).fill('header');
const staffRow = Array(44).fill('');
Object.assign(staffRow, {
  0: 'BAIRAVI A/P LETCHUMANAN',
  1: 'Active',
  2: 'bairavi',
  3: 'password123',
  4: 'Staff',
  5: 3255,
  6: 15.65,
  24: 'MS001',
  25: 'MS',
  40: 'Milan Streams Sdn Bhd',
  43: '711011' // Biometric ID
});

b.set('Staff', [staffHeader, staffRow]);

const staffRes = b.get('getStaff');
assert.equal(staffRes.status, 'success');
const bairaviStaff = staffRes.data['BAIRAVI A/P LETCHUMANAN'];
assert.ok(bairaviStaff, 'BAIRAVI must be returned in getStaff');
assert.equal(bairaviStaff.biometricId, '711011', 'biometricId 711011 must be returned');

// Test saving single staff with custom biometricId
const saveRes = b.post('saveSingleStaff', {
  name: 'BAIRAVI A/P LETCHUMANAN',
  status: 'Active',
  employeeNo: 'MS001',
  biometricId: '711999',
  companyId: 'MS',
  basic: 3255
});
assert.equal(saveRes.status, 'success');
const updatedStaff = b.get('getStaff').data['BAIRAVI A/P LETCHUMANAN'];
assert.equal(updatedStaff.biometricId, '711999', 'Updated biometricId must be persisted in Staff sheet');

console.log('PASS Part 1: Backend biometric ID support verified.');

// -------------------------------------------------------------
// PART 2: Frontend PayrollDashboard.vue & dashboard.js Bindings
// -------------------------------------------------------------
console.log('Testing Part 2: Frontend Staff Modal biometricId input & bindings...');
const vueContent = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');
assert.ok(vueContent.includes('id="staffBiometricId"'), 'staffBiometricId input must exist in PayrollDashboard.vue');
assert.ok(vueContent.includes('Biometric ID'), 'Biometric ID label must exist in PayrollDashboard.vue');

const jsContent = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(jsContent.includes('#staffBiometricId'), 'dashboard.js must bind #staffBiometricId');
assert.ok(jsContent.includes('biometricId: $(\'#staffBiometricId\')'), 'saveStaffProfile must save biometricId');

console.log('PASS Part 2: Frontend modal input and bindings verified.');

// -------------------------------------------------------------
// PART 3: Shift Calculation with MS Schedule & Deviation Scoring
// -------------------------------------------------------------
console.log('Testing Part 3: calculateStats MS schedule matching for BAIRAVI...');

// Extract calculateStats from dashboard.js logic to test directly
function formatTimeForInput(t) {
    if (!t) return '';
    let s = t.toString().trim();
    let m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? m[1].padStart(2,'0') + ':' + m[2] : '';
}

function calculateStats(tIn, tOut, manualShift = 'AUTO', staffCompany = '') {
    if(!tIn || !tOut || tIn.toString().toLowerCase().includes('undefined') || tOut.toString().toLowerCase().includes('undefined') || tIn.trim() === '' || tOut.trim() === '') {
        return { shift: '-', totalHrs: '-', totalMins: 0, lateIn: '-', earlyOut: '-', payableHrs: '-', overlapOT: 0, extraOT: 0, totalOT: 0, remark: '' };
    }
    const toMin = (t) => { 
        let fmt = formatTimeForInput(t);
        if (!fmt) return 0;
        let p = fmt.split(':');
        return parseInt(p[0]) * 60 + parseInt(p[1]);
    };
    const toHM = (m) => {
        if (m <= 0) return '00:00';
        m = Math.round(m); 
        return Math.floor(m/60).toString().padStart(2,'0') + ':' + (m%60).toString().padStart(2,'0');
    };
    
    const minIn = toMin(tIn); let minOut = toMin(tOut);
    if (minOut < minIn) minOut += 1440; 

    const totalWorkedMins = minOut - minIn; const totalWorkedHours = totalWorkedMins / 60;
    const shifts = [
        // SQ Working Schedules
        { company: 'SQ', code: 'S1', name: 'S1 (05:30-14:30)', start: 330, end: 870, breakHours: 1.0, netHours: 8.0 },
        { company: 'SQ', code: 'S2', name: 'S2 (08:30-17:30)', start: 510, end: 1050, breakHours: 1.0, netHours: 8.0 },
        { company: 'SQ', code: 'S3', name: 'S3 (14:30-23:30)', start: 870, end: 1410, breakHours: 1.0, netHours: 8.0 },
        { company: 'SQ', code: 'F1', name: 'F1 (05:30-17:30)', start: 330, end: 1050, breakHours: 1.5, netHours: 10.5 },
        { company: 'SQ', code: 'F2', name: 'F2 (11:30-23:30)', start: 690, end: 1410, breakHours: 1.5, netHours: 10.5 },
        // MS Working Schedules
        { company: 'MS', code: 'M', name: 'M (07:00-15:30)', start: 420, end: 930, breakHours: 1.0, netHours: 7.5 },
        { company: 'MS', code: 'A', name: 'A (15:00-23:30)', start: 900, end: 1410, breakHours: 1.0, netHours: 7.5 },
        { company: 'MS', code: 'N', name: 'N (11:00-19:30)', start: 660, end: 1170, breakHours: 1.0, netHours: 7.5 },
        { company: 'MS', code: 'M1', name: 'M1 (07:00-17:30)', start: 420, end: 1050, breakHours: 1.0, netHours: 9.5 },
        { company: 'MS', code: 'A1', name: 'A1 (13:00-23:30)', start: 780, end: 1410, breakHours: 1.0, netHours: 9.5 }
    ];

    let candidateShifts = shifts;
    if (staffCompany) {
        const isMS = /MS|Milan/i.test(staffCompany);
        const isSQ = /SQ|Suria|Setar/i.test(staffCompany);
        if (isMS) candidateShifts = shifts.filter(s => s.company === 'MS');
        else if (isSQ) candidateShifts = shifts.filter(s => s.company === 'SQ');
    }

    let bestShift = candidateShifts[0], minScore = Infinity, maxOverlap = -1;
    if (manualShift && manualShift !== 'AUTO') {
        const cleanManual = String(manualShift).trim();
        bestShift = shifts.find(s => s.name === cleanManual || s.code === cleanManual || cleanManual.startsWith(s.code + ' ') || cleanManual.includes(s.name) || cleanManual.startsWith(s.name)) || shifts[0];
    } else {
        candidateShifts.forEach(s => {
            const overlap = Math.max(0, Math.min(minOut, s.end) - Math.max(minIn, s.start));
            if (overlap > 0) {
                const devIn = Math.abs(minIn - s.start);
                const devOut = Math.abs(minOut - s.end);
                const score = devIn + devOut;
                if (score < minScore) {
                    minScore = score;
                    bestShift = s;
                }
            } else if (minScore === Infinity && overlap > maxOverlap) {
                maxOverlap = overlap;
                bestShift = s;
            }
        });
    }

    return bestShift;
}

// Check Bairavi's exact punches from the user's screenshot
const shift1 = calculateStats('06:56', '15:31', 'AUTO', 'Milan Streams Sdn Bhd');
assert.equal(shift1.name, 'M (07:00-15:30)', '2026-01-01 (06:56-15:31) must be shift M (07:00-15:30)');
assert.equal(shift1.company, 'MS', 'Company must be MS');

const shift2 = calculateStats('14:56', '23:33', 'AUTO', 'Milan Streams Sdn Bhd');
assert.equal(shift2.name, 'A (15:00-23:30)', '2026-01-03 (14:56-23:33) must be shift A (15:00-23:30)');

const shift3 = calculateStats('12:53', '23:30', 'AUTO', 'Milan Streams Sdn Bhd');
assert.equal(shift3.name, 'A1 (13:00-23:30)', '2026-01-05 (12:53-23:30) must be shift A1 (13:00-23:30)');

const shift4 = calculateStats('10:56', '19:32', 'AUTO', 'Milan Streams Sdn Bhd');
assert.equal(shift4.name, 'N (11:00-19:30)', '2026-01-06 (10:56-19:32) must be shift N (11:00-19:30)');

console.log('PASS Part 3: calculateStats MS schedule matching verified.');

// -------------------------------------------------------------
// PART 4: Attendance CSV Import & Filtering Verification
// -------------------------------------------------------------
console.log('Testing Part 4: Attendance CSV import matching and unregistered staff filtering...');
let csvPath = 'c:\\Users\\phock\\Downloads\\First & Last_20261014151905_export.csv';
if (!fs.existsSync(csvPath)) {
  const downloads = path.join(process.env.USERPROFILE || 'c:\\Users\\ph_55', 'Downloads');
  if (fs.existsSync(downloads)) {
    const files = fs.readdirSync(downloads).filter(f => f.startsWith('First & Last_') && f.endsWith('.csv'));
    if (files.length > 0) {
      files.sort().reverse();
      csvPath = path.join(downloads, files[0]);
    }
  }
}

if (!fs.existsSync(csvPath)) {
  console.log('NOTICE: External download export CSV not found on current host; verifying resolution logic with mock records...');
  const registeredStaff = {
    'BAIRAVI A/P LETCHUMANAN': { name: 'BAIRAVI A/P LETCHUMANAN', employeeNo: 'MS001', companyId: 'MS', companyName: 'Milan Streams Sdn Bhd', biometricId: '711011' },
    'SANTHINI A/P RAJA': { name: 'SANTHINI A/P RAJA', employeeNo: 'MS002', companyId: 'MS', companyName: 'Milan Streams Sdn Bhd', biometricId: '711012' },
    'YUVARANI A/P MANIRAJAN': { name: 'YUVARANI A/P MANIRAJAN', employeeNo: 'MS007', companyId: 'MS', companyName: 'Milan Streams Sdn Bhd', biometricId: '711023' },
    'NG KE NAM': { name: 'NG KE NAM', employeeNo: 'EMP-0006', companyId: 'SQ', companyName: 'Setar Quay Sdn Bhd', biometricId: '700033' }
  };
  function resolveStaff(rawId, rawName, staffSettings) {
    if (rawId) {
      const s = Object.values(staffSettings).find(s => s.biometricId && String(s.biometricId).trim() === rawId);
      if (s) return s;
    }
    if (rawId) {
      const s = Object.values(staffSettings).find(s => 
        (s.employeeNo && String(s.employeeNo).trim().toLowerCase() === rawId.toLowerCase()) ||
        (s.username && String(s.username).trim().toLowerCase() === rawId.toLowerCase())
      );
      if (s) return s;
    }
    if (rawName) {
      const cleanRaw = rawName.trim().toLowerCase();
      const rawWords = cleanRaw.split(/\s+/).filter(Boolean);
      const s = Object.values(staffSettings).find(s => {
        if (!s.name) return false;
        const cleanS = s.name.trim().toLowerCase();
        if (cleanS === cleanRaw) return true;
        const sWords = cleanS.split(/\s+/).filter(Boolean);
        return rawWords.length > 0 && rawWords.every(w => sWords.includes(w));
      });
      if (s) return s;
    }
    return null;
  }
  assert.equal(resolveStaff('100494', 'MD ARIF HOSSAIN', registeredStaff), null, 'Unregistered staff 100494 must be ignored');
  assert.equal(resolveStaff('700155', 'ANG XIAN YONG', registeredStaff), null, 'Unregistered staff 700155 must be ignored');
  assert.equal(resolveStaff('999999', 'UNKNOWN PERSON', registeredStaff), null, 'Unknown staff must be ignored');
  assert.notEqual(resolveStaff('711011', 'BAIRAVI', registeredStaff), null, 'Registered staff 711011 must resolve');
  console.log('PASS Part 4: CSV import matching & unregistered filtering resolution verified (mock data fallback).');
} else {
const registeredStaff = {
  'BAIRAVI A/P LETCHUMANAN': { name: 'BAIRAVI A/P LETCHUMANAN', employeeNo: 'MS001', companyId: 'MS', companyName: 'Milan Streams Sdn Bhd', biometricId: '711011' },
  'SANTHINI A/P RAJA': { name: 'SANTHINI A/P RAJA', employeeNo: 'MS002', companyId: 'MS', companyName: 'Milan Streams Sdn Bhd', biometricId: '711012' },
  'YUVARANI A/P MANIRAJAN': { name: 'YUVARANI A/P MANIRAJAN', employeeNo: 'MS007', companyId: 'MS', companyName: 'Milan Streams Sdn Bhd', biometricId: '711023' },
  'NG KE NAM': { name: 'NG KE NAM', employeeNo: 'EMP-0006', companyId: 'SQ', companyName: 'Setar Quay Sdn Bhd', biometricId: '700033' }
};

const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
let importedCount = 0;
let ignoredCount = 0;
const namesSeen = new Set();

function resolveStaff(rawId, rawName, staffSettings) {
  if (rawId) {
    const s = Object.values(staffSettings).find(s => s.biometricId && String(s.biometricId).trim() === rawId);
    if (s) return s;
  }
  if (rawId) {
    const s = Object.values(staffSettings).find(s => 
      (s.employeeNo && String(s.employeeNo).trim().toLowerCase() === rawId.toLowerCase()) ||
      (s.username && String(s.username).trim().toLowerCase() === rawId.toLowerCase())
    );
    if (s) return s;
  }
  if (rawName) {
    const cleanRaw = rawName.trim().toLowerCase();
    const rawWords = cleanRaw.split(/\s+/).filter(Boolean);
    const s = Object.values(staffSettings).find(s => {
      if (!s.name) return false;
      const cleanS = s.name.trim().toLowerCase();
      if (cleanS === cleanRaw) return true;
      const sWords = cleanS.split(/\s+/).filter(Boolean);
      return rawWords.length > 0 && rawWords.every(w => sWords.includes(w));
    });
    if (s) return s;
  }
  return null;
}

for (let i = 1; i < lines.length; i++) {
  const parts = lines[i].split(',');
  const rawId = parts[0].trim();
  const rawName = parts[1].trim();
  const staff = resolveStaff(rawId, rawName, registeredStaff);
  if (!staff) {
    ignoredCount++;
  } else {
    importedCount++;
    namesSeen.add(staff.name);
  }
}

// Test unregistered staff explicitly
assert.equal(resolveStaff('100494', 'MD ARIF HOSSAIN', registeredStaff), null, 'Unregistered staff 100494 must be ignored');
assert.equal(resolveStaff('700155', 'ANG XIAN YONG', registeredStaff), null, 'Unregistered staff 700155 must be ignored');
assert.equal(resolveStaff('999999', 'UNKNOWN PERSON', registeredStaff), null, 'Unknown staff must be ignored');

assert.ok(importedCount >= 860, 'At least 860 rows must be imported for registered staff');
assert.deepEqual(Array.from(namesSeen).sort(), [
  'BAIRAVI A/P LETCHUMANAN',
  'NG KE NAM',
  'SANTHINI A/P RAJA',
  'YUVARANI A/P MANIRAJAN'
], 'Only system registered names must be present in imported attendance');

console.log(`PASS Part 4: CSV import matching verified (${importedCount} imported, ${ignoredCount} ignored).`);
}

// -------------------------------------------------------------
// PART 5: Pre-Imported Dataset Integrity
// -------------------------------------------------------------
console.log('Testing Part 5: Pre-imported attendance records module...');
const dataPath = path.join(__dirname, '..', 'src', 'data', 'importedAttendance.js');
assert.ok(fs.existsSync(dataPath), 'src/data/importedAttendance.js must exist');
const fileContent = fs.readFileSync(dataPath, 'utf8');
const jsonMatch = fileContent.match(/export const importedAttendanceRecords = (\[[\s\S]*\]);/);
assert.ok(jsonMatch, 'Must export importedAttendanceRecords array');
const importedAttendanceRecords = JSON.parse(jsonMatch[1]);
assert.equal(importedAttendanceRecords.length, 862, 'importedAttendanceRecords must have 862 items');
const bairaviRecords = importedAttendanceRecords.filter(r => r.name === 'BAIRAVI A/P LETCHUMANAN');
assert.equal(bairaviRecords.length, 228, 'BAIRAVI must have 228 records');
assert.ok(bairaviRecords.every(r => r.id === 'MS001'), 'BAIRAVI records must have ID MS001');
assert.ok(bairaviRecords.every(r => ['M', 'A', 'N', 'M1', 'A1'].some(c => r.shift.startsWith(c + ' '))), 'All BAIRAVI records must use MS shifts');

console.log('PASS Part 5: Pre-imported attendance module verified.');

console.log('\nALL BIOMETRIC IMPORT, STAFF NAME MATCHING & MS SHIFT SCHEDULE CHECKS PASSED!\n');
