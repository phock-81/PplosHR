const fs=require('node:fs'),assert=require('node:assert/strict');
const {runtime}=require('./backend.test.cjs');
const source=fs.readFileSync('backend/GAS_payroll.js','utf8');
const uncached=source.replace(/if\(action==='login'\|\|(?:action==='hrTransition'\|\|)?READ_ACTIONS_\.indexOf\(action\)!==-1\)requestSheetReads_=Object\.create\(null\);/,'requestSheetReads_=null;');
assert.notEqual(source,uncached,'Uncached comparison must disable request reuse');
const fixedTime=Date.now();
class FixedDate extends Date { constructor(...args){super(...(args.length?args:[fixedTime]));} static now(){return fixedTime;} }
function seed(code){
 const r=runtime(code); r.ctx.Date=FixedDate;
 const staff=(name,role,manager)=>{const a=Array(43).fill('');Object.assign(a,{0:name,1:'Active',2:name.toLowerCase(),3:'pass',4:role,21:14,22:14,24:name+'-ID',27:manager||''});return a};
 r.set('Staff',[Array(43).fill('Header'),staff('MANAGER','HOD'),staff('ALICE','User','MANAGER'),staff('BOB','User')]);
 r.set('Leave',[Array(12).fill('Header'),...Array.from({length:40},(_,i)=>['L'+i,i%2?'ALICE':'BOB','AL','2026-10-01','2026-10-01',1,'Test','','Approved','2026-10-01','',''])]);
 const year=new Date().getFullYear();
 r.set('HR_leaveOpeningBalances',[Array(7).fill('Header'),...['Annual','Medical','Hospitalisation'].map((category,i)=>['O'+i,1,'ALICE','Recorded',JSON.stringify({id:'O'+i,employee:'ALICE',category,year,days:60,effectiveDate:year+'-01-01'}),'',''])]);
 r.set('HR_adjustments',[Array(7).fill('Header')]);
 const token=r.request('login',{username:'manager',password:'pass'}).sessionToken;
 const alice=r.request('login',{username:'alice',password:'pass'}).sessionToken;
 assert.ok(token);assert.ok(alice);
 return {r,token,alice};
}
const old=seed(uncached),next=seed(source);
function measured(state,action,token){state.r.calls.read=0;state.r.calls.readBySheet={};const result=state.r.request(action,{},token);assert.equal(result.status,'success',result.message);return {result,reads:state.r.calls.read,sheets:{...state.r.calls.readBySheet}};}
for(const action of ['getLeaveData','leaveOverview','hrBootstrap']){
 const before=measured(old,action,action==='leaveOverview'?old.alice:old.token);
 const after=measured(next,action,action==='leaveOverview'?next.alice:next.token);
 assert.deepEqual(after.result,before.result,action+' must retain authorized response');
 assert.ok(after.reads<before.reads,action+' must reduce reads');
 assert.equal(after.sheets.Staff,1,action+' reads Staff once');
 console.log(`${action}: ${before.reads} -> ${after.reads} sheet range reads`);
}
const own=next.r.request('getLeaveData',{},next.alice);assert.ok(own.data.every(x=>x.name==='ALICE'),'No cross-actor data reuse');
next.r.sheets.Staff.rows[2][1]='Resigned';
assert.equal(next.r.request('getStaff',{},next.alice).status,'error','Next request must reread inactive status');
next.r.sheets.Staff.rows[2][1]='Active';
next.r.sheets.Staff.rows[1][4]='User';
assert.equal(next.r.request('getLeaveData',{},next.token).data.length,0,'Next request must observe role demotion');
// Read-only cache must not leak into mutation or direct helper executions.
const sheet=next.r.sheets.Staff;
assert.equal(next.r.ctx.readSheet_(sheet,false)[2][9],'');
sheet.rows[2][9]='999';
assert.equal(next.r.ctx.readSheet_(sheet,false)[2][9],'999');
const update=next.r.request('updateOwnProfile',{contactNo:'888',address:'New address',emergency:'Contact'},next.alice);
assert.equal(update.status,'success',update.message);
assert.equal(next.r.request('getStaff',{},next.alice).data.ALICE.contactNo,'888','Mutation is visible immediately');
console.log('PASS: response parity, bounded request reads, cross-user isolation, fresh account/role checks and post-write freshness.');
