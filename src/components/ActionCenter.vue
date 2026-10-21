<script setup>
import { computed, ref } from 'vue';
// Action Center: read-only prioritised worklist derived ONLY from records the signed-in user is already authorised
// to receive via hrBootstrap. It does not add data access. Items link to the existing module screens (which re-check permission).
const props = defineProps({
  employees: { type: Array, default: () => [] },
  records: { type: Object, default: () => ({}) },
  role: { type: String, default: 'User' },
  user: { type: Object, default: () => ({}) }
});
const SLA_DAYS = 3;                 // pending-approval SLA used for the "overdue" flag (displayed in the UI)
const EXPIRY_WARN_DAYS = 60;
const isMgr = computed(() => ['HOD', 'Supervisor', 'HR', 'Admin'].includes(props.role));
const isHr = computed(() => ['HR', 'Admin'].includes(props.role));
const scopeFor = computed(() => (isHr.value ? 'all' : 'team'));
const MYT = 'Asia/Kuala_Lumpur';
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: MYT }).format(new Date());
const dayDiff = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
const isPending = (s) => /^(submitted|pending)/i.test(String(s || ''));
const dateOf = (r) => String(r.submittedAt || r.createdAt || r.date || '').slice(0, 10);
const LABELS = { claims: 'Claim', loans: 'Loan', bookings: 'Booking', appraisals: 'Appraisal', tax: 'Tax declaration' };

const items = computed(() => {
  const out = [];
  const today = todayStr();
  if (isMgr.value) {
    for (const [module, label] of Object.entries(LABELS)) {
      for (const r of props.records[module] || []) {
        if (!isPending(r.status)) continue;
        const d = dateOf(r);
        const age = d ? dayDiff(today, d) : null;
        out.push({
          key: `${module}:${r.id}`, module, scope: scopeFor.value, priority: age !== null && age > SLA_DAYS ? 1 : 2,
          kind: age !== null && age > SLA_DAYS ? 'Overdue approval' : 'Pending approval',
          title: `${label}: ${r.employee || r.title || r.id}`,
          detail: age === null ? 'Submission date not recorded' : `${age} day${age === 1 ? '' : 's'} waiting (SLA ${SLA_DAYS}d, MYT)`,
          sort: age === null ? -1 : age
        });
      }
    }
  }
  for (const r of props.records.training || []) {
    if (!r.expiry) continue;
    const left = dayDiff(r.expiry, today);
    if (left > EXPIRY_WARN_DAYS) continue;
    out.push({
      key: `train:${r.id}`, module: 'training', scope: isHr.value ? 'all' : isMgr.value ? 'team' : 'personal',
      priority: left < 0 ? 1 : 3, kind: left < 0 ? 'Certificate expired' : 'Certificate expiring',
      title: `${r.title || 'Certificate'}${r.employee ? ' - ' + r.employee : ''}`,
      detail: left < 0 ? `Expired ${-left} day(s) ago (${r.expiry})` : `Expires in ${left} day(s) (${r.expiry})`, sort: 1000 - left
    });
  }
  if (isHr.value) {
    const active = props.employees.filter((e) => !['Resigned', 'Inactive', 'Terminated'].includes(e.status));
    const noMgr = active.filter((e) => !e.manager).length;
    const noDept = active.filter((e) => !e.departmentId && !e.department).length;
    if (noMgr) out.push({ key: 'gap:mgr', module: null, priority: 3, kind: 'Data completeness', title: `${noMgr} active employee(s) without a reporting manager`, detail: 'Open Employee Management to assign. Approval routing may be affected.', sort: noMgr });
    if (noDept) out.push({ key: 'gap:dept', module: null, priority: 3, kind: 'Data completeness', title: `${noDept} active employee(s) without a department`, detail: 'Unassigned staff are excluded from department charts.', sort: noDept });
  }
  return out.sort((a, b) => a.priority - b.priority || b.sort - a.sort);
});

