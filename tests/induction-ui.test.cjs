const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const bundle=fs.readdirSync('dist/assets').find(name=>/^index-[^.]+\.js$/.test(name));
assert.ok(bundle,'Build the app before running the induction UI test.');
const code=fs.readFileSync('dist/assets/'+bundle,'utf8').replace(/export\s*\{[^}]*\};?\s*$/,'');
const wait=()=>new Promise(resolve=>setTimeout(resolve,450));

(async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://test.web.app/',runScripts:'dangerously',pretendToBeVisual:true});
 const w=dom.window,calls=[],errors=[],user={name:'TEST HR',role:'Admin'};
 const records={claimTypes:['Medical','Mileage','Outstation Meals'].map(title=>({id:title,code:title.toUpperCase(),title,availability:'Active',status:'Active'}))};
 w.addEventListener('error',event=>errors.push(event.message));
 w.ResizeObserver=class{observe(){}disconnect(){}};
 w.fetch=async(url,options)=>{
  const {action,payload}=JSON.parse(options.body);calls.push({action,payload});let data=[];
  if(action==='hrBootstrap')data={actor:user,records,employees:[{...user,status:'Active'}],audit:[]};
  if(action==='getStaff')data={};
  if(action==='getBootstrap')data={staff:{status:'success',data:{}},holidays:{status:'success',data:[]},data:{status:'success',data:[]},attendance:{status:'success',data:[]},lockedMonths:{status:'success',data:{}},leaves:{status:'success',data:[]}};
  return {json:async()=>action==='login'?{status:'success',user,sessionToken:'mock'}:{status:'success',data}};
 };
 const q=selector=>w.document.querySelector(selector);
 const set=(selector,value)=>{const field=q(selector);assert.ok(field,selector+' exists');field.value=value;field.dispatchEvent(new w.Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));};
 const open=async(module,scope='all')=>{const link=q(`[data-hr-module="${module}"][data-scope="${scope}"]`);assert.ok(link,module+' navigation exists');link.click();await wait();};
 const create=async()=>{q('.hr-section-title .btn-primary').click();await wait();assert.ok(q('#hrRecordDialog'));};
 const visibleFields=keys=>keys.forEach(key=>assert.ok(q('#hr-'+key),key+' is shown'));
 const absentFields=keys=>keys.forEach(key=>assert.equal(q('#hr-'+key),null,key+' is hidden'));
 try {
  w.eval('"use strict";\n'+code);await wait();
  set('#loginUser','test');set('#loginPass','password');q('#btnLogin').click();await wait();
  await open('companies');
  const guide=[...w.document.querySelectorAll('#hr-workspace details')].find(item=>/July 2025 induction policy/.test(item.querySelector('summary')?.textContent||''));
  assert.ok(guide,'Companies offers the induction policy guide');
  guide.querySelector('summary').click();assert.equal(guide.open,true,'Policy guide expands');
  assert.doesNotMatch(guide.textContent,/Setup targets|FAM-23\/G, pages|HR must link each job title/);
  assert.match(guide.textContent,/1,500/);assert.match(guide.textContent,/RM0\.50\/km/);
  await create();assert.equal(q('#hr-inductionPolicy').value,'','New companies have no policy selected');
  assert.equal(q('#hr-inductionPolicy').selectedOptions[0].textContent,'No induction policy');
  set('#hr-code','TESTCO');set('#hr-title','Test Company');set('#hr-inductionPolicy','FAM-23/G Jul 2025');
  await wait();
  assert.ok(q('#hrRecordDialog form').checkValidity(),[...q('#hrRecordDialog form').elements].filter(field=>field.validity&&!field.validity.valid).map(field=>field.id+': '+field.validationMessage).join('; '));
  q('#hrRecordDialog form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();
  const saved=calls.filter(call=>call.action==='hrSave').at(-1);
  assert.equal(saved?.payload.module,'companies');
  assert.equal(saved.payload.record.inductionPolicy,'FAM-23/G Jul 2025','Selected policy reaches the backend request');
  assert.equal(q('#hrRecordDialog'),null,'Successful save closes the dialog');
  await create();assert.equal(q('#hr-inductionPolicy').value,'','A subsequent company does not inherit the previous selection');
  q('#hrRecordDialog .btn-close').click();await wait();
  await open('claims','personal');
  assert.match(q('#hr-workspace').textContent,/July 2025 induction policy/,'Claims includes the policy guide');
  await create();set('#hr-category','Mileage');await wait();
  visibleFields(['personalVehicle','vehicleType','distanceKm','tripAuthorisation']);
  absentFields(['mealType','mealProvided','returnDistanceKm']);
  set('#hr-category','Outstation Meals');await wait();
  visibleFields(['mealType','mealProvided','returnDistanceKm','tripAuthorisation']);
  absentFields(['personalVehicle','vehicleType','distanceKm']);
  set('#hr-category','Medical');await wait();
  absentFields(['personalVehicle','vehicleType','distanceKm','mealType','mealProvided','returnDistanceKm','tripAuthorisation']);
  assert.deepEqual(errors,[],'No browser runtime errors');
  console.log('PASS: company policy defaults and submission, visible induction guide, and category-specific mileage/meal claim fields.');
 } finally {w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

