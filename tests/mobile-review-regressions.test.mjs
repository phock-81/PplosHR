import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getMobileCached, clearMobileSessionCache } from '../src/services/mobileSessionCache.js';
function component(name, extra = {}) {
 const source = fs.readFileSync(new URL(`../src/components/mobile/${name}.vue`, import.meta.url), 'utf8').match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/^import .*;\s*$/gm, '');
 const calls = [];
 const context = vm.createContext({ref: value => ({value}), computed: fn => ({get value(){return fn()}}), watch(){}, onMounted(){}, onUnmounted(){}, onActivated(){}, defineExpose(){}, defineProps: () => ({user:{name:'SYNTHETIC USER'}, records:{}, teamLeave:[]}), defineEmits:()=>()=>{}, alert(){}, confirm:()=>true, localStorage:{setItem(){},getItem(){return null},removeItem(){}},sessionStorage:{setItem(){},getItem(){return null}}, STANDARD_RESOURCES:[], dashboardActions:{apiPost:async (action,payload)=>{calls.push({action,payload}); return {status:'success',data:[]}}}, window:{dispatchEvent(){}}, CustomEvent:class {}, setTimeout:()=>0, clearTimeout(){}, nextTick:async()=>{}, clearMobileSessionCache, Date, console, ...extra});
 vm.runInContext(source,context);
 return {context,calls,run:code=>vm.runInContext(code,context)};
}
const requestTemplate = fs.readFileSync(new URL('../src/components/mobile/MobileRequests.vue', import.meta.url), 'utf8');
assert.ok(requestTemplate.includes('v-model="bookingForm.start" type="datetime-local"'));
assert.ok(requestTemplate.includes('v-model="bookingForm.end" type="datetime-local"'));
const requests=component('MobileRequests');
await requests.run("withdrawSubmittedLeave({id:'LEAVE-1',rowIndex:4,status:'Approved',start:'2099-01-01',type:'AL'})");
assert.equal(requests.calls[0].payload.rowIndex,4);
assert.equal(requests.calls[0].payload.requestId,'LEAVE-1');
assert.equal(requests.calls[0].payload.expectedStatus,'Approved');
assert.equal(requests.calls[0].payload.newStatus,'Withdrawal Requested');
requests.run("bookingForm.value={resourceId:'R1',start:'2099-01-01T10:00',end:'2099-01-01T09:00',title:'Meeting'}");
await requests.run('submitBooking()');
assert.equal(requests.calls.length,1,'invalid interval must not reach backend');
requests.run("bookingForm.value.end='2099-01-01T11:00'");
await requests.run('submitBooking()');
assert.equal(requests.calls[1].payload.record.start,'2099-01-01T10:00');
assert.equal(requests.calls[1].payload.record.end,'2099-01-01T11:00');
const ids=[];
const claim=component('MobileRequests',{dashboardActions:{apiPost:async(_,payload)=>{ids.push(payload.requestId);throw Error('network lost')}}});
claim.run("claimForm.value.amount='100'");
await claim.run('submitClaim()');await claim.run('submitClaim()');
assert.ok(ids[0]);assert.equal(ids[0],ids[1],'ambiguous claim retries must reuse request ID');
let releaseBootstrap,releaseScreen;
const bootstrap=new Promise(resolve=>releaseBootstrap=resolve),screen=new Promise(resolve=>releaseScreen=resolve);
const shell=component('MobileAppShell',{defineProps:()=>({user:{name:'SYNTHETIC USER'},records:{},refreshData:()=>bootstrap})});
shell.context.screen=screen;
shell.run('activeScreen.value={refresh:()=>screen}');
const refreshing=shell.run('triggerManualRefresh()');
assert.equal(shell.run('isRefreshing.value'),true);
releaseBootstrap();await new Promise(resolve=>setImmediate(resolve));
assert.equal(shell.run('isRefreshing.value'),true,'spinner must await child screen');
releaseScreen();await refreshing;
assert.equal(shell.run('isRefreshing.value'),false);
assert.equal(shell.run('hasPendingUpdate.value'),false);
const failed=component('MobileAppShell',{defineProps:()=>({user:{name:'SYNTHETIC USER'},records:{},refreshData:async()=>{throw Error('offline')}})});
await failed.run('triggerManualRefresh()');
assert.equal(failed.run('isRefreshing.value'),false);
assert.equal(failed.run('hasPendingUpdate.value'),true);
assert.equal(failed.run('notification.value.title'),'Refresh failed');
clearMobileSessionCache();
let releaseOld;const old=getMobileCached('SYNTHETIC USER','pay',()=>new Promise(resolve=>releaseOld=resolve));
await Promise.resolve();clearMobileSessionCache();
assert.equal(await getMobileCached('SYNTHETIC USER','pay',async()=> 'fresh'),'fresh');
releaseOld('stale');await old;
assert.equal(await getMobileCached('SYNTHETIC USER','pay',async()=> 'unexpected'),'fresh');
console.log('Mobile regression tests passed: withdrawal, booking validation/timezone, claim retries, refresh completion/failure and cache race.');

