<script setup>
import { ref, watch } from 'vue';
import { dashboardActions } from '../services/dashboard';

const props = defineProps({ employee: {type:String,required:true}, companyId:{type:String,default:''} });
const busy=ref(false), saving=ref(false), error=ref(''),message=ref('');
const policy=ref({mode:'OFF',siteId:'',version:0});
const sites=ref([]);
const clockEvents=ref([]);
const showSiteForm=ref(false);
const site=ref({id:'',name:'',latitude:null,longitude:null,radiusM:200,active:true,companyId:''});
const selectedPhotoEvent=ref(null);
const showPhotoModal=ref(false);

const DEFAULT_CLOCK_LOCATIONS = [
  'ARCHITECT OFFICE',
  'BANK',
  'CLIENT/DEV OFFICE',
  'COUNCIL OFFICE',
  'CS ENGINEER OFFICE',
  'HARDWARE SHOP',
  'IWK OFFICE',
  'KWSP/SOCSO/INCOME TAX',
  'LAND OFFICE',
  'ME ENGINEER OFFICE',
  'OTHERS',
  'SITE',
  'TNB OFFICE',
  'VEHICLE MAINTENANCE'
];

const locations = ref([...DEFAULT_CLOCK_LOCATIONS]);
const newLocationInput = ref('');
const editingLocationIndex = ref(-1);
const editingLocationText = ref('');
const locationSaving = ref(false);
const locationMessage = ref('');
const locationError = ref('');

function addLocation() {
  const val = newLocationInput.value.trim().toUpperCase();
  if (!val) return;
  if (locations.value.includes(val)) {
    locationError.value = `"${val}" is already in the list.`;
    return;
  }
  locations.value.push(val);
  newLocationInput.value = '';
  locationError.value = '';
}

function startEditLocation(index) {
  editingLocationIndex.value = index;
  editingLocationText.value = locations.value[index];
}

function confirmEditLocation(index) {
  const val = editingLocationText.value.trim().toUpperCase();
  if (!val) return;
  locations.value[index] = val;
  editingLocationIndex.value = -1;
  editingLocationText.value = '';
}

function cancelEditLocation() {
  editingLocationIndex.value = -1;
  editingLocationText.value = '';
}

function deleteLocation(index) {
  locations.value.splice(index, 1);
}

function resetToTemplateLocations() {
  if (confirm('Reset Check-In Locations to standard Metrio template? Any custom items will be replaced.')) {
    locations.value = [...DEFAULT_CLOCK_LOCATIONS];
  }
}

async function saveLocations() {
  locationSaving.value = true;
  locationError.value = '';
  locationMessage.value = '';
  try {
    const res = await dashboardActions.apiPost('saveClockLocations', {
      actor: props.employee,
      locations: locations.value
    });
    if (res?.status !== 'success') throw new Error(res?.message || 'Failed to save clock locations.');
    locationMessage.value = `Saved ${locations.value.length} Check-In location options successfully.`;
    setTimeout(() => { locationMessage.value = ''; }, 4000);
  } catch (err) {
    locationError.value = err.message || 'Error saving locations.';
  } finally {
    locationSaving.value = false;
  }
}

function previewPhoto(evt){
  selectedPhotoEvent.value=evt;
  showPhotoModal.value=true;
}
function closePhotoModal(){
  showPhotoModal.value=false;
  selectedPhotoEvent.value=null;
}
function openAttendance(evt){
  closePhotoModal();
  const emp=props.employee||evt?.employee||'';
  if(typeof window!=='undefined'){
    if(window.$&&$('#attendanceStaffSearch').length){
      $('#attendanceStaffSearch').val(emp);
    }
    if(typeof window.switchTab==='function'){
      window.switchTab('dashboard');
    }else if(typeof window.switchMobileTab==='function'){
      window.switchMobileTab('dashboard');
    }
    if(window.dashboardActions?.renderDashboard){
      window.dashboardActions.renderDashboard();
    }
    window.dispatchEvent(new CustomEvent('navigate-attendance',{
      detail:{employee:emp,date:evt?.date||(evt?.serverTime?evt.serverTime.slice(0,10):'')}
    }));
  }
}

