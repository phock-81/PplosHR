const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const code=fs.readFileSync(__dirname+'/../backend/biotime-sync.source.js','utf8');
function run({raw=[],att=[],locks=[],records,commit=true,role='HR',duplicate=false}={}){
 const header=Array(44).fill('');header[43]='Biometric ID';
 const employee=Array(44).fill('');employee[0]='MASTER NAME';employee[2]='login';employee[24]='EMP001';employee[25]='C1';employee[43]='00123';
 const tables={Staff:[header,employee,...(duplicate?[employee]:[])],Data:[['id','name','date','weekday','in','out','total'],...raw],Attendance:[['id'],...att],LockedMonths:[['month'],...locks.map(x=>[x,'{}'])]};
 const before=JSON.stringify(tables),writes=[];
 const ss={getSheetByName(name){return {getDataRange:()=>({getDisplayValues:()=>tables[name]}),getLastRow:()=>tables[name].length,getRange:()=>({setNumberFormat(){return this},setValues(rows){writes.push(rows);tables[name].push(...rows)}})}}};
 const ctx={hrAssert_:(ok,msg)=>{if(!ok)throw Error(msg)},hrAdmin_:a=>['HR','Admin'].includes(a.role),getSpreadsheet_:()=>ss,hrStaffCols_:()=>({bioCol:43}),ensureRows_:()=>{},jsonResponse:r=>r};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const row={biometricId:'00123',date:'2026-10-01',in:'08:00',out:'17:00',totalHrs:'09:00'};
 const result=ctx.syncBioTimeAttendance_({from:'2026-10-01',to:'2026-10-16',dryRun:!commit,records:records||[row]},{role});
 return {result,tables,before,writes};
}
let r=run();assert.equal(r.result.counts.inserted,1);assert.equal(r.tables.Data[1][0],'EMP001');assert.equal(r.tables.Data[1][1],'MASTER NAME');
r=run({commit:false});assert.equal(JSON.stringify(r.tables),r.before);
const existing=['EMP001','MASTER NAME','2026-10-01','Thursday','08:00','17:00','09:00'];
r=run({raw:[existing]});assert.equal(r.result.counts.identical,1);assert.equal(JSON.stringify(r.tables),r.before);
r=run({raw:[[...existing.slice(0,5),'18:00','10:00']]});assert.equal(r.result.counts.conflicts,1);assert.equal(JSON.stringify(r.tables),r.before);
r=run({att:[existing]});assert.equal(r.result.counts.identical,1);assert.equal(r.writes.length,0);
for(const key of ['2026-10','2026-10__C1']){r=run({locks:[key]});assert.equal(r.result.counts.locked,1);assert.equal(r.writes.length,0);}
r=run({records:[{biometricId:'NOTREGISTERED',date:'2026-10-01',in:'08:00',out:'17:00',totalHrs:'09:00'}]});assert.equal(r.result.counts.unmatched,1);
r=run({duplicate:true});assert.equal(r.result.counts.ambiguous,1);
assert.throws(()=>run({role:'Staff'}),/access/);
const row={biometricId:'00123',date:'2026-10-01',in:'08:00',out:'17:00',totalHrs:'09:00'};
r=run({records:[row,{...row,out:'18:00'}]});assert.equal(r.result.counts.conflicts,1);assert.equal(r.writes.length,0);
r=run({records:[row,row]});assert.equal(r.result.counts.inserted,1);
assert.throws(()=>run({raw:[['EMP001','MASTER NAME','01/10/2026']]}),/non-ISO/);
console.log('PASS: insert-only, master-name mapping, preview, duplicates, conflicts, both sheets, locks, unmatched/ambiguous IDs, role checks and legacy dates.');
