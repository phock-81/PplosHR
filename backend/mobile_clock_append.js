/* Mobile GPS clock-in extension for the consolidated GAS_payroll.js.
   Geolocation is captured only on staff-initiated punch, never continuously.
   Separate HR_ sheets protect legacy biometric / payroll structures.
   No automatic payroll/attendance merge: requires controlled HR reconciliation.
 */
const MOBILE_CLOCK_MODES_ = ['OFF','GEOFENCED','ANYWHERE'];
const MOBILE_CLOCK_MAX_ACCURACY_M_ = 100;
const MOBILE_CLOCK_MAX_LOCATION_AGE_MS_ = 90000;

function mobileClockTarget_(actor, name) {
  const targetName = hrName_(name || actor.name);
  hrAssert_(hrAdmin_(actor) || targetName === actor.name,'Not authorized to view this employee.');
  const target = hrStaffTarget_(targetName);
  hrAssert_(target.row[1] !== 'Resigned','Employee is inactive.');
  return {name:targetName, employeeNo:String(target.row[24] || targetName), companyId:String(target.row[25] || '')};
}
function mobileClockPolicy_(employeeNo) {
  return hrRows_('mobileClockPolicy').find(r => String(r.id) === String(employeeNo)) || null;
}
function mobileClockSites_() { return hrRows_('mobileClockSite'); }
function mobileClockPublic_(record) { return record ? hrPublic_(record) : null; }
function mobileClockConfig_(payload,actor) {
  const target=mobileClockTarget_(actor,payload && payload.employee);
  const stored=mobileClockPolicy_(target.employeeNo);
  const policy=stored?mobileClockPublic_(stored):{id:target.employeeNo,employee:target.name,mode:'OFF',siteId:'',status:'Disabled',version:0};
  const allSites=mobileClockSites_();
  const assigned=policy.siteId?allSites.find(s=>s.id===policy.siteId&&s.active!==false):null;
  const sites=hrAdmin_(actor)?allSites.map(mobileClockPublic_):(assigned?[mobileClockPublic_(assigned)]:[]);
  const events=hrRows_('mobileClockEvent').filter(r=>r.employeeNo===target.employeeNo)
    .slice(-40).reverse().map(r=>({id:r.id,type:r.type,serverTime:r.serverTime,date:r.date,siteId:r.siteId,
      location:{latitude:r.latitude,longitude:r.longitude,accuracyM:r.accuracyM},distanceM:r.distanceM,mode:r.mode,photo:r.photo||r.photolink||'',photolink:r.photolink||''}));
  return jsonResponse({status:'success',data:{employee:target.name,employeeNo:target.employeeNo,policy,sites,events,maxAccuracyM:MOBILE_CLOCK_MAX_ACCURACY_M_}});
}
function mobileClockSiteSave_(payload,actor) {
  hrAssert_(hrAdmin_(actor),'Only HR or Superadmin may manage geofences.');
  const name=String(payload.name||'').trim();
  const latitude=Number(payload.latitude),longitude=Number(payload.longitude),radiusM=Number(payload.radiusM);
  hrAssert_(name.length>=3&&name.length<=100,'Enter a site name (3–100 characters).');
  hrAssert_(Number.isFinite(latitude)&&latitude>=-90&&latitude<=90,'Invalid site latitude.');
  hrAssert_(Number.isFinite(longitude)&&longitude>=-180&&longitude<=180,'Invalid site longitude.');
  hrAssert_(Number.isFinite(radiusM)&&radiusM>=50&&radiusM<=5000,'Site radius must be 50–5000 metres.');
  const existing=payload.id?mobileClockSites_().find(r=>r.id===payload.id):null;
  if(payload.id)hrAssert_(!!existing,'Site does not exist.');
  if(existing && payload.version!=null)hrAssert_(existing.version===Number(payload.version),'Site changed. Refresh and try again.');
  const next={id:existing?existing.id:Utilities.getUuid(),name,latitude,longitude,radiusM,
    companyId:String(payload.companyId||'').trim(),active:payload.active!==false};
  return hrWrite_('mobileClockSite',next,actor,existing,existing?'Geofence updated':'Geofence created');
}
function mobileClockPolicySave_(payload,actor) {
  hrAssert_(hrAdmin_(actor),'Only HR or Superadmin can enable staff mobile clock-in.');
  const target=mobileClockTarget_(actor,payload.employee);
  const mode=String(payload.mode||'OFF').toUpperCase();
  hrAssert_(MOBILE_CLOCK_MODES_.indexOf(mode)!==-1,'Invalid mobile clock mode.');
  const existing=mobileClockPolicy_(target.employeeNo);
  if(existing && payload.version!=null)hrAssert_(Number(existing.version)===Number(payload.version),'Policy changed. Refresh and try again.');
  const siteId=mode==='GEOFENCED'?String(payload.siteId||''):'';
  if(mode==='GEOFENCED') {
    const site=mobileClockSites_().find(s=>s.id===siteId&&s.active!==false);
    hrAssert_(!!site,'Choose an active geofence site.');
    hrAssert_(!site.companyId||!target.companyId||site.companyId===target.companyId,'Geofence site belongs to another company.');
  }
  const record={id:target.employeeNo,employee:target.name,employeeNo:target.employeeNo,mode,
    siteId,status:mode==='OFF'?'Disabled':'Enabled',consentNoticeVersion:'2026-10-v1'};
  return hrWrite_('mobileClockPolicy',record,actor,existing,mode==='OFF'?'Disabled mobile clock-in':'Mobile clock-in policy changed');
}
function mobileClockDistanceM_(aLat,aLng,bLat,bLng) {
  const toRad=Math.PI/180;
  const dLat=(bLat-aLat)*toRad,dLng=(bLng-aLng)*toRad;
  const q=Math.sin(dLat/2)**2+Math.cos(aLat*toRad)*Math.cos(bLat*toRad)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
}

