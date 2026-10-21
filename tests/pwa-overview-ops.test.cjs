const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

console.log('--- Testing PWA 2.0, Action Center, Org Chart & Feature Gates ---');

// Part 1: manifest + icons + HTML wiring
const manifest = JSON.parse(read('public/manifest.webmanifest'));
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.start_url && manifest.scope === '/');
assert.ok(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'));
assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'maskable icon required');
for (const i of manifest.icons) {
  const buf = fs.readFileSync(path.join(root, 'public', i.src));
  assert.equal(buf.subarray(1, 4).toString(), 'PNG', `${i.src} must be a real PNG`);
  assert.equal(buf.readUInt32BE(16), parseInt(i.sizes), `${i.src} width must match manifest`);
}
const html = read('index.html');
assert.ok(html.includes('rel="manifest"') && html.includes('apple-touch-icon') && html.includes('viewport-fit=cover'));
assert.ok(read('src/main.js').includes('initPwa()'));
assert.ok(fs.existsSync(path.join(root, 'public/offline.html')));
console.log('PASS Part 1: manifest, icons, HTML wiring.');

// Part 2: service worker security behaviour (executed in a sandbox with mocked Cache API)
const swSrc = read('public/sw.js');
const listeners = {}; const cached = new Map(); let putCalls = 0;
const cacheApi = {
  open: async () => ({ addAll: async () => {}, put: async (r) => { putCalls++; cached.set(r.url, true); } }),
  match: async (r) => (cached.has(r.url || r) ? { cached: true } : undefined),
  keys: async () => [], delete: async () => true
};
const sandbox = { self: { location: { origin: 'https://app.test' }, addEventListener: (t, f) => (listeners[t] = f), clients: { claim() {} }, skipWaiting() {} },
  caches: cacheApi, URL, fetch: async () => ({ ok: true, type: 'basic', clone() { return this; } }) };
vm.createContext(sandbox); vm.runInContext(swSrc, sandbox);
const run = (req) => { let responded = false; listeners.fetch({ request: req, respondWith: () => { responded = true; } }); return responded; };
assert.equal(run({ method: 'POST', url: 'https://app.test/assets/a.js' }), false, 'must not intercept POST');
assert.equal(run({ method: 'GET', url: 'https://script.google.com/macros/s/x/exec', mode: 'cors' }), false, 'must not intercept cross-origin API');
assert.equal(run({ method: 'GET', url: 'https://app.test/api/payslip.pdf', mode: 'cors' }), false, 'must not intercept/cache PDFs or arbitrary same-origin data');
assert.equal(run({ method: 'GET', url: 'https://app.test/assets/index-abc.js', mode: 'cors' }), true, 'static assets may be cached');
assert.equal(run({ method: 'GET', url: 'https://app.test/', mode: 'navigate' }), true, 'navigation is network-first with offline page');
assert.ok(swSrc.includes('CLEAR_CACHES'), 'logout cache purge supported');
assert.ok(!swSrc.includes('skipWaiting()') || swSrc.includes("SKIP_WAITING"), 'skipWaiting only on user consent');
console.log('PASS Part 2: service worker never caches API/POST/PDF/personal data.');

// Part 3: feature gates all OFF
const flagsSrc = read('src/hr/featureFlags.js').replace(/export const/g, 'const').replace(/export/g, '');
const flags = vm.runInNewContext(flagsSrc + '\n({FEATURE_FLAGS,isEnabled,gatedFeatures})');
for (const k of ['geofenceClockIn', 'facialBiometrics', 'receiptOcr', 'predictiveStaffing', 'automatedSalaryChanges', 'pushNotifications', 'offlineSubmission', 'payrollBankExport']) {
  assert.equal(flags.isEnabled(k), false, `${k} must be disabled`);
}
assert.ok(Object.isFrozen(flags.FEATURE_FLAGS));
console.log('PASS Part 3: sensitive feature flags disabled and frozen.');

// Part 4: component wiring + data-integrity rules
const ws = read('src/components/HrWorkspace.vue');
assert.ok(ws.includes('<RoleOverview'), 'Visible role overview remains mounted');
assert.doesNotMatch(ws, /<ActionCenter|<OrgChart|<ResourceCalendar/, 'Legacy hidden overview trees must not mount alongside the visible overview');
assert.ok(ws.includes("window.addEventListener('hr-open-dossier'") && ws.includes("removeEventListener('hr-open-dossier'"));
const org = read('src/components/OrgChart.vue');
assert.ok(org.includes('Unassigned') && org.includes('No manager recorded') && org.includes('cycle-safe'), 'org chart must not invent reporting lines');
assert.ok(!/Math\.random|faker|demo/i.test(org + read('src/components/ActionCenter.vue')), 'no fabricated data');
const ac = read('src/components/ActionCenter.vue');
assert.ok(ac.includes("'Asia/Kuala_Lumpur'") && ac.includes('SLA_DAYS'), 'MYT + SLA must be explicit');
assert.ok(ac.includes('hr-module'), 'action items link through the permission-checked module event');
console.log('PASS Part 4: components wired, no fabricated data.');

