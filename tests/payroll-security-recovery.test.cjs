const fs=require('fs'),assert=require('node:assert/strict');
const {runtime}=require('./backend.test.cjs');
const source=fs.readFileSync('backend/GAS_payroll.js','utf8');
function staff(name,role,company,manager='') { const r=Array(45).fill(''); Object.assign(r,{0:name,1:'Active',2:name.toLowerCase(),3:'private-password-'+name,4:role,5:1000,8:'private-IC',20:'private-bank',24:'EMP-'+name,25:company,27:manager,30:1,36:30,44:'[]'}); return r; }
const claim=(id,employee,amount,status='Approved',date='2026-10-10')=>[id,1,employee,status,JSON.stringify({id,employee,amount,status,date,version:1}),'',''];
function fixture() {
 const r=runtime(source);
 r.set('Staff',[Array(45).fill('header'),staff('ADMIN','Admin','A'),staff('HR','HR','A'),staff('MANAGER','HOD','A'),staff('ALICE','User','A','MANAGER'),staff('BOB','User','B','OTHER')]);
 r.set('Holidays',[['Date','Name']]); r.set('Data',[Array(7).fill('header'),['EMP-ALICE','ALICE','2026-10-01','','08:00','17:00',9],['EMP-BOB','BOB','2026-10-01','','08:00','17:00',9]]);
 r.set('Attendance',[Array(15).fill('header'),['EMP-ALICE','ALICE','2026-10-01'],['EMP-BOB','BOB','2026-10-01']]);
 r.set('Leave',[Array(15).fill('header')]);
 r.set('LockedMonths',[['Month','Data JSON'],['2026-09__B',JSON.stringify({month:'2026-09',company:'B',status:'Locked',rates:{BOB:{basic:1000}},password:'never-send'})]]);
 r.set('Payroll',[Array(21).fill('header'),payrow('BOB',777,'2026-10','B'),payrow('ALICE',800,'2026-09','A')]);
 r.set('HR_claims',[['ID','Version','Employee','Status','Record JSON','Updated At','Updated By'],claim('CA','ALICE',100),claim('CB','BOB',200),claim('LATE','ALICE',50,'Approved','2026-10-21')]);
 const tokens={}; for(const name of ['ADMIN','HR','MANAGER','ALICE'])tokens[name]=r.ctx.hrIssueSession_({name});
 r.req=(action,payload={},name='ADMIN')=>r.request(action,payload,tokens[name]); return r;
}
function payrow(name,net=1000,month='2026-10',company='') { const r=Array(21).fill('0.00'); Object.assign(r,{0:month,1:'EMP-'+name,2:name,3:1000,4:26,6:1000,15:net,20:company}); return r; }
const payload=()=>({month:'2026-10',company:'A',data:{rates:{ALICE:{basic:1000},BOB:{basic:1000}}},payrollData:[payrow('ALICE'),payrow('BOB')]});
{
 const r=fixture();
 assert.equal(r.req('getAttendanceApproval',{includeData:true},'ALICE').status,'error');
 const hod=r.req('getAttendanceApproval',{includeData:true},'MANAGER'); assert.equal(hod.status,'success',hod.message);
 assert.deepEqual(Object.keys(hod.data.staff).sort(),['ALICE','MANAGER']);
 for(const field of ['data','attendance'])assert.deepEqual(hod.data[field].map(x=>x.name),['ALICE']);
 assert.equal(hod.data.staff.ALICE.basic,undefined); assert.equal(hod.data.staff.ALICE.bankNo,undefined);
 assert.equal(hod.data.lockedMonths['2026-09__B'],undefined);
 for(const role of ['MANAGER','HR','ADMIN']) { const result=r.req('getAttendanceApproval',{includeData:true},role); assert.equal(result.status,'success'); assert.ok(!JSON.stringify(result).includes('private-password')); assert.ok(!JSON.stringify(result).includes('never-send')); assert.ok(!JSON.stringify(result).includes('\"password\"')); }
 console.log('PASS: authenticated attendance read rejects User, scopes HOD staff/data/attendance/locks, omits passwords for every allowed role.');
}
{
 const r=fixture(), beforeB=JSON.stringify(r.sheets.Payroll.rows[1]), beforeBLock=JSON.stringify(r.sheets.LockedMonths.rows[1]);
 const res=r.req('lockMonth',payload()); assert.equal(res.status,'success',res.message);
 const rows=r.req('getPayroll').data, a=rows.find(x=>x.month==='2026-10'&&x.name==='ALICE');
 assert.equal(Number(a.claims),100); assert.equal(Number(a.nettPay),1100); assert.equal(a.companyId,'A');
 assert.equal(JSON.stringify(r.sheets.Payroll.rows.find(x=>x[2]==='BOB')),beforeB);
 assert.equal(JSON.stringify(r.sheets.LockedMonths.rows[1]),beforeBLock);
 assert.equal(r.sheets.HR_claims.rows[1][3],'Paid'); assert.equal(r.sheets.HR_claims.rows[2][3],'Approved'); assert.equal(r.sheets.HR_claims.rows[3][3],'Approved');
 const first=JSON.stringify(r.sheets.Payroll.rows), claims=JSON.stringify(r.sheets.HR_claims.rows);
 assert.equal(r.req('lockMonth',payload()).status,'success'); assert.equal(JSON.stringify(r.sheets.Payroll.rows),first); assert.equal(JSON.stringify(r.sheets.HR_claims.rows),claims);
 assert.equal(r.req('unlockMonth',{month:'2026-10',company:'A'}).status,'success'); assert.equal(r.req('lockMonth',payload()).status,'success'); assert.equal(Number(r.req('getPayroll').data.find(x=>x.month==='2026-10'&&x.name==='ALICE').nettPay),1100);
 const locked=JSON.parse(r.sheets.LockedMonths.rows.find(x=>x[0]==='2026-10__A')[1]); assert.deepEqual(Object.keys(locked.rates),['ALICE']);
 console.log('PASS: supplied payroll reimburses claims, isolates company payroll/claims/locks, and retry plus unlock/relock cannot duplicate reimbursement.');
}
for(const failure of ['payroll','claims','lock','complete']) {
 const r=fixture(); let thrown=false;
 const sheet=failure==='payroll'?r.sheets.Payroll:failure==='claims'?r.sheets.HR_claims:failure==='lock'?r.sheets.LockedMonths:null;
 if(sheet) { const get=sheet.getRange.bind(sheet), append=sheet.appendRow.bind(sheet);
   sheet.getRange=(...args)=>{const range=get(...args); for(const method of ['setValues','setValue']) {const original=range[method]; if(original)range[method]=(...v)=>{if(!thrown && ((failure==='payroll' && args[0]===2)||failure==='claims'||failure==='lock')) {thrown=true; throw Error('Injected '+failure+' failure');} return original(...v);};} return range;};
   if(failure==='lock')sheet.appendRow=(...args)=>{if(!thrown){thrown=true;throw Error('Injected lock failure');}return append(...args);};
 } else {const apply=r.ctx.payrollApplyOperation_; r.ctx.payrollApplyOperation_=operation=>{ const sheet=r.sheets.PayrollOperations,get=sheet.getRange.bind(sheet); sheet.getRange=(...args)=>{const range=get(...args),set=range.setValue; range.setValue=value=>{if(value==='Complete'&&!thrown){thrown=true;throw Error('Injected completion failure');}return set(value);}; return range;};return apply(operation);};}
 const result=r.req('lockMonth',payload()); assert.equal(result.status,'error',failure); assert.ok(thrown);
 if(failure==='payroll')assert.equal(r.sheets.HR_claims.rows[1][3],'Approved');
 assert.equal(r.req('getPayroll').status,'error','partial payroll must not be published');
 assert.equal(r.req('getStaffDossier',{name:'ALICE'},'ALICE').status,'error','dossier must not publish partial payroll');
 assert.equal(r.req('saveData',[]).status,'error','mutations must wait for recovery');
 assert.equal(r.req('lockMonth',{...payload(),company:'B'}).status,'error','other company must not overwrite pending snapshot');
 assert.equal(r.req('lockMonth',payload()).status,'success',failure+' retry');
 const a=r.req('getPayroll').data.find(x=>x.month==='2026-10'&&x.name==='ALICE');assert.equal(Number(a.nettPay),1100);assert.equal(Number(a.claims),100);
 assert.equal(r.sheets.HR_claims.rows[1][3],'Paid'); assert.equal(r.ctx.payrollPendingOperation_(),null);
 console.log('PASS: '+failure+' failure leaves durable recoverable operation; retry completes exact payroll once.');
}
{
 const r=fixture(), original=JSON.stringify(r.sheets.HR_claims.rows); const p=payload(); p.payrollData=[payrow('ADMIN')];
 assert.equal(r.req('lockMonth',p).status,'error');assert.equal(JSON.stringify(r.sheets.HR_claims.rows),original);assert.ok(!r.sheets.LockedMonths.rows.some(x=>x[0]==='2026-10__A'));
 const wrong=payload();wrong.payrollData[0][0]='2026-11'; assert.equal(r.req('lockMonth',wrong).status,'error');
 const generated=r.req('lockMonth',{month:'2026-10',company:'A'}); assert.equal(generated.status,'success',generated.message);
 const a=r.req('getPayroll').data.find(x=>x.month==='2026-10'&&x.name==='ALICE'); assert.equal(Number(a.claims),100);assert.equal(r.sheets.HR_claims.rows[2][3],'Approved');
 console.log('PASS: missing employee/wrong period cannot pay claims; generated payroll is company scoped.');
}

