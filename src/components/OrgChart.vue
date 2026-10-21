<script setup>
import { computed, ref } from 'vue';
// Interactive organisation chart built ONLY from real Staff fields: company -> department -> reporting manager -> employee.
// Missing manager/department are shown as explicit "Unassigned" branches; nothing is guessed.
const props = defineProps({
  employees: { type: Array, default: () => [] },
  records: { type: Object, default: () => ({}) }
});
const q = ref('');
const zoom = ref(1);
const collapsed = ref(new Set());
const inactive = new Set(['Resigned', 'Inactive', 'Terminated']);
const staff = computed(() => props.employees.filter((e) => !inactive.has(e.status)));
const byName = computed(() => new Map(staff.value.map((e) => [e.name, e])));
const compName = (id) => (props.records.companies || []).find((c) => String(c.id) === String(id) || String(c.code) === String(id) || String(c.title).toLowerCase() === String(id).toLowerCase())?.title || (id ? String(id) : 'Unassigned company');
const deptName = (id) => (props.records.departments || []).find((d) => String(d.id) === String(id) || String(d.code) === String(id) || String(d.title).toLowerCase() === String(id).toLowerCase())?.title || (id ? String(id) : 'Unassigned department');

function buildReports(list) {
  // manager -> direct reports within the same department group; cycle-safe
  const inGroup = new Set(list.map((e) => e.name));
  const kids = new Map();
  const roots = [];
  for (const e of list) {
    const m = e.manager && inGroup.has(e.manager) && e.manager !== e.name ? e.manager : null;
    if (m) { if (!kids.has(m)) kids.set(m, []); kids.get(m).push(e); } else roots.push(e);
  }
  const seen = new Set();
  const mk = (e) => {
    if (seen.has(e.name)) return null; seen.add(e.name);
    return { employee: e, reports: (kids.get(e.name) || []).map(mk).filter(Boolean), isExternalManager: !!(e.manager && !inGroup.has(e.manager)) };
  };
  const tree = roots.map(mk).filter(Boolean);
  // any member trapped in a reporting cycle is surfaced instead of silently dropped
  for (const e of list) if (!seen.has(e.name)) { const n = mk(e); if (n) tree.push(n); }
  return tree;
}

