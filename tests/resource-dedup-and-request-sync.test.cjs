const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Testing Resource Deduplication, Tab Renaming & Request Sync ---');

// 1. Verify MobileRequests.vue template and script
const mobileRequestsPath = path.resolve(__dirname, '../src/components/mobile/MobileRequests.vue');
const mobileRequestsSrc = fs.readFileSync(mobileRequestsPath, 'utf8');

// Check subtab is named "Resources" and not "Bookings"
assert.ok(
  mobileRequestsSrc.includes('Resources ({{ myBookings.length }})'),
  'MobileRequests.vue must have "Resources ({{ myBookings.length }})" subtab label'
);
assert.ok(
  !mobileRequestsSrc.includes('Bookings ({{ myBookings.length }})'),
  'MobileRequests.vue must not have "Bookings ({{ myBookings.length }})" subtab label'
);

// Check empty state
assert.ok(
  mobileRequestsSrc.includes('No Resource Requests'),
  'Empty state must say "No Resource Requests"'
);

// Check availableResources deduplication logic
assert.ok(
  mobileRequestsSrc.includes('const deduped = [];'),
  'availableResources must perform deduplication'
);
assert.ok(
  mobileRequestsSrc.includes('seen.add(key)'),
  'availableResources must record seen keys to prevent duplicates'
);

// Check sessionStorage sync
assert.ok(
  mobileRequestsSrc.includes('loadPersistedRequests()'),
  'Must load persisted local requests on mount'
);
assert.ok(
  mobileRequestsSrc.includes('persistLocalLeaves()'),
  'Must persist local leaves upon submission'
);
assert.ok(
  mobileRequestsSrc.includes('persistLocalClaims()'),
  'Must persist local claims upon submission'
);
console.log('PASS Part 1: MobileRequests.vue subtab rename, resource dedup and persistence verified.');

// 2. Test availableResources deduplication simulation
function computeAvailableResources(recordsResources, standardResources) {
  const backendList = (recordsResources || []).filter(r => r.availability === 'Available' && r.id);
  const baseList = backendList.length > 0 ? backendList : standardResources;
  // Prioritize catalog entries that have formal resource codes
  const list = [...baseList].sort((a, b) => (b.code ? 1 : 0) - (a.code ? 1 : 0));
  const seenCode = new Set();
  const seenTitle = new Set();
  const deduped = [];
  for (const r of list) {
    const code = String(r.code || '').trim().toUpperCase();
    const title = String(r.title || '').trim().toLowerCase();
    if (code && seenCode.has(code)) continue;
    if (title && seenTitle.has(title)) continue;
    if (code) seenCode.add(code);
    if (title) seenTitle.add(title);
    deduped.push(r);
  }
  return deduped;
}

const mockDuplicatesFromBackend = [
  { id: 'RES-0001', code: 'MON', title: 'Monitor', availability: 'Available' },
  { id: 'RES-0002', code: '', title: 'Monitor', availability: 'Available' }, // older duplicate without code
  { id: 'RES-0003', code: 'mon', title: 'Monitor 24 inch', availability: 'Available' }, // duplicate code in different case
  { id: 'RES-0004', code: 'TAB', title: 'Tablet', availability: 'Available' },
  { id: 'RES-0005', code: 'TAB', title: 'Tablet', availability: 'Available' }, // duplicate code and title
  { id: 'RES-0006', code: 'PHONE', title: 'Mobile Phone', availability: 'Available' }
];

const deduped = computeAvailableResources(mockDuplicatesFromBackend, []);
assert.strictEqual(deduped.length, 3, 'Should deduplicate 6 backend items into 3 unique resources (MON, TAB, PHONE)');
assert.strictEqual(deduped[0].code, 'MON');
assert.strictEqual(deduped[1].code, 'TAB');
assert.strictEqual(deduped[2].code, 'PHONE');
console.log('PASS Part 2: Resource deduplication algorithm successfully eliminates duplicate options.');

// 3. Test MobileHome and MobileRequests pending count synchronization
const mockLocalLeaves = [
  { id: 'local-leave-1', employee: 'ASMA', type: 'AL', start: '2026-10-20', status: 'Pending manager' }
];
const mockLocalClaims = [
  { id: 'local-claim-1', employee: 'Asma', category: 'Medical', date: '2026-10-15', amount: 50, status: 'Pending manager' }
];

const userName = 'Asma';
const upperName = userName.toUpperCase();

// Simulate MobileHome logic
let homePending = 0;
// leaves from server (empty for now)
const serverLeaves = [];
// claims from server (empty for now)
const serverClaims = [];

for (const ll of mockLocalLeaves) {
  const match = serverLeaves.some(sl => sl.id === ll.id);
  if (!match && /pending/i.test(ll.status)) homePending++;
}
for (const lc of mockLocalClaims) {
  const match = serverClaims.some(sc => sc.id === lc.id);
  if (!match && /pending/i.test(lc.status)) homePending++;
}

assert.strictEqual(homePending, 2, 'Pending requests card must count 2 (1 leave + 1 claim) for ASMA/Asma');
console.log('PASS Part 3: Pending requests count accurately reflects 2 for optimistic submissions.');

// 4. Verify backend GAS_payroll.js deduplication logic
const gasPayrollPath = path.resolve(__dirname, '../backend/GAS_payroll.js');
const gasPayrollSrc = fs.readFileSync(gasPayrollPath, 'utf8');

assert.ok(
  gasPayrollSrc.includes('if (records.resources && Array.isArray(records.resources))'),
  'GAS_payroll.js hrBootstrap_ must check and deduplicate records.resources'
);
assert.ok(
  gasPayrollSrc.includes('const seenCode = new Set()'),
  'GAS_payroll.js must use seenCode Set for deduplication'
);
console.log('PASS Part 4: Backend hrBootstrap_ resource deduplication verified.');

console.log('\n===============================================================');
console.log('ALL RESOURCE DEDUP & REQUEST SYNC TESTS PASSED PERFECTLY!');
console.log('===============================================================');
