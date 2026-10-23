'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'ui/app.js'),'utf8');
const code=app.slice(app.indexOf('function cancelTouchResponse('),app.indexOf('function bindEvents('));
function fixture() {
  const calls=[],pending=[];
  const context=vm.createContext({speechActive:true,touchPlayback:{id:'old'},voiceRecorder:null,foreignRecording:false,
    voiceConversation:null,microphoneStarting:false,state:{jobs:new Map()},publishAssistantState(){},
    stopSpeaking(){calls.push('stop');context.touchPlayback=null;context.speechActive=false;},
    finishTouch(id,busy){calls.push({id,busy});if(context.touchPlayback?.id===id)context.touchPlayback=null;},
    speakText(text){calls.push(text);return new Promise(resolve=>pending.push(resolve));}});
  vm.runInContext(code,context);return {context,calls,pending};
}
test('another single touch replaces touch speech while stale completion cannot clear the new line',async()=>{
  const f=fixture(),a=f.context.playTouchResponse({id:'new',text:'next'});
  assert.deepEqual(f.calls,['stop','next']);assert.equal(f.context.touchPlayback.id,'new');
  const b=f.context.playTouchResponse({id:'newest',text:'another'});
  assert.equal(f.context.touchPlayback.id,'newest');
  f.pending[0]();await a;assert.equal(f.context.touchPlayback.id,'newest');
  f.pending[1]();await b;assert.equal(f.context.touchPlayback,null);
});
test('touch does not interrupt an actual reply or active recording',async()=>{
  const f=fixture();f.context.touchPlayback=null;
  await f.context.playTouchResponse({id:'new',text:'next'});
  assert.deepEqual(f.calls,[{id:'new',busy:true}]);
});
test('disabling touch stops only touch audio, including after the native pending id ended',()=>{
  const f=fixture();f.context.cancelTouchResponse({phase:'cancel'});assert.deepEqual(f.calls,['stop']);
  f.context.cancelTouchResponse({phase:'cancel'});assert.deepEqual(f.calls,['stop']);
  f.context.touchPlayback={id:'new'};f.context.cancelTouchResponse({phase:'cancel',id:'old'});assert.equal(f.calls.length,1);
});
