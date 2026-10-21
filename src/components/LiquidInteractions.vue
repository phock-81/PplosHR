<script setup>
import { onMounted, onUnmounted, ref, nextTick } from 'vue';
const dock = ref([]);
const selected = ref('');
const expanded = ref(null);
const splitOpen = ref(false);
const periodOptions = ref([]);
let observer, raf = 0, scheduled = false;
const sidebar = () => document.querySelector('#sidebarMenu');
function sync(){
  scheduled=false;
  const root=sidebar();
  if (!root) return;
  const nodes=[...root.querySelectorAll('a,button,[role="button"]')].filter(el=>el.closest('li') && !el.closest('[hidden]') && el.textContent.trim() && !el.matches('.sidebar-close'));
  const active=nodes.find(el=>el.matches('.active,[aria-current="page"]') || el.closest('li.active'));
  selected.value=(active?.textContent || document.querySelector('#pageTitle')?.textContent || '').trim();
  const shortcuts=nodes.filter(el=>{const li=el.closest('li');return li && !li.closest('[style*="display: none"]') && !el.hidden && getComputedStyle(el).display!=='none';}).slice(0,7);
  dock.value=shortcuts.map((el,i)=>({key:i,label:el.textContent.trim().replace(/\s+/g,' '),icon:el.querySelector('i')?.className||'bi bi-grid',element:el}));
}
function scheduleSync(){if(!scheduled){scheduled=true;raf=requestAnimationFrame(sync);}}
function navigate(item){if(item?.element?.isConnected && item.element.getClientRects().length)item.element.click();nextTick(scheduleSync);}
function currentSelect(){return document.querySelector('#summary-dashboard.tab-section.active #summaryViewType') || document.querySelector('#summaryViewType');}
function openSplit(){const el=currentSelect();if(!el)return;periodOptions.value=[...el.options].map(o=>({label:o.textContent,value:o.value}));splitOpen.value=!splitOpen.value;}
function setPeriod(value){const el=currentSelect();if(el){el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));}splitOpen.value=false;}
function onCards(event){if(event.target.closest('button,a,input,select,textarea,[role="button"]'))return;const card=event.target.closest('#summary-dashboard .kpi-card');if(!card)return;const label=card.querySelector('.kpi-label')?.textContent?.trim()||'Metric';const value=card.querySelector('.kpi-value')?.textContent?.trim()||'—';const sub=card.querySelector('.small')?.textContent?.trim()||'';expanded.value={label,value,sub};}
function onKeys(event){if(event.key==='Escape'){expanded.value=null;splitOpen.value=false;}}
onMounted(()=>{const root=sidebar();observer=new MutationObserver(scheduleSync);if(root)observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','aria-current']});document.addEventListener('click',onCards);document.addEventListener('keydown',onKeys);scheduleSync();});
onUnmounted(()=>{observer?.disconnect();cancelAnimationFrame(raf);document.removeEventListener('click',onCards);document.removeEventListener('keydown',onKeys);});
</script>
<template>
  <div class="liquid-toolbar no-print" aria-label="Dashboard quick interactions">
    <button type="button" class="liquid-filter-pill" @click="openSplit" :aria-expanded="splitOpen" aria-label="Change summary analysis period"><i class="bi bi-calendar3" aria-hidden="true"></i><span>Period</span><i class="bi bi-chevron-down" aria-hidden="true"></i></button>
    <Transition name="liquid-split"><div v-if="splitOpen" class="liquid-split-options" role="group" aria-label="Analysis period"><button v-for="o in periodOptions" :key="o.value" type="button" @click="setPeriod(o.value)">{{o.label}}</button></div></Transition>
  </div>
  <nav v-if="dock.length" class="liquid-dock no-print" aria-label="Quick access navigation"><button v-for="item in dock" :key="item.label" type="button" class="liquid-dock-item" :class="{'is-active':selected===item.label}" :aria-label="item.label" :title="item.label" @click="navigate(item)"><i :class="item.icon" aria-hidden="true"></i><span class="liquid-dock-label">{{item.label}}</span><span v-if="selected===item.label" class="liquid-dock-dot" aria-hidden="true"></span></button></nav>
  <Transition name="liquid-expand"><div v-if="expanded" class="liquid-expanded-backdrop" @click.self="expanded=null"><section class="liquid-expanded-card" role="dialog" aria-modal="true" aria-label="Expanded dashboard metric"><button type="button" class="liquid-close" aria-label="Close metric details" @click="expanded=null"><i class="bi bi-x-lg"></i></button><span class="liquid-expanded-eyebrow">DASHBOARD METRIC</span><h3>{{expanded.label}}</h3><div class="liquid-expanded-value">{{expanded.value}}</div><p>{{expanded.sub}}</p><small>Current displayed value. Use dashboard period controls to change the underlying data.</small></section></div></Transition>
</template>
