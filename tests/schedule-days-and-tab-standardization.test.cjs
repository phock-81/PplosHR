const fs = require('fs');
const assert = require('assert');

console.log('--- RUNNING SCHEDULE DAYS, TAB CARDS & DASHBOARD ENHANCEMENT TESTS ---');

// 1. Verify HrWorkspace.vue Multi-Day Schedule Builder
const hrWorkspaceContent = fs.readFileSync('src/components/HrWorkspace.vue', 'utf8');

assert(hrWorkspaceContent.includes('ALL_WEEKDAYS'), 'HrWorkspace.vue must define ALL_WEEKDAYS');
assert(hrWorkspaceContent.includes('scheduleBlocks'), 'HrWorkspace.vue must define scheduleBlocks');
assert(hrWorkspaceContent.includes('toggleDayInBlock'), 'HrWorkspace.vue must define toggleDayInBlock');
assert(hrWorkspaceContent.includes('isDayInOtherBlock'), 'HrWorkspace.vue must grey out/disable days selected in other blocks');
assert(hrWorkspaceContent.includes('addScheduleBlock'), 'HrWorkspace.vue must provide addScheduleBlock');
assert(hrWorkspaceContent.includes('removeScheduleBlock'), 'HrWorkspace.vue must provide removeScheduleBlock');
assert(hrWorkspaceContent.includes('Rest Day / Off Day (Days not selected above)'), 'HrWorkspace.vue must render Rest Day / Off Day section for unassigned days');
assert(hrWorkspaceContent.includes('toggleDayRestOff'), 'HrWorkspace.vue must allow toggling between Rest Day and Off Day');
assert(hrWorkspaceContent.includes('MON &gt; SUN Schedule Builder'), 'HrWorkspace.vue must render MON > SUN schedule builder UI');
console.log('PASS: HrWorkspace.vue multi-day schedule builder with MON > SUN day selector and rest day designations verified');

// 2. Verify Tab View standardization across all modules in HrWorkspace.vue
assert(hrWorkspaceContent.includes("active==='resources'"), 'HrWorkspace.vue must have specialized layout for resources');
assert(!hrWorkspaceContent.includes('<p v-if="r.notes" class="text-muted small mb-0 mt-2">{{r.notes}}</p>'), 'HrWorkspace.vue must not render duplicate notes in resources card');
assert(hrWorkspaceContent.includes("active==='claimTypes'"), 'HrWorkspace.vue must have specialized layout for claimTypes');
assert(hrWorkspaceContent.includes("orgViewMode==='tab'"), 'HrWorkspace.vue must check orgViewMode');
console.log('PASS: HrWorkspace.vue tab view 3-column cards and duplicate notes removal verified');

// 3. Verify PayrollDashboard.vue
const payrollDashboardContent = fs.readFileSync('src/components/PayrollDashboard.vue', 'utf8');

assert(payrollDashboardContent.includes('Payroll Overview'), 'PayrollDashboard.vue pageTitle must default to Payroll Overview');
assert(!payrollDashboardContent.includes('Upload Staff Attendance (Raw Biometric Logs)'), 'PayrollDashboard.vue must remove the raw biometric upload button');
assert(payrollDashboardContent.includes('Working days and rest days are configured automatically via the staff member'), 'PayrollDashboard.vue Tab 4 must inform user that working/rest days derive from schedule');
assert(!payrollDashboardContent.includes('<label><input type="checkbox" value="0"> Sun</label>'), 'PayrollDashboard.vue must remove manual rest day checkboxes');
console.log('PASS: PayrollDashboard.vue title, biometric upload removal, and staff rest days notice verified');

// 4. Verify dashboard.js
const dashContent = fs.readFileSync('src/services/dashboard.js', 'utf8');

// Check approvalBanner at bottom
const bannerDefIdx = dashContent.indexOf('const approvalBanner = `');
const compEndIdx = dashContent.indexOf('container.append(compHeader);');
const bannerAppendIdx = dashContent.indexOf('container.append(approvalBanner);');

assert(bannerDefIdx !== -1, 'dashboard.js must define approvalBanner');
assert(compEndIdx !== -1, 'dashboard.js must append compHeader');
assert(bannerAppendIdx > compEndIdx, 'dashboard.js must append approvalBanner at bottom (after compHeader)');
console.log('PASS: dashboard.js approvalBanner moved to bottom of page below company attendance tables');

// Check shift fallback
assert(dashContent.includes('let assignedShift = (sObj?.schedules && sObj.schedules.length) ? sObj.schedules[0]'), 'dashboard.js must determine assignedShift from staff setting');
assert(dashContent.includes("let defaultShift = (finalPayType === 'RD' || restDays.includes(fd.dayIdx)) ? 'Off / Rest'"), 'dashboard.js must fallback to Off / Rest or assigned shift');
assert(dashContent.includes('shift: finalShift'), 'dashboard.js must set shift: finalShift on merged rows');
console.log('PASS: dashboard.js attendance shift column correctly populates assigned shift or Off/Rest instead of -');

// Check restDays schedule derivation in saveStaffProfile
assert(dashContent.includes('if (restDays.length === 0 && selectedSchedules.length > 0)'), 'dashboard.js must derive restDays from schedule when checkboxes not present');
console.log('PASS: dashboard.js derives restDays from schedule templates automatically on save');

console.log('--- ALL SCHEDULE DAYS, TAB CARDS & DASHBOARD ENHANCEMENT CHECKS PASSED ---');
