<script setup>
import { computed, ref } from 'vue';
// Resource availability calendar (week view). Read-only, built from authorised hrBootstrap `resources` + `bookings`.
// Overlap detection mirrors the booking rule (same resource, intersecting [start,end) among non-rejected/cancelled bookings).
const props = defineProps({ records: { type: Object, default: () => ({}) } });
const MYT = 'Asia/Kuala_Lumpur';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: MYT }).format(d);
const mondayOf = (d) => { const x = new Date(ymd(d) + 'T00:00:00Z'); const wd = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - wd); return x.toISOString().slice(0, 10); };
const weekStart = ref(mondayOf(new Date()));
const category = ref('all');
const shift = (n) => { const x = new Date(weekStart.value + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n * 7); weekStart.value = x.toISOString().slice(0, 10); };
const days = computed(() => Array.from({ length: 7 }, (_, i) => { const x = new Date(weekStart.value + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + i); const s = x.toISOString().slice(0, 10); return { s, label: x.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) }; }));
const resources = computed(() => (props.records.resources || []).filter((r) => category.value === 'all' || r.category === category.value));
const categories = computed(() => [...new Set((props.records.resources || []).map((r) => r.category).filter(Boolean))].sort());
const active = (b) => !/^(rejected|cancel)/i.test(String(b.status || ''));
const bookings = computed(() => (props.records.bookings || []).filter(active));
const dayOf = (v) => String(v || '').slice(0, 10);
const timeOf = (v) => String(v || '').slice(11, 16);
const byRes = computed(() => { const m = new Map(); for (const b of bookings.value) { if (!m.has(b.resourceId)) m.set(b.resourceId, []); m.get(b.resourceId).push(b); } return m; });
const conflicts = computed(() => {
  const set = new Set();
  for (const list of byRes.value.values()) {
    const s = [...list].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length && String(s[j].start) < String(s[i].end); j++) { set.add(s[i].id); set.add(s[j].id); }
  }
  return set;
});
const cell = (res, d) => (byRes.value.get(res.id) || []).filter((b) => dayOf(b.start) <= d && dayOf(b.end) >= d);
const today = ymd(new Date());
const kpi = computed(() => {
  const rs = props.records.resources || [];
  const busy = new Set(bookings.value.filter((b) => dayOf(b.start) <= today && dayOf(b.end) >= today).map((b) => b.resourceId));
  const maint = rs.filter((r) => r.availability === 'Maintenance').length;
  return { total: rs.length, maint, bookedToday: busy.size, freeToday: Math.max(0, rs.length - maint - busy.size), conflicts: conflicts.value.size };
});
const open = (b) => window.dispatchEvent(new CustomEvent('hr-module', { detail: { module: 'bookings', scope: 'all', label: 'Resource bookings' } }));
</script>

<template>
  <section class="rc-card" aria-labelledby="rcTitle">
    <div class="rc-head">
      <div><h6 id="rcTitle">Resource availability calendar</h6><p class="rc-note">Rooms, vehicles and equipment from the resource catalogue and bookings you are authorised to see (MYT).</p></div>
      <div class="rc-tools">
        <label class="visually-hidden" for="rcCat">Resource type</label>
        <select id="rcCat" v-model="category" class="form-select form-select-sm"><option value="all">All types</option><option v-for="c in categories" :key="c" :value="c">{{ c }}</option></select>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="shift(-1)" aria-label="Previous week">&lt;</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="weekStart = mondayOf(new Date())">This week</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" @click="shift(1)" aria-label="Next week">&gt;</button>
      </div>
    </div>
    <div class="rc-kpis">
      <div><span>Resources</span><b>{{ kpi.total }}</b></div><div><span>Booked today</span><b>{{ kpi.bookedToday }}</b></div>
      <div><span>Free today</span><b>{{ kpi.freeToday }}</b></div><div><span>Maintenance</span><b>{{ kpi.maint }}</b></div><div :class="{ 'rc-bad': kpi.conflicts }"><span>Overlapping bookings</span><b>{{ kpi.conflicts }}</b></div>
    </div>
    <p v-if="!resources.length" class="rc-empty">No resources are available in your scope.</p>
    <div v-else class="rc-scroll">
      <table class="rc-table">
        <caption class="visually-hidden">Resource bookings for the week starting {{ weekStart }}</caption>
        <thead><tr><th scope="col">Resource</th><th v-for="d in days" :key="d.s" scope="col" :class="{ 'rc-today': d.s === today }">{{ d.label }}</th></tr></thead>
        <tbody>
          <tr v-for="r in resources" :key="r.id">
            <th scope="row"><span>{{ r.title }}</span><small>{{ r.category }}<em v-if="r.availability === 'Maintenance'"> - maintenance</em></small></th>
            <td v-for="d in days" :key="d.s" :class="{ 'rc-today': d.s === today, 'rc-maint': r.availability === 'Maintenance' }">
              <button v-for="b in cell(r, d.s)" :key="b.id" type="button" :class="['rc-b', { 'rc-conflict': conflicts.has(b.id), 'rc-pend': /^(submitted|pending)/i.test(b.status || '') }]" @click="open(b)" :title="(b.employee || '') + ' ' + (b.title || '')">
                {{ timeOf(b.start) }}-{{ timeOf(b.end) }} {{ b.employee || b.title || '' }}<i v-if="conflicts.has(b.id)"> (overlap)</i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="rc-legend"><span class="rc-b">Booked</span> <span class="rc-b rc-pend">Pending</span> <span class="rc-b rc-conflict">Overlap</span></p>
  </section>
</template>

<style scoped>
.rc-card{background:var(--surface,#fff);border:1px solid var(--line,#e5e5ea);border-radius:18px;padding:20px;margin-bottom:18px}
.rc-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.rc-head h6{margin:0 0 4px}.rc-note{font-size:.74rem;color:var(--muted,#6e6e73);margin:0 0 10px}
.rc-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.rc-tools .btn,.rc-tools select{min-height:36px}
.rc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:12px}.rc-kpis div{background:#f5f5f7;border-radius:12px;padding:10px 12px}.rc-kpis span{display:block;font-size:.68rem;color:var(--muted,#6e6e73)}.rc-kpis b{font-size:1.2rem}.rc-bad{background:#fff1f2!important}.rc-bad b{color:#b42332}
.rc-scroll{overflow-x:auto}.rc-table{width:100%;min-width:760px;border-collapse:collapse;font-size:.74rem}.rc-table th,.rc-table td{border:1px solid #e5e5ea;padding:6px;vertical-align:top}.rc-table thead th{background:#fafafa;text-align:center}
.rc-table tbody th{text-align:left;min-width:150px;font-weight:600}.rc-table th small{display:block;color:var(--muted,#6e6e73);font-weight:400}.rc-today{background:#eef5ff}.rc-maint{background:repeating-linear-gradient(45deg,#fafafa,#fafafa 6px,#f0f0f2 6px,#f0f0f2 12px)}
.rc-b{display:block;width:100%;text-align:left;border:0;border-radius:8px;padding:4px 7px;margin-bottom:4px;background:#e8f0e9;color:#2f5c3a;font-size:.72rem;min-height:28px;overflow-wrap:anywhere}.rc-pend{background:#fff4d6;color:#7a5200}.rc-conflict{background:#fff1f2;color:#b42332;outline:1px solid #b42332}
.rc-legend{font-size:.7rem;margin:10px 0 0}.rc-legend .rc-b{display:inline-block;width:auto;margin-right:6px}.rc-empty{font-size:.82rem;color:var(--muted,#6e6e73)}
</style>
