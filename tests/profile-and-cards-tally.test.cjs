const fs = require('fs');
const assert = require('assert');

console.log('--- Testing Profile Field Swaps & Department Alignment ---');

// 1. Verify Contact No & Emergency Contact swapped in PayrollDashboard.vue
const dashVue = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');

const myProfEmerIdx = dashVue.indexOf('id="myProfileEmergency"');
const myProfContactIdx = dashVue.indexOf('id="myProfileContact"');
assert.ok(myProfEmerIdx > -1 && myProfContactIdx > -1, 'Both profile fields exist');
assert.ok(myProfEmerIdx < myProfContactIdx, 'Emergency Contact must appear BEFORE Contact No in My Profile');

const staffEmerIdx = dashVue.indexOf('id="staffEmergency"');
const staffContactIdx = dashVue.indexOf('id="staffContact"');
assert.ok(staffEmerIdx > -1 && staffContactIdx > -1, 'Both staff fields exist');
assert.ok(staffEmerIdx < staffContactIdx, 'Emergency Contact must appear BEFORE Contact No in Staff modal');

console.log('PASS 1: Emergency Contact swapped with Contact No across My Profile and Staff modal');

// 2. Verify Department and Job Grade resolution in dashboard.js
const dashJs = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(dashJs.includes('deptNameDisplay'), 'dashboard.js resolves department name for My Profile');
assert.ok(dashJs.includes('gradeNameDisplay'), 'dashboard.js resolves job grade name for My Profile');
assert.ok(dashJs.includes("$('#myProfileHeroDepartment').text(deptNameDisplay || '-')"), 'Hero department displays resolved name');
assert.ok(dashJs.includes("$('#myProfileDepartment').val(deptNameDisplay || '-')"), 'Department input displays resolved name');
assert.ok(dashJs.includes("$('#myProfileJobGrade').val(gradeNameDisplay || '-')"), 'Job grade input displays resolved name');

console.log('PASS 2: Department and Job Grade resolution in My Profile matches Overall Staff management');

// 3. Verify System Settings fallback card guard in HrWorkspace.vue
const hrWorkspace = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');
assert.ok(hrWorkspace.indexOf("form.value.code=getNextResourceCode()") > hrWorkspace.indexOf("function edit"), 'resources auto-code is inside function edit, not inside filtered');
assert.ok(hrWorkspace.includes("!['jobGrades','workSchedules','jobTitles','companies','departments','workBases','workLocations','resources','claimTypes'].includes(active)"), 'Fallback card grid is strictly guarded against system settings tabs');

console.log('PASS 3: Duplicate cards in System Settings are completely prevented');

// 4. Verify Resource Catalogue duplicate "Other" and "[]" model prevention
assert.ok(dashJs.includes('hasOther'), 'dashboard.js prevents duplicate Other option');
assert.ok(dashJs.includes("selectedModel === '[]'"), 'dashboard.js clears [] from model input');
assert.ok(dashJs.includes("raw !== '[]'"), 'dashboard.js does not parse [] as resource name');

console.log('PASS 4: Resource Catalogue Other and model brackets verified');

console.log('--- ALL CHECKS PASSED SUCCESSFULLY ---');
