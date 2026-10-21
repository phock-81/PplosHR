import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAttendancePunches } from '../src/utils/attendanceMerge.mjs';
const base={joinedDate:'2024-01-01',employeeName:'TEST EMPLOYEE'};
const e=(type,t,id) => ({id,type,serverTime:t,date:new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'}),status:'Recorded',photolink:`https://drive.google.com/file/d/${id}/view`});
test('multiple same-day biometric rows are accumulated, not overwritten',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',imported:[
  {Date:'2026-10-16',ClockIn:'08:30',ClockOut:'17:30'},
  {Date:'2026-10-16',ClockIn:'08:05',ClockOut:'18:20'},
  {Date:'2026-10-16',ClockIn:'08:16',ClockOut:'19:00'}
 ]});assert.equal(r.length,1);assert.equal(r[0].ClockIn,'08:05');assert.equal(r[0].ClockOut,'19:00');
});
test('biometric first IN with mobile later OUT',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',imported:[{Date:'2026-10-16',In:'07:55'}],mobileEvents:[e('OUT','2026-10-16T10:31:00Z','M-OUT')]});
 assert.equal(r[0].ClockIn,'07:55');assert.equal(r[0].clockInSource,'Biometric');assert.equal(r[0].ClockOut,'18:31');assert.equal(r[0].clockOutSource,'Mobile');
});
test('mobile first IN with biometric later OUT',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',mobileEvents:[e('IN','2026-10-15T23:12:00Z','M-IN')],imported:[{Date:'2026-10-16',In:'08:15',Out:'17:40'}]});
 assert.equal(r[0].ClockIn,'07:12');assert.equal(r[0].clockInSource,'Mobile');assert.equal(r[0].ClockOut,'17:40');assert.equal(r[0].clockOutSource,'Biometric');
});
test('mobile clock-out selects LATEST of multiple source outs',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',mobileEvents:[e('OUT','2026-10-16T11:33:00Z','M-OUT')],imported:[{Date:'2026-10-16',In:'08:00',Out:'17:05'}]});
 assert.equal(r[0].ClockOut,'19:33');assert.equal(r[0].clockOutSource,'Mobile');
});
test('unconfirmed queued offline data is not silently counted',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',mobileEvents:[{...e('IN','2026-10-16T01:00:00Z','Q'),isOffline:true,status:'Queued (Offline)'}]});assert.equal(r.length,0);
});
test('night-shift next-day early OUT belongs to previous evening IN',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',imported:[{Date:'2026-10-15',In:'23:00'}, {Date:'2026-10-16',Out:'08:10'}]});
 assert.equal(r.find(x=>x.Date==='2026-10-15')?.ClockOut,'08:10 (+1d)');
});
test('morning OUT stays on same date when that date has early IN',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',imported:[{Date:'2026-10-15',In:'23:00'}, {Date:'2026-10-16',In:'06:00',Out:'08:10'}]});
 assert.equal(r.find(x=>x.Date==='2026-10-16')?.ClockOut,'08:10');
});
test('pre-joining attendance is not displayed',()=>{
 const r=mergeAttendancePunches({...base,joinedDate:'2026-10-16',month:'2026-10',imported:[{Date:'2026-10-15',In:'09:00'},{Date:'2026-10-16',In:'09:10'}]});
 assert.equal(r.length,1);assert.equal(r[0].Date,'2026-10-16');
});
test('re-clocking in after earlier out leaves current session open with ClockOut —',()=>{
 const r=mergeAttendancePunches({...base,month:'2026-10',mobileEvents:[
   e('IN','2026-10-15T23:51:00Z','M-IN1'), // 07:51 MYT
   e('OUT','2026-10-16T01:15:00Z','M-OUT1'), // 09:15 MYT
   e('IN','2026-10-16T01:49:00Z','M-IN2') // 09:49 MYT
 ]});
 assert.equal(r[0].ClockIn,'07:51');
 assert.equal(r[0].ClockOut,'—');
 assert.equal(r[0].latestIn,'09:49');
 assert.equal(r[0].isOpen,true);
 assert.equal(r[0].interimOut,'09:15');
});