const tree = computed(() => {
  const term = q.value.trim().toLowerCase();
  const list = term ? staff.value.filter((e) => `${e.name} ${e.jobTitle || ''} ${e.employeeNo || ''}`.toLowerCase().includes(term)) : staff.value;
  const comps = new Map();
  for (const e of list) {
    const c = String(e.companyId || e.company || '');
    const d = String(e.departmentId || e.department || '');
    if (!comps.has(c)) comps.set(c, new Map());
    const dm = comps.get(c);
    if (!dm.has(d)) dm.set(d, []);
    dm.get(d).push(e);
  }
  return [...comps.entries()].map(([c, dm]) => ({
    id: 'c:' + c, label: compName(c), count: [...dm.values()].reduce((s, v) => s + v.length, 0),
    depts: [...dm.entries()].map(([d, people]) => ({ id: `d:${c}:${d}`, label: deptName(d), count: people.length, unassigned: !d, reports: buildReports(people) }))
  }));
});
const outOfScopeManagers = computed(() => staff.value.filter((e) => e.manager && !byName.value.has(e.manager)).length);
const toggle = (id) => { const s = new Set(collapsed.value); s.has(id) ? s.delete(id) : s.add(id); collapsed.value = s; };
const setAll = (open) => { collapsed.value = open ? new Set() : new Set(tree.value.flatMap((c) => c.depts.map((d) => d.id))); };
const openEmployee = (e) => window.dispatchEvent(new CustomEvent('hr-open-dossier', { detail: { name: e.name } }));
const zoomIn = () => (zoom.value = Math.min(1.6, +(zoom.value + 0.1).toFixed(2)));
const zoomOut = () => (zoom.value = Math.max(0.6, +(zoom.value - 0.1).toFixed(2)));
function exportCsv() {
  const cell = (x) => '"' + String(x ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  const rows = [['Company', 'Department', 'Employee', 'Job title', 'Reporting manager', 'Manager recorded?']];
  for (const c of tree.value) for (const d of c.depts) {
    const walk = (n) => { rows.push([c.label, d.label, n.employee.name, n.employee.jobTitle || '', n.employee.manager || '', n.employee.manager ? 'Yes' : 'No']); n.reports.forEach(walk); };
    d.reports.forEach(walk);
  }
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'PplosHR-OrgChart.csv'; a.click(); URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="oc-card" aria-labelledby="ocTitle">
    <div class="oc-head">
      <div><h6 id="ocTitle">Organisation chart</h6><p class="oc-note">Company, department and reporting manager exactly as recorded. Unassigned branches are shown, not guessed.</p></div>
      <div class="oc-tools">
        <label class="visually-hidden" for="ocSearch">Search organisation chart</label>
        <input id="ocSearch" v-model="q" type="search" placeholder="Search name, title, ID" class="form-control form-control-sm" />
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="setAll(true)">Expand all</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="setAll(false)">Collapse all</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" aria-label="Zoom out" @click="zoomOut">-</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" aria-label="Zoom in" @click="zoomIn">+</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="exportCsv">CSV</button>
      </div>
    </div>
    <p v-if="outOfScopeManagers" class="oc-warn">{{ outOfScopeManagers }} employee(s) report to a manager outside your visible scope; they appear as top-level in their department.</p>
    <p v-if="!tree.length" class="oc-empty">No authorised staff match.</p>
    <div class="oc-body" :style="{ fontSize: zoom + 'em' }">
      <div v-for="c in tree" :key="c.id" class="oc-company">
        <h6 class="oc-company-name"><i class="bi bi-building"></i> {{ c.label }} <small>{{ c.count }}</small></h6>
        <div v-for="d in c.depts" :key="d.id" class="oc-dept">
          <button type="button" class="oc-dept-btn" :aria-expanded="!collapsed.has(d.id)" @click="toggle(d.id)">
            <i :class="['bi', collapsed.has(d.id) ? 'bi-chevron-right' : 'bi-chevron-down']"></i> {{ d.label }} <small>{{ d.count }}</small>
            <span v-if="d.unassigned" class="oc-tag">Unassigned</span>
          </button>
          <ul v-show="!collapsed.has(d.id)" class="oc-tree">
            <template v-for="n in d.reports" :key="n.employee.name">
              <li>
                <button type="button" class="oc-node" @click="openEmployee(n.employee)"><b>{{ n.employee.name }}</b><small>{{ n.employee.jobTitle || 'No job title' }}</small><em v-if="!n.employee.manager">No manager recorded</em><span v-else-if="n.isExternalManager" class="oc-ext-mgr text-muted" style="font-size:0.68em;">Reports to: {{ n.employee.manager }}</span></button>
                <ul v-if="n.reports.length" class="oc-tree">
                  <li v-for="m in n.reports" :key="m.employee.name">
                    <button type="button" class="oc-node" @click="openEmployee(m.employee)"><b>{{ m.employee.name }}</b><small>{{ m.employee.jobTitle || 'No job title' }}</small></button>
                    <ul v-if="m.reports.length" class="oc-tree">
                      <li v-for="k in m.reports" :key="k.employee.name"><button type="button" class="oc-node" @click="openEmployee(k.employee)"><b>{{ k.employee.name }}</b><small>{{ k.employee.jobTitle || 'No job title' }}</small></button><span v-if="k.reports.length" class="oc-more">+{{ k.reports.length }} more levels - use CSV export</span></li>
                    </ul>
                  </li>
                </ul>
              </li>
            </template>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.oc-card{background:var(--surface,#fff);border:1px solid var(--line,#e5e5ea);border-radius:18px;padding:20px;margin-bottom:18px;overflow:hidden}
.oc-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.oc-head h6{margin:0 0 4px}.oc-note{font-size:.74rem;color:var(--muted,#6e6e73);margin:0 0 10px}
.oc-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.oc-tools input{width:200px;min-height:36px}.oc-tools .btn{min-height:36px;min-width:36px}
.oc-warn{font-size:.74rem;background:#fff8e6;border-radius:10px;padding:8px 12px}.oc-empty{font-size:.82rem;color:var(--muted,#6e6e73)}
.oc-body{max-height:520px;overflow:auto;padding-right:4px}.oc-company-name{margin:14px 0 8px;font-size:.9em}.oc-company-name small,.oc-dept-btn small{color:var(--muted,#6e6e73);margin-left:6px}
.oc-dept{margin:0 0 8px 8px}.oc-dept-btn{display:flex;gap:6px;align-items:center;border:0;background:#f5f5f7;border-radius:10px;padding:8px 12px;font-size:.82em;font-weight:600;width:100%;text-align:left;min-height:44px}
.oc-tag{margin-left:auto;background:#fff1f2;color:#b42332;border-radius:999px;padding:2px 8px;font-size:.7em}
.oc-tree{list-style:none;margin:6px 0 0 14px;padding-left:14px;border-left:2px solid #e5e5ea}.oc-tree li{margin:6px 0}
.oc-node{display:grid;text-align:left;border:1px solid #e5e5ea;background:#fff;border-radius:10px;padding:7px 11px;min-height:44px;max-width:100%}.oc-node:hover{background:#f5f5f7}
.oc-node b{font-size:.8em;overflow-wrap:anywhere}.oc-node small{font-size:.7em;color:var(--muted,#6e6e73)}.oc-node em{font-size:.66em;color:#b7791f;font-style:normal}.oc-more{font-size:.68em;color:var(--muted,#6e6e73);margin-left:8px}
</style>
