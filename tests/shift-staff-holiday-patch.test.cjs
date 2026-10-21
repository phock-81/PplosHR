const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const gas=fs.readFileSync(path.join(ROOT,'backend/GAS_payroll.js'),'utf8');
const dash=fs.readFileSync(path.join(ROOT,'src/services/dashboard.js'),'utf8');
const work=fs.readFileSync(path.join(ROOT,'src/components/HrWorkspace.vue'),'utf8');
function functionSource(src,start,next){
  const a=src.indexOf(start);assert.ok(a>=0,'Missing '+start);
  const b=src.indexOf(next,a+start.length);assert.ok(b>a,'Missing end delimiter '+next);
  return src.slice(a,b);
}
// Backend mock spreadsheet: exactly 45 fields for Staff and 6 for Holidays.
{
  const ctx=vm.createContext({requestSheetReads_:null,copySheetRows_:rows=>rows});
  vm.runInContext(functionSource(gas,'function readSheet_(', 'function copySheetRows_('),ctx);
  for(const [name,expected] of [['Staff',45],['Holidays',6]]){
    let width;
    const sheet={getName:()=>name,getLastRow:()=>2,getLastColumn:()=>name==='Staff'?43:2,getRange:(r,c,n,w)=>{width=w;return {getDisplayValues:()=>[['header'],['row']],getValues:()=>[['header'],['row']]};}};
    vm.runInContext('void 0',ctx);
    const rows=ctx.readSheet_(sheet,true);
    assert.equal(width,expected,`${name} read width`);
    assert.equal(rows.length,2);
  }
}
// Shift validation checks an actual extracted backend function with mock system settings.
{
  const spec={fields:[
    {key:'company',label:'Company',type:'select',required:true,options:['SQ','MS']},
    {key:'workBase',label:'Work Base',type:'select',required:true,options:['Office','Site']},
    {key:'code',label:'Code',type:'text',required:true},
    {key:'title',label:'Title',type:'text',required:true},
    {key:'start',label:'Start',type:'text',required:true},
    {key:'end',label:'End',type:'text',required:true},
    {key:'breakHours',label:'Break',type:'number',required:true,min:0,max:10},
    {key:'netHours',label:'Net',type:'number',required:true,min:0,max:24},
    {key:'availability',label:'Availability',type:'select',required:true,options:['Active','Inactive']},
  ]};
  const companies=[{code:'SQ',title:'Setar Quay'},{code:'MS',title:'Milan Stream'}];
  const bases=[{code:'OFFICE',title:'Office'},{code:'SITE',title:'Site'}];
  const ctx=vm.createContext({
    HR_MODULES:{workSchedules:spec},
    hrAssert_:(b,msg)=>{if(!b)throw Error(msg)},
    hrRows_:(mod)=>mod==='companies'?companies:mod==='workBases'?bases:[],
    hrDirectory_:()=>[],hrAdmin_:()=>true,hrName_:s=>String(s).toUpperCase(),hrDate_:v=>v,
  });
  vm.runInContext(functionSource(gas,'function hrValidate_(', 'function hrConflict_('),ctx);
  const x={company:'SQ',workBase:'Site',code:'S4',title:'Night shift',start:'23:00',end:'08:00',breakHours:1,netHours:99,availability:'Active'};
  assert.equal(ctx.hrValidate_('workSchedules',x,{role:'HR'}).netHours,8,'overnight net hours');
  assert.equal(ctx.hrValidate_('workSchedules',{...x,start:'08:00',end:'17:30'},{}).netHours,8.5);
  assert.equal(ctx.hrValidate_('workSchedules',x,{}).workBase,'SITE');
  assert.throws(()=>ctx.hrValidate_('workSchedules',{...x,breakHours:10},{}),/Break time/);
  assert.throws(()=>ctx.hrValidate_('workSchedules',{...x,company:'INVALID'},{}),/active Company/);
  assert.throws(()=>ctx.hrValidate_('workSchedules',{...x,start:'25:00'},{}),/HH:MM/);
}
// Actual holiday entitlement resolver extracted from source; missing work location must not inherit restricted holidays.
{
  const ctx=vm.createContext({
    holidays:[
      {date:'2026-01-01',company:'All',workBase:'All',location:'All',matrix:{OFFICE_PG:1,OFFICE_SEL:1,SITE_PG:1,SITE_SEL:1,SITE_KL:1,SITE_NS:1}},
      {date:'2026-03-02',company:'SQ',workBase:'SITE',location:'PG',matrix:{OFFICE_PG:0,OFFICE_SEL:0,SITE_PG:1,SITE_SEL:0,SITE_KL:0,SITE_NS:0}}
    ],
    cachedCompanies:[{id:'UUID-SQ',code:'SQ',title:'Setar Quay'}],
    staffSettings:{},normalizeDateStr:v=>v
  });
  vm.runInContext(functionSource(dash,'    function getPublicHolidayForStaff(', "    if (typeof window !== 'undefined') window.getPublicHolidayForStaff"),ctx);
  assert.ok(ctx.getPublicHolidayForStaff('2026-01-01',{}),'universal holiday for unknown region');
  assert.equal(ctx.getPublicHolidayForStaff('2026-03-02',{companyId:'UUID-SQ'}),null,'unknown region does not inherit restricted day');
  assert.ok(ctx.getPublicHolidayForStaff('2026-03-02',{companyId:'UUID-SQ',workBase:'SITE',location:'PG'}),'correct eligible employee');
  assert.equal(ctx.getPublicHolidayForStaff('2026-03-02',{company:'MS',workBase:'SITE',location:'PG'}),null,'company boundary');
  assert.equal(ctx.getPublicHolidayForStaff('2026-03-02',{company:'SQ',workBase:'OFFICE',location:'PG'}),null,'base boundary');
  assert.equal(ctx.getPublicHolidayForStaff('2026-03-02',{company:'SQ',workBase:'SITE',location:'SEL'}),null,'location boundary');
}
// Staff read-back: schedule codes must survive and must not be mistaken for rest days.
{
  const header=Array(45).fill('');header[0]='Name';header[23]='Biometric ID';header[43]='Rest Days';header[44]='Schedules';
  const staff=Array(45).fill('');staff[0]='TEST EMPLOYEE';staff[1]='Active';staff[4]='User';staff[23]='TESTBIO';staff[24]='EMP-01';staff[43]='[]';staff[44]='["S1","S2"]';
  const ctx=vm.createContext({
    getSpreadsheet_:()=>({getSheetByName:()=>({})}),readSheet_:()=>[header,staff],
    hrRole_:x=>x,jsonResponse:x=>x,defaultBiometrics_:{}
  });
  vm.runInContext(functionSource(gas,'function hrStaffCols_(', '// --- STAFF MANAGEMENT ---'),ctx);
  vm.runInContext(functionSource(gas,'function getStaff(', 'function saveSingleStaff('),ctx);
  const result=ctx.getStaff().data['TEST EMPLOYEE'];
  assert.equal(JSON.stringify(result.schedules),JSON.stringify(['S1','S2']));
  assert.equal(JSON.stringify(result.restDays),'[]','empty rest day setting must be preserved');
}
// Holiday matrix read-back from full six-column rows.
{
  const sheetRows=[['Date','Name','Company','WorkBase','Location','Matrix'],
    ['2026-03-02','Site Holiday','SQ','SITE','PG','{"SITE_PG":1,"OFFICE_PG":0}']];
  const ctx=vm.createContext({getSpreadsheet_:()=>({getSheetByName:()=>({})}),readSheet_:()=>sheetRows,jsonResponse:x=>x});
  vm.runInContext(functionSource(gas,'function getHolidays(', 'function getData('),ctx);
  const result=ctx.getHolidays().data;
  assert.equal(result[0].company,'SQ');
  assert.equal(result[0].workBase,'SITE');
  assert.equal(result[0].location,'PG');
  assert.equal(result[0].matrix.SITE_PG,1);
}
assert.ok(!gas.includes('widths = {Staff:44, Holidays:2'),'old column limits removed');
assert.ok(!gas.includes('parsedRestDays = JSON.parse(row[44])'),'schedule collision removed');
assert.ok(!dash.includes('sObj.restDays) && sObj.restDays.length'),'empty rest-days correctly retained');
assert.ok(work.includes("active==='workSchedules'&&field.key==='netHours'"),'net hours set readonly');
assert.ok(dash.includes("Existing custom records and other years will be preserved"),'non-destructive preload');
console.log('PASS: shift/staff/holiday corrective patch focused regression tests');
