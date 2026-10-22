const assert = require('assert');
const fs = require('fs');

console.log('--- Testing Department UUID Resolution, Work Base & Location, and Resource Limits Removal ---');

// 1. Verify getStaffDepartment resolution in dashboard.js
console.log('Testing 1: getStaffDepartment UUID resolution in dashboard.js...');
const dashboardJs = fs.readFileSync('src/services/dashboard.js', 'utf8');

assert.match(dashboardJs, /function getAllDepartments\(\)/, 'dashboard.js must define getAllDepartments()');
assert.match(dashboardJs, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/, 'dashboard.js must have UUID guard preventing raw UUID display');
assert.match(dashboardJs, /#staffModalSubDept.*curDept/, 'dashboard.js must update #staffModalSubDept on data populate and change');
assert.match(dashboardJs, /tags\.push\(d\.workBase\)/, 'dashboard.js must tag workBase in department dropdown');
assert.match(dashboardJs, /tags\.push\(d\.workLocation\)/, 'dashboard.js must tag workLocation in department dropdown');

console.log('PASS 1: dashboard.js department UUID resolution and live modal subtitle verified.');

// 2. Verify schema.js for departments workBase and workLocation
console.log('Testing 2: schema.js departments workBase & workLocation...');
const schemaJs = fs.readFileSync('src/hr/schema.js', 'utf8');

assert.match(schemaJs, /departments:\{[\s\S]*?workBase[\s\S]*?workLocation[\s\S]*?manager/, 'schema.js departments must have workBase and workLocation fields');
console.log('PASS 2: schema.js departments workBase and workLocation fields verified.');

// 3. Verify backend schemas for departments
console.log('Testing 3: Backend GAS_payroll.js and Code.js departments schema...');
const gasPayroll = fs.readFileSync('backend/GAS_payroll.js', 'utf8');
const codeJs = fs.readFileSync('backend/Code.js', 'utf8');

[gasPayroll, codeJs].forEach((fileContent, idx) => {
  const fileName = idx === 0 ? 'GAS_payroll.js' : 'Code.js';
  assert.match(fileContent, /"departments":\s*\{[\s\S]*?"key":\s*"workBase"/, `${fileName} must include workBase in departments`);
  assert.match(fileContent, /"departments":\s*\{[\s\S]*?"key":\s*"workLocation"/, `${fileName} must include workLocation in departments`);
});
console.log('PASS 3: Backend GAS departments schema includes workBase and workLocation.');

// 4. Verify HrWorkspace.vue for departments workBase/workLocation, window.hrDepartments, and Resource Limits removal
console.log('Testing 4: HrWorkspace.vue UI contract...');
const hrWorkspace = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');

assert.match(hrWorkspace, /window\.hrDepartments=records\.value\.departments/, 'HrWorkspace must expose window.hrDepartments');
assert.match(hrWorkspace, /active\.value === 'departments' && \['workBase', 'workLocation'\]\.includes\(field\.key\)/, 'HrWorkspace must support multiselect for departments workBase and workLocation');
assert.match(hrWorkspace, /field\.key==='workBase'[\s\S]*?active\.value==='departments'/, 'HrWorkspace must provide workBase options for departments');
assert.match(hrWorkspace, /field\.key==='workLocation'[\s\S]*?active\.value==='departments'/, 'HrWorkspace must provide workLocation options for departments');
assert.match(hrWorkspace, /r\.workBase.*r\.workLocation/s, 'HrWorkspace must render workBase and workLocation on department card');

// Check Resource Limits removal
assert.doesNotMatch(hrWorkspace, /<button[^>]*active==='resourcePolicies'/, 'Resource Limits button must be removed from subnav');
assert.doesNotMatch(hrWorkspace, /'resources','resourcePolicies','workSchedules'/, 'resourcePolicies must not be in subnav active tabs check');
assert.doesNotMatch(hrWorkspace, /<div v-if="active==='resourcePolicies'">/, 'Resource Limits card block must be removed');

console.log('PASS 4: HrWorkspace.vue department droplists and Resource Limits removal verified.');

// 5. Verify StaffDossierModal.vue
console.log('Testing 5: StaffDossierModal.vue UUID guard...');
const staffDossier = fs.readFileSync('src/components/StaffDossierModal.vue', 'utf8');
assert.match(staffDossier, /window\.hrDepartments/, 'StaffDossierModal must check window.hrDepartments');
assert.match(staffDossier, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/, 'StaffDossierModal must guard against raw UUID display');

console.log('PASS 5: StaffDossierModal.vue UUID guard verified.');

console.log('\n===============================================================');
console.log('ALL DEPARTMENT & RESOURCE LIMITS FIXES VERIFIED SUCCESSFULLY!');
console.log('===============================================================');
