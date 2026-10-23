'use strict';
// Launch the actual bundled application with independent test data. No model,
// microphone recording, external account or personal workspace is used.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function bundleSnapshot(root) {
  const result=[];
  function scan(directory){for(const name of fs.readdirSync(directory).sort()){
    const file=path.join(directory,name),info=fs.lstatSync(file),relative=path.relative(root,file);
    if(info.isSymbolicLink())result.push([relative,'link',fs.readlinkSync(file)]);
    else if(info.isDirectory())scan(file);
    else result.push([relative,info.size,info.mtimeMs]);
  }}
  scan(root);return JSON.stringify(result);
}

class CDP {
  constructor(socket) { this.socket=socket;this.next=0;this.pending=new Map();this.errors=[];
    socket.addEventListener('message', event=>{const value=JSON.parse(event.data);
      if(value.method==='Runtime.exceptionThrown')this.errors.push(value.params.exceptionDetails.text);
      const entry=this.pending.get(value.id);if(entry){clearTimeout(entry.timer);this.pending.delete(value.id);value.error?entry.reject(new Error(value.error.message)):entry.resolve(value.result);}
    });
  }
  call(method,params={}) {const id=++this.next;return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout: '+method));},30000);
    this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));
  });}
  async evaluate(expression) {const value=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);
    return value.result.value;
  }
  close(){for(const item of this.pending.values())clearTimeout(item.timer);this.pending.clear();this.socket.close();}
}

async function connect(url){const socket=new WebSocket(url);await new Promise((resolve,reject)=>{
  socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});
});const client=new CDP(socket);await client.call('Runtime.enable');return client;}

async function nativeVisibility(data, visible) {
  const started=Date.now(),file=path.join(data,'native-verification.json');
  while(Date.now()-started<5000) {
    try {
      const events=JSON.parse(fs.readFileSync(file,'utf8')).events;
      const state=events.filter(item=>['main-shown','main-hidden'].includes(item.event)).at(-1);
      if(state&&state.visible===visible&&state.renderer_alive&&state.backend_alive) return true;
    } catch {}
    await sleep(50);
  }
  return false;
}

async function main(){
  assert.equal(process.platform,'darwin','Use the macOS CI runner or a Mac');
  const application=path.resolve(process.argv[2]);
  const output=path.resolve(process.argv[3]||path.join(path.dirname(application),'smoke-report.json'));
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'laurentina-app-smoke-'));
  const coreData=path.join(data,'Core'),memoryData=path.join(data,'HyMemory');
  const bundleBefore=bundleSnapshot(application);
  const env={...process.env,LAURENTINA_CORE_DATA:coreData,LAURENTINA_MEMORY_DATA:memoryData,LAURENTINA_NATIVE_VERIFY:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  for(const key of ['LAURENTINA_CORE_HOME','LAURENTINA_MEMORY_HOME','LAURENTINA_CORE_PYTHON','LAURENTINA_MEMORY_PYTHON'])delete env[key];
  const child=spawn(path.join(application,'Contents/MacOS/Electron'),['--remote-debugging-port=0'],{env,detached:true,stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',value=>{stderr=(stderr+value.toString()).slice(-12000);});
  const report={ok:false,platform:process.platform,arch:process.arch,checks:{},models_downloaded:false};
  let client;
  try{
    const started=Date.now(),portFile=path.join(coreData,'desktop/DevToolsActivePort');let target;
    while(Date.now()-started<65000){
      if(child.exitCode!==null)throw new Error('Packaged app exited during startup');
      if(fs.existsSync(portFile)){
        const port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);
        try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();target=list.find(item=>item.url==='laurentina://app/index.html');}catch{}
        if(target)break;
      }
      await sleep(200);
    }
    assert.ok(target,'Packaged desktop did not become ready');
    client=await connect(target.webSocketDebuggerUrl);
    const checks=await client.evaluate(`(async()=>{
      const started=Date.now();while(!window.laurentina||!document.getElementById('startup-overlay')?.hidden){
        if(Date.now()-started>22000)throw new Error('UI bootstrap timeout');await new Promise(resolve=>setTimeout(resolve,100));
      }
      const api=window.laurentina,boot=await api.request('bootstrap');
      const conv=await api.request('conversation.create',{mode:'daily'});
      const fetched=await api.request('conversation.get',{id:conv.id});
      await api.request('conversation.set_mode',{id:conv.id,mode:'private'});
      const privateMode=await api.request('conversation.get',{id:conv.id});
      await api.request('conversation.delete',{id:conv.id});
      return {version:api.version,ui_ready:document.getElementById('startup-overlay').hidden,
        initially_empty:boot.conversations.length===0,conversation_roundtrip:fetched.conversation.id===conv.id,
        private_mode:privateMode.conversation.mode==='private'};
    })()`);
    assert.equal(await nativeVisibility(coreData,true),true,'initial native window visibility');
    await client.evaluate("window.laurentina.request('window.close')");
    // Background audio intentionally disables throttling, so document.hidden
    // stays false even for a hidden window. Read actual BrowserWindow events.
    checks.hidden_after_close=await nativeVisibility(coreData,false);
    await client.evaluate("window.laurentina.request('window.main')");
    checks.reopened=await nativeVisibility(coreData,true);
    Object.assign(report.checks,checks);
    for(const key of ['ui_ready','initially_empty','conversation_roundtrip','private_mode','hidden_after_close','reopened'])assert.equal(checks[key],true,key);
    report.checks.external_data=fs.existsSync(path.join(coreData,'desktop'))&&!fs.existsSync(path.join(application,'Contents/Resources/app/.local'));
    assert.equal(report.checks.external_data,true);
    report.checks.memory_external_data=fs.existsSync(path.join(memoryData,'config.dpapi'))&&!fs.existsSync(path.join(application,'Contents/Resources/hy-memory-starter/.local'));
    assert.equal(report.checks.memory_external_data,true);
    report.renderer_errors=client.errors;assert.deepEqual(client.errors,[]);
    const screenshot=await client.call('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(output.replace(/\.json$/,'.png'),Buffer.from(screenshot.data,'base64'));
    report.ok=true;
  }catch(error){report.error=error.message;report.startup_diagnostics=stderr.slice(-5000);throw error;}
  finally{
    if(client)client.close();
    try{process.kill(-child.pid,'SIGTERM');}catch{}
    await sleep(1000);try{process.kill(-child.pid,'SIGKILL');}catch{}
    report.checks.bundle_unchanged=bundleSnapshot(application)===bundleBefore;
    const verified=spawnSync('codesign',['--verify','--deep','--strict',application],{encoding:'utf8'});
    report.checks.signature_valid_after_run=verified.status===0;
    if(!report.checks.bundle_unchanged||!report.checks.signature_valid_after_run){
      report.ok=false;report.error=report.error||'Application modified its signed bundle';process.exitCode=1;
    }
    fs.writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
