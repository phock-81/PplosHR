import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log('--- Verifying Direct Attendance Remark Key-in & Apply ---');

// 1. Check PersonalAttendance.vue template and script
const paPath = path.resolve('src/components/PersonalAttendance.vue');
const paContent = fs.readFileSync(paPath, 'utf8');

// Ensure direct input is present for remark
assert.ok(paContent.includes('v-model="rowRemarks[row.Date]"'), 'PersonalAttendance must bind rowRemarks directly to input');
assert.ok(paContent.includes('placeholder="Key in remark..."'), 'PersonalAttendance must have remark placeholder');
assert.ok(paContent.includes('@keydown.enter.prevent="applyRemark(row)"'), 'PersonalAttendance must allow enter to apply remark');

// Ensure Apply button exists
assert.ok(paContent.includes('applyRemark(row)'), 'PersonalAttendance must have applyRemark function');
assert.ok(paContent.includes('Apply'), 'PersonalAttendance must display Apply button text');
assert.ok(paContent.includes('Applied'), 'PersonalAttendance must display Applied on success');

// Ensure reflection on overall attendance
assert.ok(paContent.includes('dashboardActions.updateStaffAttendanceRemark'), 'PersonalAttendance must call updateStaffAttendanceRemark to reflect on overall attendance');

// 2. Test applyRemark execution in isolated VM context
const scriptBlock = paContent.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\s*$/gm, '');
const calls = [];
let remarkUpdatedCall = null;

const fakeUser = { name: 'ASMA ZARIHA BINTI MOHD. SHUKRI', employeeNo: 'EMP-999', joinedDate: '2026-01-01' };
const fakeRows = [
  { Date: '2026-10-20', date: '2026-10-20', ClockIn: '05:24', ClockOut: '14:33', remark: '', shift: 'Normal' },
  { Date: '2026-10-19', date: '2026-10-19', ClockIn: '14:06', ClockOut: '23:30', remark: '', shift: 'Shift 2' }
];

const ctx = vm.createContext({
  ref: value => ({ value }),
  computed: fn => ({ get value() { return fn(); } }),
  defineProps: () => ({ user: fakeUser, embedded: false }),
  defineEmits: () => () => {},
  watch: () => {},
  onMounted: () => {},
  onBeforeUnmount: () => {},
  nextTick: async () => {},
  mergeAttendancePunches: () => fakeRows,
  formatDateKL: d => d,
  formatDateDMY: d => d,
  Date,
  Intl,
  setTimeout: (fn) => fn(),
  dashboardActions: {
    apiPost: async (action, payload) => {
      calls.push({ action, payload });
      return { status: 'success', message: 'Remark saved successfully.' };
    },
    updateStaffAttendanceRemark: (user, date, remark) => {
      remarkUpdatedCall = { user, date, remark };
    }
  }
});

vm.runInContext(scriptBlock, ctx);
const run = code => vm.runInContext(code, ctx);

// Simulate keying in remark directly for 2026-10-20
run("rowRemarks.value['2026-10-20'] = 'Client meeting offsite'");
assert.equal(run("rowRemarks.value['2026-10-20']"), 'Client meeting offsite');

// Simulate clicking Apply
await run("applyRemark(rows.value[0])");

// Verify backend API called
assert.equal(calls.length, 1);
assert.equal(calls[0].action, 'saveStaffAttendanceRemark');
assert.equal(calls[0].payload.date, '2026-10-20');
assert.equal(calls[0].payload.remark, 'Client meeting offsite');
assert.equal(calls[0].payload.in, '05:24');
assert.equal(calls[0].payload.out, '14:33');

// Verify dashboard reflection was invoked
assert.ok(remarkUpdatedCall, 'updateStaffAttendanceRemark was invoked');
assert.equal(remarkUpdatedCall.date, '2026-10-20');
assert.equal(remarkUpdatedCall.remark, 'Client meeting offsite');
assert.equal(remarkUpdatedCall.user.name, 'ASMA ZARIHA BINTI MOHD. SHUKRI');

// 3. Verify dashboard.js exposes updateStaffAttendanceRemark and updates globalData
const dashPath = path.resolve('src/services/dashboard.js');
const dashContent = fs.readFileSync(dashPath, 'utf8');

assert.ok(dashContent.includes('function updateStaffAttendanceRemark('), 'dashboard.js must define updateStaffAttendanceRemark');
assert.ok(dashContent.includes('updateStaffAttendanceRemark,'), 'dashboard.js must export updateStaffAttendanceRemark in dashboardActions');
assert.ok(dashContent.includes('window.updateStaffAttendanceRemark = updateStaffAttendanceRemark'), 'dashboard.js must assign window.updateStaffAttendanceRemark');

console.log('✓ All Direct Remark Key-In, Apply and Overall Reflection verifications passed!');
