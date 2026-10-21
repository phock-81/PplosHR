<script setup>
import {ref,computed,watch,onMounted,onBeforeUnmount,nextTick,defineAsyncComponent} from 'vue';
const InductionBenefits=defineAsyncComponent(()=>import('./InductionBenefits.vue'));
const HrAnalytics=defineAsyncComponent(()=>import('./HrAnalytics.vue'));
const HrInsights=defineAsyncComponent(()=>import('./HrInsights.vue'));



const ReportCenter=defineAsyncComponent(()=>import('./ReportCenter.vue'));
const StatutorySettingsModal=defineAsyncComponent(()=>import('./StatutorySettingsModal.vue'));
const YearEndModal=defineAsyncComponent(()=>import('./YearEndModal.vue'));
const StaffDossierModal=defineAsyncComponent(()=>import('./StaffDossierModal.vue'));
const LetterGeneratorModal=defineAsyncComponent(()=>import('./LetterGeneratorModal.vue'));
import RoleOverview from './overview/RoleOverview.vue';
import {modules} from '../hr/schema';
import {canOpenHr} from '../hr/navigation';
import {dashboardActions} from '../services/dashboard';
import {CacheManager} from '../services/cacheManager';
const props=defineProps({enabled:{type:Boolean,default:true}});
const user=ref(null),records=ref({}),employees=ref([]),teamLeave=ref([]),audit=ref([]),busy=ref(false),saving=ref(false),error=ref(''),notice=ref(''),active=ref('overview'),query=ref(''),status=ref(''),editor=ref(null),detail=ref(null),decision=ref(null),form=ref({}),isDialogFullscreen=ref(false),activeMultiDropdown=ref(null);
const validationErrors=ref({});
const leaveTypeLabels={AL:'Annual Leave',EL:'Emergency Leave',MC:'Medical Leave',HL:'Hospitalisation',NPL:'Unpaid Leave',ML:'Maternity Leave',PL:'Paternity Leave',CL:'Compassionate Leave'};
const leaveToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const onLeaveToday=computed(()=>teamLeave.value.filter(l=>(!l.status||l.status==='Approved')&&l.start<=leaveToday()&&l.end>=leaveToday()));
const upcomingLeave=computed(()=>teamLeave.value.filter(l=>(!l.status||l.status==='Approved')&&l.start>leaveToday()));
const leaveScopeNote=computed(()=>['Admin','HR'].includes(user.value?.role)?'All staff':['HOD','Supervisor'].includes(user.value?.role)?'Staff under your supervision':'Colleagues in your company and department');
function leaveTypeLabel(t){return leaveTypeLabels[String(t||'').toUpperCase()]||t||'Leave';}
function leaveInitials(n){return String(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();}
function leaveFmt(s){const d=new Date(s+'T00:00:00');return isNaN(d)?s:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});}
function leaveRange(l){return l.start===l.end?leaveFmt(l.start):`${leaveFmt(l.start)} – ${leaveFmt(l.end)}`;}
function leaveBack(l){const d=new Date(l.end+'T00:00:00');d.setDate(d.getDate()+1);return d.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'});}
const selectedCompany=ref('all'),selectedDepartment=ref('all'),selectedStaff=ref('all'),orgViewMode=ref('tab');
const employeeMap=computed(()=>{const map=new Map();for(const emp of employees.value||[]){if(emp.name)map.set(emp.name,emp);}return map;});
const filterCompanies=computed(()=>records.value.companies||[]);
const filterDepartments=computed(()=>{
  let list=records.value.departments||[];
  if(selectedCompany.value&&selectedCompany.value!=='all'){
    list=list.filter(d=>{
      if(!d.companyId||String(d.companyId).toUpperCase()==='ALL')return true;
      const cos=String(d.companyId).split(',').map(s=>s.trim().toUpperCase());
      return cos.includes(String(selectedCompany.value).toUpperCase());
    });
  }
  return list;
});
const filterStaff=computed(()=>{let list=employees.value||[];if(selectedCompany.value&&selectedCompany.value!=='all'){list=list.filter(e=>String(e.companyId)===String(selectedCompany.value)||String(e.company)===String(selectedCompany.value));}if(selectedDepartment.value&&selectedDepartment.value!=='all'){list=list.filter(e=>String(e.departmentId)===String(selectedDepartment.value)||String(e.department)===String(selectedDepartment.value));}return list;});
function onCompanyChange(){if(selectedDepartment.value!=='all'){const valid=filterDepartments.value.some(d=>String(d.id)===String(selectedDepartment.value));if(!valid)selectedDepartment.value='all';}if(selectedStaff.value!=='all'){const valid=filterStaff.value.some(e=>e.name===selectedStaff.value);if(!valid)selectedStaff.value='all';}}
function onDepartmentChange(){if(selectedStaff.value!=='all'){const valid=filterStaff.value.some(e=>e.name===selectedStaff.value);if(!valid)selectedStaff.value='all';}}
function resetFilters(){selectedCompany.value='all';selectedDepartment.value='all';selectedStaff.value='all';query.value='';status.value='';}
const showStatutoryModal=ref(false);
function openStatutorySettings(){showStatutoryModal.value=true;}
const showYearEndModal=ref(false);
function openYearEndModal(){showYearEndModal.value=true;}
const showDossierModal=ref(false);
const dossierTargetEmployee=ref('');
function openStaffDossier(name=''){
  if (!name) {
    if (user.value?.role === 'User' && user.value?.name) {
      name = user.value.name;
    } else if (employees.value && employees.value.length) {
      name = employees.value[0]?.name || employees.value[0]?.employee || '';
    }
  }
  dossierTargetEmployee.value=name;
  showDossierModal.value=true;
}
if(typeof window!=='undefined'){setTimeout(()=>import('./StaffDossierModal.vue'),1500);}
const showLetterModal=ref(false);
function onOpenDossier(e){if(['HR','Admin','HOD','Supervisor'].includes(user.value?.role))openStaffDossier(e?.detail?.name||'');}
function openLetterGenerator(){showLetterModal.value=true;}
const ALL_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const DEFAULT_WORK_SCHEDULES = [
  // Setar Quay (SQ)
  { id: 'SCH-SQ-S1', company: 'SQ', code: 'S1', workBase: 'Site', title: 'SQ Shift S1 (05:30 - 14:30)', start: '05:30', end: '14:30', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'Morning Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-SQ-S2', company: 'SQ', code: 'S2', workBase: 'Office', title: 'SQ Shift S2 (08:30 - 17:30)', start: '08:30', end: '17:30', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'Normal Office Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-SQ-S3', company: 'SQ', code: 'S3', workBase: 'Site', title: 'SQ Shift S3 (14:30 - 23:30)', start: '14:30', end: '23:30', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'Evening Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-SQ-S4', company: 'SQ', code: 'S4', workBase: 'Site', title: 'SQ Shift S4 (23:00 - 08:00)', start: '23:00', end: '08:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'Night / Overnight Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-SQ-F1', company: 'SQ', code: 'F1', workBase: 'Site', title: 'SQ Full Shift F1 (05:30 - 17:30)', start: '05:30', end: '17:30', breakHours: 1.5, netHours: 10.5, availability: 'Active', status: 'Active', notes: 'Full Day Shift 10.5h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-SQ-F2', company: 'SQ', code: 'F2', workBase: 'Site', title: 'SQ Full Shift F2 (11:30 - 23:30)', start: '11:30', end: '23:30', breakHours: 1.5, netHours: 10.5, availability: 'Active', notes: 'Late Full Shift 10.5h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  // Milan Stream (MS)
  { id: 'SCH-MS-M1', company: 'MS', code: 'M1', workBase: 'Site', title: 'MS Shift M1 (06:00 - 15:00)', start: '06:00', end: '15:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'MS Morning Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-MS-M2', company: 'MS', code: 'M2', workBase: 'Office', title: 'MS Shift M2 (08:00 - 17:00)', start: '08:00', end: '17:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'MS Day Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-MS-M3', company: 'MS', code: 'M3', workBase: 'Site', title: 'MS Shift M3 (14:00 - 23:00)', start: '14:00', end: '23:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'MS Afternoon Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-MS-M4', company: 'MS', code: 'M4', workBase: 'Site', title: 'MS Shift M4 (23:00 - 08:00)', start: '23:00', end: '08:00', breakHours: 1.0, netHours: 8.0, availability: 'Active', status: 'Active', notes: 'MS Night / Overnight Shift 8h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-MS-M', company: 'MS', code: 'M', workBase: 'Site', title: 'MS Morning Shift M (07:00 - 15:30)', start: '07:00', end: '15:30', breakHours: 1.0, netHours: 7.5, availability: 'Active', status: 'Active', notes: 'MS Morning 7.5h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-MS-A', company: 'MS', code: 'A', workBase: 'Site', title: 'MS Afternoon Shift A (15:00 - 23:30)', start: '15:00', end: '23:30', breakHours: 1.0, netHours: 7.5, availability: 'Active', status: 'Active', notes: 'MS Afternoon 7.5h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-MS-N', company: 'MS', code: 'N', workBase: 'Office', title: 'MS Normal Shift N (11:00 - 19:30)', start: '11:00', end: '19:30', breakHours: 1.0, netHours: 7.5, availability: 'Active', status: 'Active', notes: 'MS Mid-day 7.5h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] },
  { id: 'SCH-MS-A1', company: 'MS', code: 'A1', workBase: 'Site', title: 'MS Extended Afternoon A1 (13:00 - 23:30)', start: '13:00', end: '23:30', breakHours: 1.0, netHours: 9.5, availability: 'Active', status: 'Active', notes: 'MS Extended 9.5h', workingDays: [...ALL_WEEKDAYS], restDays: [], offDays: [] }
];

const DEFAULT_WORK_BASES = [
  { id: 'WB-OFFICE', code: 'OFFICE', title: 'Office', availability: 'Active', notes: 'Headquarters / Corporate office environment' },
  { id: 'WB-SITE', code: 'SITE', title: 'Site', availability: 'Active', notes: 'Project sites, operations & fieldwork' }
];

const DEFAULT_WORK_LOCATIONS = [
  { id: 'LOC-PG', code: 'PG', title: 'Penang', state: 'Pulau Pinang', availability: 'Active', notes: 'Penang Branch & Sites' },
  { id: 'LOC-SEL', code: 'SEL', title: 'Selangor', state: 'Selangor', availability: 'Active', notes: 'Selangor Projects & Site Hub' },
  { id: 'LOC-KL', code: 'KL', title: 'Kuala Lumpur', state: 'Wilayah Persekutuan Kuala Lumpur', availability: 'Active', notes: 'Kuala Lumpur HQ & Projects' },
  { id: 'LOC-NS', code: 'NS', title: 'Negeri Sembilan', state: 'Negeri Sembilan', availability: 'Active', notes: 'Negeri Sembilan Site Operations' }
];

function getNextShiftCode(company) {
  const list = records.value.workSchedules || [];
  const comp = String(company || 'SQ').toUpperCase();
  const compShifts = list.filter(s => String(s.company || '').toUpperCase() === comp);
  // Global templates use G (avoids collision with legacy MS code A1), SQ uses S and MS uses M.
  const prefix = comp === 'SQ' ? 'S' : comp === 'MS' ? 'M' : 'G';
  const numbers = compShifts.map(s => {
    const m = String(s.code || '').match(new RegExp('^' + prefix + '(\\d+)$', 'i'));
    return m ? parseInt(m[1], 10) : 0;
  }).filter(n => n > 0);
  const nextNum = numbers.length ? Math.max(...numbers) + 1 : 1;
  return prefix + nextNum;
}

function getNextJobCode() {
  const list = records.value.jobTitles || [];
  const numbers = list.map(j => {
    const m = String(j.code || '').match(/^JOB-(\d+)$/i);
    return m ? parseInt(m[1], 10) : 0;
  }).filter(n => n > 0);
  const nextNum = numbers.length ? Math.max(...numbers) + 1 : 1;
  return 'JOB-' + String(nextNum).padStart(3, '0');
}

function getNextDepartmentCode() {
  const list = records.value.departments || [];
  let maxNum = 0;
  let hasDepPrefix = false;
  list.forEach(d => {
    const code = String(d.code || '').trim();
    const matchDep = code.match(/^DEP-?(\d+)$/i);
    const matchNum = code.match(/^(\d+)$/);
    if (matchDep) {
      hasDepPrefix = true;
      const n = parseInt(matchDep[1], 10);
      if (n > maxNum) maxNum = n;
    } else if (matchNum) {
      const n = parseInt(matchNum[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const nextNum = maxNum + 1;
  if (hasDepPrefix) {
    return 'DEP-' + String(nextNum).padStart(3, '0');
  }
  return String(nextNum).padStart(3, '0');
}

function calcNetHours(start, end, breakH) {
  const time=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if(!time.test(String(start||''))||!time.test(String(end||'')))return null;
  if(breakH===''||breakH===undefined||breakH===null)return null;
  const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);
  const begin=sh*60+sm;let finish=eh*60+em;
  if(finish===begin)return null;
  if(finish<begin)finish+=1440;
  const rest=Number(breakH);
  if(!Number.isFinite(rest)||rest<0||rest*60>=finish-begin)return null;
  return Math.round(((finish-begin)/60-rest)*100)/100;
}

const seedingShifts = ref(false);
async function generateDefaultShifts() {
  seedingShifts.value = true;
  notice.value = 'Generating shift templates for Milan Stream & Setar Quay...';
  try {
    const list = records.value.workSchedules || [];
    for (const shift of DEFAULT_WORK_SCHEDULES) {
      if (!list.some(s => s.code === shift.code && s.company === shift.company)) {
        // New records must NOT send id/version: hrSave interprets id as EDIT.
        const result = await api('hrSave', {
          module: 'workSchedules',
          requestId: 'seed-' + shift.id,
          record: { company:shift.company, workBase:shift.workBase||'Office', code:shift.code, title:shift.title,
            start:shift.start, end:shift.end, breakHours:shift.breakHours,
            netHours:shift.netHours, availability:shift.availability, notes:shift.notes }
        });
        if(result?.status!=='success') throw Error(result?.message||'Could not save shift '+shift.code);
      }
    }
    await load(true);
    notice.value = 'Milan Stream & Setar Quay shifts generated successfully for HR to update!';
  } catch (err) {
    // Never report a successful save when the Apps Script backend rejected it.
    notice.value = '';
    error.value = 'Could not save shift templates: ' + (err?.message || 'Unknown server error');
  } finally {
    seedingShifts.value = false;
  }
}

function onOverviewNavigateModule(mod, targetScope) {
  let s = targetScope;
  if (!s || s === 'overview') {
    s = admin.value ? 'all' : ['HOD','Supervisor'].includes(user.value?.role) ? 'team' : 'personal';
  }
  choose(mod, s);
  load();
}

function onOverviewOpenModal(modalName) {
  if (modalName === 'statutory') openStatutorySettings();
  else if (modalName === 'yearEnd') openYearEndModal();
  else if (modalName === 'letters') openLetterGenerator();
  else if (modalName === 'dossier') openStaffDossier();
  else if (modalName === 'attendance') openAttendanceDashboard();
}

const scope=ref('overview'),pageLabel=ref('Overview');
let loadVersion=0;
const loadedScope=ref(null);
const hasCurrentRecords=computed(()=>loadedScope.value===scope.value);
const api=dashboardActions.apiPost;
const ownLeaveSummary=ref(null),ownLeaveError=ref(''),ownLeaveLoading=ref(false);
let ownLeaveGeneration=0,ownLeavePending=null;
function clearOwnLeaveSummary(){ownLeaveGeneration++;ownLeavePending=null;ownLeaveSummary.value=null;ownLeaveError.value='';ownLeaveLoading.value=false;}
async function loadOwnLeaveSummary(force=false){
  if(!props.enabled||!['User','Staff'].includes(user.value?.role))return;
  if(ownLeavePending)return ownLeavePending;
  if(!force&&ownLeaveSummary.value)return;
  const generation=ownLeaveGeneration;
  ownLeaveLoading.value=true;ownLeaveError.value='';
  const job=(async()=>{
    try{
      const result=await api('leaveOverview',{});
      if(generation!==ownLeaveGeneration)return;
      if(result?.status!=='success'||!result.data)throw Error(result?.message||'Leave balance is unavailable. Refresh to try again.');
      ownLeaveSummary.value=result.data;
    }catch(error){if(generation===ownLeaveGeneration)ownLeaveError.value=error.message||'Leave balance is unavailable. Refresh to try again.';}
    finally{if(generation===ownLeaveGeneration)ownLeaveLoading.value=false;}
  })();
  ownLeavePending=job;
  try{return await job;}finally{if(ownLeavePending===job)ownLeavePending=null;}
}

watch(()=>props.enabled, enabled=>{if(enabled&&user.value)void load(true);else if(!enabled){loadVersion++;busy.value=false;}});
const admin=computed(()=>['Admin','HR'].includes(user.value?.role));
const permitted=computed(()=>Object.entries(modules).filter(([key,s])=>admin.value||s.self||s.public||['profiles','appraisals','letters','training'].includes(key)));
const spec=computed(()=>modules[active.value]);

const DAY_INDEX_MAP = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };

const scheduleBlocks = ref([]);
const restDayDesignations = ref({});

function initScheduleBlocks(r) {
  let blocks = [];
  if (r && r.daySchedules) {
    try {
      blocks = typeof r.daySchedules === 'string' ? JSON.parse(r.daySchedules) : JSON.parse(JSON.stringify(r.daySchedules));
    } catch (_) {}
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    const defaultDays = (r && Array.isArray(r.workingDays) && r.workingDays.length) ? [...r.workingDays] : [...ALL_WEEKDAYS];
    const st = r?.start || form.value.start || '08:00';
    const en = r?.end || form.value.end || '17:30';
    const b = r?.breakHours !== undefined ? Number(r.breakHours) : (form.value.breakHours !== undefined ? Number(form.value.breakHours) : 1);
    const n = calcNetHours(st, en, b) ?? 8.5;
    blocks = [
      {
        days: defaultDays,
        start: st,
        end: en,
        breakHours: b,
        netHours: n
      }
    ];
  }
  scheduleBlocks.value = blocks;

  const assigned = new Set(blocks.flatMap(b => b.days || []));
  const desig = {};
  ALL_WEEKDAYS.forEach(d => {
    if (!assigned.has(d)) {
      if (d === 'Sun') desig[d] = 'rest';
      else desig[d] = 'off';
    }
  });
  if (r && Array.isArray(r.restDays)) {
    r.restDays.forEach(idx => {
      const dayName = typeof idx === 'string' && ALL_WEEKDAYS.includes(idx) ? idx : Object.keys(DAY_INDEX_MAP).find(k => DAY_INDEX_MAP[k] === Number(idx));
      if (dayName && !assigned.has(dayName)) desig[dayName] = 'rest';
    });
  }
  if (r && Array.isArray(r.offDays)) {
    r.offDays.forEach(idx => {
      const dayName = typeof idx === 'string' && ALL_WEEKDAYS.includes(idx) ? idx : Object.keys(DAY_INDEX_MAP).find(k => DAY_INDEX_MAP[k] === Number(idx));
      if (dayName && !assigned.has(dayName)) desig[dayName] = 'off';
    });
  }
  restDayDesignations.value = desig;
}

const unassignedDays = computed(() => {
  const assigned = new Set(scheduleBlocks.value.flatMap(b => b.days || []));
  return ALL_WEEKDAYS.filter(d => !assigned.has(d));
});

function isDayInOtherBlock(day, blockIndex) {
  return scheduleBlocks.value.some((b, idx) => idx !== blockIndex && (b.days || []).includes(day));
}

function toggleDayInBlock(day, blockIndex) {
  if (isDayInOtherBlock(day, blockIndex)) return;
  const block = scheduleBlocks.value[blockIndex];
  if (!block) return;
  const idx = (block.days || []).indexOf(day);
  if (idx > -1) {
    block.days.splice(idx, 1);
    if (!restDayDesignations.value[day]) {
      restDayDesignations.value[day] = (day === 'Sun' ? 'rest' : 'off');
    }
  } else {
    block.days.push(day);
    delete restDayDesignations.value[day];
  }
  updateBlockNet(block);
}

function updateBlockNet(block) {
  const net = calcNetHours(block.start, block.end, block.breakHours);
  block.netHours = (net !== null && !isNaN(net)) ? net : 0;
  if (scheduleBlocks.value[0] === block) {
    form.value.start = block.start;
    form.value.end = block.end;
    form.value.breakHours = block.breakHours;
    form.value.netHours = block.netHours;
  }
}

function addScheduleBlock() {
  const avail = unassignedDays.value;
  const newDays = avail.length > 0 ? [avail[0]] : [];
  newDays.forEach(d => delete restDayDesignations.value[d]);
  const newBlock = {
    days: newDays,
    start: '08:00',
    end: '17:00',
    breakHours: 1,
    netHours: 8
  };
  scheduleBlocks.value.push(newBlock);
  updateBlockNet(newBlock);
}

function removeScheduleBlock(index) {
  if (scheduleBlocks.value.length <= 1) return;
  const removed = scheduleBlocks.value.splice(index, 1)[0];
  if (removed && removed.days) {
    removed.days.forEach(d => {
      restDayDesignations.value[d] = (d === 'Sun' ? 'rest' : 'off');
    });
  }
}

function toggleDayRestOff(day) {
  if (restDayDesignations.value[day] === 'rest') {
    restDayDesignations.value[day] = 'off';
  } else {
    restDayDesignations.value[day] = 'rest';
  }
}

function isDayRest(day) {
  return restDayDesignations.value[day] === 'rest';
}

function shouldShowField(field) {
  if (!field) return false;
  if (active.value === 'workSchedules' && ['start', 'end', 'breakHours', 'netHours', 'daySchedules', 'workingDays', 'restDays', 'offDays'].includes(field.key)) {
    return false;
  }
  if (field.categories && field.categories.length) {
    if (!form.value?.category) return false;
    const curCat = String(form.value.category).trim().toLowerCase();
    return field.categories.some(c => String(c).trim().toLowerCase() === curCat);
  }
  return true;
}
const formFields=computed(()=>(spec.value?.fields||[]).filter(shouldShowField));
function isFieldWide(field) {
  if (!field) return false;
  if (field.type === 'textarea' || field.type === 'url') return true;
  if (active.value === 'jobTitles' && field.key === 'title') return false;
  if (['title', 'address', 'evidenceUrl', 'notes'].includes(field.key)) return true;
  return false;
}
function isMultiSelect(field) {
  if (!field) return false;
  if (field.type === 'multiselect') return true;
  if (active.value === 'jobTitles' && ['departmentId', 'workBase', 'workLocation'].includes(field.key)) {
    return true;
  }
  if (active.value === 'workSchedules' && ['workBase', 'workLocation'].includes(field.key)) {
    return true;
  }
  if (active.value === 'departments' && field.key === 'companyId') {
    return true;
  }
  return false;
}
function getMultiSelectValues(fieldKey) {
  const raw = form.value[fieldKey];
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
function isOptionSelected(field, opt) {
  const key = field.key;
  const raw = form.value[key];
  if (!raw) return false;
  const vals = getMultiSelectValues(key).map(s => s.toUpperCase());
  const allOpts = options(field);
  const concreteOpts = allOpts.filter(o => String(o.value).toUpperCase() !== 'ALL');
  const optValUpper = String(opt.value).toUpperCase();
  if (optValUpper === 'ALL') {
    return vals.includes('ALL') || (concreteOpts.length > 0 && concreteOpts.every(o => vals.includes(String(o.value).toUpperCase())));
  }
  return vals.includes('ALL') || vals.includes(optValUpper);
}
function toggleMultiSelectOption(field, opt) {
  const key = field.key;
  const allOpts = options(field);
  const concreteOpts = allOpts.filter(o => String(o.value).toUpperCase() !== 'ALL');
  let currentVals = getMultiSelectValues(key);
  const hasAll = currentVals.some(v => v.toUpperCase() === 'ALL');
  if (hasAll) {
    currentVals = concreteOpts.map(o => o.value);
  }
  const optValUpper = String(opt.value).toUpperCase();
  if (optValUpper === 'ALL') {
    if (hasAll || (concreteOpts.length > 0 && currentVals.length === concreteOpts.length)) {
      form.value[key] = '';
    } else {
      form.value[key] = 'All';
    }
  } else {
    const exists = currentVals.some(v => String(v).toUpperCase() === optValUpper);
    let nextVals;
    if (exists) {
      nextVals = currentVals.filter(v => String(v).toUpperCase() !== optValUpper);
    } else {
      nextVals = [...currentVals, opt.value];
    }
    if (nextVals.length === 0) {
      form.value[key] = '';
    } else if (concreteOpts.length > 0 && nextVals.length === concreteOpts.length) {
      form.value[key] = 'All';
    } else {
      form.value[key] = nextVals.join(', ');
    }
  }
  clearFieldValidation();
}
function getMultiSelectDisplay(field) {
  const key = field.key;
  const raw = form.value[key];
  if (!raw || String(raw).trim() === '') {
    if (key === 'companyId') return 'Select companies...';
    if (key === 'departmentId') return 'Select departments...';
    if (key === 'workLocation') return 'Select work locations...';
    if (key === 'workBase') return 'Select work bases...';
    return 'Select...';
  }
  const vals = getMultiSelectValues(key);
  if (vals.some(v => v.toUpperCase() === 'ALL')) {
    if (key === 'companyId') return 'ALL (All Companies)';
    if (key === 'departmentId') return 'All departments';
    if (key === 'workLocation') return 'All work locations';
    if (key === 'workBase') return 'All work bases';
    return 'All';
  }
  const allOpts = options(field);
  const labels = vals.map(v => {
    const found = allOpts.find(o => String(o.value).toUpperCase() === String(v).toUpperCase());
    return found ? found.label : v;
  });
  if (labels.length <= 2) {
    return labels.join(', ');
  }
  return `${labels.length} selected (${labels.slice(0, 2).join(', ')}...)`;
}
function formatMultiDepartmentLabel(val) {
  if (!val) return '—';
  if (String(val).toUpperCase() === 'ALL') return 'All Departments';
  const parts = String(val).split(',').map(s => s.trim()).filter(Boolean);
  const labels = parts.map(id => label('departments', id));
  return labels.join(', ');
}
function formatMultiCompanyLabel(val) {
  if (!val) return '—';
  if (String(val).toUpperCase() === 'ALL') return 'ALL (All Companies)';
  const parts = String(val).split(',').map(s => s.trim()).filter(Boolean);
  const cos = records.value.companies || [];
  const labels = parts.map(id => {
    const found = cos.find(c => c.id === id || c.code === id);
    return found ? (found.code || found.title || id) : id;
  });
  return labels.join(', ');
}
function deduplicateByCode(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(item => {
    const code = String(item.code || item.title || item.id || '').trim().toUpperCase();
    if (!code || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}
function deduplicateSchedules(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(item => {
    const key = (String(item.company || '') + '_' + String(item.code || '')).toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(item => {
    const workingDays = (Array.isArray(item.workingDays) && item.workingDays.length)
      ? [...item.workingDays]
      : (item.workingDays && typeof item.workingDays === 'string')
        ? item.workingDays.split(',').map(s=>s.trim()).filter(Boolean)
        : [...ALL_WEEKDAYS];
    let daySchedules = item.daySchedules;
    if (!daySchedules) {
      daySchedules = JSON.stringify([{
        days: workingDays,
        start: item.start || '08:00',
        end: item.end || '17:30',
        breakHours: item.breakHours !== undefined ? Number(item.breakHours) : 1,
        netHours: item.netHours !== undefined ? Number(item.netHours) : 8.5
      }]);
    }
    return {
      ...item,
      workingDays,
      daySchedules,
      restDays: Array.isArray(item.restDays) ? item.restDays : [],
      offDays: Array.isArray(item.offDays) ? item.offDays : []
    };
  });
}
function isAllDaysSchedule(r) {
  if (!r) return false;
  const days = Array.isArray(r.workingDays) ? r.workingDays : (r.workingDays && typeof r.workingDays === 'string') ? r.workingDays.split(',') : [];
  if (days.length < 7) return false;
  return ALL_WEEKDAYS.every(d => days.includes(d));
}
function getRestOffBadges(r) {
  if (!r) return [];
  const badges = [];
  const restSet = new Set(Array.isArray(r.restDays) ? r.restDays.map(idx => Object.keys(DAY_INDEX_MAP).find(k => DAY_INDEX_MAP[k] === Number(idx)) || idx) : []);
  const offSet = new Set(Array.isArray(r.offDays) ? r.offDays.map(idx => Object.keys(DAY_INDEX_MAP).find(k => DAY_INDEX_MAP[k] === Number(idx)) || idx) : []);
  ALL_WEEKDAYS.forEach(d => {
    if (restSet.has(d)) badges.push({ name: d, type: 'Rest' });
    else if (offSet.has(d)) badges.push({ name: d, type: 'Off' });
  });
  return badges;
}
const current=computed(()=>{
  const list = records.value[active.value]||[];
  if (active.value === 'workSchedules') return deduplicateSchedules(list);
  if (active.value === 'workBases' || active.value === 'workLocations') return deduplicateByCode(list);
  return list;
});
const page=ref(1);
const pageSize=50;
const pageCount=computed(()=>Math.max(1,Math.ceil(filtered.value.length/pageSize)));
const pagedRecords=computed(()=>filtered.value.slice((page.value-1)*pageSize,page.value*pageSize));
watch([active,query,status,selectedCompany,selectedDepartment,selectedStaff],()=>{page.value=1;},{flush:'sync'});
const searchable=computed(()=>current.value.map(record=>({record,text:Object.values(record).filter(value=>typeof value==='number'||(typeof value==='string'&&!value.startsWith('data:'))).join(' ').toLowerCase()})));
const filtered=computed(()=>{
  const term=query.value.trim().toLowerCase();
  const selCo=selectedCompany.value&&selectedCompany.value!=='all'?String(selectedCompany.value):null;
  const selDept=selectedDepartment.value&&selectedDepartment.value!=='all'?String(selectedDepartment.value):null;
  const selStaff=selectedStaff.value&&selectedStaff.value!=='all'?String(selectedStaff.value):null;
  const selStatus=status.value;
  return searchable.value.filter(({record,text})=>{
    if(selStatus&&(record.status||record.availability)!==selStatus)return false;
    if(term&&!text.includes(term))return false;
    if(selStaff){
      if(record.employee&&record.employee!==selStaff)return false;
      if(active.value==='profiles'&&record.name!==selStaff)return false;
    }
    if(selDept){
      if(record.departmentId){if(String(record.departmentId)!==selDept)return false;}
      else if(record.employee){const emp=employeeMap.value.get(record.employee);if(emp&&emp.departmentId&&String(emp.departmentId)!==selDept)return false;}
      else if(active.value==='departments'){if(String(record.id)!==selDept)return false;}
    }
    if(selCo){
      if(record.companyId){
        const cos = String(record.companyId).split(',').map(s=>s.trim().toUpperCase());
        const selCoUpper = selCo.toUpperCase();
        if(!cos.includes(selCoUpper) && !cos.includes('ALL')) return false;
      }
      else if(record.company){
        const coObj = (records.value.companies || []).find(c => String(c.id) === selCo || String(c.code) === selCo);
        const match = String(record.company).toLowerCase() === selCo.toLowerCase() ||
                      (coObj && String(record.company).toUpperCase() === String(coObj.code || '').toUpperCase()) ||
                      (coObj && String(coObj.title || '').toLowerCase().includes(String(record.company).toLowerCase()));
        if(!match) return false;
      }
      else if(record.employee){const emp=employeeMap.value.get(record.employee);if(emp&&emp.companyId&&String(emp.companyId)!==selCo)return false;}
      else if(active.value==='companies'){if(String(record.id)!==selCo)return false;}
      else if(active.value==='departments'){
        const cos = String(record.companyId||'').split(',').map(s=>s.trim().toUpperCase());
        if(!cos.includes(selCo.toUpperCase()) && !cos.includes('ALL')) return false;
      }
    }
    return true;
  }).map(({record})=>record);
});
watch(pageCount,count=>{page.value=Math.min(page.value,count);});
const statuses=computed(()=>[...new Set(current.value.map(r=>r.status))]);
const pending=computed(()=>Object.entries(records.value).flatMap(([module,list])=>list.filter(r=>r.status.startsWith('Pending')||r.status==='Submitted').map(r=>({...r,module}))));
const pendingAttendanceItems=ref([]);
function onActionCount(e){
  if(e?.detail?.pendingAttendanceList){
    pendingAttendanceItems.value=e.detail.pendingAttendanceList;
  }
}
const actionable=computed(()=>{
  const base=pending.value.filter(r=>actions(r.module,r).some(a=>!['cancel','detail'].includes(a.command)));
  return [...base, ...pendingAttendanceItems.value];
});
const money=n=>Number(n||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
const totals=computed(()=>({approved:(records.value.claims||[]).filter(r=>r.status==='Approved').reduce((s,r)=>s+r.amount,0),paid:(records.value.claims||[]).filter(r=>r.status==='Paid').reduce((s,r)=>s+r.amount,0),training:(records.value.training||[]).filter(r=>r.status==='Planned').length}));
const canCreate=computed(()=>spec.value&&active.value!=='profiles'&&(admin.value||(scope.value==='personal'&&spec.value.self)));
function claimCategory(value){const normal=v=>String(v||'').trim().replace(/\s+/g,' ').toLowerCase();const names=['medical','dental','optical','medical check-up','mileage','outstation meals'];const title=normal(value);if(names.includes(title))return title;const type=(records.value.claimTypes||[]).find(t=>normal(t.title)===title);return type?normal(type.code):title;}
function resourceCategory(id){const r=(records.value.resources||[]).find(x=>x.id===id||x.code===id);return r?.category||'';}
function label(module,id){
  if(module==='companies'){
    if(!id) return '—';
    if(String(id).toUpperCase()==='ALL') return 'ALL (All Companies)';
    if(String(id).includes(',')) return formatMultiCompanyLabel(id);
    const r=(records.value.companies||[]).find(r=>r.id===id||r.code===id);
    return r?.code||r?.title||id||'—';
  }
  const r=(records.value[module]||[]).find(r=>r.id===id);
  return r?.title||r?.employee||id||'—';
}
function value(field,r){if(field.type==='ref')return label(field.ref,r[field.key]);if(field.type==='number')return r[field.key]??'—';return r[field.key]||'—';}
function primary(r){
  if(r.isAttendance)return r.title || ('Attendance Approval · ' + r.month);
  if(r.resourceId)return label('resources',r.resourceId);
  return r.title||r.employee||r.code||'Record';
}
function choose(key,nextScope=scope.value){if(!user.value&&typeof window!=='undefined'){const s=localStorage.getItem('hrPortalUser');if(s){try{user.value=JSON.parse(s);}catch(_){}}if(!user.value&&window.currentUser)user.value=window.currentUser;}if(!canOpenHr(user.value?.role,key,nextScope))return;if(nextScope!==scope.value){const cachedHr=CacheManager.getHrRecords();if(cachedHr&&cachedHr[nextScope]&&cachedHr[nextScope].records&&Object.keys(cachedHr[nextScope].records).length>0){records.value=cachedHr[nextScope].records;employees.value=cachedHr[nextScope].employees||[];teamLeave.value=cachedHr[nextScope].teamLeave||[];audit.value=cachedHr[nextScope].audit||[];loadedScope.value=nextScope;}else{loadedScope.value=null;records.value={};employees.value=[];audit.value=[];}}active.value=key;scope.value=nextScope;query.value='';status.value='';selectedStaff.value='all';error.value='';detail.value=null;editor.value=null;decision.value=null;}
async function load(force=false){
  if(!user.value||!props.enabled)return;
  const requestedScope=scope.value;
  if(requestedScope==='overview')void loadOwnLeaveSummary(force);
  if(!force&&loadedScope.value===requestedScope&&Object.keys(records.value||{}).length>0)return;

  if(!records.value || Object.keys(records.value).length === 0){
    const cachedHr = CacheManager.getHrRecords();
    if(cachedHr && cachedHr[requestedScope]){
      const sData = cachedHr[requestedScope];
      if(sData.records) records.value = sData.records;
      if(sData.employees) employees.value = sData.employees;
      if(sData.teamLeave) teamLeave.value = sData.teamLeave;
      if(sData.audit) audit.value = sData.audit;
      if(records.value?.workBases && typeof window!=='undefined') window.workBases=records.value.workBases;
      if(records.value?.workLocations && typeof window!=='undefined') window.workLocations=records.value.workLocations;
      if(records.value?.workSchedules && typeof window!=='undefined') window.workSchedules=records.value.workSchedules;
      if(records.value?.companies && typeof window!=='undefined') window.hrCompanies=records.value.companies;
      loadedScope.value = requestedScope;
    }
  }

  const version=++loadVersion;
  const hasExistingData = Object.keys(records.value || {}).length > 0;
  if (!hasExistingData) busy.value=true;
  error.value='';
  try{
    const res=await api('hrBootstrap',{scope:requestedScope});
    if(version!==loadVersion)return;
    if(res.status!=='success')throw Error(res.message||'Could not load records. Deploy the updated Apps Script and sign in again.');
    records.value=res.data.records;
    if(!records.value.workSchedules||!records.value.workSchedules.length){records.value.workSchedules=[];}else{records.value.workSchedules=deduplicateSchedules(records.value.workSchedules);}
    if(typeof window!=='undefined'&&localStorage.getItem('hr_custom_workSchedules')){try{const custom=JSON.parse(localStorage.getItem('hr_custom_workSchedules')||'[]');if(Array.isArray(custom)&&custom.length){const merged=[...records.value.workSchedules];custom.forEach(c=>{const idx=merged.findIndex(m=>m.id===c.id||(m.code===c.code&&m.company===c.company));if(idx>-1)merged[idx]={...merged[idx],...c};else merged.push(c);});records.value.workSchedules=deduplicateSchedules(merged);}}catch(_){}}
    if(!records.value.workBases||!records.value.workBases.length){records.value.workBases=JSON.parse(JSON.stringify(DEFAULT_WORK_BASES));}else{records.value.workBases=deduplicateByCode(records.value.workBases);}
    if(!records.value.workLocations||!records.value.workLocations.length){records.value.workLocations=JSON.parse(JSON.stringify(DEFAULT_WORK_LOCATIONS));}else{records.value.workLocations=deduplicateByCode(records.value.workLocations);}
    if(typeof window!=='undefined'){window.workBases=records.value.workBases;window.workLocations=records.value.workLocations;window.workSchedules=records.value.workSchedules;window.hrCompanies=records.value.companies||[];}
    employees.value=(res.data.employees || []).map(emp => ({
      ...emp,
      id: emp.id || emp.employeeNo || emp.name,
      name: emp.name || emp.employee || '',
      employee: emp.name || emp.employee || '',
      company: emp.company || emp.companyName || emp.companyId || '',
      department: emp.department || emp.departmentName || emp.departmentId || ''
    }));
    teamLeave.value=res.data.teamLeave||[];
    user.value=res.data.actor;
    audit.value=res.data.audit;
    loadedScope.value=requestedScope;
    CacheManager.saveHrRecords({
      [requestedScope]: {
        records: records.value,
        employees: employees.value,
        teamLeave: teamLeave.value,
        audit: audit.value,
        timestamp: Date.now()
      }
    });

    // Background pre-warming for 'team' scope when viewing overview
    if (requestedScope === 'overview' && ['HOD','Supervisor','HR','Admin'].includes(user.value?.role)) {
      setTimeout(() => {
        const cached = CacheManager.getHrRecords() || {};
        if (!cached['team'] || (Date.now() - (cached['team'].timestamp || 0) > 120000)) {
          api('hrBootstrap', { scope: 'team' }).then(teamRes => {
            if (teamRes?.status === 'success' && teamRes.data) {
              CacheManager.saveHrRecords({
                team: {
                  records: teamRes.data.records,
                  employees: teamRes.data.employees,
                  teamLeave: teamRes.data.teamLeave,
                  audit: teamRes.data.audit,
                  timestamp: Date.now()
                }
              });
            }
          }).catch(() => {});
        }
      }, 1000);
    }
  }catch(e){if(version===loadVersion)error.value=e.message;}finally{if(version===loadVersion)busy.value=false;}
}

function session(e){clearOwnLeaveSummary();showDossierModal.value=false;showStatutoryModal.value=false;showYearEndModal.value=false;showLetterModal.value=false;dossierTargetEmployee.value='';loadVersion++;busy.value=false;saving.value=false;loadedScope.value=null;active.value='overview';scope.value='overview';pageLabel.value='Overview';user.value=e.detail;editor.value=null;detail.value=null;decision.value=null;if(user.value)load(false);}
function options(field){
  if(field.type==='staff'){
    let all=employees.value.filter(e=>e.status!=='Resigned');
    if(active.value==='departments'&&field.key==='manager'){
      all=all.filter(e=>{
        const r=String(e.role||'').toUpperCase();
        return r==='HOD'||r==='SUPERVISOR'||(form.value.manager&&e.name===form.value.manager);
      });
    }
    return all.map(e=>({value:e.name,label:e.name}));
  }
  if(field.type==='ref'){
    let all=(records.value[field.ref]||[]).filter(r=>r.availability!=='Inactive'||(String(form.value[field.key]||'').includes(r.id)));
    if(field.key==='departmentId'&&form.value.companyId&&form.value.companyId!=='ALL'){
      const formCos=String(form.value.companyId).split(',').map(s=>s.trim().toUpperCase());
      all=all.filter(d=>{
        if(!d.companyId||String(d.companyId).toUpperCase()==='ALL')return true;
        const dCos=String(d.companyId).split(',').map(s=>s.trim().toUpperCase());
        return formCos.includes('ALL')||formCos.some(c=>dCos.includes(c));
      });
    }
    const items=all.map(r=>({value:r.id,label:field.key==='departmentId'&&r.code&&r.title&&r.code!==r.title?`${r.title} (${r.code})`:primary(r)}));
    if(active.value==='departments'&&field.key==='companyId'){
      return [{value:'ALL',label:'ALL (All Companies)'},...items];
    }
    if(active.value==='jobTitles'&&field.key==='departmentId'){
      return [{value:'All',label:'All departments'},...items];
    }
    return items;
  }
  if(field.source){
    const types=records.value[field.source]||[];
    if(types.length)return types.filter(r=>r.availability!=='Inactive').map(r=>({value:r.title,label:r.title}));
  }
  if(field.key==='company'&&active.value==='workSchedules'){
    const companies=(records.value.companies||[]).filter(c=>c.availability!=='Inactive');
    const opts=companies.length?companies.map(c=>({value:c.code||c.title,label:c.title?`${c.title} (${c.code||c.title})`:c.code})):(field.options||[]).filter(v=>v!=='All').map(v=>({value:v,label:v}));
    return [{value:'All',label:'All companies'},...opts.filter(v=>String(v.value).toUpperCase()!=='ALL')];
  }
  if(field.key==='workBase'&&(active.value==='workSchedules'||active.value==='jobTitles')){
    const bases=deduplicateByCode((records.value.workBases&&records.value.workBases.length)?records.value.workBases:DEFAULT_WORK_BASES);
    return [{value:'All',label:'All work bases'},...bases.filter(b=>b.availability!=='Inactive').map(b=>({value:(b.code||b.title||'').toUpperCase(),label:b.title?`${b.title} (${b.code})`:b.code}))];
  }
  if(field.key==='workLocation'&&(active.value==='workSchedules'||active.value==='jobTitles')){
    const locs=deduplicateByCode((records.value.workLocations&&records.value.workLocations.length)?records.value.workLocations:DEFAULT_WORK_LOCATIONS);
    return [{value:'All',label:'All work locations'},...locs.filter(l=>l.availability!=='Inactive').map(l=>({value:String(l.code||l.title||'').toUpperCase(),label:l.title?`${l.title} (${l.code||l.title})`:String(l.code||l.title)}))];
  }
  return (field.options||[]).map(x=>({value:x,label:x}));
}
function edit(r=null){
  form.value=r?{...r}:Object.fromEntries(spec.value.fields.map(f=>[f.key,f.key==='employee'?user.value.name:f.type==='select'&&f.required&&!f.noDefault?(options(f)[0]?.value||''):f.key==='year'?new Date().getFullYear():'']));
  if(active.value==='workSchedules'){
    if(!r){
      form.value.company=options(spec.value.fields.find(f=>f.key==='company')).find(o=>String(o.value).toUpperCase()==='SQ')?.value || options(spec.value.fields.find(f=>f.key==='company')).find(o=>String(o.value).toUpperCase()!=='ALL')?.value || 'All';
      form.value.workBase=form.value.workBase||'SITE';
      form.value.workLocation=form.value.workLocation||'All';
      form.value.code=getNextShiftCode(form.value.company);
    }else{
      form.value.workBase=String(form.value.workBase||'').toUpperCase();
      form.value.workLocation=form.value.workLocation||'All';
    }
    const net=calcNetHours(form.value.start,form.value.end,form.value.breakHours);
    if(net!==null&&!isNaN(net))form.value.netHours=net;
    initScheduleBlocks(r);
  }
  activeMultiDropdown.value = null;
  if(active.value==='jobTitles'){
    if(!r){
      form.value.code=getNextJobCode();
      form.value.workBase=form.value.workBase||'All';
      form.value.workLocation=form.value.workLocation||'All';
      form.value.departmentId=form.value.departmentId||'All';
    } else {
      form.value.workBase=form.value.workBase||'All';
      form.value.workLocation=form.value.workLocation||'All';
      form.value.departmentId=form.value.departmentId||'';
    }
  }
  if(active.value==='departments'){
    if(!r){
      form.value.code=getNextDepartmentCode();
      if(!form.value.companyId) form.value.companyId = 'ALL';
    }
  }
  validationErrors.value={};
  error.value='';
  editor.value={id:r?.id||null,version:r?.version,requestId:crypto.randomUUID?.()||('request-'+Date.now()+'-'+Math.random().toString(36).slice(2))};
  nextTick(()=>document.querySelector('#hrRecordDialog input, #hrRecordDialog select')?.focus());
}
function clearFieldValidation(event){
  const key=String(event?.target?.id||'').replace(/^hr-/, '');
  if(key&&validationErrors.value[key]){
    const next={...validationErrors.value};delete next[key];validationErrors.value=next;
    if(!Object.keys(next).length)error.value='';
  }
}
function validateRecordForm(){
  const problems={};
  for(const field of formFields.value){
    const key=field.key;
    const value=key==='employee'&&scope.value==='personal'?user.value?.name:form.value[key];
    const empty=value==null||String(value).trim()==='';
    if(field.required&&empty){problems[key]=field.label+' is required.';continue;}
    if(empty)continue;
    if(field.type==='number'){
      const n=Number(value);
      if(!Number.isFinite(n))problems[key]=field.label+' must be a valid number.';
      else if(field.min!=null&&n<field.min)problems[key]=field.label+' must be at least '+field.min+'.';
      else if(field.max!=null&&n>field.max)problems[key]=field.label+' must be no more than '+field.max+'.';
      else if(['year','instalments','maxAssigned'].includes(key)&&!Number.isInteger(n))problems[key]=field.label+' must be a whole number.';
    }
    if(field.type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))problems[key]=field.label+' must be a valid date.';
    if(field.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))problems[key]='Enter a valid email address.';
  }
  if(active.value==='workSchedules') {
    if (scheduleBlocks.value.length === 0 || scheduleBlocks.value.every(b => (b.days || []).length === 0)) {
      problems.daySchedules = 'Please select at least one working day for the schedule.';
    }
    for (const b of scheduleBlocks.value) {
      if (calcNetHours(b.start, b.end, b.breakHours) === null) {
        problems.netHours = 'Enter valid start/end times and a break shorter than the shift.';
        break;
      }
    }
    const net = calcNetHours(form.value.start, form.value.end, form.value.breakHours);
    if (net !== null && !isNaN(net)) form.value.netHours = net;
  }
  validationErrors.value=problems;
  const first=Object.keys(problems)[0];
  if(first){
    error.value=Object.values(problems).join(' ');
    nextTick(()=>{const field=document.getElementById('hr-'+first);field?.scrollIntoView({block:'center',behavior:'smooth'});field?.focus({preventScroll:true});});
    return false;
  }
  return true;
}
function saveRequestWithDeadline(payload,ms=35000){
  let timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('The server has not confirmed the request yet. It may still complete. Check the record list before retrying; the same request reference will be reused.')),ms);
  });
  return Promise.race([api('hrSave',payload),deadline]).finally(()=>clearTimeout(timer));
}
function inductionFlexi(code){const map={S:1500,M:1000,E:600,C:600,W:600};return map[String(code).toUpperCase()]||600;}
function inductionCheckup(code){const map={S:'RM 800 / yr (Age 40+ or Senior Mgt)',M:'RM 500 / yr (Age 40+ or Managers)'};return map[String(code).toUpperCase()]||'N/A';}
function inductionMeals(code){const map={S:'Actual expense with receipt',M:'RM 70/day (Breakfast 15, Lunch 25, Dinner 30)',E:'RM 50/day (Breakfast 10, Lunch 20, Dinner 20)',C:'RM 50/day (Breakfast 10, Lunch 20, Dinner 20)',W:'Not listed (per site terms)'};return map[String(code).toUpperCase()]||'Policy limit';}
function inductionOt(code){const map={S:'Exempt',M:'Exempt',E:'Eligible (<= RM 4,000 office / <= RM 7,000 site)',C:'Eligible (1.5x / 2.0x / 3.0x; Site: 1.0x)',W:'Eligible (1.5x office / 1.0x site)'};return map[String(code).toUpperCase()]||'Eligible';}
function inductionLeave(code){const map={S:'22 – 26 days',M:'18 – 24 days',E:'14 – 20 days',C:'12 – 18 days',W:'12 – 18 days'};return map[String(code).toUpperCase()]||'12 – 26 days';}
function editable(r){if(!r)return false;if(!admin.value&&!canCreate.value)return false;if(spec.value?.immutable)return false;const st=r.status||r.availability||'Active';return ['Active','Draft','Open','Applied','Shortlisted','Interview','Offer','Hired','Rejected','Planned','Available','Inactive','Maintenance'].includes(st);}
async function save(){
  if(saving.value||!editor.value)return;
  if(scope.value==='personal')form.value.employee=user.value.name;
  if(!validateRecordForm())return;
  saving.value=true;
  error.value='';
  try {
    const fields = spec.value?.fields || [];
    for (const f of fields) {
      if (f.type === 'date' && form.value[f.key]) {
        const s = String(form.value[f.key]).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          // valid
        } else if (/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.test(s)) {
          const parts = s.split(/[-/]/);
          form.value[f.key] = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
        } else if (/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.test(s)) {
          const parts = s.split(/[-/]/);
          if (Number(parts[0]) > 12) {
            form.value[f.key] = `${parts[2]}-${String(parts[1]).padStart(2, '0')}-${String(parts[0]).padStart(2, '0')}`;
          } else if (Number(parts[1]) > 12) {
            form.value[f.key] = `${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
          } else {
            form.value[f.key] = `${parts[2]}-${String(parts[0]).padStart(2, '0')}-${String(parts[1]).padStart(2, '0')}`;
          }
        }
      }
      if (f.type === 'number' && form.value[f.key] !== undefined && form.value[f.key] !== '') {
        form.value[f.key] = Number(form.value[f.key]);
      }
    }
    const savedModule=active.value;
    if (savedModule === 'workSchedules') {
      if (!form.value.workLocation) form.value.workLocation = 'All';
      const primaryBlock = scheduleBlocks.value[0] || {};
      form.value.start = primaryBlock.start || form.value.start || '08:00';
      form.value.end = primaryBlock.end || form.value.end || '17:30';
      form.value.breakHours = primaryBlock.breakHours !== undefined ? Number(primaryBlock.breakHours) : 1;
      const net = calcNetHours(form.value.start, form.value.end, form.value.breakHours);
      if (net !== null && !isNaN(net)) form.value.netHours = net;

      form.value.daySchedules = JSON.stringify(scheduleBlocks.value);
      form.value.workingDays = scheduleBlocks.value.flatMap(b => b.days || []);
      const restDayIndices = [];
      const offDayIndices = [];
      unassignedDays.value.forEach(d => {
        const idx = DAY_INDEX_MAP[d];
        if (isDayRest(d)) restDayIndices.push(idx);
        else offDayIndices.push(idx);
      });
      form.value.restDays = restDayIndices;
      form.value.offDays = offDayIndices;
    }
    const versionNum = editor.value.version != null ? Number(editor.value.version) : undefined;
    let res = await saveRequestWithDeadline({module:savedModule,id:editor.value.id,version:versionNum,requestId:editor.value.requestId,record:form.value});
    if(res.status!=='success'){
      if (savedModule === 'workSchedules' && res.message && res.message.includes('Record changed')) {
        const retryRes = await saveRequestWithDeadline({module:savedModule,id:editor.value.id,requestId:editor.value.requestId,record:form.value});
        if (retryRes && retryRes.status === 'success') {
          res = retryRes;
        }
      }
      if(res.status!=='success'){
        error.value=(res.message||'Save failed. Please retry.')+' [Module: '+savedModule+', reference: '+editor.value.requestId+']';
        return;
      }
    }
    // A confirmed server response is the success boundary; do not hold the modal
    // open while the expensive full HR bootstrap runs. Update only the affected list.
    const updatedRecord = {
      ...(res.data || {}),
      ...form.value,
      id: res.data?.id || form.value.id || editor.value.id,
      version: res.data?.version || (editor.value.version ? Number(editor.value.version) + 1 : 1),
      daySchedules: form.value.daySchedules || res.data?.daySchedules,
      workingDays: form.value.workingDays || res.data?.workingDays,
      restDays: form.value.restDays || res.data?.restDays || [],
      offDays: form.value.offDays || res.data?.offDays || []
    };
    const existing = records.value[active.value] || [];
    records.value[active.value] = existing.some(r => r.id === updatedRecord.id) 
      ? existing.map(r => r.id === updatedRecord.id ? updatedRecord : r) 
      : [updatedRecord, ...existing];
    if (typeof window !== 'undefined' && savedModule === 'workSchedules') {
      window.workSchedules = records.value.workSchedules;
      try {
        localStorage.setItem('hr_custom_workSchedules', JSON.stringify(records.value.workSchedules));
      } catch (_) {}
    }
    CacheManager.saveHrRecords({
      [scope.value]: {
        records: records.value,
        employees: employees.value,
        teamLeave: teamLeave.value,
        audit: audit.value
      }
    });
    editor.value = null;
    notice.value = 'Record saved.';
    validationErrors.value = {};
    notice.value=spec.value?.self?'Request submitted successfully.':'Record saved successfully.';
    // Background reconciliation: failure must not retroactively erase confirmed success.
    void load(true).catch(console.error);
  } catch(err) {
    error.value = (err.message || 'Save failed. Please retry.')+' [Module: '+active.value+', request reference: '+(editor.value?.requestId||'unknown')+']';
  } finally {
    saving.value = false;
  }
}
function actions(module,r){const a=[],self=r.employee===user.value?.name,manager=['Admin','HR','Supervisor','HOD'].includes(user.value?.role)&&r.manager===user.value?.name;const push=(command,label)=>a.push({command,label});
 if(['claims','loans','bookings'].includes(module)&&['Pending manager','Pending admin'].includes(r.status)&&(self||admin.value))push('cancel','Cancel');
 if(['claims','loans'].includes(module)&&!self&&((r.status==='Pending manager'&&(manager||admin.value))||(r.status==='Pending admin'&&admin.value))){push('approve',r.status==='Pending manager'?'Recommend':'Approve');push('reject','Reject');}
 if(module==='claims'&&r.status==='Approved'&&admin.value&&!self)push('paid','Record payment');
 if(module==='loans'&&r.status==='Approved'&&admin.value&&!self)push('disburse','Record disbursement');
 if(module==='loans'&&r.status==='Active'&&admin.value)push('repay','Record repayment');
 if(module==='bookings'&&r.status==='Pending admin'&&admin.value&&!self){push('approve','Approve');push('reject','Reject');}
 if(module==='resourceAssignments'&&r.status==='Assigned'&&admin.value&&scope.value==='all')push('returnResource','Record return');
 if(module==='tax'&&r.status==='Submitted'&&admin.value&&!self)push('review','Mark reviewed');
 if(module==='cycles'&&r.status==='Active'&&admin.value)push('closeCycle','Close cycle');
 if(module==='letters'&&r.status==='Draft'&&admin.value)push('issue','Issue letter');
 if(module==='training'&&r.status==='Planned'&&admin.value)push('complete','Complete');
 if(module==='appraisals'){if(r.status==='Pending self'&&self)push('selfReview','Self review');if(r.status==='Pending manager'&&(manager||admin.value)&&!self)push('managerReview','Manager review');if(r.status==='Pending admin'&&admin.value&&!self)push('finalise','Finalise');}
 return a;
}
function ask(module,r,a){decision.value={module,record:r,...a,comments:'',reference:'',repayment:'',rating:3};}
async function act(){
  saving.value=true;
  error.value='';
  try {
    const d=decision.value;
    const res=await api('hrTransition',{module:d.module,id:d.record.id,version:d.record.version,command:d.command,comments:d.comments,reference:d.reference,repayment:d.repayment,rating:d.rating});
    if(res.status!=='success'){
      error.value=res.message||'Action failed.';
      return;
    }
    // Instant local state & cache update for immediate response time
    if (res.data && records.value[d.module]) {
      const list = records.value[d.module];
      const idx = list.findIndex(r => r.id === res.data.id);
      if (idx > -1) list[idx] = res.data;
      try {
        const cachedHr = CacheManager.getHrRecords() || {};
        if (cachedHr[scope.value]?.records?.[d.module]) {
          const cList = cachedHr[scope.value].records[d.module];
          const cIdx = cList.findIndex(r => r.id === res.data.id);
          if (cIdx > -1) cList[cIdx] = res.data;
          CacheManager.saveHrRecords(cachedHr);
        }
      } catch (_) {}
    }
    decision.value=null;
    notice.value='Action recorded.';
    saving.value=false;
    load(true).catch(console.error);
  } catch(err) {
    error.value = err.message || 'Action failed.';
  } finally {
    saving.value=false;
  }
}
function exportCsv(){const list=active.value==='audit'?audit.value:active.value==='reports'?Object.entries(records.value).flatMap(([m,rows])=>rows.map(r=>({module:m,...r}))):filtered.value;
 const keys=[...new Set(list.flatMap(r=>Object.keys(r)))];const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const csv='\uFEFF'+[keys.map(cell).join(','),...list.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='HR-'+active.value+'.csv';a.click();URL.revokeObjectURL(url);}
function printLetter(r){detail.value=r;nextTick(()=>window.print());}
function handleFileUpload(event, fieldKey) {
  const file = event.target?.files?.[0];
  if (!file) return;
  if (file.type && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 800;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.6);
        form.value[fieldKey] = compressed;
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    if (file.size > 35 * 1024) {
      alert('Document is too large for inline attachment (max 35 KB). Please upload to Google Drive and paste the shareable link instead.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      form.value[fieldKey] = e.target.result;
    };
    reader.readAsDataURL(file);
  }
}
function openAttendanceDashboard(month) {
  if (typeof window.switchTab === 'function') {
    window.switchTab('dashboard');
  } else {
    const sidebarLink = document.querySelector('[data-page="dashboard"]');
    if (sidebarLink) sidebarLink.click();
  }
  if (month && typeof window.$ === 'function') {
    setTimeout(() => {
      $('#monthSelect').val(month).trigger('change');
    }, 50);
  }
}
function handleAttendanceUpload(file) {
  if (!file) return;
  if (dashboardActions && typeof dashboardActions.handleFile === 'function') {
    dashboardActions.handleFile(file);
    openAttendanceDashboard();
  }
}
let priorFocus;
watch([() => form.value?.start, () => form.value?.end, () => form.value?.breakHours], ([s, e, b]) => {
  if (active.value === 'workSchedules' && editor.value) {
    const net = calcNetHours(s, e, b);
    form.value.netHours = net === null || !Number.isFinite(net) ? '' : net;
  }
});
watch(() => form.value?.company, (newCo) => {
  if (active.value === 'workSchedules' && editor.value && !editor.value.id && newCo) {
    const curCode = String(form.value.code || '').trim();
    if (!curCode || /^(S|M|G|SQ|MS)\d*$/i.test(curCode)) {
      form.value.code = getNextShiftCode(newCo);
    }
  }
});
watch(()=>Boolean(editor.value||decision.value||detail.value),async open=>{if(open){priorFocus=document.activeElement;await nextTick();document.querySelector('.hr-dialog input, .hr-dialog select, .hr-dialog button')?.focus();}else priorFocus?.focus();});
function trapDialog(event){if(event.key!=='Tab')return;const items=[...event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
function openModule(e){const d=e.detail||{};if(!user.value&&typeof window!=='undefined'){const s=localStorage.getItem('hrPortalUser');if(s){try{user.value=JSON.parse(s);}catch(_){}}if(!user.value&&window.currentUser)user.value=window.currentUser;}if(!canOpenHr(user.value?.role,d.module,d.scope))return;choose(d.module,d.scope);pageLabel.value=d.label||'Overview';load(false);}
function review(record){
  if(record.isAttendance || record.module === 'attendance'){
    openAttendanceDashboard(record.month);
    return;
  }
  const module=record.module;const nextScope=record.employee===user.value?.name?'personal':admin.value?'all':['HOD','Supervisor'].includes(user.value?.role)?'team':'personal';const link=document.querySelector(`[data-hr-module="${module}"][data-scope="${nextScope}"]`);if(link){let parent=link.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}link.click();}}
function onCacheSync(e) {
  // Defensive guard: never trigger server re-fetch (load(true)) from cache-sync events.
  // This prevents recursive loop: load -> saveHrRecords -> peopleos-cache-sync -> load.
}
onMounted(()=>{window.addEventListener('hr-module',openModule);window.addEventListener('hr-open-dossier',onOpenDossier);window.addEventListener('hr-session',session);window.addEventListener('hr-action-count',onActionCount);const saved=localStorage.getItem('hrPortalUser');if(saved){try{user.value=JSON.parse(saved);if(user.value)load(false);}catch{}}else if(typeof window!=='undefined'&&window.currentUser){user.value=window.currentUser;load(false);}});
onBeforeUnmount(()=>{clearOwnLeaveSummary();loadVersion++;window.removeEventListener('hr-module',openModule);window.removeEventListener('hr-open-dossier',onOpenDossier);window.removeEventListener('hr-session',session);window.removeEventListener('hr-action-count',onActionCount);});
</script>
<template>
<section id="hr-workspace" class="tab-section hr-workspace" style="display:none;">
 <div class="hr-heading" style="display:none;"><button class="btn btn-outline-secondary" :disabled="busy" @click="load">{{busy?'Refreshing…':'Refresh records'}}</button></div>
 <div v-if="error" role="alert" class="alert alert-danger">{{error}}</div><div v-if="notice&&!editor&&!decision" role="status" class="alert alert-success">{{notice}}<button class="btn-close float-end" aria-label="Dismiss" @click="notice=''"/></div>
 <div class="hr-layout">
 <div class="hr-panel" :aria-busy="busy">
 <p v-if="busy&&hasCurrentRecords" class="text-muted small" role="status">Refreshing records…</p>
 <div v-if="busy&&!hasCurrentRecords" class="hr-loading" role="status">Loading HR records…</div>
 <template v-else-if="active==='overview'">
    <RoleOverview
      :user="user"
      :records="records"
      :employees="employees"
      :team-leave="teamLeave"
      :audit="audit"
      :pending-attendance-list="pendingAttendanceItems"
      :refreshing="busy || ownLeaveLoading"
      :leave-summary="ownLeaveSummary"
      :leave-summary-error="ownLeaveError"
      :leave-summary-loading="ownLeaveLoading"
      @refresh="load(true)"
      @navigate-module="onOverviewNavigateModule"
      @open-dossier="openStaffDossier"
      @open-modal="onOverviewOpenModal"
      @review-action="review"
    />
    <!-- Enterprise Operations & Administration Shortcuts for HR / Admin -->
    <div v-if="admin" class="main-card p-3 mt-4 border border-light-subtle shadow-sm rounded-3 enterprise-ops-card">
      <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2 pb-2 border-bottom">
        <div class="fw-bold text-dark small text-uppercase" style="letter-spacing: 0.05em;">
          <i class="bi bi-gear-fill me-1 text-primary"></i>Enterprise Operations &amp; Administration
        </div>
      </div>
      <div class="enterprise-ops-grid pt-1">
        <button id="openAttendanceApprovalsOverviewBtn" class="btn btn-outline-primary btn-sm fw-semibold shadow-sm enterprise-op-btn" type="button" @click="openAttendanceDashboard()">
          <i class="bi bi-clock-history me-1"></i><span>Attendance Approvals</span>
        </button>
        <button id="openStaffDossierBtn" class="btn btn-outline-info btn-sm fw-semibold text-dark shadow-sm enterprise-op-btn" type="button" @click="openStaffDossier()">
          <i class="bi bi-file-earmark-person me-1 text-info"></i><span>360° Staff Dossier</span>
        </button>
        <button id="openStatutorySettingsBtn" class="btn btn-outline-primary btn-sm fw-semibold shadow-sm enterprise-op-btn" type="button" @click="openStatutorySettings">
          <i class="bi bi-sliders me-1"></i><span>Statutory &amp; Policy Settings</span>
        </button>
        <button id="openYearEndRolloverBtn" class="btn btn-outline-success btn-sm fw-semibold shadow-sm enterprise-op-btn" type="button" @click="openYearEndModal">
          <i class="bi bi-calendar2-range me-1"></i><span>Year-End Leave Rollover</span>
        </button>
        <button id="openLetterGeneratorBtn" class="btn btn-outline-warning btn-sm fw-semibold text-dark shadow-sm enterprise-op-btn" type="button" @click="openLetterGenerator()">
          <i class="bi bi-file-earmark-text me-1"></i><span>Corporate Letter Generator</span>
        </button>
        <label for="hrAttendanceFileUpload" class="btn btn-outline-primary btn-sm fw-semibold mb-0 shadow-sm enterprise-op-btn" style="cursor: pointer;">
          <i class="bi bi-cloud-upload-fill me-1"></i><span>Upload Biometric Attendance</span>
          <input type="file" id="hrAttendanceFileUpload" accept=".csv, .xlsx, .xls" class="d-none" @change="handleAttendanceUpload($event.target.files[0])" />
        </label>
      </div>
    </div>
 </template>
 <template v-else-if="active==='reports'"><ReportCenter :employees="employees" :records="records" :team-leave="teamLeave" :user="user" /><HrAnalytics :employees="employees" :records="records" :team-leave="teamLeave" :role="user?.role || 'User'" mode="reports" /><div class="hr-section-title"><div><p>Live summaries of records you are permitted to view.</p></div><button class="btn btn-outline-secondary" @click="exportCsv">Export records</button></div><div class="main-card p-4"><table class="table"><thead><tr><th>Module</th><th>Records</th><th>Awaiting action</th><th>Completed / approved</th></tr></thead><tbody><tr v-for="[key,s] in permitted" :key="key"><td>{{s.label}}</td><td>{{(records[key]||[]).length}}</td><td>{{(records[key]||[]).filter(r=>r.status.startsWith('Pending')||r.status==='Submitted').length}}</td><td>{{(records[key]||[]).filter(r=>['Completed','Approved','Paid','Reviewed','Issued'].includes(r.status)).length}}</td></tr></tbody></table><p class="text-muted small mb-0">Claims paid: RM {{money(totals.paid)}}. Reimbursements are tracked separately from payroll; these totals do not change payslips.</p></div></template>
 <template v-else-if="active==='audit'"><div class="hr-section-title"><div><p>Latest 500 changes to the new HR modules.</p></div><button class="btn btn-outline-secondary" @click="exportCsv">Export CSV</button></div><div class="main-card p-3 table-responsive"><table class="table"><thead><tr><th>When</th><th>Actor</th><th>Module</th><th>Action</th><th>Record</th></tr></thead><tbody><tr v-for="r in audit" :key="r.id"><td>{{new Date(r.updatedAt).toLocaleString()}}</td><td>{{r.actor}}</td><td>{{modules[r.module]?.label}}</td><td>{{r.status}}</td><td>{{r.title}}</td></tr></tbody></table><p v-if="!audit.length" class="hr-empty">No changes recorded yet.</p></div></template>
 <template v-else-if="spec">
  <InductionBenefits v-if="['jobGrades','companies','claims','claimPolicies'].includes(active)"/>
  
  <!-- Organisation Sub-module Switcher & View Mode Selector -->
  <div v-if="['companies','jobGrades','departments','jobTitles','resources','resourcePolicies','workSchedules','workBases','workLocations','claimTypes','claimPolicies'].includes(active)" class="org-subnav-tabs d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3 pb-2 border-bottom">
    <div class="nav nav-pills flex-nowrap overflow-auto" role="tablist">
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='companies'}" type="button" @click="choose('companies')">
        <i class="bi bi-building me-1"></i>Companies
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='jobGrades'}" type="button" @click="choose('jobGrades')">
        <i class="bi bi-layers me-1"></i>Job Grades
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='departments'}" type="button" @click="choose('departments')">
        <i class="bi bi-diagram-3 me-1"></i>Departments
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='jobTitles'}" type="button" @click="choose('jobTitles')">
        <i class="bi bi-person-badge me-1"></i>Job Title Library
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='workBases'}" type="button" @click="choose('workBases')">
        <i class="bi bi-briefcase me-1"></i>Work Bases
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='workLocations'}" type="button" @click="choose('workLocations')">
        <i class="bi bi-geo-alt me-1"></i>Work Locations
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='resources'}" type="button" @click="choose('resources')">
        <i class="bi bi-box-seam me-1"></i>Resource Catalogue
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='resourcePolicies'}" type="button" @click="choose('resourcePolicies')">
        <i class="bi bi-shield-slash me-1"></i>Resource Limits
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='workSchedules'}" type="button" @click="choose('workSchedules')">
        <i class="bi bi-clock-history me-1"></i>Shift Templates
      </button>
      <button class="nav-link py-1 px-3 fw-bold me-1" :class="{active: active==='claimTypes'}" type="button" @click="choose('claimTypes')">
        <i class="bi bi-receipt me-1"></i>Claim Types
      </button>
      <button class="nav-link py-1 px-3 fw-bold" :class="{active: active==='claimPolicies'}" type="button" @click="choose('claimPolicies')">
        <i class="bi bi-shield-check me-1"></i>Claim Limits by Grade
      </button>
    </div>
    <div class="d-flex align-items-center gap-1">
      <span class="text-muted small me-1">Display:</span>
      <div class="btn-group btn-group-sm" role="group" aria-label="View Mode Switcher">
        <button type="button" id="hrOrgTabViewBtn" class="btn btn-outline-primary" :class="{active: orgViewMode==='tab'}" title="Tab View (Cards)" @click="orgViewMode='tab'">
          <i class="bi bi-grid-fill me-1"></i>Tab View
        </button>
        <button type="button" id="hrOrgListingViewBtn" class="btn btn-outline-primary" :class="{active: orgViewMode==='listing'}" title="Listing View (Table)" @click="orgViewMode='listing'">
          <i class="bi bi-table me-1"></i>Listing View
        </button>
      </div>
    </div>
  </div>

  <div class="hr-section-title d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
    <div class="flex-grow-1" style="min-width: 260px;">
      <p v-if="['claimPolicies','resourcePolicies'].includes(active)" class="hr-note mb-0">Grade-specific limits override the all-grades policy. Where policies exist for the company and category, an employee must match a grade or all-grades policy. Zero claim limits or a zero resource quantity disable that entitlement.</p>
      <p v-else-if="active==='loans'" class="hr-note mb-0">Record externally approved loan disbursements and repayments. This register does not initiate bank payments, calculate interest or deduct repayments from payroll.</p>
      <p v-else-if="active==='tax'" class="hr-note mb-0">Declaration register for HR review. Amounts are employee declarations; no eligibility, tax deduction or official TP1 submission is calculated here.</p>
      <p v-else-if="active==='adjustments'" class="hr-note mb-0">Posted adjustments change annual, medical, hospitalisation leave after an opening balance is recorded. Use a negative entry to reverse a posting. Refresh My Leave to see the updated balance.</p>
      <p v-else-if="active==='leaveOpeningBalances'" class="hr-note mb-0">Enter the verified available days for one employee and leave type. The newest opening replaces the previous opening for that year and type. Choose “Exclude existing test records” only after confirming existing leave records are test history: these records remain in history but are excluded from this balance. Future requests count normally.</p>
      <p v-else-if="active==='letters'" class="hr-note mb-0">Issued letters are available to the employee here. Issuing a letter does not send an email or change salary.</p>
    </div>
    <div v-if="scope === 'personal' && canCreate" class="d-flex align-items-center gap-2 ms-auto">
      <button class="btn btn-primary btn-sm fw-bold shadow-sm" @click="edit()">{{spec.self?'New request':'Add record'}}</button>
    </div>
  </div>
  
  <!-- Universal Standardized Cascading Filter Toolbar (Company > Project/Department > Search) -->
  <div v-if="scope !== 'personal'" class="staff-toolbar no-print p-3 bg-white rounded-3 shadow-sm border mb-4">
    <div class="row g-2 align-items-end">
      <div class="col-12 col-sm-6 col-lg-3">
        <label class="form-label small fw-bold text-muted text-uppercase mb-1" for="hrCompanyFilter"><i class="bi bi-building me-1"></i>Company</label>
        <select id="hrCompanyFilter" v-model="selectedCompany" class="form-select form-select-sm fw-semibold" aria-label="Filter records by company" @change="onCompanyChange">
          <option value="all">All Companies</option>
          <option v-for="c in filterCompanies" :key="c.id" :value="c.id">{{c.title}}</option>
        </select>
      </div>
      <div class="col-12 col-sm-6 col-lg-3">
        <label class="form-label small fw-bold text-muted text-uppercase mb-1" for="hrDepartmentFilter"><i class="bi bi-diagram-3 me-1"></i>Project / Department</label>
        <select id="hrDepartmentFilter" v-model="selectedDepartment" class="form-select form-select-sm fw-semibold" aria-label="Filter records by department" @change="onDepartmentChange">
          <option value="all">All Projects / Depts</option>
          <option v-for="d in filterDepartments" :key="d.id" :value="d.id">{{d.title}}</option>
        </select>
      </div>
      <div style="display:none;">
        <select id="hrStaffFilter" v-model="selectedStaff" class="form-select form-select-sm" aria-label="Filter records by staff">
          <option value="all">All Staff</option>
          <option v-for="e in filterStaff" :key="e.id || e.name" :value="e.name">{{e.name}}</option>
        </select>
      </div>
      <div class="col-12 col-lg-6">
        <label class="form-label small fw-bold text-muted text-uppercase mb-1" for="hrSearch"><i class="bi bi-search me-1"></i>Search</label>
        <div class="search-field">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input id="hrSearch" v-model="query" type="search" aria-label="Search HR records" class="form-control form-control-sm" placeholder="Search records..."/>
        </div>
      </div>
      <div style="display:none;">
        <select id="hrStatusFilter" v-model="status" class="form-select form-select-sm hr-status-filter" aria-label="Filter record status">
          <option value="">All statuses</option>
          <option v-for="s in statuses" :key="s" :value="s">{{s}}</option>
        </select>
      </div>
    </div>
    <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top flex-wrap gap-2">
      <div class="d-flex align-items-center gap-2">
        <span class="small text-muted fw-semibold">{{filtered.length}} matching of {{current.length}} records</span>
        <span v-if="selectedCompany !== 'all' || selectedDepartment !== 'all' || selectedStaff !== 'all' || status || query" class="badge bg-light text-primary border" style="cursor: pointer;" @click="resetFilters">
          <i class="bi bi-x-circle me-1"></i>Reset filters
        </span>
      </div>
      <div class="d-flex align-items-center gap-2 ms-auto">
        <button v-if="canCreate" class="btn btn-primary btn-sm fw-bold shadow-sm" @click="edit()">
          <i class="bi bi-plus-lg me-1"></i>{{spec.self?'New request':'Add record'}}
        </button>
        <button v-if="admin && active==='leaveOpeningBalances'" id="openYearEndRolloverSectionBtn" class="btn btn-outline-success btn-sm fw-bold shadow-sm" type="button" @click="openYearEndModal">
          <i class="bi bi-calendar2-range me-1"></i>Year-End Rollover
        </button>
        <button v-if="admin && active==='letters'" id="openLetterGeneratorSectionBtn" class="btn btn-outline-warning btn-sm fw-bold text-dark shadow-sm" type="button" @click="openLetterGenerator()">
          <i class="bi bi-file-earmark-text me-1"></i>Corporate Letter Generator
        </button>
        <button class="btn btn-outline-secondary btn-sm fw-semibold shadow-sm" title="Export CSV" @click="exportCsv">
          <i class="bi bi-download me-1"></i>CSV
        </button>
      </div>
    </div>
  </div>

  <nav v-if="pageCount>1" class="d-flex align-items-center justify-content-between gap-2 mb-3" aria-label="Record pages">
    <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="page===1" @click="page--">Previous</button>
    <span class="small" role="status">Page {{page}} of {{pageCount}} · {{pagedRecords.length}} records shown</span>
    <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="page===pageCount" @click="page++">Next</button>
  </nav>
  <div v-if="!filtered.length" class="hr-empty main-card">
    <i :class="'bi bi-'+spec.icon"/>
    <h5>{{current.length?'No matching records':'No records yet'}}</h5>
    <p>{{canCreate?'Add your first record to get started.':'Records will appear when HR assigns them to you.'}}</p>
  </div>
  
  <!-- Specialized High-Density Layout for Job Grades -->
  <template v-if="active==='jobGrades'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-md-6 col-lg-4">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar bg-primary text-white fw-bold">G{{r.code}}</div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{r.title}}</h6>
                    <span class="badge bg-primary text-white small mt-1"><i class="bi bi-award-fill me-1"></i>Grade {{r.code}}</span>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">{{r.availability||r.status||'Active'}}</span>
              </div>
              <div class="d-flex flex-wrap gap-1 mt-2 mb-2">
                <span class="badge bg-danger-subtle text-danger border border-danger-subtle small"><i class="bi bi-heart-pulse-fill me-1"></i>Flexi: RM {{money(inductionFlexi(r.code))}}</span>
                <span class="badge bg-info-subtle text-info-emphasis border border-info-subtle small"><i class="bi bi-clipboard2-pulse-fill me-1"></i>Check-up: {{inductionCheckup(r.code)}}</span>
                <span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle small"><i class="bi bi-cup-hot-fill me-1"></i>Meals: {{inductionMeals(r.code)}}</span>
                <span class="badge bg-primary-subtle text-primary border border-primary-subtle small"><i class="bi bi-clock-history me-1"></i>OT: {{inductionOt(r.code)}}</span>
                <span class="badge border small" style="background:#f3e8ff; color:#6b21a8; border-color:#e9d5ff;"><i class="bi bi-calendar3 me-1"></i>AL: {{inductionLeave(r.code)}}</span>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit Grade</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Grade Code</th>
              <th>Grade Name</th>
              <th>Flexi-Wellness</th>
              <th>Check-Up</th>
              <th>Meals (&gt;250km)</th>
              <th>Mileage</th>
              <th>OT Eligibility</th>
              <th>AL Scale</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-primary text-white fw-bold px-2 py-1"><i class="bi bi-award-fill me-1"></i>Grade {{r.code}}</span></td>
              <td class="fw-bold">{{r.title}}</td>
              <td><span class="badge bg-danger-subtle text-danger border border-danger-subtle">RM {{money(inductionFlexi(r.code))}} / yr</span></td>
              <td class="small">{{inductionCheckup(r.code)}}</td>
              <td class="small">{{inductionMeals(r.code)}}</td>
              <td class="small">Car 0.50 / Bike 0.20</td>
              <td class="small">{{inductionOt(r.code)}}</td>
              <td><span class="badge border" style="background:#f3e8ff; color:#6b21a8; border-color:#e9d5ff;">{{inductionLeave(r.code)}}</span></td>
              <td><span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">{{r.availability||r.status||'Active'}}</span></td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Work Schedules -->
  <template v-else-if="active==='workSchedules'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-md-6 col-lg-4">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar fw-bold" :class="r.company === 'SQ' ? 'bg-primary text-white' : r.company === 'MS' ? 'bg-success text-white' : 'bg-dark text-white'">
                    {{ r.code }}
                  </div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{ r.title }}</h6>
                    <div class="text-muted small mt-1">
                      <span class="badge" :class="r.company === 'SQ' ? 'bg-primary text-white' : r.company === 'MS' ? 'bg-success text-white' : 'bg-secondary text-white'">
                        {{ r.company === 'All' ? 'All companies' : r.company }}
                      </span>
                      <span class="badge ms-1" :class="String(r.workBase||'').toLowerCase()==='site' ? 'bg-warning text-dark' : 'bg-secondary text-white'">
                        {{ r.workBase || 'Office' }}
                      </span>
                      <span class="badge bg-light text-dark border ms-1">
                        {{ r.workLocation || 'All' }}
                      </span>
                    </div>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">
                  {{ r.availability || r.status || 'Active' }}
                </span>
              </div>
              <div class="d-flex flex-wrap gap-1 mt-2 mb-2">
                <span class="badge bg-light text-dark border small"><i class="bi bi-clock me-1 text-primary"></i>{{ r.start }} – {{ r.end }}</span>
                <span class="badge bg-info-subtle text-info-emphasis border border-info-subtle small"><i class="bi bi-cup-hot me-1"></i>Break: {{ r.breakHours }}h</span>
                <span class="badge bg-primary-subtle text-primary border border-primary-subtle small fw-bold"><i class="bi bi-briefcase me-1"></i>Net: {{ r.netHours }}h</span>
              </div>
              <div class="d-flex flex-wrap align-items-center gap-1 mb-2">
                <span v-if="isAllDaysSchedule(r)" class="badge bg-success-subtle text-success border border-success-subtle small">
                  <i class="bi bi-calendar-check me-1"></i>Mon – Sun (All 7 Days)
                </span>
                <template v-else>
                  <span v-for="d in (r.workingDays || [])" :key="d" class="badge bg-primary-subtle text-primary border border-primary-subtle" style="font-size:0.75rem;">
                    {{ d }}
                  </span>
                  <span v-for="d in getRestOffBadges(r)" :key="d.name" class="badge" :class="d.type === 'Rest' ? 'bg-danger-subtle text-danger border border-danger-subtle' : 'bg-secondary-subtle text-secondary border border-secondary-subtle'" style="font-size:0.72rem;">
                    {{ d.name }}: {{ d.type }}
                  </span>
                </template>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Update Shift</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Company</th>
              <th>Work Base</th>
              <th>Work Location</th>
              <th>Shift Code</th>
              <th>Description</th>
              <th>Working Days</th>
              <th>Working Hours</th>
              <th>Break</th>
              <th>Net Hours</th>
              <th>Notes / Grace</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge fw-semibold" :class="r.company === 'SQ' ? 'bg-primary text-white' : r.company === 'MS' ? 'bg-success text-white' : 'bg-secondary text-white'">{{ r.company }}</span></td>
              <td><span class="badge" :class="String(r.workBase||'').toLowerCase()==='site' ? 'bg-warning-subtle text-warning-emphasis border' : 'bg-secondary-subtle text-secondary border'">{{ r.workBase || 'Office' }}</span></td>
              <td>{{ r.workLocation || 'All' }}</td>
              <td><span class="fw-bold text-dark">{{ r.code }}</span></td>
              <td class="fw-semibold">{{ r.title }}</td>
              <td>
                <span v-if="isAllDaysSchedule(r)" class="badge bg-success-subtle text-success border border-success-subtle small">
                  Mon – Sun
                </span>
                <span v-else class="small fw-semibold text-dark">
                  {{ (r.workingDays || []).join(', ') }}
                </span>
              </td>
              <td>{{ r.start }} – {{ r.end }}</td>
              <td>{{ r.breakHours }}h</td>
              <td><span class="badge bg-light text-dark border">{{ r.netHours }}h</span></td>
              <td class="small text-muted">{{ r.notes || '—' }}</td>
              <td><span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status)}">{{ r.availability || r.status || 'Active' }}</span></td>
              <td class="text-end">
                <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-semibold me-1" @click="edit(r)">Edit</button>
                <button class="btn btn-outline-secondary btn-sm" @click="detail=r">Details</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Job Titles -->
  <template v-else-if="active==='jobTitles'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-md-6 col-lg-4">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar bg-primary text-white fw-bold"><i class="bi bi-person-badge"></i></div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{r.title}}</h6>
                    <div class="text-muted small mt-1 d-flex flex-wrap gap-1 align-items-center">
                      <span class="badge bg-secondary-subtle text-secondary border fw-bold">{{r.code}}</span>
                      <span class="badge bg-primary-subtle text-primary border fw-bold">{{label('jobGrades', r.gradeId)}}</span>
                      <span v-if="r.departmentId" class="badge bg-info-subtle text-info border fw-bold"><i class="bi bi-diagram-3 me-1"></i>{{formatMultiDepartmentLabel(r.departmentId)}}</span>
                      <span v-if="r.workBase" class="badge bg-light text-dark border"><i class="bi bi-briefcase me-1"></i>{{r.workBase === 'All' ? 'All Bases' : r.workBase}}</span>
                      <span v-if="r.workLocation" class="badge bg-light text-dark border"><i class="bi bi-geo-alt me-1"></i>{{r.workLocation === 'All' ? 'All Locations' : r.workLocation}}</span>
                    </div>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">{{r.availability||r.status||'Active'}}</span>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit Title</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Job Code</th>
              <th>Job Title</th>
              <th>Department</th>
              <th>Job Grade</th>
              <th>Work Based</th>
              <th>Work Location</th>
              <th>Status</th>
              <th>Description</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-secondary-subtle text-secondary border px-2 py-1 fw-bold">{{r.code}}</span></td>
              <td class="fw-bold text-primary">{{r.title}}</td>
              <td><span v-if="r.departmentId" class="badge bg-info-subtle text-info border px-2 py-1 fw-bold"><i class="bi bi-diagram-3 me-1"></i>{{formatMultiDepartmentLabel(r.departmentId)}}</span><span v-else class="text-muted small">—</span></td>
              <td><span class="badge bg-primary-subtle text-primary border px-2 py-1 fw-bold">{{label('jobGrades', r.gradeId)}}</span></td>
              <td><span class="badge bg-light text-dark border">{{r.workBase || 'All'}}</span></td>
              <td><span class="badge bg-light text-dark border">{{r.workLocation || 'All'}}</span></td>
              <td><span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">{{r.availability||r.status||'Active'}}</span></td>
              <td class="small text-muted">{{r.notes || '—'}}</td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Companies -->
  <template v-else-if="active==='companies'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-md-6 col-lg-4">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar bg-primary text-white fw-bold"><i class="bi bi-building"></i></div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{r.title}}</h6>
                    <div class="text-muted small mt-1">
                      <span class="badge bg-secondary-subtle text-secondary border fw-bold">{{r.code}}</span>
                      <span v-if="r.registration" class="badge bg-light text-dark border ms-1">Reg: {{r.registration}}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="small text-muted mt-2 d-flex flex-wrap gap-2">
                <span v-if="r.epf"><strong>EPF:</strong> {{r.epf}}</span>
                <span v-if="r.socso"><strong>SOCSO:</strong> {{r.socso}}</span>
                <span v-if="r.tax"><strong>Tax:</strong> {{r.tax}}</span>
              </div>
              <p v-if="r.address" class="text-muted small mb-2 mt-2"><i class="bi bi-geo-alt me-1"></i>{{r.address}}</p>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit Company</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Code</th>
              <th>Company Name</th>
              <th>Registration</th>
              <th>Policy</th>
              <th>EPF / SOCSO / Tax</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-secondary-subtle text-secondary border px-2 py-1 fw-bold">{{r.code}}</span></td>
              <td class="fw-bold text-dark">{{r.title}}</td>
              <td class="small">{{r.registration || '—'}}</td>
              <td><span class="badge bg-primary-subtle text-primary border px-2 py-1"><i class="bi bi-shield-check me-1"></i>{{r.inductionPolicy || 'Standard Policy'}}</span></td>
              <td class="small text-muted">{{[r.epf && 'EPF: '+r.epf, r.socso && 'SOCSO: '+r.socso, r.tax && 'Tax: '+r.tax].filter(Boolean).join(' · ') || '—'}}</td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Departments -->
  <template v-else-if="active==='departments'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-12 col-sm-6 col-lg-3">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar bg-primary text-white fw-bold"><i class="bi bi-diagram-3"></i></div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{r.title}}</h6>
                    <div class="text-muted small mt-1">
                      <span class="badge bg-secondary-subtle text-secondary border fw-bold">{{r.code}}</span>
                      <span class="badge bg-light text-dark border ms-1"><i class="bi bi-building me-1"></i>{{label('companies', r.companyId)}}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p v-if="r.manager" class="text-muted small mb-2 mt-1"><i class="bi bi-person-badge text-secondary me-1"></i><strong>Head:</strong> {{r.manager}}</p>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit Dept</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Dept Code</th>
              <th>Department Name</th>
              <th>Company</th>
              <th>Department Head</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-secondary-subtle text-secondary border px-2 py-1 fw-bold">{{r.code}}</span></td>
              <td class="fw-bold text-dark">{{r.title}}</td>
              <td><span class="badge bg-light text-dark border px-2 py-1"><i class="bi bi-building me-1"></i>{{label('companies', r.companyId)}}</span></td>
              <td class="small text-muted">{{r.manager || 'Unassigned'}}</td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Work Bases -->
  <template v-else-if="active==='workBases'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-12 col-sm-6 col-lg-3">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar fw-bold" :class="String(r.code||'').toUpperCase()==='SITE' ? 'bg-warning text-dark' : 'bg-primary text-white'">
                    <i class="bi bi-briefcase"></i>
                  </div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{ r.title || r.code }}</h6>
                    <span class="badge bg-secondary-subtle text-secondary border fw-bold mt-1">{{ r.code }}</span>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">{{r.availability||r.status||'Active'}}</span>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit Base</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Base Code</th>
              <th>Base Name</th>
              <th>Status</th>
              <th>Description</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-secondary-subtle text-secondary border fw-bold">{{ r.code }}</span></td>
              <td class="fw-bold">{{ r.title }}</td>
              <td><span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status)}">{{ r.availability || r.status || 'Active' }}</span></td>
              <td class="small text-muted">{{ r.notes || '—' }}</td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Work Locations -->
  <template v-else-if="active==='workLocations'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-12 col-sm-6 col-lg-3">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar bg-info-subtle text-info-emphasis border border-info fw-bold">
                    <i class="bi bi-geo-alt"></i>
                  </div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{ r.title || r.code }}</h6>
                    <div class="text-muted small mt-1">
                      <span class="badge bg-secondary-subtle text-secondary border fw-bold">{{ r.code }}</span>
                      <span v-if="r.state" class="badge bg-light text-dark border ms-1">{{ r.state }}</span>
                    </div>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">{{r.availability||r.status||'Active'}}</span>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit Location</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Location Code</th>
              <th>Location Name</th>
              <th>State / Territory</th>
              <th>Status</th>
              <th>Description</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-secondary-subtle text-secondary border fw-bold">{{ r.code }}</span></td>
              <td class="fw-bold">{{ r.title }}</td>
              <td class="small">{{ r.state || '—' }}</td>
              <td><span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status)}">{{ r.availability || r.status || 'Active' }}</span></td>
              <td class="small text-muted">{{ r.notes || '—' }}</td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Resource Catalogue -->
  <template v-else-if="active==='resources'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-12 col-sm-6 col-lg-3">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar bg-primary-subtle text-primary border border-primary fw-bold">
                    <i class="bi bi-box-seam"></i>
                  </div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{ r.title || r.name }}</h6>
                    <div class="text-muted small mt-1 d-flex gap-1 flex-wrap">
                      <span class="badge bg-secondary-subtle text-secondary border fw-bold">{{ r.code }}</span>
                      <span class="badge bg-primary-subtle text-primary border">{{ r.category }}</span>
                    </div>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive','Maintenance'].includes(r.availability||r.status)}">{{r.availability||r.status||'Available'}}</span>
              </div>
              <div class="small text-muted d-flex flex-column gap-1 mt-2 mb-2">
                <span v-if="r.location"><i class="bi bi-geo-alt me-1"></i><strong>Location:</strong> {{r.location}}</span>
                <span v-if="r.assetValue"><i class="bi bi-cash-stack me-1"></i><strong>Asset Value:</strong> RM {{money(r.assetValue)}}</span>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Resource Code</th>
              <th>Resource Name</th>
              <th>Category</th>
              <th>Location</th>
              <th>Asset Value</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-secondary-subtle text-secondary border fw-bold">{{ r.code }}</span></td>
              <td class="fw-bold text-dark">{{ r.title }}</td>
              <td><span class="badge bg-primary-subtle text-primary border">{{ r.category }}</span></td>
              <td class="small">{{ r.location || '—' }}</td>
              <td class="small fw-semibold">{{ r.assetValue ? 'RM ' + money(r.assetValue) : '—' }}</td>
              <td><span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive','Maintenance'].includes(r.availability||r.status)}">{{ r.availability || r.status || 'Available' }}</span></td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Specialized High-Density Layout for Claim Types -->
  <template v-else-if="active==='claimTypes'">
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-12 col-sm-6 col-lg-3">
          <div class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="d-flex align-items-center gap-2">
                  <div class="staff-avatar bg-warning-subtle text-warning-emphasis border border-warning fw-bold">
                    <i class="bi bi-tags"></i>
                  </div>
                  <div>
                    <h6 class="fw-bold mb-0 text-dark">{{ r.title }}</h6>
                    <span class="badge bg-secondary-subtle text-secondary border fw-bold mt-1">{{ r.code }}</span>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status),'is-rejected':['Inactive'].includes(r.availability||r.status)}">{{r.availability||r.status||'Active'}}</span>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="table-responsive main-card p-0 shadow-sm border rounded-3 mb-3">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Type Code</th>
              <th>Claim Type Name</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in pagedRecords" :key="r.id">
              <td><span class="badge bg-secondary-subtle text-secondary border fw-bold">{{ r.code }}</span></td>
              <td class="fw-bold text-dark">{{ r.title }}</td>
              <td><span class="hr-status" :class="{'is-complete':['Active','Available'].includes(r.availability||r.status)}">{{ r.availability || r.status || 'Active' }}</span></td>
              <td class="text-end">
                <div class="d-flex justify-content-end gap-1">
                  <button v-if="editable(r)" class="btn btn-outline-primary btn-sm fw-bold" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
                  <button class="btn btn-outline-secondary btn-sm" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </template>

  <!-- Standard High-Density Card for other HR modules -->
  <template v-else>
    <template v-if="orgViewMode==='tab'">
      <div class="row g-3 mb-3">
        <div v-for="r in pagedRecords" :key="r.id" class="col-md-6 col-lg-4">
          <article class="card h-100 shadow-sm border rounded-3 p-3 d-flex flex-column justify-content-between hr-record">
            <div>
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <h6 class="fw-bold mb-1 text-dark">{{ primary(r) }}</h6>
                  <div class="text-muted small">
                    <span v-if="r.code" class="badge bg-secondary-subtle text-secondary border fw-bold me-1">{{ r.code }}</span>
                    <span v-if="r.category" class="badge bg-primary-subtle text-primary border me-1">{{ r.category }}</span>
                    <span v-if="r.employee" class="badge bg-light text-dark border">{{ r.employee }}</span>
                  </div>
                </div>
                <span class="hr-status" :class="{'is-complete':['Approved','Completed','Paid','Reviewed','Issued','Active','Available'].includes(r.status||r.availability),'is-rejected':['Rejected','Cancelled','Inactive'].includes(r.status||r.availability)}">{{r.status||r.availability||'Active'}}</span>
              </div>
              <div class="small text-muted mt-2 mb-2">
                <div v-if="r.amount"><strong>Amount:</strong> RM {{money(r.amount)}}</div>
                <div v-if="r.date"><strong>Date:</strong> {{r.date}}</div>
                <div v-if="r.outstanding!=null"><strong>Outstanding:</strong> RM {{money(r.outstanding)}}</div>
                <div v-if="active==='claimPolicies'">
                  <div><strong>Per receipt:</strong> RM {{money(r.receiptLimit)}}</div>
                  <div><strong>Annual limit:</strong> RM {{money(r.annualLimit)}} ({{r.year}})</div>
                </div>
                <div v-if="active==='resourcePolicies'">
                  <div><strong>Max active:</strong> {{r.maxAssigned}}</div>
                  <div><strong>Value cap:</strong> {{r.maxValue ? 'RM ' + money(r.maxValue) : 'None'}}</div>
                </div>
              </div>
            </div>
            <div class="d-flex gap-2 pt-2 border-top mt-auto flex-wrap">
              <button v-if="editable(r)" class="btn btn-sm btn-outline-primary fw-bold flex-grow-1" @click="edit(r)"><i class="bi bi-pencil-square me-1"></i>Edit</button>
              <button class="btn btn-sm btn-outline-secondary" @click="detail=r"><i class="bi bi-eye me-1"></i>Details</button>
              <button v-for="a in actions(active,r)" :key="a.command" class="btn btn-sm btn-outline-primary" @click="ask(active,r,a)">{{a.label}}</button>
              <button v-if="active==='letters'&&r.status==='Issued'" class="btn btn-sm btn-outline-secondary" @click="printLetter(r)">Print</button>
            </div>
          </article>
        </div>
      </div>
    </template>
    <template v-else>
      <article v-for="r in pagedRecords" :key="r.id" class="main-card hr-record"><div class="hr-record-head"><div><span class="hr-status" :class="{'is-complete':['Approved','Completed','Paid','Reviewed','Issued','Active','Available'].includes(r.status||r.availability),'is-rejected':['Rejected','Cancelled','Inactive'].includes(r.status||r.availability)}">{{r.status||r.availability||'Active'}}</span><h5>{{primary(r)}}</h5><p>{{r.employee||r.category||r.code}} <span v-if="r.date">· {{r.date}}</span><span v-if="r.amount"> · RM {{money(r.amount)}}</span><span v-if="r.finalRating"> · Score {{r.finalRating}} / 5</span></p></div><div class="hr-record-actions"><button class="btn btn-outline-secondary btn-sm" @click="detail=r">Details</button><button v-if="editable(r)" class="btn btn-outline-primary btn-sm" @click="edit(r)">Edit</button><button v-for="a in actions(active,r)" :key="a.command" class="btn btn-outline-primary btn-sm" @click="ask(active,r,a)">{{a.label}}</button><button v-if="active==='letters'&&r.status==='Issued'" class="btn btn-outline-secondary btn-sm" @click="printLetter(r)">Print</button></div></div><div v-if="r.outstanding!=null" class="hr-record-sub">Outstanding: RM {{money(r.outstanding)}}</div><div v-if="r.start" class="hr-record-sub">{{r.start.replace('T',' ')}} — {{r.end.replace('T',' ')}} <span v-if="r.resourceId">· {{label('resources',r.resourceId)}}</span><span v-if="r.resourceId&&resourceCategory(r.resourceId)" class="badge bg-light text-dark border ms-2"><i class="bi bi-tag me-1"></i>{{resourceCategory(r.resourceId)}}</span></div><div v-if="r.gradeId" class="hr-record-sub">Grade: {{label('jobGrades',r.gradeId)}}</div><div v-if="active==='claimPolicies'" class="hr-record-sub">{{r.category}} · {{r.year}} · Per receipt RM {{money(r.receiptLimit)}} · Annual RM {{money(r.annualLimit)}} · {{r.gradeId?label('jobGrades',r.gradeId):'All grades'}}</div><div v-if="active==='resourcePolicies'" class="hr-record-sub">{{r.category}} · Maximum {{r.maxAssigned}} active · {{r.maxValue?'Value cap RM '+money(r.maxValue):'No asset-value cap'}}</div><div v-if="r.manager" class="hr-record-sub">Reviewer: {{r.manager}}</div></article>
    </template>
  </template>
 </template></div></div>
 <Teleport to="body">
 <div v-if="editor||decision||detail" class="hr-dialog-backdrop" :class="{'is-fullscreen-backdrop': isDialogFullscreen}" @keydown.tab="trapDialog" @keydown.esc="!saving&&(editor=null,decision=null,detail=null)">
  <div v-if="editor" id="hrRecordDialog" class="hr-dialog" :class="{'is-fullscreen': isDialogFullscreen}" role="dialog" aria-modal="true" aria-labelledby="hrDialogTitle" tabindex="-1"><form novalidate @submit.prevent="save" @input="clearFieldValidation" @change="clearFieldValidation"><div class="hr-dialog-head"><h4 id="hrDialogTitle">{{editor.id?'Edit':'New'}} · {{spec.label}}</h4><div class="d-flex align-items-center gap-2"><button type="button" class="btn btn-sm btn-outline-secondary py-1 px-2 d-inline-flex align-items-center gap-1" :title="isDialogFullscreen ? 'Exit Full Screen' : 'Full Screen'" @click="isDialogFullscreen = !isDialogFullscreen"><i :class="isDialogFullscreen ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen'"></i><span class="small d-none d-sm-inline">{{ isDialogFullscreen ? 'Exit Fullscreen' : 'Full Screen' }}</span></button><button type="button" class="btn-close" aria-label="Close" :disabled="saving" @click="editor=null"/></div></div><div class="hr-dialog-body"><div v-if="activeMultiDropdown" class="position-fixed top-0 start-0 w-100 h-100" style="z-index: 1055; background: transparent;" @click="activeMultiDropdown = null"></div><div v-if="error" role="alert" class="alert alert-danger">{{error}}</div><p v-if="active==='leaveOpeningBalances'" class="hr-note">Use an HR-verified balance, not a balance calculated from test leave. Selecting “Exclude existing test records” excludes the employee's existing leave records from this opening; it does not delete them.</p><div class="hr-form-grid"><div v-for="field in formFields" :key="field.key" :class="{'hr-form-wide': isFieldWide(field)}"><label class="form-label" :for="'hr-'+field.key">{{field.label}}{{field.required?' *':''}}</label><div v-if="isMultiSelect(field)" class="position-relative"><button type="button" :id="'hr-'+field.key" class="form-select text-start d-flex justify-content-between align-items-center w-100 bg-white" :class="{'is-invalid': validationErrors[field.key]}" @click="activeMultiDropdown = activeMultiDropdown === field.key ? null : field.key"><span class="text-truncate me-2" :class="{'text-muted': !form[field.key]}">{{ getMultiSelectDisplay(field) }}</span></button><div v-if="activeMultiDropdown === field.key" class="dropdown-menu show shadow-lg w-100 p-2 mt-1 border rounded-3" style="max-height: 250px; overflow-y: auto; z-index: 1060; position: absolute; left: 0; top: 100%;"><div v-for="opt in options(field)" :key="opt.value" class="form-check p-2 ps-4 mb-1 rounded hover-bg-light cursor-pointer user-select-none d-flex align-items-center" @click.stop="toggleMultiSelectOption(field, opt)"><input class="form-check-input me-2 mt-0 cursor-pointer" type="checkbox" :id="'chk-' + field.key + '-' + opt.value" :checked="isOptionSelected(field, opt)" @click.stop="toggleMultiSelectOption(field, opt)"/><label class="form-check-label w-100 cursor-pointer small fw-semibold text-dark mb-0" :for="'chk-' + field.key + '-' + opt.value">{{ opt.label }}</label></div></div></div><textarea v-else-if="field.type==='textarea'" :id="'hr-'+field.key" v-model="form[field.key]" class="form-control" :aria-invalid="Boolean(validationErrors[field.key])" rows="2" :required="field.required"/><select v-else-if="['select','staff','ref'].includes(field.type)" :id="'hr-'+field.key" v-model="form[field.key]" class="form-select" :aria-invalid="Boolean(validationErrors[field.key])" :required="field.required" :disabled="field.key==='employee'&&(!admin||scope==='personal')"><option value="">{{field.key==='inductionPolicy'?'No induction policy':field.key==='departmentId'?'Select department…':'Select…'}}</option><option v-for="o in options(field)" :key="o.value" :value="o.value">{{o.label}}</option></select><div v-else-if="field.type==='url'" class="hr-file-upload-container"><div class="input-group"><input :id="'hr-'+field.key" v-model="form[field.key]" class="form-control" type="text" :placeholder="'Paste document link or choose a file'" :required="field.required"/><label class="btn btn-outline-primary mb-0 d-flex align-items-center" :for="'hr-file-'+field.key" style="cursor:pointer;"><i class="bi bi-upload me-1"></i> Choose File<input :id="'hr-file-'+field.key" type="file" class="d-none" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" @change="handleFileUpload($event, field.key)"/></label></div><div v-if="form[field.key]" class="d-flex align-items-center gap-2 mt-2 p-2 bg-light border rounded"><span class="badge bg-primary text-truncate" style="max-width:280px;"><i class="bi bi-file-earmark-check me-1"></i>{{form[field.key].startsWith('data:')?'Attached Document ('+(form[field.key].slice(5,form[field.key].indexOf(';'))||'file')+')':form[field.key]}}</span><a v-if="form[field.key].startsWith('http')||form[field.key].startsWith('data:')" :href="form[field.key]" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-info py-0 px-2"><i class="bi bi-box-arrow-up-right me-1"></i> View</a><button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" @click="form[field.key]=''"><i class="bi bi-x"></i> Clear</button></div></div><input v-else :id="'hr-'+field.key" v-model="form[field.key]" class="form-control" :readonly="(active==='workSchedules'&&field.key==='netHours')||(active==='jobTitles'&&field.key==='code')" :aria-invalid="Boolean(validationErrors[field.key])" :type="active==='workSchedules'&&['start','end'].includes(field.key)?'time':field.type" :required="field.required" :min="field.min" :max="field.max" :step="field.type==='number'?'any':undefined" :placeholder="active==='jobTitles'&&field.key==='code'?'Auto-assigned by system':undefined"/><small v-if="validationErrors[field.key]" class="hr-field-error" role="alert">{{validationErrors[field.key]}}</small></div></div>
<div v-if="active==='workSchedules'" class="w-100 mt-3">
  <div class="border rounded-3 p-3 bg-light-subtle">
    <div class="d-flex justify-content-between align-items-center mb-2">
      <h6 class="fw-bold mb-0 text-dark"><i class="bi bi-calendar3-week text-primary me-2"></i>Daily Working Schedules &amp; Shift Times</h6>
      <span class="badge bg-light text-secondary border small">MON &gt; SUN Schedule Builder</span>
    </div>
    
    <div v-for="(block, bIdx) in scheduleBlocks" :key="bIdx" class="card mb-3 shadow-sm border">
      <div class="card-header bg-white py-2 d-flex justify-content-between align-items-center">
        <span class="fw-bold text-dark small"><i class="bi bi-clock-history me-1 text-primary"></i>Schedule Block {{ bIdx + 1 }}</span>
        <button v-if="scheduleBlocks.length > 1" type="button" class="btn btn-sm btn-outline-danger py-0 px-2" @click="removeScheduleBlock(bIdx)">
          <i class="bi bi-trash me-1"></i>Remove
        </button>
      </div>
      <div class="card-body p-3">
        <!-- Day Selector -->
        <label class="form-label small fw-bold text-muted mb-1">Day Selection (MON &gt; SUN) *</label>
        <div class="d-flex flex-wrap gap-2 mb-3">
          <button 
            v-for="d in ALL_WEEKDAYS" 
            :key="d" 
            type="button" 
            class="btn btn-sm"
            :class="block.days.includes(d) ? 'btn-primary fw-bold' : isDayInOtherBlock(d, bIdx) ? 'btn-light text-muted border-0 opacity-50' : 'btn-outline-secondary'"
            :disabled="isDayInOtherBlock(d, bIdx)"
            :title="isDayInOtherBlock(d, bIdx) ? 'Assigned in another schedule block' : 'Click to toggle ' + d"
            @click="toggleDayInBlock(d, bIdx)">
            {{ d }}
          </button>
        </div>
        
        <!-- Hours and times -->
        <div class="row g-2">
          <div class="col-6 col-md-3">
            <label class="form-label small fw-bold text-muted mb-1">Start time *</label>
            <input type="time" class="form-control form-control-sm" v-model="block.start" @change="updateBlockNet(block)" required />
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label small fw-bold text-muted mb-1">End time *</label>
            <input type="time" class="form-control form-control-sm" v-model="block.end" @change="updateBlockNet(block)" required />
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label small fw-bold text-muted mb-1">Break (hrs) *</label>
            <input type="number" step="0.5" min="0" max="10" class="form-control form-control-sm" v-model.number="block.breakHours" @input="updateBlockNet(block)" required />
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label small fw-bold text-muted mb-1">Net hours</label>
            <input type="number" class="form-control form-control-sm bg-light fw-bold text-primary" :value="block.netHours" readonly />
          </div>
        </div>
      </div>
    </div>

    <!-- Add Schedule Button -->
    <div class="d-flex justify-content-between align-items-center mb-3">
      <button type="button" class="btn btn-sm btn-outline-primary fw-bold" :disabled="unassignedDays.length === 0" @click="addScheduleBlock">
        <i class="bi bi-plus-circle me-1"></i> Add schedule
      </button>
      <span v-if="unassignedDays.length === 0" class="text-muted small"><i class="bi bi-check2-circle text-success me-1"></i>All 7 days assigned to schedules</span>
      <span v-else class="text-muted small">{{ unassignedDays.length }} day(s) available for additional schedule</span>
    </div>

    <!-- Rest Day / Off Day Designation -->
    <div class="p-2 border rounded-2 bg-white">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="small fw-bold text-muted"><i class="bi bi-slash-circle me-1"></i>Rest Day / Off Day (Days not selected above):</span>
        <span class="text-muted small" style="font-size: 0.75rem;">Click badge to toggle Rest &harr; Off</span>
      </div>
      <div v-if="unassignedDays.length === 0" class="text-muted small ps-1">None (Full 7-day operational schedule)</div>
      <div v-else class="d-flex flex-wrap gap-2 mt-1">
        <button 
          v-for="d in unassignedDays" 
          :key="d" 
          type="button" 
          class="btn btn-sm d-inline-flex align-items-center gap-1 py-1 px-2"
          :class="isDayRest(d) ? 'btn-danger' : 'btn-secondary'"
          @click="toggleDayRestOff(d)">
          <i :class="isDayRest(d) ? 'bi bi-moon-stars-fill' : 'bi bi-slash-circle'"></i>
          {{ d }}: <strong>{{ isDayRest(d) ? 'Rest Day' : 'Off Day' }}</strong>
        </button>
      </div>
    </div>
  </div>
</div></div><div class="hr-dialog-footer"><button class="btn btn-outline-secondary" type="button" :disabled="saving" @click="editor=null">Cancel</button><button type="submit" class="btn btn-primary" :disabled="saving" @click="save">{{saving?'Saving…':spec.self?'Submit request':'Save record'}}</button></div></form></div>
  <div v-else-if="decision" class="hr-dialog" :class="{'is-fullscreen': isDialogFullscreen}" role="dialog" aria-modal="true" aria-labelledby="hrDecisionTitle" tabindex="-1"><form @submit.prevent="act"><div class="hr-dialog-head"><h4 id="hrDecisionTitle">{{decision.label}}</h4><div class="d-flex align-items-center gap-2"><button type="button" class="btn btn-sm btn-outline-secondary py-1 px-2 d-inline-flex align-items-center gap-1" :title="isDialogFullscreen ? 'Exit Full Screen' : 'Full Screen'" @click="isDialogFullscreen = !isDialogFullscreen"><i :class="isDialogFullscreen ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen'"></i><span class="small d-none d-sm-inline">{{ isDialogFullscreen ? 'Exit Fullscreen' : 'Full Screen' }}</span></button><button type="button" class="btn-close" aria-label="Close" :disabled="saving" @click="decision=null"/></div></div><div class="hr-dialog-body"><div v-if="error" role="alert" class="alert alert-danger">{{error}}</div><p>{{primary(decision.record)}} · {{decision.record.employee}}</p><p v-if="decision.command==='finalise'" class="hr-note">Final score averages the self and manager ratings. Your rating is used when no manager rating exists.</p><template v-if="['selfReview','managerReview','finalise'].includes(decision.command)"><label for="hrRating" class="form-label">Rating (1–5)</label><input id="hrRating" v-model="decision.rating" type="number" min="1" max="5" step=".1" class="form-control mb-3" required/></template><template v-if="['paid','disburse','repay'].includes(decision.command)"><template v-if="decision.command==='repay'"><label for="hrRepayment" class="form-label">Repayment amount (RM)</label><input id="hrRepayment" v-model="decision.repayment" type="number" min=".01" :max="decision.record.outstanding" step=".01" class="form-control mb-3" required/></template><label for="hrPaymentReference" class="form-label">Payment reference</label><input id="hrPaymentReference" v-model="decision.reference" class="form-control mb-3" required/><p class="text-muted small">Records an external payment. No bank transfer is initiated.</p></template><label for="hrDecisionComments" class="form-label">{{decision.command==='reject'?'Rejection reason':'Comments'}}</label><textarea id="hrDecisionComments" v-model="decision.comments" class="form-control" rows="2" :required="decision.command==='reject'"/></div><div class="hr-dialog-footer"><button type="button" class="btn btn-outline-secondary" :disabled="saving" @click="decision=null">Cancel</button><button type="submit" class="btn btn-primary" :disabled="saving" @click="act">{{saving?'Recording…':'Confirm '+decision.label.toLowerCase()}}</button></div></form></div>
  <div v-else-if="detail" class="hr-dialog hr-detail" :class="{'is-fullscreen': isDialogFullscreen}" role="dialog" aria-modal="true" aria-labelledby="hrDetailTitle" tabindex="-1"><div class="hr-dialog-head"><h4 id="hrDetailTitle">{{primary(detail)}}</h4><div class="d-flex align-items-center gap-2"><button type="button" class="btn btn-sm btn-outline-secondary py-1 px-2 d-inline-flex align-items-center gap-1" :title="isDialogFullscreen ? 'Exit Full Screen' : 'Full Screen'" @click="isDialogFullscreen = !isDialogFullscreen"><i :class="isDialogFullscreen ? 'bi bi-fullscreen-exit' : 'bi bi-arrows-fullscreen'"></i><span class="small d-none d-sm-inline">{{ isDialogFullscreen ? 'Exit Fullscreen' : 'Full Screen' }}</span></button><button class="btn-close" aria-label="Close" @click="detail=null"/></div></div><div class="hr-dialog-body"><span class="hr-status" :class="{'is-complete':['Approved','Completed','Paid','Reviewed','Issued','Active','Available'].includes(detail.status||detail.availability),'is-rejected':['Rejected','Cancelled','Inactive'].includes(detail.status||detail.availability)}">{{detail.status||detail.availability||'Active'}}</span><dl><template v-for="field in spec?.fields||[]" :key="field.key"><dt>{{field.label}}</dt><dd><template v-if="field.type==='url'&&detail[field.key]"><a :href="detail[field.key]" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"><i class="bi bi-box-arrow-up-right"></i> View / Download Document</a><div v-if="detail[field.key].startsWith('data:image')" class="mt-2"><img :src="detail[field.key]" alt="Preview" class="img-thumbnail" style="max-height:180px;"/></div></template><span v-if="field.key==='departmentId'&&active==='jobTitles'">{{formatMultiDepartmentLabel(detail[field.key])}}</span><span v-else>{{value(field,detail)}}</span></dd></template><template v-for="key in ['inductionPolicyVersion','inductionCompanyId','inductionGradeCode','selfRating','selfComments','managerRating','managerComments','finalRating','finalComments','decisionComments','paymentReference','outstanding','repayments','updatedBy','updatedAt']" :key="key"><dt v-if="detail[key]!=null">{{key.replace(/([A-Z])/g,' $1')}}</dt><dd v-if="detail[key]!=null">{{detail[key]}}</dd></template></dl></div><div class="hr-dialog-footer"><button v-if="editable(detail)" class="btn btn-primary" type="button" @click="edit(detail); detail=null"><i class="bi bi-pencil-square me-1"></i> Edit record</button><button class="btn btn-outline-secondary" type="button" @click="detail=null">Close</button></div></div>
 </div>
 </Teleport>
 <StatutorySettingsModal v-if="showStatutoryModal"
   v-model="showStatutoryModal"
   :can-edit="admin"
   @saved="load"
 />
 <YearEndModal v-if="showYearEndModal"
   v-model="showYearEndModal"
   :companies="records.companies || []"
   :can-edit="admin"
   @committed="load"
   @saved="load"
 />
 <StaffDossierModal v-if="showDossierModal"
   v-model="showDossierModal"
   :initial-employee="dossierTargetEmployee"
   :employees="employees"
   :current-user="user"
 />
 <LetterGeneratorModal v-if="showLetterModal"
   v-model="showLetterModal"
   :employees="employees"
   :current-user="user"
   :companies="records.companies || []"
   @saved="load"
   @issued="load"
 />
</section>
</template>

<style scoped>
.enterprise-ops-card {
  width: 100%;
  max-width: 100%;
  margin-left: 0;
  margin-right: 0;
}
.enterprise-ops-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.75rem;
  width: 100%;
}
.enterprise-op-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  width: 100%;
  height: 100%;
  min-height: 42px;
  padding: 0.5rem 0.75rem;
  white-space: normal;
  line-height: 1.25;
  box-sizing: border-box;
  font-size: 0.83rem;
  border-radius: 8px;
}
@media (max-width: 1200px) {
  .enterprise-ops-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 576px) {
  .enterprise-ops-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
