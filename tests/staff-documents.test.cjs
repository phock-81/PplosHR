const {runtime}=require('./backend.test.cjs'),fs=require('node:fs'),assert=require('node:assert/strict');
const r=runtime(fs.readFileSync('backend/GAS_payroll.js','utf8'));
const row=(name,role)=>Object.assign(Array(43).fill(''),{0:name,1:'Active',2:name,3:'password',4:role,8:'IC',23:'[]',24:'ID-'+name,30:1,34:'a@example.com',35:'Race',36:30,37:'Degree',38:'Office',39:0,40:'Company'});
r.set('Staff',[Array(24).fill('header').concat(Array(19).fill('')),row('ADMIN','Admin'),row('ALICE','User')]);r.set('Leave',[Array(12).fill('header')]);
const tokens={};for(const name of ['ADMIN','ALICE'])tokens[name]=r.request('login',{username:name,password:'password'}).sessionToken;
const req=(who,action,p={})=>r.request(action,p,tokens[who]);const ok=x=>{assert.equal(x.status,'success',x.message);return x;};
const parentId='1b-EtKWOg981bwjBzwTvYiqthX3X7TyKf',folders={},uploads=[];let created=0;
const iterator=values=>{let i=0;return {hasNext:()=>i<values.length,next:()=>values[i++]}};
const parent={getId:()=>parentId,getFoldersByName:name=>iterator(Object.values(folders).filter(f=>f.name===name)),createFolder:name=>{created++;const id='folder'+created;return folders[id]={name,getId:()=>id,getUrl:()=>`https://drive.google.com/drive/folders/${id}`,isTrashed:()=>false,getParents:()=>iterator([parent]),createFile:blob=>{uploads.push({id,blob});return {getUrl:()=>`https://drive.google.com/file/d/file${uploads.length}/view`}}}}};
r.ctx.DriveApp={getFolderById:id=>{if(id===parentId)return parent;if(!folders[id])throw Error('missing folder');return folders[id]}};
r.ctx.Utilities.base64Decode=s=>Array.from(Buffer.from(s,'base64'));r.ctx.Utilities.newBlob=(bytes,mime,name)=>({bytes,mime,name});
let saved=ok(req('ADMIN','saveSingleStaff',{name:'ALICE',email:'new@example.com',academicLevel:'Masters',version:1,staffFolderId:'evil',staffFolderUrl:'evil'}));assert.equal(created,1);assert.match(saved.staffFolderUrl,/folder1$/);
let staff=ok(req('ADMIN','getStaff')).data.ALICE;assert.equal(staff.email,'new@example.com');assert.equal(staff.icNo,'IC');assert.equal(staff.race,'Race');assert.equal(staff.serviceYearsSource,'0');assert.equal(staff.staffFolderId,'folder1');
ok(req('ADMIN','saveSingleStaff',{name:'ALICE',version:2}));assert.equal(created,1);assert.equal(req('ADMIN','saveSingleStaff',{name:'ALICE',version:2,isQuickSave:true,restDays:[0]}).status,'error');
const before=r.sheets.Staff.rows[2].slice(34);ok(req('ADMIN','saveSingleStaff',{name:'ALICE',version:3,isQuickSave:true,restDays:[0]}));assert.deepEqual(r.sheets.Staff.rows[2].slice(34),before);
assert.equal(ok(req('ALICE','getStaff')).data.ALICE.staffFolderUrl,undefined);
const file={name:'ALICE',category:'Letter',fileName:'letter.pdf',mimeType:'application/pdf',fileData:Buffer.from('%PDF-test').toString('base64')};assert.equal(req('ALICE','staffDocumentUpload',file).status,'error');const upload=ok(req('ADMIN','staffDocumentUpload',file));assert.equal(upload.version,5);assert.equal(req('ADMIN','saveSingleStaff',{name:'ALICE',version:4,existingAttachment:''}).status,'error');const secondUpload=ok(req('ADMIN','staffDocumentUpload',file));assert.equal(secondUpload.version,6);assert.equal(uploads[0].id,'folder1');assert.equal(req('ADMIN','staffDocumentUpload',{...file,fileName:'bad.html',mimeType:'text/html'}).status,'error');
// MC uses authenticated actor, regardless of requested target.
ok(req('ALICE','submitLeave',{...file,staffName:'ADMIN',leaveType:'NPL - Unpaid',startDate:'2026-11-02',endDate:'2026-11-02',totalDays:1,reason:'test'}));assert.equal(uploads[2].id,'folder1');assert.equal(r.sheets.Leave.rows[1][1],'ALICE');
// Saved ID must be within the configured parent; do not silently duplicate.
folders.folder1.getParents=()=>iterator([]);saved=ok(req('ADMIN','saveSingleStaff',{name:'ALICE',version:6,existingAttachment:''}));assert.match(saved.folderError,/outside/);assert.ok(r.sheets.Staff.rows[2][16].includes(upload.fileUrl));assert.ok(r.sheets.Staff.rows[2][16].includes(secondUpload.fileUrl));assert.equal(created,1);folders.folder1.getParents=()=>iterator([parent]);
// Exact-name lookup recovers when the Sheet ID was not saved.
r.sheets.Staff.rows[2][41]='';r.sheets.Staff.rows[2][42]='';ok(req('ADMIN','saveSingleStaff',{name:'ALICE',version:7}));assert.equal(created,1);
ok(req('ADMIN','saveSingleStaff',{name:'NEW STAFF',username:'new-staff',password:'password123',employeeNo:'MS099',role:'User'}));assert.equal(created,2);assert.equal(folders.folder2.name,'MS099_NEW STAFF');
const snapshot=r.sheets.Staff.rows.map(r=>r.slice());r.sheets.Staff.getMaxColumns=()=>43;r.ctx.LockService.getScriptLock=()=>({waitLock(){},releaseLock(){}});r.ctx.getSpreadsheet_().getUrl=()=> 'url';r.ctx.setupHrBackend();assert.deepEqual(r.sheets.Staff.rows[2].slice(34),snapshot[2].slice(34));assert.equal(r.sheets.Staff.rows[0][42],'Staff Folder URL');
console.log('PASS: extended staff roundtrip, legacy preservation, stale quicksave, server-owned folder reuse/recovery, HR-only folder links/uploads, actor-only MC routing, upload validation and non-destructive setup.');
