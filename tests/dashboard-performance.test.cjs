const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/services/dashboard.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

(async () => {
  let token = 'session-a';
  const calls = [];
  const context = vm.createContext({console, AbortController, setTimeout, clearTimeout, API_URL: 'test', localStorage: {getItem: () => token}, sessionStorage: {getItem: () => token}, fetch: (url, options) => {
    const wait = deferred(); calls.push({body: JSON.parse(options.body), wait}); return wait.promise;
  }});
  vm.runInContext(section('    const pendingReads', '    function formatLocalDate'), context);
  const api = context.apiPost;
  const finish = (index, data = {status: 'success', data: {version: 1}}) => calls[index].wait.resolve({ok: true, text: async () => JSON.stringify(data)});
  const first = api('getStaff', {a: 1, b: 2});
  const duplicate = api('getStaff', {b: 2, a: 1});
  assert.equal(calls.length, 1, 'two concurrent equivalent reads use one request');
  finish(0);
  const [a, b] = await Promise.all([first, duplicate]);
  a.data.version = 99; assert.equal(b.data.version, 1, 'callers have independent results');
  const fresh = api('getStaff', {a: 1, b: 2}); assert.equal(calls.length, 2, 'no completed response cache'); finish(1); await fresh;
  const personal = api('getLeaveData', {scope: 'personal'});
  const team = api('getLeaveData', {scope: 'team'});
  assert.equal(calls.length, 4, 'distinct scopes never merge'); finish(2); finish(3); await Promise.all([personal, team]);
  const oldRead = api('getStaff', {});
  const write = api('saveSingleStaff', {name: 'TEST'});
  const duringWrite = api('getStaff', {});
  assert.equal(calls.length, 7, 'write start invalidates earlier pending read');
  finish(5); await write;
  const afterWrite = api('getStaff', {});
  assert.equal(calls.length, 8, 'write completion invalidates reads begun during save');
  finish(4); await oldRead;
  const duplicateAfter = api('getStaff', {});
  assert.equal(calls.length, 8, 'old completion cannot evict newer request');
  finish(6); finish(7); await Promise.all([duringWrite, afterWrite, duplicateAfter]);
  const error = api('getStaff', {}); finish(8, {status: 'error'}); await error;
  const retry = api('getStaff', {}); assert.equal(calls.length, 10, 'errors do not poison retries'); finish(9); await retry;
  const previousSession = api('getStaff', {}); token = 'session-b';
  const nextSession = api('getStaff', {}); assert.equal(calls.length, 12, 'sessions never merge');
  finish(10); finish(11);
  assert.equal((await previousSession).staleSession, true, 'late prior-session result is rejected');
  assert.equal((await nextSession).status, 'success');

  let renders = 0; const refreshed = [];
  const refreshContext = vm.createContext({staffSettings: {}, globalData: [{}], findStaffSetting: () => null, CacheManager: { saveBootstrap: () => {}, saveAttendanceRows: () => {} }, apiPost: async action => {refreshed.push(action); return {status: 'success', data: {TEST: {version: 2}}};}, renderStaffMgmt: () => renders++, renderSummaryDashboard: () => renders++, renderDashboard: () => renders++, alert: () => {}});
  vm.runInContext(section('    async function refreshStaffData()', '    async function saveStaffProfile()'), refreshContext);
  assert.equal(await refreshContext.refreshStaffData(), true);
  assert.deepEqual(refreshed, ['getStaff'], 'staff edits refresh staff only, without bootstrap attendance/payroll');
  assert.equal(refreshContext.staffSettings.TEST.version, 2); assert.equal(renders, 3);
  for (const [start, end] of [['    async function saveStaffProfile()', '    async function saveRateLocally'], ['    async function saveRateLocally', '    async function syncSingleStaff'], ['    async function syncSingleStaff', '    async function deleteStaff']]) {
    assert.match(section(start, end), /await refreshStaffData\(\)/);
    assert.doesNotMatch(section(start, end), /initializeApp\(/);
  }
  let overviewResolve; const starts = [];
  const jq = new Proxy({}, {get: (_, key) => key === 'is' ? () => false : () => jq});
  const portal = vm.createContext({$: () => jq, currentUser: {name: 'TEST'}, fetchMyLeave: async () => {starts.push('history');}, apiPost: () => {starts.push('balance'); return new Promise(r => overviewResolve = r);}, renderLeaveBalances() {}, handleLeaveTypeChange() {}, leaveNotice() {}});
  vm.runInContext(section('    async function loadStaffPortal()', '    async function loadMyProfile()'), portal);
  const loading = portal.loadStaffPortal();
  assert.deepEqual(starts, ['history', 'balance'], 'history starts before balance response (two parallel reads, not two serial trips)');
  overviewResolve({status: 'success', data: {}}); await loading;
  const navigation = section('    function switchTab(', '    /* --- PAYSLIPS');
  assert.doesNotMatch(navigation, /fadeIn\(/, 'page navigation no longer waits for or queues fade animations');
  assert.equal((navigation.match(/stop\(true, true\)/g) || []).length, 2, 'desktop and mobile clear outstanding transitions');
  console.log('PASS: concurrent identical reads 2→1; scope/session isolation, write invalidation, retry and response isolation; staff-only refresh and parallel leave loading.');
})().catch(error => {console.error(error); process.exitCode = 1;});