function mobileClockStaffFolder_(target) {
  if (typeof DriveApp === 'undefined') return null;
  // 1. Try hrEnsureStaffFolder_ if available (standard HR folder flow or test mock)
  try {
    if (typeof hrStaffTarget_ === 'function' && typeof hrEnsureStaffFolder_ === 'function') {
      const st = hrStaffTarget_(target.name);
      if (st) {
        const folder = hrEnsureStaffFolder_(st);
        if (folder) return folder;
      }
    }
  } catch (_) {}

  // 2. Direct Attachment folder lookup / creation under STAFF_FOLDER_PARENT_
  try {
    const parentId = (typeof STAFF_FOLDER_PARENT_ !== 'undefined' && STAFF_FOLDER_PARENT_) ? STAFF_FOLDER_PARENT_ : '1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf';
    const parent = DriveApp.getFolderById(parentId);
    const cleanId = String(target.employeeNo || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
    const cleanName = String(target.name || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
    const folderName = (cleanId && cleanName) ? (cleanId + '_' + cleanName) : (cleanName || cleanId || 'Staff');
    const matches = parent.getFoldersByName(folderName);
    while (matches.hasNext()) {
      const f = matches.next();
      if (!f.isTrashed()) return f;
    }
    return parent.createFolder(folderName);
  } catch (err) {
    if (typeof Logger !== 'undefined') Logger.log('mobileClockStaffFolder_ error: ' + err);
    return null;
  }
}

function mobileClockPunch_(payload,actor) {
  const target=mobileClockTarget_(actor,actor.name);
  const policy=mobileClockPolicy_(target.employeeNo);
  hrAssert_(policy&&policy.mode!=='OFF'&&MOBILE_CLOCK_MODES_.indexOf(policy.mode)!==-1,'Mobile clock-in is not enabled for your profile. Contact HR.');
  const kind=String(payload.type||'').toUpperCase();
  hrAssert_(kind==='IN'||kind==='OUT','Choose clock in or clock out.');
  const requestId=String(payload.requestId||'');
  hrAssert_(/^[a-zA-Z0-9-]{12,90}$/.test(requestId),'Invalid request reference.');
  // Idempotent retry must work even when the original GPS sample has expired.
  const existing=hrRows_('mobileClockEvent').filter(r=>r.employeeNo===target.employeeNo);
  const duplicate=existing.find(r=>r.id===requestId);
  if(duplicate)return jsonResponse({status:'success',data:mobileClockPublic_(duplicate),duplicate:true});
  const latitude=Number(payload.latitude),longitude=Number(payload.longitude),accuracyM=Number(payload.accuracyM);
  hrAssert_(payload.latitude!==null&&payload.latitude!==''&&payload.longitude!==null&&payload.longitude!==''&&payload.accuracyM!==null&&payload.accuracyM!=='','A real GPS reading is required.');
  hrAssert_(Number.isFinite(latitude)&&latitude>=-90&&latitude<=90&&Number.isFinite(longitude)&&longitude>=-180&&longitude<=180,'Valid GPS coordinates are required.');
  hrAssert_(Number.isFinite(accuracyM)&&accuracyM>0&&accuracyM<=MOBILE_CLOCK_MAX_ACCURACY_M_,'GPS accuracy too low. Move outdoors and retry.');
  const capturedMs=Date.parse(String(payload.capturedAt||''));
  const now=new Date(),nowMs=now.getTime();
  hrAssert_(Number.isFinite(capturedMs)&&Math.abs(nowMs-capturedMs)<=MOBILE_CLOCK_MAX_LOCATION_AGE_MS_,'GPS reading expired or device time is incorrect. Please retry.');
  let site=null,distanceM=null;
  if(policy.mode==='GEOFENCED') {
    site=mobileClockSites_().find(s=>s.id===policy.siteId&&s.active!==false);
    hrAssert_(!!site,'Assigned geofence site is unavailable. Contact HR.');
    distanceM=mobileClockDistanceM_(latitude,longitude,Number(site.latitude),Number(site.longitude));
    hrAssert_(distanceM<=Number(site.radiusM),'Outside the permitted clock-in geofence ('+Math.round(distanceM)+' m from site; limit '+site.radiusM+' m).');
  }
  const klDate=Utilities.formatDate(now,'Asia/Kuala_Lumpur','yyyy-MM-dd');
  const latest=existing[existing.length-1];
  const latestAge=latest?nowMs-Date.parse(latest.serverTime):Infinity;
  if(kind==='OUT')hrAssert_(latest&&latest.type==='IN'&&latestAge>=0&&latestAge<20*60*60*1000,'No open clock-in found in the last 20 hours. Contact HR for a correction.');
  if(kind==='IN')hrAssert_(!latest||latest.type!=='IN'||latestAge>20*60*60*1000,'Already clocked in. Clock out first.');
  hrAssert_(!latest||latestAge>=15000,'Please wait 15 seconds between punches.');
  const photoStr = (payload.photo && typeof payload.photo === 'string' && payload.photo.startsWith('data:image')) ? payload.photo : '';
  let photolink = '';
  if (photoStr) {
    try {
      if (typeof DriveApp !== 'undefined') {
        const staffFolder = mobileClockStaffFolder_(target);
        if (staffFolder) {
          const datePart = Utilities.formatDate(now, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
          const timePart = Utilities.formatDate(now, 'Asia/Kuala_Lumpur', 'HH-mm-ss');
          const fileName = datePart + '_' + timePart + '.jpg';
          const base64Data = photoStr.indexOf(',') !== -1 ? photoStr.split(',')[1] : photoStr;
          const bytes = Utilities.base64Decode(base64Data);
          const blob = Utilities.newBlob(bytes, 'image/jpeg', fileName);
          const file = staffFolder.createFile(blob);
          try {
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          } catch (shareErr) {
            if (typeof Logger !== 'undefined') Logger.log('Sharing notice: ' + shareErr);
          }
          photolink = file.getUrl();
        }
      }
    } catch (driveErr) {
      if (typeof Logger !== 'undefined') Logger.log('Drive save error: ' + (driveErr && driveErr.message ? driveErr.message : driveErr));
    }
  }
  const event={id:requestId,employee:target.name,employeeNo:target.employeeNo,type:kind,serverTime:now.toISOString(),date:klDate,
    latitude:Number(latitude.toFixed(7)),longitude:Number(longitude.toFixed(7)),accuracyM:Number(accuracyM.toFixed(1)),
    siteId:site?site.id:'',siteName:site?site.name:'',distanceM:distanceM==null?null:Number(distanceM.toFixed(1)),
    mode:policy.mode,clientCapturedAt:String(payload.capturedAt),photo:photolink||photoStr,photolink:photolink,photoUrl:photolink,source:'mobile-pwa',status:'Recorded'};
  const sheet=hrSheet_('mobileClockEvent',true);
  try {
    if (sheet && sheet.getLastColumn && sheet.getLastColumn() < 8) {
      sheet.getRange(1, 8).setValue('photolink');
    }
  } catch (_) {}
  sheet.appendRow([event.id,1,event.employee,event.status,JSON.stringify(event),event.serverTime,actor.name,photolink]);
  if(photoStr || photolink) {
    try {
      const docSheet=hrSheet_('staffDocuments',true);
      const docId=Utilities.getUuid();
      const docRec={id:docId,employee:target.name,employeeNo:target.employeeNo,title:'Attendance Selfie ('+kind+') · '+klDate,
        category:'Attendance Photo',url:photolink||photoStr,photolink:photolink,date:klDate,status:'Verified',punchId:requestId,punchType:kind,punchTime:event.serverTime,
        location:{latitude:event.latitude,longitude:event.longitude,accuracyM:event.accuracyM}};
      docSheet.appendRow([docId,1,target.name,'Verified',JSON.stringify(docRec),now.toISOString(),actor.name,photolink]);
    }catch(_){}
  }
  if(photolink) {
    try {
      const staffTarget = typeof hrStaffTarget_ === 'function' ? hrStaffTarget_(target.name) : null;
      if (staffTarget && staffTarget.index && typeof getSpreadsheet_ === 'function') {
        const staffSheet = getSpreadsheet_().getSheetByName('Staff');
        if (staffSheet) {
          const curAttach = String(staffTarget.row[16] || '').trim();
          const nextAttach = curAttach ? (curAttach + ' | ' + photolink) : photolink;
          staffSheet.getRange(staffTarget.index, 17).setValue(nextAttach);
        }
      }
    }catch(_){}
  }
  return jsonResponse({status:'success',data:event});
}
