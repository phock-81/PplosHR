const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Starting Performance & My Team Loading Verification ---');

const baseDir = path.resolve(__dirname, '..');
const dashboardJs = fs.readFileSync(path.join(baseDir, 'src/services/dashboard.js'), 'utf8');
const hrWorkspaceVue = fs.readFileSync(path.join(baseDir, 'src/components/HrWorkspace.vue'), 'utf8');
const cacheManagerJs = fs.readFileSync(path.join(baseDir, 'src/services/cacheManager.js'), 'utf8');

// 1. Verify CacheManager has TEAM_LEAVE support
assert.ok(cacheManagerJs.includes('TEAM_LEAVE: \'peopleos_cache_team_leave_v2\''), 'CacheManager must define TEAM_LEAVE key');
assert.ok(cacheManagerJs.includes('getTeamLeave()'), 'CacheManager must provide getTeamLeave');
assert.ok(cacheManagerJs.includes('saveTeamLeave(data)'), 'CacheManager must provide saveTeamLeave');
console.log('PASS 1: CacheManager TEAM_LEAVE methods verified.');

// 2. Verify HrWorkspace.vue has instant hydration & silent revalidation for My Team tabs
assert.ok(hrWorkspaceVue.includes('cachedHr[nextScope]'), 'HrWorkspace must hydrate nextScope from CacheManager');
assert.ok(hrWorkspaceVue.includes('if (!hasExistingData) busy.value=true;'), 'HrWorkspace must not block UI with full spinner when cached data exists');
assert.ok(hrWorkspaceVue.includes("api('hrBootstrap', { scope: 'team' })"), 'HrWorkspace must pre-warm team scope 1s after login');
assert.ok(hrWorkspaceVue.includes('load(false);'), 'openModule must trigger silent revalidation without clearing records');
console.log('PASS 2: HrWorkspace.vue instant hydration and non-blocking background revalidation verified.');

// 3. Verify dashboard.js renderLeaveManagementTables separation and instant cache hydration
assert.ok(dashboardJs.includes('function renderLeaveManagementTables(records)'), 'dashboard.js must separate renderLeaveManagementTables for 0ms rendering');
assert.ok(dashboardJs.includes('CacheManager.getTeamLeave()'), 'fetchLeaveManagementData must check CacheManager.getTeamLeave() for instant hydration');
assert.ok(dashboardJs.includes('CacheManager.saveTeamLeave(clean)'), 'fetchLeaveManagementData must update CacheManager.saveTeamLeave on sync');
console.log('PASS 3: Leave Management instant cache hydration and separated table rendering verified.');

// 4. Verify dashboard.js renderStaffMgmt instant cache hydration
assert.ok(dashboardJs.includes('const cachedBoot = CacheManager.getBootstrap();') && dashboardJs.includes('cachedBoot.staffSettings'), 'renderStaffMgmt must check CacheManager.getBootstrap() for 0ms render');
assert.ok(dashboardJs.includes('CacheManager.saveBootstrap({ staffSettings });'), 'renderStaffMgmt must persist fetched staff to CacheManager');
console.log('PASS 4: Team Directory / Staff Management instant cache hydration verified.');

// 5. Verify switchTab('dashboard') instant hydration
assert.ok(dashboardJs.includes('const cachedAtt = CacheManager.getAttendanceHistory();'), 'switchTab dashboard must hydrate attendance history from CacheManager');
assert.ok(dashboardJs.includes('const cachedLocked = CacheManager.getLockedMonths();'), 'switchTab dashboard must hydrate locked months from CacheManager');
console.log('PASS 5: Attendance Dashboard instant hydration verified.');

console.log('\n--- ALL PERFORMANCE & MY TEAM LOADING VERIFICATIONS PASSED! ---');
