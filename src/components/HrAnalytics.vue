<script setup>
import { computed, ref } from 'vue';

// Presentation only: caller supplies records already authorized by hrBootstrap.
// This component never performs privileged requests or changes source records.
const props = defineProps({
  employees: { type: Array, default: () => [] },
  records: { type: Object, default: () => ({}) },
  teamLeave: { type: Array, default: () => [] },
  role: { type: String, default: 'User' },
  mode: { type: String, default: 'overview' }
});
const company = ref('all');
const department = ref('all');
const period = ref('all');
const focus = ref(null);
const isManager = computed(() => ['Admin', 'HR'].includes(props.role));
const companyOptions = computed(() => props.records.companies || []);
const departmentOptions = computed(() => (props.records.departments || []).filter(d => company.value === 'all' || String(d.companyId) === company.value));
const companyName = id => companyOptions.value.find(x => String(x.id) === String(id))?.title || String(id || 'Not assigned');
const departmentName = id => (props.records.departments || []).find(x => String(x.id) === String(id))?.title || String(id || 'Not assigned');
const staff = computed(() => props.employees.filter(e =>
  (company.value === 'all' || String(e.companyId || e.company || '') === company.value) &&
  (department.value === 'all' || String(e.departmentId || e.department || '') === department.value)));
const staffNames = computed(() => new Set(staff.value.map(e => e.name)));
const allNames = computed(() => new Set(props.employees.map(e => e.name)));
const employeeLookup = computed(() => new Map(props.employees.map(e => [e.name, e])));
const scoped = rows => rows.filter(r => {
  // Only records tied to a staff member or an explicitly matching company/department
  // participate when company/department filters are active. Never count unknown scope.
  const filtered = company.value !== 'all' || department.value !== 'all';
  if (r.employee) return staffNames.value.has(r.employee);
  if (!filtered) return true;
  const companyMatch = company.value === 'all' || String(r.companyId || '') === company.value;
  const deptMatch = department.value === 'all' || String(r.departmentId || '') === department.value;
  return !!(r.companyId || r.departmentId) && companyMatch && deptMatch;
});
const inPeriod = r => {
  if (period.value === 'all') return true;
  const date = r.date || r.start || r.createdAt || r.updatedAt;
  return typeof date === 'string' && date.slice(0, 7) === period.value;
};
const rows = key => scoped(props.records[key] || []).filter(inPeriod);
const leave = computed(() => props.teamLeave.filter(l => {
  if (company.value !== 'all' || department.value !== 'all') {
    const e = employeeLookup.value.get(l.employee);
    if (!e || !staffNames.value.has(l.employee)) return false;
  }
  return period.value === 'all' || (String(l.start || '').slice(0, 7) === period.value);
}));
const months = computed(() => {
  const dates = [...props.teamLeave.map(r => r.start), ...Object.values(props.records).flatMap(list => Array.isArray(list) ? list.map(r => r.date || r.start || r.createdAt) : [])];
  return [...new Set(dates.filter(v => typeof v === 'string' && /^\d{4}-\d{2}/.test(v)).map(v => v.slice(0, 7)))].sort().reverse().slice(0, 18);
});
const group = (items, key, formatter = x => x) => Object.entries(items.reduce((a, item) => {
  const name = String(formatter(item[key]) || 'Not specified'); a[name] = (a[name] || 0) + 1; return a;
}, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
const workforce = computed(() => group(staff.value, 'departmentId', v => departmentName(v)).slice(0, 12));
const employment = computed(() => group(staff.value, 'status'));
const leaveMix = computed(() => group(leave.value, 'type', v => ({AL:'Annual',MC:'Medical',EL:'Emergency',HL:'Hospitalisation',CL:'Compassionate',NPL:'Unpaid',ML:'Maternity',PL:'Paternity'})[v] || v));
const claims = computed(() => group(rows('claims'), 'category'));
const approval = computed(() => {
  const permitted = ['claims', 'loans', 'bookings', 'appraisals', 'tax'];
  return group(permitted.flatMap(k => rows(k)), 'status');
});
const total = items => items.reduce((sum, x) => sum + x.value, 0);
const max = items => Math.max(1, ...items.map(x => x.value));
const palette = ['#385f84', '#77a0ac', '#7b927d', '#ba9b7d', '#9a8aa5', '#748291', '#d4a579'];
const slices = items => {
  const all = total(items); let offset = 0;
  return items.map((item, index) => {
    const share = all ? item.value / all : 0;
    const result = { ...item, share, color: palette[index % palette.length], offset };
    offset += share * 100; return result;
  });
};
const donutStyle = items => ({background: total(items) ? `conic-gradient(${slices(items).map(s => `${s.color} ${s.offset}% ${s.offset + s.share * 100}%`).join(',')})` : '#e9edf0'});
const activeEmployees = computed(() => staff.value.filter(e => !['Resigned','Inactive','Terminated'].includes(e.status)).length);
const pendingRequests = computed(() => ['claims','loans','bookings','appraisals','tax'].reduce((count, k) => count + rows(k).filter(x => ['Submitted','Pending','Pending HOD','Pending HR'].some(s => String(x.status).startsWith(s))).length, 0));
const totalLeaveDays = computed(() => {
  return leave.value.reduce((sum, l) => {
    const d1 = new Date(l.start), d2 = new Date(l.end || l.start);
    const diff = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);
    return sum + (l.halfDay ? 0.5 : diff);
  }, 0);
});

const totalClaimsAmount = computed(() => {
  return rows('claims').reduce((sum, c) => sum + Number(c.amount || 0), 0);
});

const focusRecords = computed(() => {
  if (!focus.value) return [];
  const { metric, label } = focus.value;
  if (metric === 'Department') {
    return staff.value
      .filter(e => departmentName(e.departmentId) === label || String(e.department || '') === label)
      .map(e => ({ id: e.employeeNo || e.id || e.name, primary: e.name, secondary: e.jobTitle || 'Employee', detail: companyName(e.companyId), status: e.status }));
  }
  if (metric === 'Employment status') {
    return staff.value
      .filter(e => e.status === label)
      .map(e => ({ id: e.employeeNo || e.id || e.name, primary: e.name, secondary: departmentName(e.departmentId), detail: e.jobTitle || 'Employee', status: e.status }));
  }
  if (metric === 'Leave') {
    return leave.value
      .filter(l => {
        const typeLabel = ({AL:'Annual',MC:'Medical',EL:'Emergency',HL:'Hospitalisation',CL:'Compassionate',NPL:'Unpaid',ML:'Maternity',PL:'Paternity'})[l.type] || l.type;
        return typeLabel === label || l.type === label;
      })
      .map(l => ({ id: l.id || `${l.employee}-${l.start}`, primary: l.employee, secondary: l.type, detail: `${l.start} to ${l.end || l.start}`, status: l.status || 'Approved' }));
  }
  if (metric === 'Claims') {
    return rows('claims')
      .filter(c => (c.category || 'General') === label)
      .map(c => ({ id: c.id || c.date, primary: c.employee || 'Claim', secondary: `RM ${Number(c.amount || 0).toFixed(2)}`, detail: c.date, status: c.status }));
  }
  if (metric === 'Request status') {
    const permitted = ['claims', 'loans', 'bookings', 'appraisals', 'tax'];
    return permitted.flatMap(k => rows(k))
      .filter(r => r.status === label)
      .map(r => ({ id: r.id, primary: r.employee || r.title || 'Record', secondary: r.module || 'Request', detail: r.date || r.start || 'Recent', status: r.status }));
  }
  return [];
});

const reportDate = () => new Date().toLocaleString('en-MY', {dateStyle:'medium',timeStyle:'short'});
const exportRows = computed(() => [
  ...workforce.value.map(x => ({report:'Workforce by department',category:x.label,count:x.value})),
  ...employment.value.map(x => ({report:'Employment status',category:x.label,count:x.value})),
  ...leaveMix.value.map(x => ({report:'Approved leave by type',category:x.label,count:x.value})),
  ...(isManager.value ? claims.value.map(x => ({report:'Claim count by type',category:x.label,count:x.value})) : []),
  ...(isManager.value ? approval.value.map(x => ({report:'Request status',category:x.label,count:x.value})) : [])
]);
function csvExport() {
  const clean = s => `"${String(s ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"','""')}"`;
  const lines = [['Report','Category','Count'], ...exportRows.value.map(r => [r.report,r.category,r.count])];
  const csv = '\uFEFF' + lines.map(row => row.map(clean).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'PplosHR-Analytics.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function printReport() { window.print(); }
function selectSlice(metric, label) { focus.value = focus.value?.metric === metric && focus.value?.label === label ? null : {metric,label}; }
function resetScope() { company.value='all';department.value='all';period.value='all';focus.value=null; }
</script>

<template>
  <section class="people-analytics" aria-label="HR analytics">
    <div class="pa-toolbar">
      <div><h5 class="mb-1">People analytics</h5><p class="small text-muted mb-0">Authorized records only · {{reportDate()}}</p></div>
      <div class="pa-filters">
        <label v-if="isManager">Company <select v-model="company" @change="department='all';focus=null"><option value="all">All permitted companies</option><option v-for="c in companyOptions" :key="c.id" :value="String(c.id)">{{c.title}}</option></select></label>
        <label v-if="isManager">Department <select v-model="department" @change="focus=null"><option value="all">All departments</option><option v-for="d in departmentOptions" :key="d.id" :value="String(d.id)">{{d.title}}</option></select></label>
        <label>Period <select v-model="period" @change="focus=null"><option value="all">All available dates</option><option v-for="m in months" :key="m" :value="m">{{m}}</option></select></label>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="resetScope">Reset</button>
      </div>
    </div>
    <div class="pa-kpis">
      <div><span>Visible employees</span><strong>{{staff.length}}</strong></div>
      <div><span>Active employees</span><strong>{{activeEmployees}}</strong></div>
      <div><span>Approved leave</span><strong>{{leave.length}} <small style="font-size:0.75rem; font-weight:normal; color:#64748b;">({{totalLeaveDays}} days)</small></strong></div>
      <div v-if="isManager"><span>Claims total</span><strong>RM {{totalClaimsAmount.toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2})}} <small style="font-size:0.75rem; font-weight:normal; color:#64748b;">({{rows('claims').length}} claims)</small></strong></div>
    </div>
    <div class="pa-charts">
      <section class="pa-card"><h6>Workforce by department</h6><p class="pa-note">Headcount · tap bar to open record list</p><p v-if="!workforce.length" class="pa-empty">No authorized staff data.</p>
        <button v-for="w in workforce" :key="w.label" type="button" class="pa-bar-row" @click="selectSlice('Department',w.label)" :aria-pressed="focus?.metric==='Department'&&focus?.label===w.label"><span :title="w.label">{{w.label}}</span><span class="pa-track"><span :style="{width:(w.value/max(workforce)*100)+'%'}"/></span><b>{{w.value}}</b></button>
      </section>
      <section class="pa-card"><h6>Employment status</h6><p class="pa-note">Staff distribution · tap slice to filter</p><div class="pa-donut-layout"><div class="pa-donut" :style="donutStyle(employment)"><span><strong>{{total(employment)}}</strong><small>people</small></span></div><div class="pa-legend"><button v-for="s in slices(employment)" :key="s.label" type="button" @click="selectSlice('Employment status',s.label)"><i :style="{background:s.color}"/>{{s.label}} <b>{{s.value}}</b></button><span v-if="!employment.length" class="pa-empty">No data</span></div></div></section>
      <section class="pa-card"><h6>Approved team leave</h6><p class="pa-note">{{leave.length}} applications · {{totalLeaveDays}} total days</p><div class="pa-donut-layout"><div class="pa-donut" :style="donutStyle(leaveMix)"><span><strong>{{total(leaveMix)}}</strong><small>records</small></span></div><div class="pa-legend"><button v-for="s in slices(leaveMix)" :key="s.label" type="button" @click="selectSlice('Leave',s.label)"><i :style="{background:s.color}"/>{{s.label}} <b>{{s.value}}</b></button><span v-if="!leaveMix.length" class="pa-empty">No approved leave data</span></div></div></section>
      <section v-if="isManager" class="pa-card"><h6>Claims by category</h6><p class="pa-note">{{rows('claims').length}} records · RM {{totalClaimsAmount.toFixed(2)}} total</p><p v-if="!claims.length" class="pa-empty">No claim data for this selection.</p><button v-for="s in claims" :key="s.label" type="button" class="pa-bar-row" @click="selectSlice('Claims',s.label)"><span>{{s.label}}</span><span class="pa-track"><span :style="{width:s.value/max(claims)*100+'%'}"/></span><b>{{s.value}}</b></button></section>
      <section v-if="isManager" class="pa-card"><h6>Request status</h6><p class="pa-note">Claims, loans, bookings, appraisals and tax review</p><div class="pa-donut-layout"><div class="pa-donut" :style="donutStyle(approval)"><span><strong>{{total(approval)}}</strong><small>requests</small></span></div><div class="pa-legend"><button v-for="s in slices(approval)" :key="s.label" type="button" @click="selectSlice('Request status',s.label)"><i :style="{background:s.color}"/>{{s.label}} <b>{{s.value}}</b></button><span v-if="!approval.length" class="pa-empty">No requests</span></div></div></section>
    </div>

    <!-- Interactive In-Context Drill-Down Record Drawer -->
    <div v-if="focus" class="pa-drilldown-panel mt-3 p-3 bg-white border rounded-3 shadow-sm" role="region" aria-label="Drill-down records">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
        <div>
          <h6 class="mb-0 fw-bold text-primary"><i class="bi bi-list-nested me-1"></i>Drill-down Records: {{ focus.metric }} — {{ focus.label }}</h6>
          <small class="text-muted">{{ focusRecords.length }} record{{ focusRecords.length === 1 ? '' : 's' }} match this filter</small>
        </div>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="focus = null"><i class="bi bi-x-lg me-1"></i>Close Drill-down</button>
      </div>
      <div v-if="!focusRecords.length" class="text-muted small py-2">No matching records for this slice.</div>
      <div v-else class="table-responsive" style="max-height: 280px; overflow-y: auto;">
        <table class="table table-sm table-hover align-middle mb-0" style="font-size: 0.8rem;">
          <thead class="table-light">
            <tr>
              <th>ID / Ref</th>
              <th>Primary Target</th>
              <th>Category / Info</th>
              <th>Date / Scope</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(rec, idx) in focusRecords" :key="idx">
              <td><code>{{ rec.id }}</code></td>
              <td><strong>{{ rec.primary }}</strong></td>
              <td>{{ rec.secondary }}</td>
              <td><small class="text-muted">{{ rec.detail }}</small></td>
              <td><span class="badge bg-light text-dark border">{{ rec.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="mode==='reports'" class="pa-report-actions"><button type="button" class="btn btn-outline-secondary" @click="csvExport">Export analytics CSV</button><button type="button" class="btn btn-primary" @click="printReport">Print / Save as PDF</button><small>PDF uses the browser's print-to-PDF option. Charts report only available authorized records.</small></div>
  </section>
</template>

<style scoped>
.people-analytics{margin:1rem 0;color:#263443}.pa-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1rem}.pa-filters{display:flex;flex-wrap:wrap;align-items:end;gap:.65rem}.pa-filters label{font-size:.72rem;color:#64748b;font-weight:600;display:grid;gap:.2rem}.pa-filters select{background:white;border:1px solid #d9e0e7;border-radius:9px;padding:.5rem;font-size:.78rem;max-width:210px;color:#334155}.pa-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.8rem;margin:1rem 0}.pa-kpis>div,.pa-card{background:white;border:1px solid #e3e8ed;border-radius:14px;padding:1.05rem;box-shadow:0 2px 9px #182b4108}.pa-kpis span{display:block;color:#64748b;font-size:.76rem}.pa-kpis strong{font-size:1.55rem;font-weight:750;font-variant-numeric:tabular-nums}.pa-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.pa-card{min-width:0}.pa-card h6{font-weight:700;margin:0}.pa-note{color:#7d8997;font-size:.73rem;margin:.25rem 0 1rem}.pa-empty{font-size:.83rem;color:#8793a1;padding:1rem 0}.pa-bar-row{border:0;background:none;width:100%;display:grid;grid-template-columns:minmax(70px,130px) minmax(20px,1fr) 30px;gap:.55rem;align-items:center;text-align:left;font-size:.76rem;padding:.4rem .1rem;color:#475569}.pa-bar-row:hover,.pa-bar-row[aria-pressed=true]{background:#f0f5f8;border-radius:6px}.pa-bar-row>span:first-child{white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.pa-bar-row b{text-align:right}.pa-track{background:#eef1f5;display:block;border-radius:12px;height:10px;overflow:hidden}.pa-track>span{height:100%;display:block;background:#4c789b;border-radius:inherit}.pa-donut-layout{display:flex;align-items:center;gap:1.2rem;min-height:160px}.pa-donut{width:148px;height:148px;border-radius:50%;display:grid;place-items:center;flex-shrink:0}.pa-donut>span{width:103px;height:103px;border-radius:50%;background:white;display:flex;flex-direction:column;justify-content:center;align-items:center}.pa-donut strong{font-size:1.5rem}.pa-donut small{color:#8290a0}.pa-legend{display:flex;flex-direction:column;gap:.45rem;min-width:0;flex:1}.pa-legend button{display:flex;align-items:center;gap:.5rem;text-align:left;border:0;background:none;padding:0;font-size:.76rem;color:#465568}.pa-legend button:hover{text-decoration:underline}.pa-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;flex-shrink:0}.pa-legend b{margin-left:auto}.pa-selection{border:1px solid #d7e2eb;border-radius:10px;background:#f7fafc;padding:.65rem 1rem;margin-top:.9rem;font-size:.8rem}.pa-report-actions{display:flex;align-items:center;flex-wrap:wrap;gap:.7rem;margin:1rem 0}.pa-report-actions small{color:#64748b}@media(max-width:980px){.pa-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pa-charts{grid-template-columns:1fr}}@media(max-width:480px){.pa-filters{width:100%}.pa-filters label{flex:1}.pa-filters select{max-width:100%;width:100%}.pa-donut{width:120px;height:120px}.pa-donut>span{width:85px;height:85px}.pa-donut-layout{gap:.6rem}}@media print{.pa-toolbar .pa-filters,.pa-report-actions,.pa-selection{display:none!important}.pa-charts{grid-template-columns:repeat(2,1fr)}.pa-card,.pa-kpis>div{box-shadow:none;break-inside:avoid}.people-analytics{color:black}}
</style>
