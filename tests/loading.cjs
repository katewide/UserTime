const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {AsyncLocalStorage}=require('node:async_hooks');
const source=readFileSync(require('node:path').join(__dirname, '../server.js'),'utf8');
let aiCalls=0;
const calls=[];
const mockFetch=async(url,options)=>{
 calls.push(url);
 let body;
 if(url.includes('/chat/completions')) { aiCalls++; throw Error('AI unavailable'); }
 else if(url.includes('/time?')) body={data:[{userId:1,seconds:3600,commentText:'work'}],meta:{total:1}};
 else if(url.includes('/users?')) body={data:[{id:1,name:'Test',departmentId:[2]}]};
 else if(url.includes('/departments?')) body={data:[{id:2,name:'Team'}]};
 else body={data:{title:'Task',checklist:{1:{id:1,title:'Оценка: 2-4 ч.'}}}};
 return {ok:true,status:200,text:async()=>JSON.stringify(body)};
};
const ctx=vm.createContext({AsyncLocalStorage,KEY:'secret',BASE:'https://example.test',console:{info:()=>{}},setTimeout,clearTimeout,AbortController,AbortSignal,URLSearchParams,fetch:mockFetch});
vm.runInContext(source.slice(source.indexOf('const requestContext'),source.indexOf('const server =')),ctx);
(async()=>{
 const report=await vm.runInContext('buildTaskReport(1,"session")',ctx);
 assert.equal(report.totalSeconds,3600);assert.equal(aiCalls,0);assert.equal(report.checklist.gemmaEstimate,null);
 const estimate=await vm.runInContext('calculateGemmaEstimate(["2-4 ч."],"session")',ctx);
 assert.equal(estimate,null);assert.equal(aiCalls,1);
 ctx.fetch=async(url,{signal})=>new Promise((resolve,reject)=>{
  if(signal.aborted) return reject(Object.assign(Error('aborted'),{name:'AbortError'}));
  signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});
 });
 await assert.rejects(vm.runInContext('requestContext.run({id:"test",signal:AbortSignal.timeout(10)},()=>portal("/slow"))',ctx),e=>e.status===504);
 const app=readFileSync(require('node:path').join(__dirname, '../app.js'),'utf8');
 const retry=app.slice(app.indexOf('async function fetchWithStartupRetry'),app.indexOf('function showBudget'));
 let count=0,waits=[];
 const ui=vm.createContext({AbortSignal,setTimeout:(cb,ms)=>{waits.push(ms);cb()},fetch:async()=>{
  count++;return {status:count<3?503:200,headers:{get:()=> '0'},json:async()=>count<3?{error:{code:'BH_APP_STARTING'}}:{ok:true}};
 }});
 vm.runInContext(retry,ui);
 assert.equal((await vm.runInContext('fetchWithStartupRetry("/")',ui)).response.status,200);
 assert.equal(count,3);
 count=0;ui.fetch=async()=>{count++;return {status:503,headers:{get:()=> '0'},json:async()=>({error:{code:'BH_APP_STARTING'}})}};
 await vm.runInContext('fetchWithStartupRetry("/")',ui);assert.equal(count,3);
 count=0;ui.fetch=async()=>{count++;return {status:401,headers:{get:()=> null},json:async()=>({error:{code:'TOKEN_MISSING'}})}};
 await vm.runInContext('fetchWithStartupRetry("/")',ui);assert.equal(count,1);
 count=0;ui.fetch=async()=>{count++;return {status:503,headers:{get:()=> '60'},json:async()=>({error:{code:'BH_APP_STARTING'}})}};
 await vm.runInContext('fetchWithStartupRetry("/")',ui);assert.equal(count,1);
 console.log('PASS: report without AI; AI failure isolated; request deadline; startup recovery; retry limit; no auth retry; long Retry-After respected');
})().catch(e=>{console.error(e);process.exitCode=1});
