const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','backend','GAS_payroll.js'),'utf8');
const PHOTO='data:image/jpeg;base64,'+Buffer.from([255,216,255,224,0,16,74,70,73,70,0,0,255,217]).toString('base64');
function setup(shouldFail=false){
 const appended={event:[],document:[]}, files=[];
 const c={console, Date, Buffer, Logger:{log(){}}, ContentService:{MimeType:{JSON:'json'},createTextOutput:(s)=>({setMimeType(){return this},getContent(){return s}})},
  Utilities:{getUuid:()=> 'DOC-UUID',formatDate:(d,tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-10-16':fmt==='HH-mm-ss'?'09-12-00':'2026-10-16',base64Decode:s=>Buffer.from(s,'base64'),newBlob:(bytes,mime,name)=>({bytes,mime,name})},
  SpreadsheetApp:{openById:()=>({getSheetByName:(name)=>name==='Attendance'?{getName:()=> 'Attendance',getLastRow:()=>2,getLastColumn:()=>15,getRange:()=>({getValues:()=>[Array(15).fill(''),['','TEST EMPLOYEE','2026-10-16','','08:00','','','','','','','','','','']]})}:null})},DriveApp:{Access:{},Permission:{}}
 };
 vm.createContext(c);vm.runInContext(source,c);
 c.hrName_=x=>String(x).toUpperCase();c.hrAssert_=(ok,message)=>{if(!ok)throw Error(message)};
 c.mobileClockTarget_=()=>({name:'TEST EMPLOYEE',employeeNo:'E001'});
 c.mobileClockPolicy_=()=>({mode:'ANYWHERE',siteId:''});c.mobileClockSites_=()=>[];
 c.mobileClockStaffFolder_=()=>({createFile(blob){if(shouldFail)throw Error('Drive permission denied');const file={getUrl:()=> 'https://drive.google.com/file/d/TEST/view',blob};files.push(file);return file;}});
 c.hrRows_=(mod)=> mod==='mobileClockEvent'?[]:[];
 c.hrSheet_=(mod)=>({getLastColumn:()=>7,getRange:()=>({setValue(){}}),appendRow(row){(mod==='mobileClockEvent'?appended.event:appended.document).push(row);}});
 // Use the real mobileClockHasBiometricIn_ with a mocked biometric Attendance sheet.
 return {c,appended,files};
}
test('confirmed mobile punch writes a real private Drive link to event JSON and sheet H',()=>{
 const {c,appended,files}=setup();
 const result=JSON.parse(c.mobileClockPunch_({type:'IN',requestId:'punch-1234567890',latitude:5.414,longitude:100.321,accuracyM:18,capturedAt:new Date().toISOString(),photo:PHOTO},{name:'TEST EMPLOYEE',role:'User'}).getContent());
 assert.equal(result.status,'success');
 assert.equal(result.data.photolink,'https://drive.google.com/file/d/TEST/view');
 assert.equal(appended.event[0][6],'5.414, 100.321');
 assert.equal(appended.event[0][7],result.data.photolink);
 assert.equal(JSON.parse(appended.event[0][4]).photolink,result.data.photolink);
 assert.equal(appended.document[0][7],result.data.photolink);
 assert.equal(appended.event[0][4].includes('data:image/jpeg'),false);
});

test('mobile punch writes address to Column G when address is supplied',()=>{
 const {c,appended}=setup();
 const r=JSON.parse(c.mobileClockPunch_({type:'IN',requestId:'punch-address-test',latitude:5.414,longitude:100.321,accuracyM:18,capturedAt:new Date().toISOString(),photo:PHOTO,address:'Lorong Bukit Minyak 3, Juru, 14000',checkInLocation:'Site A',remark:'On time'},{name:'TEST EMPLOYEE',role:'User'}).getContent());
 assert.equal(r.status,'success');
 assert.equal(appended.event[0][6],'Lorong Bukit Minyak 3, Juru, 14000');
 assert.equal(appended.event[0][8],'Site A');
 assert.equal(appended.event[0][9],'On time');
});
test('Drive failure must NEVER claim punch success or append attendance',()=>{
 const {c,appended}=setup(true);
 assert.throws(()=>c.mobileClockPunch_({type:'IN',requestId:'punch-1234567890',latitude:5.414,longitude:100.321,accuracyM:18,capturedAt:new Date().toISOString(),photo:PHOTO},{name:'TEST EMPLOYEE',role:'User'}), /Unable to save verification photo/);
 assert.equal(appended.event.length,0);
});
test('missing verification photo must reject before recording',()=>{
 const {c,appended}=setup();
 assert.throws(()=>c.mobileClockPunch_({type:'IN',requestId:'punch-1234567890',latitude:5.414,longitude:100.321,accuracyM:18,capturedAt:new Date().toISOString(),photo:''},{name:'TEST EMPLOYEE',role:'User'}), /valid camera JPEG/);
 assert.equal(appended.event.length,0);
});
test('mobile OUT can use a valid biometric IN to support mixed-source day',()=>{
 const {c,appended}=setup();
 const r=JSON.parse(c.mobileClockPunch_({type:'OUT',requestId:'punch-1234567890',latitude:5.414,longitude:100.321,accuracyM:18,capturedAt:new Date().toISOString(),photo:PHOTO},{name:'TEST EMPLOYEE',role:'User'}).getContent());
 assert.equal(r.status,'success');assert.equal(appended.event.length,1);
});
test('new shift creation uses requestId without id; edit-id path rejects nonexistent record',()=>{
 const {c}=setup();
 c.hrRows_=()=>[];
 c.hrDirectory_=()=>[];
 c.hrWrite_=(module,record)=>c.jsonResponse({status:'success',data:record});
 const shift={company:'SQ',workBase:'Office',code:'O1',title:'OFFICE',start:'08:00',end:'17:30',breakHours:1,netHours:8.5,availability:'Active',notes:''};
 const result=JSON.parse(c.hrSave_({module:'workSchedules',requestId:'seed-SCH-SQ-O1',record:shift},{name:'TEST HR',role:'HR'}).getContent());
 assert.equal(result.status,'success');assert.equal(result.data.code,'O1');
 assert.throws(()=>c.hrSave_({module:'workSchedules',id:'SCH-SQ-O1',requestId:'seed-SCH-SQ-O1',record:shift},{name:'TEST HR',role:'HR'}),/Record not found/);
});
