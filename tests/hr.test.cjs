const {runtime}=require('./backend.test.cjs');const fs=require('node:fs'),assert=require('node:assert/strict');
const r=runtime(fs.readFileSync('backend/GAS_payroll.js','utf8'));
function staff(name,role){const a=Array(24).fill('');Object.assign(a,{0:name,1:'Active',2:name.toLowerCase(),3:'pass',4:role,5:3000,8:name+'-IC',21:14,22:14,23:'[]'});return a;}
r.set('Staff',[Array(24).fill('header'),staff('ADMIN','Admin'),staff('MANAGER','HOD'),staff('ALICE','Staff'),staff('BOB','Staff')]);r.set('Leave',[Array(12).fill('header')]);r.set('Holidays',[['Date','Name']]);r.set('Data',[Array(7).fill('header')]);r.set('Attendance',[Array(15).fill('header')]);r.set('LockedMonths',[['Month','Data JSON']]);r.set('Payroll',[Array(16).fill('header'),['2026-09','A','ALICE',3000],['2026-09','B','BOB',2500]]);
const tokens=Object.fromEntries(['ADMIN','MANAGER','ALICE','BOB'].map(name=>{const x=r.request('login',{username:name.toLowerCase(),password:'pass'});assert.equal(x.status,'success');assert.ok(x.sessionToken);return [name,x.sessionToken]}));
const request=(who,action,payload={})=>r.request(action,payload,tokens[who]);
function save(who,module,record,extra={}){return request(who,'hrSave',{module,record,...extra});}
function ok(x){assert.equal(x.status,'success',x.message);return x.data;}
function transition(who,module,record,command,extra={}){return request(who,'hrTransition',{module,id:record.id,version:record.version,command,...extra});}
assert.equal(r.request('hrBootstrap').status,'error');assert.equal(JSON.parse(r.ctx.doGet({parameter:{action:'getStaff'}}).getContent()).status,'error');
const own=ok(request('ALICE','getStaff'));assert.deepEqual(Object.keys(own),['ALICE']);assert.equal(own.ALICE.password,undefined);assert.equal(ok(request('ADMIN','getStaff')).BOB.password,undefined);assert.equal(ok(request('ALICE','getPayroll')).length,1);assert.equal(request('ALICE','saveHolidays',[]).status,'error');assert.equal(request('MANAGER','saveSingleStaff',{name:'MANAGER',role:'Admin'}).status,'error');assert.equal(r.request('resetPassword',{username:'alice',icNo:'ALICE-IC',newPassword:'hacked'}).status,'error');
const company=ok(save('ADMIN','companies',{code:'SQ',title:'Setar Quay'}));const dept=ok(save('ADMIN','departments',{code:'BIM',title:'BIM',companyId:company.id,manager:'MANAGER'}));ok(request('ADMIN','saveSingleStaff',{name:'ALICE',username:'alice',role:'User',alEntitlement:14,mcEntitlement:14,basic:3000,companyId:company.id,departmentId:dept.id,manager:'MANAGER'}));assert.equal(r.sheets.HR_profiles,undefined);
assert.equal(save('ALICE','companies',{code:'X',title:'Blocked'}).status,'error');
let claim=ok(save('ALICE','claims',{employee:'BOB',category:'Medical',title:'Clinic',receiptNo:'R1',date:'2026-10-13',amount:120}));assert.equal(claim.employee,'ALICE');assert.equal(claim.status,'Pending manager');assert.equal(transition('BOB','claims',claim,'approve').status,'error');assert.equal(transition('ALICE','claims',claim,'approve').status,'error');
claim=ok(transition('MANAGER','claims',claim,'approve'));assert.equal(claim.status,'Pending admin');assert.equal(transition('MANAGER','claims',claim,'approve').status,'error');const stale={...claim};claim=ok(transition('ADMIN','claims',claim,'approve'));assert.equal(claim.status,'Approved');assert.equal(transition('ADMIN','claims',stale,'approve').status,'error');assert.equal(transition('ADMIN','claims',claim,'paid').status,'error');claim=ok(transition('ADMIN','claims',claim,'paid',{reference:'BANK-001'}));assert.equal(claim.status,'Paid');
assert.equal(save('ALICE','claims',{employee:'ALICE',category:'Medical',title:'bad',receiptNo:'R2',date:'bad',amount:-1}).status,'error');
const resource=ok(save('ADMIN','resources',{code:'CAR01',title:'Pool car',category:'Vehicle',availability:'Available'}));const b=ok(save('ALICE','bookings',{employee:'ALICE',resourceId:resource.id,start:'2026-10-14T09:00',end:'2026-10-14T10:00',title:'Site visit'}));assert.equal(save('BOB','bookings',{employee:'BOB',resourceId:resource.id,start:'2026-10-14T09:30',end:'2026-10-14T10:30',title:'Conflict'}).status,'error');ok(save('BOB','bookings',{employee:'BOB',resourceId:resource.id,start:'2026-10-14T10:00',end:'2026-10-14T11:00',title:'Adjacent'}));ok(transition('ADMIN','bookings',b,'approve'));
const cycle=ok(save('ADMIN','cycles',{title:'2026 Review',start:'2026-10-01',end:'2026-12-31',year:2026}));let review=ok(save('ADMIN','appraisals',{employee:'ALICE',cycleId:cycle.id,manager:'MANAGER',title:'Model quality'}));assert.equal(transition('BOB','appraisals',review,'selfReview',{rating:4}).status,'error');review=ok(transition('ALICE','appraisals',review,'selfReview',{rating:4}));review=ok(transition('MANAGER','appraisals',review,'managerReview',{rating:3}));review=ok(transition('ADMIN','appraisals',review,'finalise',{rating:5}));assert.equal(review.finalRating,3.5);assert.equal(review.status,'Completed');
const declaration=ok(save('ALICE','tax',{employee:'ALICE',year:2026,category:'Lifestyle',title:'Declared expense',amount:100}));ok(transition('ADMIN','tax',declaration,'review'));assert.equal(ok(request('BOB','hrBootstrap')).records.tax.length,0);
let letter=ok(save('ADMIN','letters',{employee:'ALICE',category:'Memo',title:'Memo',date:'2026-10-13',notes:'Letter body'}));assert.equal(ok(request('ALICE','hrBootstrap')).records.letters.length,0);letter=ok(transition('ADMIN','letters',letter,'issue'));assert.equal(ok(request('ALICE','hrBootstrap')).records.letters.length,1);
const adj=ok(save('ADMIN','adjustments',{employee:'ALICE',year:new Date().getFullYear(),category:'Annual',days:2,title:'Approved carry-forward'}));assert.equal(save('ADMIN','adjustments',{employee:'ALICE',year:2026,category:'Annual',days:3,title:'Edited'},{id:adj.id,version:adj.version}).status,'error');const login=r.request('login',{username:'alice',password:'pass'});assert.equal(login.user.alBalance,16,'Backend captured balance is followed when no opening balance recorded');
ok(request('ADMIN','saveSingleStaff',{name:'BOB',username:'bob',role:'Staff',status:'Active',basic:2500}));assert.equal(r.sheets.Staff.rows[4][3],'pass');
assert.ok(ok(request('ADMIN','hrBootstrap')).audit.length>=15);assert.equal(ok(request('BOB','hrBootstrap')).audit.length,0);