{
 const r=fixture(); assert.equal(r.req('lockMonth',payload()).status,'success');
 const all={...payload(),company:'ALL'};
 assert.equal(r.req('lockMonth',all).status,'error','ALL must not replace company lock');
 assert.equal(r.req('unlockMonth',{month:'2026-10',company:'A'}).status,'success');
 assert.equal(r.req('lockMonth',all).status,'success');
 assert.equal(r.req('lockMonth',payload()).status,'error','company must not replace ALL lock');
 console.log('PASS: overlapping ALL/company finalized locks require explicit unlock.');
}

{
 const r=fixture(); let held=false, reads=0;
 r.ctx.LockService.getScriptLock=()=>({tryLock:()=>held=true,hasLock:()=>held,releaseLock:()=>held=false});
 const get=r.sheets.Payroll.getRange.bind(r.sheets.Payroll);
 r.sheets.Payroll.getRange=(...args)=>{const range=get(...args), read=range.getDisplayValues;range.getDisplayValues=()=>{assert.ok(held,'payroll must be read under commit lock');reads++;return read();};return range;};
 assert.equal(r.req('getPayroll').status,'success');assert.equal(r.req('getStaffDossier',{name:'ALICE'},'ALICE').status,'success');assert.equal(reads,2);assert.equal(held,false);
 const company={id:'A',code:'COMP-A',title:'Company A'};r.set('HR_companies',[Array(7).fill('header'),['A',1,'','Active',JSON.stringify(company),'','']]);
 assert.equal(r.req('lockMonth',{...payload(),company:'Company A'}).status,'success');
 assert.equal(r.req('unlockMonth',{month:'2026-10',company:'COMP-A'}).status,'success');
 assert.ok(!r.sheets.LockedMonths.rows.some(row=>row[0]==='2026-10__A'));
 console.log('PASS: payroll and dossier readers share commit lock; company aliases resolve to stable lock and unlock identity.');
}
{
 const r=fixture();r.set('HR_claims',[Array(7).fill('header')]);
 for(let i=1;i<=12;i++) {
   const month='2027-'+String(i).padStart(2,'0');
   const result=r.req('lockMonth',{month,company:'A',payrollData:[payrow('ALICE',1000,month,'A')]});
   assert.equal(result.status,'success',result.message);
   assert.equal(r.sheets.PayrollOperations.getLastRow(),i+1,'one compact journal marker per completed approval');
 }
 assert.ok(r.sheets.PayrollOperations.rows.slice(1).every(row=>row[1]==='Complete'&&row[2]==='meta'&&!row[4].includes('lockedData')));
 console.log('PASS: twelve approvals retain twelve compact completion markers, with no historical payroll snapshots.');
}
{
 const r=fixture(), apply=r.ctx.payrollApplyOperation_;let failed=false;
 r.ctx.payrollApplyOperation_=operation=>{const sheet=r.sheets.PayrollOperations,remove=sheet.deleteRows.bind(sheet);sheet.deleteRows=(...args)=>{if(!failed){failed=true;throw Error('Injected journal cleanup failure');}return remove(...args);};return apply(operation);};
 assert.equal(r.req('lockMonth',payload()).status,'success','cleanup failure must not roll back completed payroll');
 assert.equal(r.ctx.payrollPendingOperation_(),null);assert.ok(r.sheets.PayrollOperations.getLastRow()>2);
 assert.equal(r.req('lockMonth',payload()).status,'success');assert.equal(r.sheets.PayrollOperations.getLastRow(),2,'idempotent approval retries deferred cleanup');
 const a=r.req('getPayroll').data.find(row=>row.month==='2026-10'&&row.name==='ALICE');assert.equal(Number(a.nettPay),1100);
 console.log('PASS: journal cleanup failure leaves approval Complete and retry safely compacts it without changing payroll.');
}
{
 const r=fixture();r.sheets.Staff.rows.find(row=>row[0]==='ALICE')[43]='101';r.sheets.Staff.rows.find(row=>row[0]==='BOB')[43]='202';
 r.set('Attendance',[Array(15).fill('header'),['101','ALICE','2026-10-01','','09:00','18:00',9],['202','BOB','2026-10-01','','07:00','16:00',9],['101','BOB','2026-10-02','','06:00','15:00',9],['202','ALICE','2026-10-03','','06:00','15:00',9]]);
 r.set('Data',[Array(7).fill('header'),['101','ALICE','2026-10-01','','08:00','17:00',9],['101','','2026-10-02','','08:30','17:30',9],['EMP-ALICE','ALICE','2026-10-03','','08:45','17:45',9],['202','BOB','2026-10-04','','07:00','16:00',9],['999','ALICE EXTRA','2026-10-05','','05:00','14:00',9]]);
 const res=r.req('mobileClockConfig',{},'ALICE');assert.equal(res.status,'success',res.message);
 assert.deepEqual(res.data.attendance.map(row=>[row.date,row.in]),[['2026-10-01','09:00'],['2026-10-02','08:30'],['2026-10-03','08:45']]);
 assert.ok(res.data.attendance.every(row=>row.name==='ALICE'&&row.id==='EMP-ALICE'));
 assert.ok(res.data.attendance.every(row=>!('basic' in row)&&!('payType' in row)&&!('password' in row)));
 assert.equal(r.req('mobileClockConfig',{employee:'BOB'},'ALICE').status,'error');
 console.log('PASS: mobile config returns only own exact name/employee/biometric history, rejects conflicting IDs and substring matches, and saved corrections override raw dates.');
}
{
 const r=fixture();const saved=['EMP-ALICE','ALICE','2026-10-01','Normal','08:00','17:00',9,'DAY',0,0,8,0,2,'Approved overtime',237.5];
 r.set('Attendance',[Array(15).fill('header'),saved,['EMP-BOB','BOB','2026-10-01','Normal','08:00','17:00',9,'DAY',0,0,8,0,2,'',999]]);
 const hod=r.req('getAttendanceApproval',{includeData:true},'MANAGER');assert.equal(hod.status,'success');assert.equal(hod.data.attendance.length,1);
 assert.equal(hod.data.attendance[0].extraOT,'2');assert.ok(!('manualOTPay' in hod.data.attendance[0]));assert.ok(!JSON.stringify(hod.data.attendance).includes('237.5'));
 for(const role of ['HR','ADMIN']) {const res=r.req('getAttendanceApproval',{includeData:true},role);assert.equal(res.data.attendance.find(row=>row.name==='ALICE').manualOTPay,'237.5');}
 assert.equal(r.req('getAttendance',{},'MANAGER').status,'error');
 const actor={name:'MANAGER',role:'HOD'};
 const raw=r.ctx.getAttendance();const legacy=JSON.parse(r.ctx.hrLegacyResponse_('getAttendance',raw,actor).getContent());assert.equal(legacy.data.length,1);assert.ok(!('manualOTPay' in legacy.data[0]));
 const composite=r.ctx.jsonResponse({status:'success',data:{attendance:JSON.parse(raw.getContent())}});
 const boot=JSON.parse(r.ctx.hrLegacyResponse_('getBootstrap',composite,actor).getContent());assert.equal(boot.data.attendance.data.length,1);assert.ok(!('manualOTPay' in boot.data.attendance.data[0]));
 console.log('PASS: saved numeric OT-pay override is withheld from HOD approval/legacy/bootstrap responses and retained for HR/Admin.');
}
