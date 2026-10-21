const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- RUNNING MON TO SUN SCHEDULE & BACKEND TEMPLATE TESTS ---');

const gasPath = path.join(__dirname, '../backend/GAS_payroll.js');
const gasContent = fs.readFileSync(gasPath, 'utf8');

// 1. Verify GAS schema and hrValidate_ preserve schedule day fields
assert(gasContent.includes('"key": "daySchedules"'), 'GAS_payroll.js must include daySchedules in workSchedules fields');
assert(gasContent.includes('"key": "workingDays"'), 'GAS_payroll.js must include workingDays in workSchedules fields');
assert(gasContent.includes('"key": "restDays"'), 'GAS_payroll.js must include restDays in workSchedules fields');
assert(gasContent.includes('"key": "offDays"'), 'GAS_payroll.js must include offDays in workSchedules fields');
assert(gasContent.includes('record.daySchedules ='), 'GAS_payroll.js hrValidate_ must preserve daySchedules');
assert(gasContent.includes('record.workingDays ='), 'GAS_payroll.js hrValidate_ must preserve workingDays');
console.log('PASS: GAS_payroll.js workSchedules schema and hrValidate_ preserve all schedule fields');

// 2. Verify GAS hrRows_ and hrSeedWorkSchedules_ default to Mon-Sun
assert(gasContent.includes("const allWeekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']"), 'GAS hrSeedWorkSchedules_ must declare Mon till Sun');
assert(gasContent.includes("if (!record.workingDays || !Array.isArray(record.workingDays) || record.workingDays.length === 0)"), 'GAS hrRows_ must initialize empty workingDays with allDays');
console.log('PASS: GAS hrRows_ and hrSeedWorkSchedules_ default all schedules to Mon till Sun working days');

// 3. Verify src/hr/schema.js
const schemaPath = path.join(__dirname, '../src/hr/schema.js');
const schemaContent = fs.readFileSync(schemaPath, 'utf8');
assert(schemaContent.includes("f('daySchedules','Day Schedules','textarea')"), 'src/hr/schema.js must declare daySchedules');
assert(schemaContent.includes("f('workingDays','Working Days','text')"), 'src/hr/schema.js must declare workingDays');
console.log('PASS: src/hr/schema.js workSchedules includes daySchedules and workingDays');

// 4. Verify src/components/HrWorkspace.vue
const hrWorkspacePath = path.join(__dirname, '../src/components/HrWorkspace.vue');
const hrWorkspaceContent = fs.readFileSync(hrWorkspacePath, 'utf8');

assert(hrWorkspaceContent.includes("const ALL_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']"), 'HrWorkspace.vue must declare ALL_WEEKDAYS');
assert(hrWorkspaceContent.includes("workingDays: [...ALL_WEEKDAYS]"), 'HrWorkspace.vue DEFAULT_WORK_SCHEDULES must default to ALL_WEEKDAYS');
assert(hrWorkspaceContent.includes("defaultDays = (r && Array.isArray(r.workingDays) && r.workingDays.length) ? [...r.workingDays] : [...ALL_WEEKDAYS]"), 'initScheduleBlocks must default to ALL_WEEKDAYS');
assert(hrWorkspaceContent.includes("Mon – Sun (All 7 Days)"), 'HrWorkspace.vue cards must display Mon - Sun (All 7 Days) badge');
assert(hrWorkspaceContent.includes("localStorage.setItem('hr_custom_workSchedules'"), 'HrWorkspace.vue save must persist workSchedules');
console.log('PASS: HrWorkspace.vue defaults to Mon-Sun, displays badges, and robustly persists');

console.log('--- ALL MON TO SUN SCHEDULE & BACKEND TEMPLATE CHECKS PASSED ---');
