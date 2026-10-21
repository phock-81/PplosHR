const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {runtime}=require('./backend.test.cjs');
const source=fs.readFileSync('src/services/dashboard.js','utf8');
const section=source.slice(source.indexOf('    // Keep server status values intact'),source.indexOf('    function toggleSummaryView()'));
const texts={},html={},elements={};
const $=selector=>elements[selector]||(elements[selector]={toString(){return selector},text(v){if(v===undefined)return texts[selector]||'';texts[selector]=v;return this},html(v){if(v===undefined)return texts[selector]||'';html[selector]=v;return this},empty(){html[selector]='';return this},append(v){html[selector]=(html[selector]||'')+String(v);return this},val(){return ''},removeClass(){return this},addClass(){return this},show(){return this},hide(){return this},prop(){return this},find(){return this},last(){return this},on(){return this},children(){return html[selector]?[1]:[]}});$.fn={};
let response=[],submitted;
const context={console,$,Intl,Date,CacheManager:{saveTeamLeave(){},getTeamLeave:()=>[]},currentUser:{name:'ALICE',role:'User'},isAdmin:false,staffSettings:{ALICE:{name:'ALICE',manager:'HOD'}},formatLocalDate:s=>String(s).slice(0,10),prompt:()=> 'Please withdraw',apiPost:async(action,payload)=>{if(action==='updateLeaveStatus'){submitted=payload;return {status:'success'}}return {status:'success',data:response}},bootstrap:{Modal:{getOrCreateInstance:()=>({show(){}}),getInstance:()=>({hide(){}})}},document:{getElementById:()=>({})}};
vm.createContext(context);vm.runInContext(section+'\nglobalThis.leaveTest={leaveStatusView,leaveMatchesStatus,leaveCanDecide,fetchMyLeave,fetchLeaveManagementData,withdrawLeave,confirmLeaveDecision};',context);
const t=context.leaveTest;
(async()=>{
 response=[{id:'L1',name:'ALICE',status:'pending_hod',rowIndex:2,start:'2099-01-01',end:'2099-01-02',type:'AL',days:2},{id:'L2',name:'ALICE',status:'pending_admin',rowIndex:3,start:'2099-02-01',end:'2099-02-01',type:'AL',days:1},{id:'L3',name:'ALICE',status:'approved',rowIndex:4,start:'2099-03-01',end:'2099-03-01',type:'AL',days:1}];
 await t.fetchMyLeave();assert.equal(texts['#myLeavePending'],2);assert.equal(texts['#myNextLeave'],'2099-03-01');assert.ok(html['#myLeaveTableBody'].includes('Awaiting HOD approval'));assert.ok(html['#myLeaveTableBody'].includes('Awaiting HR approval'));
 for(const status of ['Pending','pending_hod','pending_admin'])assert.ok(t.leaveMatchesStatus(status,'Pending'));assert.ok(t.leaveMatchesStatus('approved','Approved'));assert.equal(t.leaveMatchesStatus('Withdrawal Requested','Pending'),false);
 const raw=response[0].status;await t.withdrawLeave('L1',2);assert.equal(submitted.expectedStatus,raw);assert.equal(submitted.requestId,'L1');assert.equal(submitted.newStatus,'Withdrawal Requested');
 context.currentUser={name:'HOD',role:'HOD'};response=[response[0]];await t.fetchLeaveManagementData();assert.equal(texts['#pendingCount,#teamPending'],1);assert.ok(html['#approvalTableBody'].includes('L1'));
 context.currentUser={name:'HR',role:'HR'};context.isAdmin=true;await t.fetchLeaveManagementData();assert.equal(texts['#pendingCount,#teamPending'],0);
 response[0]={...response[0],status:'pending_admin'};await t.fetchLeaveManagementData();assert.equal(texts['#pendingCount,#teamPending'],1);
 vm.runInContext("leaveDecisionPending={record:teamLeaveRecords[0],newStatus:'Approved'}",context);await t.confirmLeaveDecision();assert.equal(submitted.expectedStatus,'pending_admin');
 const backend=runtime(fs.readFileSync('backend/GAS_payroll.js','utf8'));backend.ctx.hrCheckLeave_=()=>{};
 const staff=(name,role,manager='')=>{const r=Array(45).fill('');Object.assign(r,{0:name,1:'Active',4:role,24:name,27:manager});return r};
 for(const role of ['User','HOD','HR','Admin'])for(const status of ['pending_hod','pending_admin','Pending'])for(const direct of [true,false]){
   const actor={name:'REVIEWER',role},manager=direct?'REVIEWER':'OTHER';backend.set('Staff',[Array(45).fill('header'),staff('REVIEWER',role),staff('ALICE','User',manager)]);backend.set('Leave',[Array(15).fill('header'),['L','ALICE','AL','2099-01-01','2099-01-01',1,'','',status]]);
   let allowed=true;try{backend.ctx.hrLegacyPayload_('updateLeaveStatus',{rowIndex:2,requestId:'L',expectedStatus:status,newStatus:'Approved'},actor)}catch{allowed=false}
   const actual=t.leaveCanDecide({name:'ALICE',status},actor,{ALICE:{name:'ALICE',manager}},direct);
   assert.equal(actual,allowed,JSON.stringify({role,status,direct}));
 }
 assert.equal(t.leaveCanDecide({name:'REVIEWER',status:'pending_hod'},{name:'REVIEWER',role:'HOD'},{},true),false);
 console.log('PASS: real desktop leave counters/rendering/filtering recognize current stages; HOD/HR queues match backend approval permissions; decisions and withdrawal preserve raw expectedStatus.');
})().catch(e=>{console.error(e);process.exitCode=1});

