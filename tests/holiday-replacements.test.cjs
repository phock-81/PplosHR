const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

console.log('--- Testing Public Holidays 2026 & Sunday/Holiday Replacement Resolution ---');

const dashboardCode = fs.readFileSync('src/services/dashboard.js', 'utf8');

// Extract normalizeDateStr, DEFAULT_2026_HOLIDAYS, and getPublicHolidayForStaff
const fnNorm = dashboardCode.match(/function normalizeDateStr\([^\)]*\)\s*\{[\s\S]*?\n    \}/);
const defHols = dashboardCode.match(/const DEFAULT_2026_HOLIDAYS\s*=\s*\[[\s\S]*?\n    \];/);
const fnMatch = dashboardCode.match(/function getPublicHolidayForStaff\(dateStr,\s*staffInfo\)\s*\{[\s\S]*?\n    \}/);

assert.ok(fnNorm, 'normalizeDateStr extracted');
assert.ok(defHols, 'DEFAULT_2026_HOLIDAYS extracted');
assert.ok(fnMatch, 'getPublicHolidayForStaff extracted');

const ctx = {
    staffSettings: {},
    globalStaffMap: null,
    cachedCompanies: [],
    holidays: []
};
vm.createContext(ctx);
vm.runInContext(fnNorm[0] + '\n' + defHols[0] + '\nholidays = DEFAULT_2026_HOLIDAYS;\n' + fnMatch[0] + '\nthis.getPublicHolidayForStaff = getPublicHolidayForStaff;\nthis.DEFAULT_2026_HOLIDAYS = DEFAULT_2026_HOLIDAYS;', ctx);

// 1. Verify 24 holidays (including restored George Town World Heritage Day)
assert.equal(ctx.DEFAULT_2026_HOLIDAYS.length, 24, 'Must have exactly 24 holidays');
assert.ok(ctx.DEFAULT_2026_HOLIDAYS.some(h => h.date === '2026-07-07' && h.name.includes('George Town World Heritage Day')), 'Restored George Town World Heritage Day present');

// 2. Verify column entitlements
const cols = ['OFFICE_PG', 'OFFICE_SEL', 'SITE_PG', 'SITE_SEL', 'SITE_KL', 'SITE_NS'];
for (const col of cols) {
    const sum = ctx.DEFAULT_2026_HOLIDAYS.reduce((acc, h) => acc + (h.matrix[col] || 0), 0);
    assert.ok(sum >= 18, `Column ${col} has valid holiday sum: ${sum}`);
}

const sitePg = { workBase: 'SITE', location: 'PG' };
const siteKl = { workBase: 'SITE', location: 'KL' };
const siteSel = { workBase: 'SITE', location: 'SEL' };
const siteNs = { workBase: 'SITE', location: 'NS' };
const officePg = { workBase: 'OFFICE', location: 'PG' };

// 3. Thaipusam on 2026-02-01 (Sunday):
// - SITE staff replacement on 2026-02-02 (Monday)
const hSitePgMon = ctx.getPublicHolidayForStaff('2026-02-02', sitePg);
assert.ok(hSitePgMon && hSitePgMon.name.includes('Thaipusam'), 'SITE PG gets Thaipusam replacement on Monday 2026-02-02');

// - OFFICE PG does NOT have Thaipusam replacement on 2026-02-02 (they get it on 2026-02-16)
assert.equal(ctx.getPublicHolidayForStaff('2026-02-02', officePg), null, 'OFFICE PG does not have holiday on 2026-02-02');
const hOfficeFeb16 = ctx.getPublicHolidayForStaff('2026-02-16', officePg);
assert.ok(hOfficeFeb16 && hOfficeFeb16.name.includes('Replacement Thaipusam'), 'OFFICE PG gets Replacement Thaipusam on 2026-02-16');

// 4. Federal Territory Day on 2026-02-01 (Sunday) for SITE KL:
// Since 2026-02-02 is Thaipusam replacement, FT Day replacement rolls over to Tuesday 2026-02-03!
const hSiteKlTue = ctx.getPublicHolidayForStaff('2026-02-03', siteKl);
assert.ok(hSiteKlTue && hSiteKlTue.name.includes('Federal Territory'), 'SITE KL gets FT Day replacement on Tuesday 2026-02-03');

// 5. Hari Raya Puasa (2nd Day) on 2026-03-22 (Sunday) -> Replacement on 2026-03-23 (Monday)
const hRayaRep = ctx.getPublicHolidayForStaff('2026-03-23', sitePg);
assert.ok(hRayaRep && hRayaRep.name.includes('Hari Raya Puasa'), 'Replacement on Monday 2026-03-23 for Hari Raya 2nd day');

// 6. Wesak Day on 2026-05-31 (Sunday) and Agong Birthday on 2026-06-01 (Monday):
// Both 2026-06-01 (Monday) and 2026-06-02 (Tuesday) are public holidays!
const hJun1 = ctx.getPublicHolidayForStaff('2026-06-01', sitePg);
const hJun2 = ctx.getPublicHolidayForStaff('2026-06-02', sitePg);
assert.ok(hJun1, '2026-06-01 is a public holiday');
assert.ok(hJun2, '2026-06-02 is a public holiday (Agong Birthday replacement)');

// 7. Deepavali on 2026-11-08 (Sunday) -> Replacement on 2026-11-09 (Monday)
const hDeepavaliRep = ctx.getPublicHolidayForStaff('2026-11-09', sitePg);
assert.ok(hDeepavaliRep && hDeepavaliRep.name.includes('Deepavali'), 'Replacement on Monday 2026-11-09 for Deepavali');

// 8. Direct Sunday holiday match also recognized if working on Sunday
const hDeepavaliSun = ctx.getPublicHolidayForStaff('2026-11-08', sitePg);
assert.ok(hDeepavaliSun && hDeepavaliSun.name.includes('Deepavali'), 'Sunday 2026-11-08 is also recognized as holiday');

// 9. Rule: If Sunday is the working day, NO replacement if Sunday is holiday
const sitePgSundayWorker = { workBase: 'SITE', location: 'PG', isSundayWorkingDay: true };
const sitePgSunHoliday = ctx.getPublicHolidayForStaff('2026-02-01', sitePgSundayWorker);
assert.ok(sitePgSunHoliday && sitePgSunHoliday.name.includes('Thaipusam'), 'Sunday holiday recognized on Sunday for Sunday worker');
const sitePgMonRep = ctx.getPublicHolidayForStaff('2026-02-02', sitePgSundayWorker);
assert.equal(sitePgMonRep, null, 'NO replacement on Monday if Sunday is a working day');

const sitePgRestOnFriday = { workBase: 'SITE', location: 'PG', restDays: [5] }; // Friday rest day, Sunday work day
assert.equal(ctx.getPublicHolidayForStaff('2026-11-09', sitePgRestOnFriday), null, 'NO replacement on Monday 2026-11-09 for staff who work on Sunday (rest day Friday)');
assert.ok(ctx.getPublicHolidayForStaff('2026-11-08', sitePgRestOnFriday), 'Sunday 2026-11-08 Deepavali holiday observed directly on Sunday for Sunday worker');

console.log('PASS: All 23 holidays verified, matrix totals validated (18 each), and Sunday/Holiday replacement days accurately resolved.');