// Production imports must never pull the historical employee fixture into any chunk.
function productionSources(dir) {
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?productionSources(new URL(entry.name+'/',dir)):/\.(vue|[cm]?[jt]sx?)$/.test(entry.name)?[new URL(entry.name,dir)]:[]);
}
for(const file of productionSources(new URL('../src/',import.meta.url))) {
 if(file.pathname.endsWith('/data/importedAttendance.js'))continue;
 assert.ok(!fs.readFileSync(file,'utf8').includes('importedAttendance'),`Production fixture reference: ${file.pathname}`);
}
const attendanceSource=fs.readFileSync(new URL('../src/components/mobile/MobileAttendance.vue',import.meta.url),'utf8');
const attendanceBlock=attendanceSource.slice(attendanceSource.indexOf('const authorizedAttendance ='),attendanceSource.indexOf('const displayedAttendanceDays ='));
const attendanceUser={name:'SYNTHETIC USER',employeeNo:'EMP-1',joinedDate:'2026-01-01'};
const attendanceContext=vm.createContext({computed:fn=>({get value(){return fn()}}),props:{user:attendanceUser,records:{attendance:[{employeeNo:'EMP-1',name:'SYNTHETIC USER',date:'2026-10-10',in:'09:00',out:'17:00'},{employeeNo:'EMP-2',name:'SYNTHETIC USER TWO',date:'2026-10-10',in:'01:00',out:'23:00'}]}},clockConfig:{value:null},userBioId:{value:''},userName:{value:'SYNTHETIC USER'},userJoinedDate:{value:'2026-01-01'},clockEvents:{value:[]},selectedMonth:{value:'2026-10'}});
vm.runInContext(attendanceBlock,attendanceContext);
assert.equal(vm.runInContext('authorizedAttendance.value.length',attendanceContext),1);
assert.equal(vm.runInContext('authorizedAttendance.value[0].In',attendanceContext),'09:00');
vm.runInContext('props.records={}',attendanceContext);
assert.equal(vm.runInContext('authorizedAttendance.value.length',attendanceContext),0);
console.log('PASS: no production fixture imports; mobile attendance accepts only own exact identity and stays empty without server records.');

vm.runInContext("clockConfig.value={attendance:[{employeeNo:'EMP-1',date:'2026-10-10',in:'08:30',out:'17:30'}]}",attendanceContext);
assert.equal(vm.runInContext('authorizedAttendance.value[0].In',attendanceContext),'08:30');
console.log('PASS: authenticated clock-config attendance supplies the timeline.');

const cacheBlock=attendanceSource.slice(attendanceSource.indexOf('function clockConfigForStorage('),attendanceSource.indexOf('const displayedRecentPunches ='));
let storedClock;
const liveConfig={policy:{enabled:true},attendance:[{employeeNo:'EMP-1',date:'2026-10-10',in:'08:30'}]};
const cacheContext=vm.createContext({window:{},localStorage:{setItem:(_,value)=>storedClock=value,getItem:()=>storedClock},CLOCK_CACHE_KEY:{value:'synthetic-cache'},clockConfig:{value:liveConfig},clockEvents:{value:[]},selectedCheckInLocation:{value:''},currentGpsAddress:{value:''},gpsFix:{value:null},Date});
vm.runInContext(cacheBlock,cacheContext);
vm.runInContext('saveCachedClockInfo()',cacheContext);
assert.equal(JSON.parse(storedClock).clockConfig.attendance,undefined);
assert.equal(liveConfig.attendance.length,1,'saving cache must preserve live in-memory history');
storedClock=JSON.stringify({clockConfig:liveConfig,clockEvents:[]});
vm.runInContext('restoreCachedClockInfo()',cacheContext);
assert.equal(vm.runInContext('clockConfig.value.attendance',cacheContext),undefined);
assert.equal(JSON.parse(storedClock).clockConfig.attendance,undefined,'legacy cached history must be removed from storage');
console.log('PASS: full attendance history stays in memory and is excluded from new and restored persistent clock caches.');
