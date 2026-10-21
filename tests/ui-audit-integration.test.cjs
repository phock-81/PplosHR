const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const waitFor = async (predicate, message) => {
  const end = Date.now() + 5000;
  while (!predicate()) { if(Date.now()>end) throw Error(message); await new Promise(r=>setTimeout(r,10)); }
};
(async()=>{
  const {build} = await import('vite');
  const {default:vue} = await import('@vitejs/plugin-vue');
  const outDir = path.resolve('tmp/ui-audit-build');
  if (!process.env.REVIEW_UI_SKIP_BUILD) await build({configFile:false,plugins:[vue()],logLevel:'silent',define:{'import.meta.env.PROD':'false','import.meta.env.VITE_GAS_API_URL':JSON.stringify('https://example.invalid/api')},build:{outDir,emptyOutDir:true,minify:false,rollupOptions:{output:{format:'iife',name:'HrAuditApp',inlineDynamicImports:true,entryFileNames:'app.js'}}}});
  const compiledCode=fs.readFileSync(path.join(outDir,'app.js'),'utf8');
  const fixture=fs.readFileSync('src/data/importedAttendance.js','utf8').match(/export const importedAttendanceRecords = (\[[\s\S]*\]);/);
  assert.ok(fixture,'historical fixture available for exclusion check');
  const fixtureNames=[...new Set(JSON.parse(fixture[1]).map(row=>row.name))].slice(0, 30);
  for(const name of fixtureNames)assert.ok(!compiledCode.includes(name),'Production module graph must not contain historical personnel fixtures');
  const errors=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',e=>{if(!/Not implemented:.*(navigation|HTMLCanvasElement)/.test(e.message)) errors.push(e.message);});
  virtualConsole.on('error',(...args)=>errors.push(args.map(String).join(' ')));
  const dom=new JSDOM('<div id="app"></div>',{url:'https://example.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole});
  const w=dom.window;
  const calls=[];
  let holdBootstrap=false, releaseBootstrap;
  let blob;
  let actor={name:'REVIEW ADMIN',role:'Admin',employeeNo:'TEST-ADMIN'};
  const training=Array.from({length:120},(_,i)=>({id:'T'+i,title:'Course '+i,employee:'REVIEW EMPLOYEE',status:'Completed',date:'2026-10-01',attachment:'data:application/pdf;base64,DO_NOT_INDEX_ATTACHMENT'}));
  const bootstrap=()=>({actor,employees:[{name:'REVIEW EMPLOYEE',employeeNo:'TEST-1',status:'Active',role:'User',companyId:'C1'}],records:{companies:[{id:'C1',title:'Test Company',code:'SQ',status:'Active'}],departments:[],training,claims:[],bookings:[],leave:[],resources:[]},teamLeave:[],audit:[]});
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.Blob=Blob;
  w.URL.createObjectURL=b=>{blob=b;return 'blob:review';};w.URL.revokeObjectURL=()=>{};
  const anchorClick=w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click=function(){if(!this.download)anchorClick.call(this);};
  w.fetch=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push(request);
    const {action}=request;let data={};let response;
    if(action==='login') response={status:'success',sessionToken:'review-token',user:actor};
    else if(action==='getStaffDossier') response={status:'error',message:'Synthetic dossier service unavailable'};
    else if(action==='whoami') response={status:'success',user:actor};
    else {
      if(action==='hrBootstrap') {data=bootstrap();if(holdBootstrap) await new Promise(r=>releaseBootstrap=r);}
      if(action==='getBootstrap') data={staff:{status:'success',data:{}},holidays:{status:'success',data:[]},data:{status:'success',data:[]},attendance:{status:'success',data:[]},lockedMonths:{status:'success',data:{}},leaves:{status:'success',data:[]}};
      if(action==='getLeaveData'||action==='getPayroll')data=[];
      response={status:'success',data};
    }
    return {ok:true,text:async()=>JSON.stringify(response)};
  };
  const q=s=>w.document.querySelector(s);
  try {
    w.eval(compiledCode);
    await waitFor(()=>q('#loginUser'),'login must mount without setup errors');
    q('#loginUser').value='review';q('#loginPass').value='test';q('#btnLogin').click();
    await waitFor(()=>q('[data-hr-module="training"][data-scope="all"]'),'authorized navigation appears');
    await waitFor(()=>calls.some(c=>c.action==='getBootstrap'),'desktop attendance bootstrap starts');
    await new Promise(r=>setTimeout(r,30));
    assert.equal(calls.filter(c=>c.action==='hrBootstrap').length,1,'desktop overview shares one bootstrap and does not start mobile scope');
    q('[data-hr-module="training"][data-scope="all"]').click();
    await waitFor(()=>q('#hr-workspace nav[aria-label="Record pages"]'),'paginated records appear');
    const cards=()=>w.document.querySelectorAll('#hr-workspace article.hr-record');
    assert.equal(cards().length,50,'first page bounds rendered records');
    const pageNav=()=>q('#hr-workspace nav[aria-label="Record pages"]');
    pageNav().lastElementChild.click();await waitFor(()=>pageNav().textContent.includes('Page 2'),'next page responds');
    assert.equal(cards().length,50);
    pageNav().lastElementChild.click();await waitFor(()=>pageNav().textContent.includes('Page 3'),'last page responds');assert.equal(cards().length,20);
    const search=q('#hrSearch');search.value='Course 119';search.dispatchEvent(new w.Event('input',{bubbles:true}));
    await waitFor(()=>cards().length===1,'filter resets page');assert.match(cards()[0].textContent,/Course 119/);
    search.value='DO_NOT_INDEX_ATTACHMENT';search.dispatchEvent(new w.Event('input',{bubbles:true}));await waitFor(()=>cards().length===0,'attachment binary data is excluded from search');
    search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));await waitFor(()=>cards().length===50,'clear filter restores first page');
    [...q('#hr-workspace').querySelectorAll('button')].find(b=>b.textContent.trim()==='CSV').click();
    assert.ok(blob,'CSV creates downloadable content');const csv=await blob.text();assert.equal((csv.match(/Course \d+/g)||[]).length,120,'export includes every filtered record, not only visible page');
    w.openStaffDossier('REVIEW EMPLOYEE');
    await waitFor(()=>calls.some(c=>c.action==='getStaffDossier'),'lazy dossier loads on first open');
    holdBootstrap=true;const pending=w.initializeApp();await waitFor(()=>releaseBootstrap,'delayed initialization is in flight');
    w.logout();releaseBootstrap();await pending;
    assert.equal(w.currentUser,null,'logout clears legacy identity');
    assert.deepEqual(Object.keys(w.staffSettings),[],'logout clears legacy personnel records');
    assert.equal(q('#refreshSystemBtn').disabled,false,'late response releases refresh busy state');
    assert.deepEqual(errors,[],'no Vue setup/runtime errors');
    console.log('PASS: compiled Vue mount/login, single desktop bootstrap, 120-record pagination/search/full export, attachment exclusion, logout during delayed load.');
  } catch(error) { console.error('UI diagnostic',JSON.stringify({errors,calls:calls.map(c=>[c.action,c.payload]),text:q('#hr-workspace')?.textContent?.slice(-2500)})); throw error; } finally {dom.window.close();}
})().then(()=>{try{require('esbuild').stop();}catch(_){}process.exit(0);}).catch(error=>{console.error(error);process.exit(1);});