const userIdentifier = computed(() => {
  return props.user?.username || props.user?.email || props.user?.name ||
    (typeof window !== 'undefined' && window.currentUser && (window.currentUser.username || window.currentUser.email || window.currentUser.name)) ||
    props.role;
});
const seenKey = computed(() => `pploshr.ac.seen.${encodeURIComponent(userIdentifier.value)}`);
const seen = ref(new Set(JSON.parse(localStorage.getItem(seenKey.value) || '[]')));
const unread = computed(() => items.value.filter((i) => !seen.value.has(i.key)).length);
const open = ref(false);
const shown = computed(() => (open.value ? items.value : items.value.slice(0, 5)));
function markAllRead() { seen.value = new Set(items.value.map((i) => i.key)); localStorage.setItem(seenKey.value, JSON.stringify([...seen.value])); }
function go(i) {
  seen.value.add(i.key); localStorage.setItem(seenKey.value, JSON.stringify([...seen.value]));
  if (i.module) window.dispatchEvent(new CustomEvent('hr-module', { detail: { module: i.module, scope: i.scope, label: i.title } }));
}
const tone = (p) => (p === 1 ? 'ac-high' : p === 2 ? 'ac-mid' : 'ac-low');
</script>

<template>
  <section class="ac-card" aria-labelledby="acTitle">
    <div class="ac-head">
      <div>
        <h6 id="acTitle">Action Center <span v-if="unread" class="ac-badge" :aria-label="unread + ' unread items'">{{ unread }}</span></h6>
        <p class="ac-note">Prioritised from records you are authorised to see. Notices are read-state only on this device.</p>
      </div>
      <button v-if="unread" type="button" class="btn btn-sm btn-outline-secondary" @click="markAllRead">Mark all read</button>
    </div>
    <p v-if="!items.length" class="ac-empty"><i class="bi bi-check2-circle"></i> Nothing needs attention right now.</p>
    <ul v-else class="ac-list">
      <li v-for="i in shown" :key="i.key">
        <button type="button" :class="['ac-item', tone(i.priority), { 'ac-unread': !seen.has(i.key) }]" @click="go(i)" :disabled="!i.module && false">
          <span class="ac-kind">{{ i.kind }}</span>
          <span class="ac-title">{{ i.title }}</span>
          <span class="ac-detail">{{ i.detail }}</span>
        </button>
      </li>
    </ul>
    <button v-if="items.length > 5" type="button" class="btn btn-sm btn-link" @click="open = !open">{{ open ? 'Show fewer' : 'Show all ' + items.length }}</button>
  </section>
</template>

<style scoped>
.ac-card{background:var(--surface,#fff);border:1px solid var(--line,#e5e5ea);border-radius:18px;padding:20px;margin-bottom:18px}
.ac-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.ac-head h6{margin:0 0 4px}.ac-note{font-size:.74rem;color:var(--muted,#6e6e73);margin:0 0 10px}
.ac-badge{background:#b42332;color:#fff;border-radius:999px;font-size:.68rem;padding:2px 8px;margin-left:6px;vertical-align:middle}
.ac-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.ac-item{display:grid;grid-template-columns:140px 1fr;gap:2px 12px;width:100%;text-align:left;border:1px solid var(--line,#e5e5ea);border-left-width:4px;border-radius:12px;background:#fff;padding:10px 12px;min-height:44px}
.ac-item:hover{background:#f5f5f7}.ac-kind{font-size:.66rem;font-weight:650;letter-spacing:.04em;text-transform:uppercase;grid-row:1/3;align-self:center}
.ac-title{font-size:.82rem;font-weight:600;overflow-wrap:anywhere}.ac-detail{font-size:.72rem;color:var(--muted,#6e6e73)}
.ac-high{border-left-color:#b42332}.ac-high .ac-kind{color:#b42332}.ac-mid{border-left-color:#b7791f}.ac-mid .ac-kind{color:#8a5a0a}.ac-low{border-left-color:#4a6fa5}.ac-low .ac-kind{color:#3a5a8c}
.ac-unread .ac-title::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#0071e3;margin-right:7px}
.ac-empty{font-size:.82rem;color:var(--muted,#6e6e73)}
@media(max-width:576px){.ac-item{grid-template-columns:1fr}.ac-kind{grid-row:auto}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