const policy=ok(save('ADMIN','claimPolicies',{title:'Medical policy',companyId:company.id,category:'Medical',year:2026,receiptLimit:150,annualLimit:200}));
assert.equal(save('ALICE','claims',{employee:'ALICE',category:'Medical',title:'Over limit',receiptNo:'R2',date:'2026-10-13',amount:160}).status,'error');
assert.equal(save('ALICE','claims',{employee:'ALICE',category:'Medical',title:'Annual cap',receiptNo:'R3',date:'2026-10-13',amount:100}).status,'error');
assert.equal(save('ALICE','claims',{employee:'ALICE',category:'Medical',title:'Duplicate',receiptNo:'R1',date:'2026-10-13',amount:10}).status,'error');
let loan=ok(save('ALICE','loans',{employee:'ALICE',title:'Emergency loan',date:'2026-10-13',amount:500,instalments:5}));loan=ok(transition('MANAGER','loans',loan,'approve'));loan=ok(transition('ADMIN','loans',loan,'approve'));loan=ok(transition('ADMIN','loans',loan,'disburse',{reference:'LOAN-01'}));assert.equal(loan.outstanding,500);loan=ok(transition('ADMIN','loans',loan,'repay',{reference:'REPAY-01',repayment:100}));assert.equal(loan.outstanding,400);assert.equal(transition('ADMIN','loans',loan,'repay',{reference:'REPAY-01',repayment:100}).status,'error');assert.equal(transition('ADMIN','loans',loan,'repay',{reference:'REPAY-02',repayment:500}).status,'error');loan=ok(transition('ADMIN','loans',loan,'repay',{reference:'REPAY-02',repayment:400}));assert.equal(loan.status,'Settled');
const payload={module:'training',requestId:'repeat-request-001',record:{employee:'ALICE',title:'BIM certification',date:'2026-10-14'}};const training=ok(request('ADMIN','hrSave',payload));ok(request('ADMIN','hrSave',payload));assert.equal(ok(request('ADMIN','hrBootstrap')).records.training.length,1);ok(transition('ADMIN','training',training,'complete'));
assert.equal(save('ADMIN','lifecycle',{employee:'ALICE',title:'Retired task'}).status,'error');assert.equal(request('ADMIN','hrTransition',{module:'lifecycle',id:'old-task',version:1,command:'complete'}).status,'error');assert.equal(ok(request('ADMIN','hrBootstrap')).records.lifecycle,undefined);
ok(transition('ADMIN','cycles',cycle,'closeCycle'));

