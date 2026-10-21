'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const extension=fs.readFileSync(path.join(root,'backend','mobile_clock_append.js'),'utf8');
const gas=fs.readFileSync(path.join(root,'backend','GAS_payroll.js'),'utf8');
const mobile=fs.readFileSync(path.join(root,'src','components','mobile','MobileAttendance.vue'),'utf8');
const profile=fs.readFileSync(path.join(root,'src','components','StaffDossierModal.vue'),'utf8');
const admin=fs.readFileSync(path.join(root,'src','components','MobileClockPolicyAdmin.vue'),'utf8');
const data={mobileClockPolicy:[],mobileClockSite:[],mobileClockEvent:[]};
const USERS={ALICE:{id:'EMP-A',company:'C1',active:true},BOB:{id:'EMP-B',company:'C1',active:true},INACTIVE:{id:'EMP-C',company:'C1',active:false}};
let seq=0;
const fakeDriveFiles=[];
const ctx={
  Math,Date,Number,String,JSON,Array,Set,
  Utilities:{
    getUuid:()=>`testing-id-${++seq}`,
    formatDate:(d,tz,fmt)=>d.toISOString().slice(0,10),
    base64Decode:(s)=>Buffer.from(s,'base64'),
    newBlob:(bytes,mime,name)=>({bytes,mime,name})
  },
  DriveApp:{
    Access:{ANYONE_WITH_LINK:'ANYONE_WITH_LINK'},
    Permission:{VIEW:'VIEW'}
  },
  hrName_:v=>String(v||'').trim().toUpperCase(),
  hrAdmin_:a=>['HR','Admin'].includes(a.role),
  hrAssert_:(ok,msg)=>{if(!ok)throw Error(msg)},
  hrStaffTarget_:(name)=>{const x=USERS[name];if(!x)throw Error('Employee not found');const r=Array(44).fill('');r[0]=name;r[1]=x.active?'Active':'Resigned';r[24]=x.id;r[25]=x.company;return {row:r,index:2}},
  hrEnsureStaffFolder_:(target)=>({
    createFile:(blob)=>{
      const file={getId:()=>`mock-file-${++seq}`,getUrl:()=>`https://drive.google.com/file/d/mock-file-${seq}/view`,setSharing:()=>{}};
      fakeDriveFiles.push(file);
      return file;
    }
  }),
  hrRows_:m=>data[m] || [],
  hrPublic_:r=>({...r,_row:undefined}),
  hrWrite_:(m,rec,actor,old,action)=>{const now=new Date().toISOString();const o={...rec,version:(old?.version||0)+1,updatedAt:now,updatedBy:actor.name};const idx=data[m].findIndex(r=>r.id===o.id);if(idx<0)data[m].push(o);else data[m][idx]=o;return {status:'success',data:o}},
  hrSheet_:(m,create)=>{
    if(!data[m]&&create)data[m]=[];
    return {
      getLastColumn:()=>8,
      getRange:(r,c)=>({setValue:()=>{}}),
      appendRow(row){
        const rec=JSON.parse(row[4]);
        if(row[7])rec.photolink=row[7];
        data[m].push(rec);
      }
    };
  },
  jsonResponse:x=>x
};
vm.createContext(ctx);vm.runInContext(extension,ctx);
const HR={name:'HR ADMIN',role:'HR'},A={name:'ALICE',role:'User'},B={name:'BOB',role:'User'};
function fail(fn,part){assert.throws(fn,e=>e.message.includes(part),part)}
assert.equal(ctx.mobileClockConfig_({},A).data.policy.mode,'OFF');
fail(()=>ctx.mobileClockConfig_({employee:'BOB'},A),'Not authorized');
fail(()=>ctx.mobileClockPolicySave_({employee:'ALICE',mode:'ANYWHERE'},A),'Only HR');
fail(()=>ctx.mobileClockPunch_({type:'IN'},A),'not enabled');
const site=ctx.mobileClockSiteSave_({name:'Main Site',latitude:5.4141,longitude:100.3288,radiusM:250,companyId:'C1',active:true},HR).data;
assert.ok(site.id);
fail(()=>ctx.mobileClockSiteSave_({name:'bad',latitude:94,longitude:100,radiusM:200},HR),'Invalid site latitude');
fail(()=>ctx.mobileClockPolicySave_({employee:'ALICE',mode:'GEOFENCED',siteId:'not-a-site'},HR),'active geofence site');
const pol=ctx.mobileClockPolicySave_({employee:'ALICE',mode:'GEOFENCED',siteId:site.id},HR).data;
assert.equal(pol.mode,'GEOFENCED');
assert.equal(ctx.mobileClockConfig_({},A).data.sites.length,1);
const now=()=>new Date().toISOString();
const punch=(actor,type,latitude,longitude,accuracyM=15,requestId=`test-punch-${++seq}-234567`)=>
  ctx.mobileClockPunch_({type,latitude,longitude,accuracyM,requestId,capturedAt:now()},actor);
