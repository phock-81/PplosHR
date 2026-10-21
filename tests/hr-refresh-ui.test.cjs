const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict');
const bundle=fs.readdirSync('dist/assets').find(n=>/^index-[^.]+\.js$/.test(n));
const code=fs.readFileSync('dist/assets/'+bundle,'utf8').replace(/export\s*\{[^}]*\};?\s*$/,'');
const wait=()=>new Promise(r=>setTimeout(r,80));
(async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://test.web.app/',runScripts:'dangerously',pretendToBeVisual:true}),w=dom.window;
 let pending=null,hold=false;const actor={name:'HR TEST',role:'HR'};
 w.ResizeObserver=class{observe(){}disconnect(){}};
 w.fetch=async(url,options)=>{const {action}=JSON.parse(options.body);let data={};
  if(action==='getBootstrap')data={staff:{status:'success',data:{}},holidays:{status:'success',data:[]},data:{status:'success',data:[]},attendance:{status:'success',data:[]},lockedMonths:{status:'success',data:{}},leaves:{status:'success',data:[]}};
  if(action==='hrBootstrap'){data={actor,employees:[],audit:[],records:{companies:[{id:'C1',title:'Visible company',code:'C',status:'Active'}]}};if(hold)await new Promise(r=>pending=r);}
  return {json:async()=>action==='login'?{status:'success',user:actor,sessionToken:'hr-test'}:{status:'success',data}};
 };
 const q=s=>w.document.querySelector(s);
 try{
 w.eval(code);await wait();q('#loginUser').value='hr';q('#loginPass').value='password';q('#btnLogin').click();await wait();
 q('[data-hr-module="companies"][data-scope="all"]').click();await wait();
 assert.match(q('#hr-workspace').textContent,/Visible company/);
 hold=true;q('.hr-heading button').click();await wait();
 assert.match(q('#hr-workspace').textContent,/Visible company/,'same-scope refresh retains content');
 assert.equal(q('.hr-panel').getAttribute('aria-busy'),'true');assert.match(q('#hr-workspace').textContent,/Refreshing records/);
 pending();await wait();assert.equal(q('.hr-panel').getAttribute('aria-busy'),'false');
 q('[data-hr-module="claims"][data-scope="personal"]').click();await wait();
 assert.doesNotMatch(q('#hr-workspace').textContent,/Visible company/,'scope switch clears prior records');
 w.dispatchEvent(new w.CustomEvent('hr-session',{detail:null}));pending();await wait();
 assert.doesNotMatch(q('#hr-workspace').textContent,/Visible company/,'late reply cannot restore prior session');
 console.log('PASS: HR refresh retains current content, scopes clear, and late replies cannot restore a signed-out session.');
 }finally{dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