// Test 1: Staff 45-column read/write & schedules round-trip
ok(request('ADMIN', 'saveSingleStaff', {
  name: 'CHARLIE',
  username: 'charlie',
  password: 'password123',
  role: 'Staff',
  status: 'Active',
  basic: 2800,
  companyId: company.id,
  departmentId: dept.id,
  workBase: 'SITE',
  location: 'PG',
  restDays: [0, 6],
  schedules: ['S1', 'S2']
}));
const charlieRead = ok(request('ADMIN', 'getStaff')).CHARLIE;
assert.ok(charlieRead, 'CHARLIE must be returned by getStaff');
assert.deepEqual(charlieRead.schedules, ['S1', 'S2'], 'Schedules array must round-trip via column 45');
assert.equal(charlieRead.schedule, 'S1, S2', 'Schedule display string must format correctly');
assert.deepEqual(charlieRead.restDays, [0, 6], 'Rest days must round-trip independently of schedules');
assert.equal(charlieRead.workBase, 'SITE');
assert.equal(charlieRead.location, 'PG');
assert.ok(r.sheets.Staff.rows.some(row => row[0] === 'CHARLIE' && row[44] === '["S1","S2"]'), 'Staff sheet row must contain schedules in column 45 (index 44)');

// Test 2: Holidays 6-column read/write & matrix round-trip
const holidayData = [
  { date: '2026-05-01', name: 'Labour Day', company: 'ALL', workBase: 'ALL', location: 'ALL', matrix: { OFFICE_PG: 1, SITE_PG: 1 } },
  { date: '2026-07-07', name: 'George Town Heritage Day', company: 'SQ', workBase: 'SITE', location: 'PG', matrix: { SITE_PG: 1 } }
];
ok(request('ADMIN', 'saveHolidays', holidayData));
const holidaysRead = ok(request('ADMIN', 'getHolidays'));
assert.equal(holidaysRead.length, 2);
assert.equal(holidaysRead[0].date, '2026-05-01');
assert.equal(holidaysRead[0].name, 'Labour Day');
assert.equal(holidaysRead[1].date, '2026-07-07');
assert.equal(holidaysRead[1].company, 'SQ');
assert.equal(holidaysRead[1].workBase, 'SITE');
assert.equal(holidaysRead[1].location, 'PG');
assert.deepEqual(holidaysRead[1].matrix, { SITE_PG: 1 });
assert.equal(r.sheets.Holidays.rows[1].length, 6, 'Holidays sheet row must contain 6 columns');
assert.equal(r.sheets.Holidays.rows[2][5], JSON.stringify({ SITE_PG: 1 }), 'Matrix column must serialize JSON');