fail(()=>punch(A,'IN',5.45,100.39),'Outside the permitted');
fail(()=>punch(A,'IN',5.4141,100.3288,180),'accuracy too low');
fail(()=>ctx.mobileClockPunch_({type:'IN',requestId:'valid-id-123456789',latitude:null,longitude:null,accuracyM:10,capturedAt:now()},A),'real GPS');
const ok=punch(A,'IN',5.4141,100.3288);
assert.equal(ok.status,'success');assert.equal(ok.data.mode,'GEOFENCED');assert.equal(data.mobileClockEvent.length,1);
fail(()=>punch(A,'IN',5.4141,100.3288),'Already clocked in');
const replay=ctx.mobileClockPunch_({type:'IN',requestId:ok.data.id,latitude:5.4141,longitude:100.3288,accuracyM:10,capturedAt:'2000-01-01T00:00:00Z'},A);
assert.equal(replay.duplicate,true);assert.equal(data.mobileClockEvent.length,1);
// Test clock-out after a legitimate elapsed interval without needing live device movement.
data.mobileClockEvent[0].serverTime=new Date(Date.now()-60_000).toISOString();
assert.equal(punch(A,'OUT',5.4141,100.3288).status,'success');
fail(()=>punch(A,'OUT',5.4141,100.3288),'No open clock-in');
ctx.mobileClockPolicySave_({employee:'BOB',mode:'ANYWHERE'},HR);
const any=punch(B,'IN',3.139,101.6869);assert.equal(any.data.mode,'ANYWHERE');assert.equal(any.data.distanceM,null);
assert.equal(ctx.mobileClockConfig_({},B).data.sites.length,0);
assert.equal(ctx.mobileClockConfig_({employee:'BOB'},HR).data.events.length,1);
ctx.mobileClockPolicySave_({employee:'BOB',mode:'OFF'},HR);
fail(()=>punch(B,'OUT',3.139,101.6869),'not enabled');

// Test clock punch with verification photo and staff profile document archive
data.mobileClockEvent[1].serverTime=new Date(Date.now()-60_000).toISOString();
const samplePhoto = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD_test_selfie_data';
const photoPunch = ctx.mobileClockPunch_({
  type: 'IN',
  latitude: 5.4141,
  longitude: 100.3288,
  accuracyM: 12,
  requestId: `test-punch-photo-${++seq}-234567`,
  capturedAt: now(),
  photo: samplePhoto
}, A);
assert.equal(photoPunch.status, 'success');
assert.ok(photoPunch.data.photolink, 'photoPunch must contain Google Drive photolink');
assert.ok(photoPunch.data.photolink.includes('drive.google.com'), 'photolink must be Google Drive URL');
assert.equal(data.mobileClockEvent.at(-1).photolink, photoPunch.data.photolink);
assert.ok(data.staffDocuments && data.staffDocuments.length > 0, 'Must record photo in staffDocuments');
assert.equal(data.staffDocuments[0].category, 'Attendance Photo');
assert.equal(data.staffDocuments[0].photolink, photoPunch.data.photolink);

const aliceConfig = ctx.mobileClockConfig_({}, A);
assert.ok(aliceConfig.data.events.some(e => e.photolink === photoPunch.data.photolink), 'Config must return photolink for audit');

// Mandatory source integration checks.
for(const a of ['mobileClockConfig','mobileClockSiteSave','mobileClockPolicySave','mobileClockPunch'])assert.ok(gas.includes(`if(action==='${a}')`),`missing route ${a}`);
assert.ok(gas.includes("'mobileClockConfig'"),'config must be a read action');
assert.ok(gas.includes('photolink'),'GAS must include photolink column in mobileClockEvent');
for(const token of ['navigator.geolocation.getCurrentPosition','maximumAge:0','mobileClockPunch','Clock In','Clock Out','clockSubmitting','pploshr_offline_punches','openCameraModal','captureSnapshot'])assert.ok(mobile.includes(token),token);
for(const token of ['MobileClockPolicyAdmin',"canManageMobileClock && profile.name",'Attendance & Verification','openAttendanceRecord'])assert.ok(profile.includes(token),token);
for(const token of ['Save Staff Permission','Verification Photo','openAttendance','previewPhoto'])assert.ok(admin.includes(token),token);
console.log('PASS mobile clock GPS: permission, geographic boundary, location quality, duplicate, clock sequence, history isolation, front-camera photo verification, Google Drive photolink, offline queue, profile archive, UI and API integration');
