'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'ui/app.js'),'utf8');
function fixture(failAck=false){
 const calls=[];const context=vm.createContext({speechGeneration:1,speechStartBarrier:Promise.resolve(),state:{voice:{}},Date,Uint8Array,atob,delay:async()=>{},voiceAudioContext:{decodeAudioData:async()=>({duration:.1})},rpc:async(action,payload)=>{calls.push({action,payload:structuredClone(payload)});if(action==='voice.start')return{id:'fixture'};if(payload.after===2){if(failAck)throw new Error('offline cleanup');return{done:true,chunks:[]};}return{done:true,chunks:[{seq:1,mime_type:'audio/wav',audio_base64:'AA=='},{seq:2,mime_type:'audio/wav',audio_base64:'AQ=='}]};}});
 vm.runInContext(source.slice(source.indexOf('async function* streamSpeechAudio('),source.indexOf('function beginSpeech(')),context);return{context,calls};
}
test('the last decoded batch is acknowledged even when done arrives with audio',async()=>{
 const f=fixture(),chunks=[];for await(const chunk of f.context.streamSpeechAudio('fixture',1))chunks.push(chunk);
 assert.equal(chunks.length,2);assert.deepEqual(f.calls.map(c=>[c.action,c.payload.after]),[['voice.start',undefined],['voice.poll',0],['voice.poll',2]]);
});
test('failed final cleanup does not discard the successfully received audio',async()=>{
 const f=fixture(true),chunks=[];for await(const chunk of f.context.streamSpeechAudio('fixture',1))chunks.push(chunk);assert.equal(chunks.length,2);
});
test('a cancelled generation stops decoding without asking for a later batch',async()=>{
 const f=fixture(),iterator=f.context.streamSpeechAudio('fixture',1);assert.equal((await iterator.next()).done,false);f.context.speechGeneration=2;assert.equal((await iterator.next()).done,true);assert.equal(f.calls.filter(c=>c.action==='voice.poll').length,1);
});