async function refresh() {
  if(!props.employee)return;
  busy.value=true;error.value='';message.value='';
  try {
    const res=await dashboardActions.apiPost('mobileClockConfig',{employee:props.employee});
    if(res?.status!=='success')throw Error(res?.message||'Unable to retrieve mobile clock settings.');
    policy.value={mode:res.data.policy?.mode||'OFF',siteId:res.data.policy?.siteId||'',version:res.data.policy?.version||0};
    sites.value=res.data.sites||[];
    clockEvents.value=res.data.events||[];
    if (res.data.locations && Array.isArray(res.data.locations) && res.data.locations.length > 0) {
      locations.value = res.data.locations;
    }
  }catch(e){error.value=e.message||'Settings unavailable.';}finally{busy.value=false;}
}
watch(()=>props.employee,refresh,{immediate:true});

async function savePolicy(){
  saving.value=true;error.value='';message.value='';
  try{
    if(policy.value.mode==='GEOFENCED'&&!policy.value.siteId)throw Error('Select a geofence site first.');
    const res=await dashboardActions.apiPost('mobileClockPolicySave',{employee:props.employee,...policy.value});
    if(res?.status!=='success')throw Error(res?.message||'Unable to save staff mobile clock permission.');
    message.value=`Mobile clock-in permission saved for ${props.employee}.`;
    await refresh();
    message.value='Mobile clock-in permission saved.';
  }catch(e){error.value=e.message;}finally{saving.value=false;}
}
function newSite(){site.value={id:'',name:'',latitude:null,longitude:null,radiusM:200,active:true,companyId:props.companyId||''};showSiteForm.value=true;}
function editSite(s){site.value={...s};showSiteForm.value=true;}
function setSiteCenterFromGps(){
  if(!navigator.geolocation){error.value='GPS unavailable on this device.';return;}
  navigator.geolocation.getCurrentPosition(p=>{
    site.value.latitude=Number(p.coords.latitude.toFixed(7));
    site.value.longitude=Number(p.coords.longitude.toFixed(7));
  },()=>{error.value='Unable to get current site GPS position.';},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
}
async function saveSite(){
  saving.value=true;error.value='';message.value='';
  try{
    const res=await dashboardActions.apiPost('mobileClockSiteSave',site.value);
    if(res?.status!=='success')throw Error(res?.message||'Unable to save geofence site.');
    const newId=res.data?.id;
    showSiteForm.value=false;
    await refresh();
    if(newId){policy.value.siteId=newId;}
    message.value='Geofence site saved. Now save the employee permission.';
  }catch(e){error.value=e.message;}finally{saving.value=false;}
}
</script>

<template>
  <div class="clock-admin">
    <div class="d-flex align-items-center justify-content-between mb-2 gap-2">
      <div><h5 class="fw-bold mb-0"><i class="bi bi-pin-map me-2"></i>Mobile GPS Attendance</h5>
        <small class="text-muted">HR-managed access for {{ employee }}</small></div>
      <button type="button" class="btn btn-sm btn-outline-secondary" :disabled="busy||saving" @click="refresh">Refresh</button>
    </div>
    <div v-if="error" role="alert" class="alert alert-danger small">{{error}}</div>
    <div v-if="message" role="status" class="alert alert-success small">{{message}}</div>
    <div class="row g-3">
      <div class="col-md-6"><label class="form-label" for="mobileClockMode">Mobile clock-in permission</label>
        <select id="mobileClockMode" v-model="policy.mode" class="form-select" :disabled="busy||saving">
          <option value="OFF">Disabled</option>
          <option value="GEOFENCED">Enabled — geofence required</option>
          <option value="ANYWHERE">Enabled — any GPS location</option>
        </select>
      </div>
      <div v-if="policy.mode==='GEOFENCED'" class="col-md-6">
        <label class="form-label" for="mobileClockSite">Assigned geofence site</label>
        <select id="mobileClockSite" v-model="policy.siteId" class="form-select" :disabled="busy||saving" required>
          <option value="">Choose location...</option>
          <option v-for="g in sites.filter(x=>x.active!==false && (!x.companyId||!companyId||x.companyId===companyId))" :key="g.id" :value="g.id">{{g.name}} ({{g.radiusM}} m)</option>
        </select>
      </div>
    </div>
    <p class="small text-muted mt-2">Both enabled modes require the staff member to share a fresh GPS location (accuracy within 100 m). Geofenced mode also requires being inside the assigned site radius. No background tracking.</p>
    <div class="d-flex gap-2 flex-wrap mt-2">
      <button type="button" class="btn btn-primary" :disabled="busy||saving" @click="savePolicy">{{saving?'Saving…':'Save Staff Permission'}}</button>
      <button type="button" class="btn btn-outline-primary" :disabled="busy||saving" @click="newSite">Create Geofence Site</button>
    </div>
    <div v-if="sites.length" class="mt-3"><h6 class="fw-bold">Geofence site library</h6>
      <div v-for="g in sites" :key="g.id" class="d-flex align-items-center justify-content-between gap-3 border-top py-2 small">
        <div><strong>{{g.name}}</strong> · {{g.radiusM}} m · {{g.latitude}}, {{g.longitude}} <span v-if="g.active===false" class="text-danger">(Inactive)</span></div>
        <button type="button" class="btn btn-outline-secondary btn-sm" @click="editSite(g)">Edit</button>
      </div>
    </div>

    <!-- Check-In Location Dropdown Options (Template & HR Management) -->
    <div class="card mt-3 border shadow-sm">
      <div class="card-header bg-light d-flex align-items-center justify-content-between py-2">
        <div class="d-flex align-items-center gap-2">
          <i class="bi bi-list-check text-primary fs-5"></i>
          <div>
            <h6 class="fw-bold mb-0">Check-In Location Dropdown Options</h6>
            <small class="text-muted">Options available for staff when selecting punch location on mobile</small>
          </div>
        </div>
        <span class="badge bg-primary rounded-pill">{{ locations.length }} options</span>
      </div>
      <div class="card-body p-3">
        <div v-if="locationError" class="alert alert-danger small py-1 px-2 mb-2">{{ locationError }}</div>
        <div v-if="locationMessage" class="alert alert-success small py-1 px-2 mb-2">{{ locationMessage }}</div>

        <!-- Add new location input group -->
        <div class="input-group input-group-sm mb-3">
          <input
            v-model="newLocationInput"
            type="text"
            class="form-control"
            placeholder="Add new location (e.g. SHOWROOM, WAREHOUSE)..."
            @keyup.enter="addLocation"
          />
          <button class="btn btn-primary" type="button" @click="addLocation">
            <i class="bi bi-plus-lg me-1"></i>Add
          </button>
        </div>

        <!-- Location items listing -->
        <div class="table-responsive" style="max-height: 240px; overflow-y: auto;">
          <table class="table table-sm table-hover align-middle small mb-0">
            <thead class="table-light sticky-top">
              <tr>
                <th style="width: 45px;">#</th>
                <th>Location Name</th>
                <th style="width: 100px;" class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(loc, idx) in locations" :key="idx">
                <td class="text-muted">{{ idx + 1 }}</td>
                <td>
                  <div v-if="editingLocationIndex === idx" class="input-group input-group-sm">
                    <input
                      v-model="editingLocationText"
                      type="text"
                      class="form-control form-control-sm"
                      @keyup.enter="confirmEditLocation(idx)"
                    />
                    <button class="btn btn-success btn-sm" type="button" @click="confirmEditLocation(idx)" title="Confirm">
                      <i class="bi bi-check-lg"></i>
                    </button>
                    <button class="btn btn-outline-secondary btn-sm" type="button" @click="cancelEditLocation" title="Cancel">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </div>
                  <strong v-else>{{ loc }}</strong>
                </td>
                <td class="text-end">
                  <div v-if="editingLocationIndex !== idx" class="btn-group btn-group-sm">
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm py-0 px-2"
                      title="Edit location"
                      @click="startEditLocation(idx)"
                    >
                      <i class="bi bi-pencil"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-danger btn-sm py-0 px-2"
                      title="Delete location"
                      @click="deleteLocation(idx)"
                    >
                      <i class="bi bi-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Management Footer Actions -->
        <div class="d-flex justify-content-between align-items-center mt-3 pt-2 border-top">
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            :disabled="locationSaving"
            @click="resetToTemplateLocations"
          >
            <i class="bi bi-arrow-counterclockwise me-1"></i>Reset to Default Template
          </button>
          <button
            type="button"
            class="btn btn-sm btn-success"
            :disabled="locationSaving"
            @click="saveLocations"
          >
            <span v-if="locationSaving" class="spinner-border spinner-border-sm me-1" role="status"></span>
            <i v-else class="bi bi-check2-circle me-1"></i>
            {{ locationSaving ? 'Saving…' : 'Save Dropdown Options' }}
          </button>
        </div>
      </div>
    </div>

    <section v-if="clockEvents.length" class="mt-3">
      <h6 class="fw-bold">Staff GPS clock history (latest 20)</h6>
      <div class="table-responsive"><table class="table table-sm align-middle small">
        <thead>
          <tr>
            <th>Time (MYT)</th>
            <th>Punch</th>
            <th>Mode</th>
            <th>Verification Photo</th>
            <th>GPS position / Address</th>
            <th>Attendance</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="evt in clockEvents.slice(0,20)" :key="evt.id">
            <td>{{new Date(evt.serverTime).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'})}}</td>
            <td>
              <span class="badge" :class="evt.type==='IN'?'bg-success':'bg-danger'">
                {{evt.type==='IN'?'Clock In':'Clock Out'}}
              </span>
            </td>
            <td>{{evt.mode}}</td>
            <td>
              <div v-if="evt.photo" class="d-flex align-items-center gap-2">
                <img
                  :src="evt.photo"
                  alt="Selfie"
                  class="rounded-circle border shadow-sm"
                  style="width: 32px; height: 32px; object-fit: cover; cursor: pointer;"
                  @click="previewPhoto(evt)"
                />
                <button type="button" class="btn btn-sm btn-link p-0 text-decoration-none small" @click="previewPhoto(evt)">
                  View
                </button>
                <a
                  v-if="evt.photolink || (evt.photo && evt.photo.startsWith('https://drive.google.com'))"
                  :href="evt.photolink || evt.photo"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-sm btn-link p-0 text-decoration-none small text-success fw-bold"
                  title="Open in Google Drive"
                >
                  <i class="bi bi-google me-1"></i>Drive
                </a>
              </div>
              <span v-else class="text-muted small">No photo</span>
            </td>
            <td>
              <div v-if="evt.location">
                <a :href="`https://www.google.com/maps?q=${encodeURIComponent(evt.location.latitude+','+evt.location.longitude)}`" target="_blank" rel="noopener noreferrer">
                  {{evt.location.latitude}}, {{evt.location.longitude}}
                </a>
                <span class="text-muted"> (±{{evt.location.accuracyM}} m)</span>
              </div>
              <div v-if="evt.address || evt.checkInLocation" class="text-dark small mt-1">
                <span v-if="evt.checkInLocation" class="badge bg-primary-subtle text-primary border me-1">{{evt.checkInLocation}}</span>
                <span>{{evt.address}}</span>
                <div v-if="evt.remark" class="text-muted fst-italic">Note: {{evt.remark}}</div>
              </div>
            </td>
            <td>
              <button type="button" class="btn btn-sm btn-outline-primary" @click="openAttendance(evt)">
                <i class="bi bi-calendar-check me-1"></i>View Attendance
              </button>
            </td>
          </tr>
        </tbody>
      </table></div>
    </section>
    <form v-if="showSiteForm" class="border rounded-3 p-3 mt-3 bg-white" @submit.prevent="saveSite">
      <h6 class="fw-bold">{{site.id?'Edit':'New'}} geofence site</h6>
      <div class="row g-2">
        <div class="col-md-6"><label class="form-label">Site name</label><input v-model.trim="site.name" class="form-control" required minlength="3" maxlength="100" placeholder="Head Office / Project Site" /></div>
        <div class="col-md-6"><label class="form-label">Radius (metres)</label><input v-model.number="site.radiusM" class="form-control" type="number" required min="50" max="5000" /></div>
        <div class="col-md-6"><label class="form-label">Latitude</label><input v-model.number="site.latitude" class="form-control" type="number" step="any" min="-90" max="90" required /></div>
        <div class="col-md-6"><label class="form-label">Longitude</label><input v-model.number="site.longitude" class="form-control" type="number" step="any" min="-180" max="180" required /></div>
        <div class="col-md-6"><label class="form-label">Status</label><select class="form-select" v-model="site.active"><option :value="true">Active</option><option :value="false">Inactive</option></select></div>
      </div>
      <button type="button" class="btn btn-link px-0 mt-2" @click="setSiteCenterFromGps">Use this device's GPS as site center</button>
      <div class="d-flex gap-2 mt-2"><button type="submit" class="btn btn-primary" :disabled="saving">Save Site</button><button type="button" class="btn btn-outline-secondary" @click="showSiteForm=false">Cancel</button></div>
    </form>

    <!-- Photo Verification Lightbox Modal -->
    <div v-if="showPhotoModal && selectedPhotoEvent" class="photo-modal-backdrop" @click.self="closePhotoModal">
      <div class="photo-modal-dialog card shadow-lg border-0">
        <div class="card-header bg-white d-flex align-items-center justify-content-between py-3 border-bottom">
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-camera-fill text-primary fs-5"></i>
            <h6 class="fw-bold mb-0">Face Verification Record</h6>
          </div>
          <button type="button" class="btn-close" aria-label="Close" @click="closePhotoModal"></button>
        </div>
        <div class="card-body p-4 text-center">
          <div class="mb-3 position-relative d-inline-block">
            <img
              :src="selectedPhotoEvent.photo"
              alt="Face Verification Record"
              class="img-fluid rounded-4 shadow border"
              style="max-width: 280px; max-height: 280px; object-fit: cover;"
            />
            <span
              class="badge position-absolute bottom-0 start-50 translate-middle-x mb-2 px-3 py-1 shadow-sm"
              :class="selectedPhotoEvent.type==='IN'?'bg-success':'bg-danger'"
            >
              {{ selectedPhotoEvent.type==='IN'?'CLOCK IN':'CLOCK OUT' }}
            </span>
          </div>

          <div class="text-start bg-light rounded-3 p-3 small mb-3">
            <div class="row g-2">
              <div class="col-6"><strong>Staff:</strong> {{ employee }}</div>
              <div class="col-6"><strong>Status:</strong> <span class="badge bg-success-subtle text-success border">Verified</span></div>
              <div class="col-12"><strong>Time:</strong> {{ new Date(selectedPhotoEvent.serverTime).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}) }}</div>
              <div class="col-12">
                <strong>GPS:</strong>
                <a :href="`https://www.google.com/maps?q=${encodeURIComponent(selectedPhotoEvent.location.latitude+','+selectedPhotoEvent.location.longitude)}`" target="_blank" rel="noopener noreferrer" class="ms-1">
                  {{ selectedPhotoEvent.location.latitude }}, {{ selectedPhotoEvent.location.longitude }}
                </a>
                <span class="text-muted ms-1">(±{{ selectedPhotoEvent.location.accuracyM }} m)</span>
              </div>
              <div class="col-12" v-if="selectedPhotoEvent.mode">
                <strong>Mode:</strong> {{ selectedPhotoEvent.mode }}
                <span v-if="selectedPhotoEvent.distanceM != null"> · {{ selectedPhotoEvent.distanceM }} m from site</span>
              </div>
            </div>
          </div>

          <div class="d-flex gap-2 justify-content-center">
            <button type="button" class="btn btn-primary" @click="openAttendance(selectedPhotoEvent)">
              <i class="bi bi-calendar-check me-1"></i>View Attendance Record
            </button>
            <button type="button" class="btn btn-outline-secondary" @click="closePhotoModal">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>
.clock-admin{background:#fff;border:1px solid #e5e5ea;border-radius:16px;padding:18px}
.clock-admin .btn{min-height:40px}
.photo-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(4px);
  z-index: 1060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.photo-modal-dialog {
  max-width: 440px;
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  animation: photoModalIn 0.18s ease-out;
}
@keyframes photoModalIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>
