<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';
import {dashboardActions} from '../services/dashboard';
import {roleLabel} from '../hr/navigation';
const user=ref(null),open=ref(false),root=ref(null),trigger=ref(null);
const actionCount=ref(0);

function session(e){
  user.value=e.detail;
  open.value=false;
  if(user.value){
    if(typeof dashboardActions.fetchActionCount==='function') dashboardActions.fetchActionCount();
  } else {
    actionCount.value=0;
  }
}
function onActionCount(e){
  actionCount.value=Number(e?.detail?.total ?? e?.detail ?? 0);
}
function outside(e){if(!root.value?.contains(e.target))open.value=false;}
function close(){open.value=false;trigger.value?.focus();}
function profile(){open.value=false;dashboardActions.switchTab('my-profile');}
function logout(){open.value=false;dashboardActions.logout();}
function goToActionQueue(){
  open.value=false;
  if(typeof window.switchTab==='function') window.switchTab('hr-workspace');
  window.dispatchEvent(new CustomEvent('hr-module',{detail:{module:'overview',scope:'overview',label:'Overview'}}));
  setTimeout(()=>{
    const el=document.querySelector('.hr-queue, .hr-metrics');
    if(el) el.scrollIntoView({behavior:'smooth'});
  },100);
}

onMounted(()=>{
  window.addEventListener('hr-session',session);
  window.addEventListener('hr-action-count',onActionCount);
  document.addEventListener('click',outside);
  if(typeof dashboardActions.fetchActionCount==='function') dashboardActions.fetchActionCount();
});
onBeforeUnmount(()=>{
  window.removeEventListener('hr-session',session);
  window.removeEventListener('hr-action-count',onActionCount);
  document.removeEventListener('click',outside);
});
</script>
<template>
 <div v-if="user" ref="root" class="account-menu" @keydown.esc.stop="close">
  <button id="accountMenuButton" ref="trigger" class="account-trigger" type="button" :aria-expanded="open" aria-controls="accountMenuPanel" @click="open=!open">
   <span class="account-avatar overflow-hidden" aria-hidden="true">
    <img v-if="user.photo || user.photoUrl" :src="user.photo || user.photoUrl" class="w-100 h-100 object-fit-cover rounded-circle" alt="" />
    <template v-else>{{user.name?.trim().slice(0,1)}}</template>
   </span>
   <span v-if="actionCount > 0" id="accountActionBadge" class="account-action-badge" :title="actionCount + ' action(s) require your attention'">{{actionCount > 99 ? '99+' : actionCount}}</span>
   <span class="account-identity"><strong>{{user.name}}</strong><small>{{roleLabel(user.role)}}</small></span><i class="bi bi-chevron-down" aria-hidden="true"/>
  </button>
  <div v-if="open" id="accountMenuPanel" class="account-panel">
   <div v-if="actionCount > 0" class="account-action-summary p-2 mb-1 border-bottom bg-danger-subtle rounded-2 text-danger small fw-semibold" style="cursor: pointer;" @click="goToActionQueue">
    <i class="bi bi-bell-fill me-1"></i> {{actionCount}} pending action{{actionCount > 1 ? 's' : ''}}
   </div>
   <button id="accountProfile" type="button" @click="profile"><i class="bi bi-person-circle"/>My Profile</button>
   <button id="accountLogout" type="button" @click="logout"><i class="bi bi-box-arrow-right"/>Logout</button>
  </div>
 </div>
</template>
