const {runtime}=require('./backend.test.cjs');
const fs=require('node:fs'),assert=require('node:assert/strict');
const r=runtime(fs.readFileSync('backend/GAS_payroll.js','utf8'));
function employee(name,role,manager=''){const row=Array(31).fill('');Object.assign(row,{0:name,1:'Active',2:name.toLowerCase(),3:'test-password',4:role,5:3000,23:'[]',24:'EMP-'+name,27:manager,30:1});return row;}
r.set('Staff',[Array(31).fill('header'),employee('ADMIN','Admin'),employee('HR','HR'),employee('HEAD','HOD'),employee('ALICE','User','HEAD'),employee('BOB','Staff'),employee('OLDHEAD','Supervisor')]);
r.set('Leave',[Array(12).fill('header'),['L1','ALICE','Annual','2026-10-15','2026-10-15',1,'','','Pending'],['L2','BOB','Annual','2026-10-15','2026-10-15',1,'','','Pending']]);
r.set('Payroll',[Array(16).fill('header'),['2026-09','A','ALICE',3000],['2026-09','B','BOB',4000]]);
const tokens={};for(const name of ['ADMIN','HR','HEAD','ALICE','BOB','OLDHEAD']){const v=r.request('login',{username:name.toLowerCase(),password:'test-password'});assert.equal(v.status,'success');tokens[name]=v.sessionToken;if(name==='OLDHEAD')assert.equal(v.user.role,'HOD');if(name==='BOB')assert.equal(v.user.role,'User');}
const req=(who,action,payload={})=>r.request(action,payload,tokens[who]);
const ok=v=>{assert.equal(v.status,'success',v.message);return v.data;};
const save=(who,name,role,extra={})=>req(who,'saveSingleStaff',{name,username:name.toLowerCase(),role,status:'Active',basic:3000,...extra});
assert.equal(save('HR','ALICE','Admin').status,'error');
assert.equal(save('HR','ADMIN','Admin').status,'error');
assert.equal(save('HR','ADMIN','HR').status,'error');
ok(save('HR','HR','HR',{password:'replacement'}));
assert.equal(save('HEAD','ALICE','User').status,'error');
ok(save('HR','ALICE','User',{jobTitle:'BIM Modeller',version:1}));
assert.equal(r.sheets.Staff.rows[4][28],'BIM Modeller');assert.equal(r.sheets.Staff.rows[4][27],'HEAD');
assert.equal(save('HR','ALICE','User',{jobTitle:'stale',version:1}).status,'error');
ok(save('HR','NEW','HR',{password:'test-password'}));
ok(save('HR','NEW_USER','User',{password:'test-password'}));
assert.ok([45, 46].includes(r.sheets.Staff.rows.at(-1).length));assert.ok(r.sheets.Staff.rows.at(-1)[24]);
assert.equal(save('ADMIN','ADMIN','User').status,'error');
assert.equal(save('ADMIN','BOB','User',{manager:'BOB'}).status,'error');
assert.equal(save('ADMIN','BOB','User',{employeeNo:'EMP-ALICE'}).status,'error');
assert.equal(save('ADMIN','BOB','User',{username:'alice'}).status,'error');
assert.equal(req('ADMIN','deleteSingleStaff',{name:'BOB'}).status,'error');
assert.equal(req('ADMIN','hrSave',{module:'profiles',record:{employee:'BOB'}}).status,'error');
assert.equal(req('HEAD','getBootstrap').status,'error');assert.equal(req('HEAD','getData').status,'error');
assert.equal(ok(req('HEAD','getPayroll')).length,0);const headStaff=ok(req('HEAD','getStaff'));assert.deepEqual(Object.keys(headStaff).sort(),['ALICE','HEAD']);assert.equal(headStaff.ALICE.basic,0);
assert.deepEqual(ok(req('HEAD','getLeaveData')).map(x=>x.name),['ALICE']);
assert.equal(req('HEAD','updateLeaveStatus',{rowIndex:3,newStatus:'Approved'}).status,'error');
ok(req('HR','hrSave',{module:'leaveOpeningBalances',record:{employee:'ALICE',year:2026,category:'Annual',effectiveDate:'2026-01-01',days:10,historyMode:'Keep existing records after effective date',title:'Verified opening fixture'}}));
ok(req('HEAD','updateLeaveStatus',{rowIndex:2,newStatus:'Approved'}));assert.equal(r.sheets.Leave.rows[1][8],'Approved');
const profiles=ok(req('ADMIN','hrBootstrap')).records.profiles;assert.equal(profiles.find(x=>x.employee==='ALICE').jobTitle,'BIM Modeller');assert.equal(r.sheets.HR_profiles,undefined);
assert.equal(req('HEAD','hrBootstrap',{scope:'all'}).status,'error');assert.equal(req('ALICE','hrBootstrap',{scope:'team'}).status,'error');
const personal=ok(req('ADMIN','hrBootstrap',{scope:'personal'}));assert.ok(personal.records.profiles.every(x=>x.employee==='ADMIN'));assert.equal(personal.audit.length,0);
ok(save('ADMIN','HEAD','User'));assert.equal(req('HEAD','updateLeaveStatus',{rowIndex:2,newStatus:'Rejected'}).status,'error');
assert.equal(ok(req('HR','getStaff')).ADMIN.password,undefined);

// Verify HR HOD (role: HOD, department: HR) is able to edit HR account
const hrDept = ok(req('ADMIN','hrSave',{module:'departments',record:{code:'HR',title:'Human Resources',companyId:'ALL'}}));
ok(save('ADMIN','HR_HEAD','HOD',{departmentId:hrDept.id,password:'test-password'}));
const hrHeadToken = r.request('login',{username:'hr_head',password:'test-password'}).sessionToken;
ok(r.request('saveSingleStaff',{name:'HR',username:'hr',role:'HR',status:'Active',basic:4000},hrHeadToken));
console.log('PASS: HR privilege boundaries, role aliases, last Admin protection, employee master identity, stale edits, account uniqueness, team leave scope, payroll privacy, role changes effective in active sessions.');