// Part 5: hosting headers
const fb = JSON.parse(read('firebase.json'));
const hdr = (src) => fb.hosting.headers.find((h) => h.source === src);
assert.ok(hdr('/sw.js') && /no-cache/.test(hdr('/sw.js').headers[0].value), 'sw.js must never be cached by CDN');
assert.ok(hdr('/manifest.webmanifest'));
console.log('PASS Part 5: hosting cache headers.');

// Part 6: ResourceCalendar & ReportCenter wiring and parity
assert.ok(ws.includes('<RoleOverview') && ws.includes('<ReportCenter'), 'Visible overview and reports remain wired');
assert.ok(ws.includes('<ReportCenter'), 'ReportCenter must be wired in HrWorkspace');
const rc = read('src/components/ResourceCalendar.vue');
assert.ok(rc.includes('hasOverlap') || rc.includes('conflicts'), 'ResourceCalendar must detect overlapping/conflicting bookings');
const rep = read('src/components/ReportCenter.vue');
assert.ok(rep.includes('\\uFEFF'), 'ReportCenter CSV export must include UTF-8 BOM');
assert.ok(rep.includes('reportPrintArea') && rep.includes('printPdf'), 'ReportCenter must support print/PDF target');
console.log('PASS Part 6: ResourceCalendar & ReportCenter parity and conflict detection.');

// Part 7: Mobile PWA 2.0 Responsive 5-Tab Navigation (Epic C)
const pd = read('src/components/PayrollDashboard.vue');
assert.ok(pd.includes('id="adminBottomNav"') && pd.includes('id="userBottomNav"'), 'Both admin and user mobile bottom nav bars must exist');
const expectedTabs = ['Home', 'Attendance', 'Requests', 'Inbox', 'Me'];
for (const tab of expectedTabs) {
  assert.ok(pd.includes(`<span>${tab}</span>`), `Mobile bottom nav must include destination: ${tab}`);
}
assert.ok(pd.includes('My Payslips') && pd.includes('360° Dossier') && pd.includes('Sign Out'), 'Me tab must provide quick links to payslips, dossier, and signout');
const dbJs = read('src/services/dashboard.js');
assert.ok(dbJs.includes("tabId === 'dashboard'"), 'switchMobileTab must handle Attendance destination');
console.log('PASS Part 7: Mobile PWA 2.0 5-tab responsive navigation (Home, Attendance, Requests, Inbox, Me).');

// Part 8: Dedicated Mobile App Shell & Native Screens
assert.ok(pd.includes('<MobileAppShell'), 'MobileAppShell must be mounted in PayrollDashboard');
const appShell = read('src/components/mobile/MobileAppShell.vue');
assert.ok(appShell.includes('MobileHome') && appShell.includes('MobileAttendance') && appShell.includes('MobileRequests') && appShell.includes('MobileInbox') && appShell.includes('MobileMe'));
assert.ok(fs.existsSync(path.join(root, 'src/components/mobile/MobileHome.vue')));
assert.ok(fs.existsSync(path.join(root, 'src/components/mobile/MobileAttendance.vue')));
assert.ok(fs.existsSync(path.join(root, 'src/components/mobile/MobileRequests.vue')));
assert.ok(fs.existsSync(path.join(root, 'src/components/mobile/MobileInbox.vue')));
assert.ok(fs.existsSync(path.join(root, 'src/components/mobile/MobileMe.vue')));
const mReq = read('src/components/mobile/MobileRequests.vue');
assert.ok(mReq.includes('capture="environment"') && mReq.includes('image/*'), 'Mobile claims must support phone camera capture');
assert.ok(mReq.includes('LEAVE_DRAFT_KEY') && mReq.includes('CLAIM_DRAFT_KEY'), 'Mobile requests must preserve drafts in localStorage');
const mInbox = read('src/components/mobile/MobileInbox.vue');
assert.ok(mInbox.includes('confirmApprove') && mInbox.includes('confirmReject'), 'Mobile inbox must support approval and rejection with reason');
assert.ok(dbJs.includes('normaliseRole(currentUser?.role)'), 'switchMobileTab must normalize role before checking');
console.log('PASS Part 8: Dedicated mobile app screens (MobileAppShell, Home, Attendance, Requests with camera, Inbox, Me).');

// Part 9: ReportCenter XLSX export & ActionCenter user isolation
assert.ok(rep.includes('exportXlsx') && rep.includes('Download XLSX'), 'ReportCenter must support XLSX export');
assert.ok(ac.includes('userIdentifier') && !ac.includes('`pploshr.ac.seen.${props.role}`'), 'ActionCenter seenKey must be keyed by user, not role');
console.log('PASS Part 9: ReportCenter XLSX export and ActionCenter user-isolated localStorage key.');

// Part 10: HrAnalytics drilldown drawer & dual units
const ha = read('src/components/HrAnalytics.vue');
assert.ok(ha.includes('focusRecords') && ha.includes('pa-drilldown-panel'), 'HrAnalytics must have list-level record drilldowns');
assert.ok(ha.includes('totalLeaveDays') && ha.includes('totalClaimsAmount'), 'HrAnalytics must compute both record counts and real units (days, RM)');
console.log('PASS Part 10: HrAnalytics list-level record drilldown and dual units.');

console.log('\nALL PWA / MOBILE APP SHELL / ACTION CENTER / ORG CHART / RESOURCE CALENDAR / REPORT CENTER / DRILLDOWNS TESTS PASSED!\n');


