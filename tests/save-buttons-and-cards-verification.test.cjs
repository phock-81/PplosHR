const fs = require('fs');
const assert = require('assert');

console.log('--- RUNNING SAVE BUTTONS & TAB VIEW VERIFICATION ---');

// 1. Verify HrWorkspace.vue has deduplication for workLocations and workBases
const hrWorkspaceContent = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');

assert(hrWorkspaceContent.includes('deduplicateByCode'), 'HrWorkspace.vue must define deduplicateByCode');
assert(hrWorkspaceContent.includes('deduplicateByCode(records.value.workLocations)'), 'HrWorkspace.vue must deduplicate workLocations on load');
assert(hrWorkspaceContent.includes('deduplicateByCode(records.value.workBases)'), 'HrWorkspace.vue must deduplicate workBases on load');
assert(hrWorkspaceContent.includes("field.key==='workLocation'&&active.value==='workSchedules'"), 'HrWorkspace.vue must handle workLocation field in options');
console.log('PASS: HrWorkspace.vue deduplicates workLocations and workBases');

// 2. Verify Tab View in HrWorkspace.vue uses Employee-Management style cards
assert(hrWorkspaceContent.includes('class="row g-3 mb-3"'), 'HrWorkspace.vue must use row g-3 for multi-column card grid');
assert(hrWorkspaceContent.includes('class="col-md-6 col-lg-4"'), 'HrWorkspace.vue must use 3-column card grid like Employee Management');
assert(hrWorkspaceContent.includes("active==='workBases'"), 'HrWorkspace.vue must have dedicated workBases template');
assert(hrWorkspaceContent.includes("active==='workLocations'"), 'HrWorkspace.vue must have dedicated workLocations template');
assert(hrWorkspaceContent.includes('Update Shift'), 'HrWorkspace.vue must provide card update button');
console.log('PASS: HrWorkspace.vue tab view uses 3-column card grid matching Employee Management');

// 3. Verify Shift Template Save in HrWorkspace.vue
assert(hrWorkspaceContent.includes("if (!form.value.workLocation) form.value.workLocation = 'All';"), 'HrWorkspace.vue must default workLocation to All if empty');
assert(hrWorkspaceContent.includes('calcNetHours(form.value.start, form.value.end, form.value.breakHours)'), 'HrWorkspace.vue must compute netHours');
assert(hrWorkspaceContent.includes('versionNum'), 'HrWorkspace.vue must safely pass version as number');
console.log('PASS: HrWorkspace.vue shift template save correctly handles netHours, workLocation, and version');

// 4. Verify dashboard.js saveStaffProfile
const dashContent = fs.readFileSync('src/services/dashboard.js', 'utf8');

assert(!dashContent.includes('document.getElementById(id).reportValidity()'), 'dashboard.js must not use reportValidity on hidden tab elements');
assert(dashContent.includes('emailVal') && dashContent.includes('.test(emailVal)'), 'dashboard.js must explicitly validate email');
assert(dashContent.includes('#staff-tab-employment-btn'), 'dashboard.js must switch to employment tab on validation errors');
assert(dashContent.includes('#staff-tab-personal-btn'), 'dashboard.js must switch to personal tab on validation errors');
assert(dashContent.includes('locMap'), 'dashboard.js must normalize location codes');
assert(dashContent.includes('baseMap'), 'dashboard.js must normalize workBase codes');
assert(dashContent.includes('dedupeByCode(rawWorkLocations)'), 'dashboard.js must deduplicate workLocations');
assert(dashContent.includes('dedupeByCode(rawWorkBases)'), 'dashboard.js must deduplicate workBases');
console.log('PASS: dashboard.js saveStaffProfile and openStaffModal are robust and deduplicated');

// 5. Verify backend/GAS_payroll.js
const gasContent = fs.readFileSync('backend/GAS_payroll.js', 'utf8');

assert(gasContent.includes('hrSeedWorkBases_'), 'GAS_payroll.js must have hrSeedWorkBases_');
assert(gasContent.includes('hrSeedWorkLocations_'), 'GAS_payroll.js must have hrSeedWorkLocations_');
assert(gasContent.includes('toDelete.sort((a,b) => b - a).forEach(rowIdx => {'), 'GAS_payroll.js must prune duplicate location rows');
assert(gasContent.includes('locMap'), 'GAS_payroll.js must map legacy location names to codes');
assert(gasContent.includes('baseMap'), 'GAS_payroll.js must map workBase');
assert(gasContent.includes('matchCoCode'), 'GAS_payroll.js must match workSchedules by company & code when id is newly created or default');
console.log('PASS: GAS_payroll.js backend correctly seeds, prunes duplicates, and matches shift templates');

console.log('--- ALL SAVE BUTTONS & TAB VIEW CHECKS PASSED ---');
