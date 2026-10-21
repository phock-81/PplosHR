const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const root=fs.existsSync(path.resolve(__dirname,'../source')) ? path.resolve(__dirname,'../source') : path.resolve(__dirname,'..');
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
const hr=get('src/components/HrWorkspace.vue'),sch=get('src/hr/schema.js'),gas=get('backend/GAS_payroll.js'),db=get('src/services/dashboard.js'),vue=get('src/components/PayrollDashboard.vue');
let passed=0;function check(name,fn){try{fn();console.log('PASS',name);passed++}catch(e){console.error('FAIL',name,e.message);process.exitCode=1}}
function functionSource(source,name){const start=source.indexOf('function '+name+'(');if(start<0)throw Error('missing '+name);let pos=source.indexOf('{',start),level=0,quote=null,escape=false,template=false;for(let i=pos;i<source.length;i++){const c=source[i];if(quote){if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c===quote){quote=null;continue}continue}if(c==='"'||c==="'"||c==='`'){quote=c;continue}if(c==='{')level++;if(c==='}')if(--level===0)return source.slice(start,i+1)}throw Error('unterminated '+name)}
check('shift hours: same-day/overnight/break validation',()=>{
 const fn=vm.runInNewContext(functionSource(hr,'calcNetHours')+';calcNetHours');
 assert.equal(fn('08:00','17:30',1),8.5);assert.equal(fn('23:00','08:00',1),8);assert.equal(fn('17:00','08:00',1),14);assert.equal(fn('08:00','08:00',1),null);assert.equal(fn('08:00','09:00',2),null);assert.equal(fn('25:00','08:00',1),null);assert.equal(fn('08:00','10:00','bad'),null);
});
check('shift codes distinguish SQ/MS/global',()=>{const records={value:{workSchedules:[{company:'SQ',code:'S1'},{company:'SQ',code:'S3'},{company:'MS',code:'M2'},{company:'MS',code:'A1'},{company:'All',code:'G1'}]}};const fn=vm.runInNewContext(functionSource(hr,'getNextShiftCode')+';getNextShiftCode',{records});assert.equal(fn('SQ'),'S4');assert.equal(fn('MS'),'M3');assert.equal(fn('All'),'G2')});
check('schema exposes All company, Work Base, Location',()=>{assert.match(sch,/options:\['SQ','MS','All'\]/);assert.match(sch,/f\('workLocation','Work Location'/);assert.match(sch,/workBases:\{/);assert.match(sch,/workLocations:\{/)});
check('shift UI fields and display',()=>{assert.match(hr,/label:'All companies'/);assert.match(hr,/label:'All work locations'/);assert.match(hr,/active==='workSchedules'&&field.key==='title'/);assert.match(hr,/\['start','end'\]\.includes\(field.key\)\?'time'/);assert.match(hr,/<th>Work Location<\/th>/);assert.match(hr,/form\.value\.netHours = net === null/)});
check('HR can assign HOD, cannot assign HR/Admin',()=>{assert.match(db, /const isSuperadmin = currentUser\.role === 'Admin'/);assert.match(db,/\$\('#staffRole'\)\.prop\('disabled', false\)/);assert.match(gas,/\['User','HOD'\]\.includes\(role\)/);assert.match(gas,/Only Superadmin can assign HR or Admin roles/)});
check('job grade dropdown selected and saved',()=>{assert.match(vue,/<select id="staffJobGrade"/);assert.match(db,/fill\('staffJobGrade'/);assert.match(db,/gradeId: \$\('#staffJobGrade'\)\.val\(\)/);assert.match(gas,/const requestedGrade=/);assert.match(gas,/result\.gradeId=requestedGrade\|\|jobGrade/)});
check('staff schedules rendered and filtered',()=>{assert.match(vue,/id="staffScheduleOptionsContainer"/);assert.match(db,/const schLocation=String\(sch\.workLocation\|\|'All'\)/);assert.match(db,/schComp !== 'ALL'/);assert.match(db,/staffLocation'\)\.off\('change\.sch'/);assert.match(db,/schedules: selectedSchedules/)});
check('backend shift schema and location reference validates',()=>{
 assert.match(gas,/"key": "workLocation"/);assert.match(gas,/const isAll=f\.key!=='workBase'/);assert.match(gas,/f\.key==='workBase'\?'workBases':'workLocations'/);
});
check('backend HR shift validation handles overnight and global',()=>{
 const HR_MODULES={workSchedules:{fields:[{key:'company',label:'Company',type:'select',options:['SQ','MS','All'],required:true},{key:'workBase',label:'Work Base',type:'select',options:['Office','Site'],required:true},{key:'workLocation',label:'Location',type:'select',options:['All','PG','SEL','KL','NS'],required:true},{key:'code',label:'Shift code',type:'text',required:true},{key:'title',label:'Description',type:'text',required:true},{key:'start',label:'Start',type:'text',required:true},{key:'end',label:'End',type:'text',required:true},{key:'breakHours',label:'Break',type:'number',required:true,min:0,max:10},{key:'netHours',label:'Net',type:'number',required:true,min:0,max:24},{key:'availability',label:'Availability',type:'select',options:['Active','Inactive'],required:true}]}};
 const refs={companies:[{code:'SQ'},{code:'MS'}],workBases:[{code:'OFFICE'},{code:'SITE'}],workLocations:[{code:'PG'},{code:'SEL'}]};
 const ctx={HR_MODULES,hrAssert_:(v,msg)=>{if(!v)throw Error(msg)},hrRows_:k=>refs[k]||[],hrDirectory_:()=>[],hrName_:x=>x,hrDate_:x=>x,Number,Math,RegExp};
 const fn=vm.runInNewContext(functionSource(gas,'hrValidate_')+';hrValidate_',ctx);
 const row={company:'All',workBase:'OFFICE',workLocation:'All',code:'G1',title:'Global Office Night',start:'23:00',end:'08:00',breakHours:1,netHours:900,availability:'Active'};
 assert.equal(fn('workSchedules',row,{role:'HR'}).netHours,8);
 assert.equal(fn('workSchedules',{...row,company:'SQ',workLocation:'PG'},{}).workLocation,'PG');
 assert.throws(()=>fn('workSchedules',{...row,workLocation:'INVALID'},{}),/Select an active Location/);
 assert.throws(()=>fn('workSchedules',{...row,workBase:'NOTABASE'},{}),/Select an active Work Base/);
 assert.throws(()=>fn('workSchedules',{...row,breakHours:10},{}),/Break time/);
});
check('staff and holiday backend widths retained',()=>{assert.match(gas,/Staff:45, Holidays:6/);assert.match(gas,/row\[44\]/);assert.match(gas,/Schedules/)});
console.log(`${passed} focused checks passed`);if(process.exitCode)process.exit(1);
