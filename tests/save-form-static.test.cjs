const fs=require('fs');const assert=require('assert');const s=fs.readFileSync('src/components/HrWorkspace.vue','utf8');const style=fs.readFileSync('src/styles/hr.css','utf8');
const checks=[
['manual validation is invoked before saving',/if\(!validateRecordForm\(\)\)return;/.test(s)],
['native validation cannot silently suppress save',s.includes('<form novalidate @submit.prevent="save"')],
['invalid field has visible explanation',s.includes('hr-field-error')],
['save cannot be double-clicked',s.includes('if(saving.value||!editor.value)return;')],
['save response handled before refresh',/notice\.value=spec\.value\?\.self[\s\S]*?void load\(true\)/.test(s)],
['submit timeout informs uncertain outcome',s.includes('The server has not confirmed the request yet.')],
['modal teleported to body',s.includes('<Teleport to="body">')&&s.includes('</Teleport>')],
['mobile modal constrained to viewport',style.includes('width:calc(100vw - 20px)')]
];for(const [n,ok] of checks){assert(ok,n);console.log('PASS',n)}