// Test 3: Overnight shift 23:00 to 08:00 via hrSave on workSchedules
const nightShift = ok(save('ADMIN', 'workSchedules', {
  code: 'S9',
  title: 'Night Shift',
  company: 'SQ',
  workBase: 'Site',
  start: '23:00',
  end: '08:00',
  breakHours: 1,
  availability: 'Active'
}));
assert.ok(nightShift.id, 'Night shift must have generated ID');
assert.equal(nightShift.code, 'S9');
assert.equal(nightShift.start, '23:00');
assert.equal(nightShift.end, '08:00');
assert.equal(nightShift.breakHours, 1);
assert.equal(nightShift.netHours, 8, 'Net hours must be 9h - 1h break = 8.0h for overnight shift across midnight');
assert.equal(nightShift.workBase, 'SITE');

// Test 4: Strict holiday resolution when work base/location are unconfigured (and matrix filtering)
const dashboardCode = fs.readFileSync('src/services/dashboard.js', 'utf8');
assert.ok(dashboardCode.includes('getPublicHolidayForStaff'), 'dashboard.js must export getPublicHolidayForStaff');
assert.ok(dashboardCode.includes('validKeys.every') || dashboardCode.includes('if (!allActive) continue;'), 'Strict matrix matching must not leak to unconfigured profiles');
const fnMatch = dashboardCode.match(/function getPublicHolidayForStaff\(dateStr,\s*staffInfo\)\s*\{[\s\S]*?\n    \}/);
assert.ok(fnMatch, 'getPublicHolidayForStaff function extracted');
const fnNorm = dashboardCode.match(/function normalizeDateStr\(dateVal\)\s*\{[\s\S]*?\n    \}/);
assert.ok(fnNorm, 'normalizeDateStr function extracted');
const vmCtx = require('node:vm').createContext({
  holidays: [
    { date: '2026-05-01', name: 'Labour Day', company: 'ALL', matrix: { OFFICE_PG: 1, OFFICE_SEL: 1, SITE_PG: 1, SITE_SEL: 1, SITE_KL: 1, SITE_NS: 1 } },
    { date: '2026-07-07', name: 'George Town Heritage Day', company: 'ALL', matrix: { OFFICE_PG: 1, SITE_PG: 1 } }
  ],
  staffSettings: {},
  globalStaffMap: null
});
require('node:vm').runInContext(fnNorm[0] + '\n' + fnMatch[0] + '\nthis.getPublicHolidayForStaff = getPublicHolidayForStaff;', vmCtx);
assert.ok(vmCtx.getPublicHolidayForStaff('2026-05-01', { name: 'UNKNOWN', workBase: '', location: '' }), 'Nationwide holiday applies to unconfigured staff');
assert.equal(vmCtx.getPublicHolidayForStaff('2026-07-07', { name: 'UNKNOWN', workBase: '', location: '' }), null, 'Restricted matrix holiday does not leak to unconfigured staff');
assert.ok(vmCtx.getPublicHolidayForStaff('2026-07-07', { name: 'PG_STAFF', workBase: 'OFFICE', location: 'PG' }), 'George Town Heritage Day applies to OFFICE PG staff');
assert.equal(vmCtx.getPublicHolidayForStaff('2026-07-07', { name: 'KL_STAFF', workBase: 'SITE', location: 'KL' }), null, 'George Town Heritage Day does not apply to SITE KL staff');

ok(request('BOB','logout'));assert.equal(request('BOB','hrBootstrap').status,'error');r.sheets.Staff.rows[3][1]='Resigned';assert.equal(request('ALICE','hrBootstrap').status,'error');assert.ok(r.calls.release>0);
console.log('PASS: authenticated reads, password redaction/preservation, ownership and role enforcement, two-stage claims, payment reference, stale writes, booking overlap and adjacency, appraisal sequence, tax privacy, letter publication, immutable leave adjustment/login balance, audit visibility, logout and inactive-account denial, 45-col staff schedules, 6-col holidays matrix, overnight workSchedules, and strict holiday matrix resolution.');

