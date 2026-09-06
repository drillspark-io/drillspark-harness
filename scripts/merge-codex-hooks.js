#!/usr/bin/env node
'use strict';
// Preview-only merger for generated project hooks. Never writes config or trusts hooks.
const fs=require('fs');
function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function validate(value) {
  if(!value || typeof value!=='object'||Array.isArray(value))throw Error('Hook config must be an object');
  if(value.hooks===undefined)return;
  if(!value.hooks||typeof value.hooks!=='object'||Array.isArray(value.hooks))throw Error('hooks must be an event map');
  for(const [event,groups]of Object.entries(value.hooks)) {
    if(!Array.isArray(groups))throw Error(event+' must be an array');
    for(const group of groups)if(!group||!Array.isArray(group.hooks)||!group.hooks.length)throw Error('Invalid matcher group: '+event);
  }
}
function merge(existing,proposal) {
  validate(existing);validate(proposal);
  const output=JSON.parse(JSON.stringify(existing));
  for(const [key,value]of Object.entries(proposal)) {
    if(key==='__proto__'||key==='constructor'||key==='prototype')throw Error('Invalid metadata key');
    if(key==='hooks')continue;
    if(Object.hasOwn(output,key) && canonical(output[key])!==canonical(value))throw Error('Conflicting metadata: '+key);
    output[key]=value;
  }
  output.hooks=output.hooks||{};
  for(const [event,groups]of Object.entries(proposal.hooks||{})) {
    if(['__proto__','constructor','prototype'].includes(event))throw Error('Invalid event name');
    const previous=output.hooks[event]||[];
    const seen=new Set(previous.map(canonical));
    for(const group of groups)if(!seen.has(canonical(group))){previous.push(group);seen.add(canonical(group));}
    output.hooks[event]=previous;
  }
  return output;
}
if(require.main===module) {
  try {
    const [existing,proposal]=process.argv.slice(2);
    if(!existing||!proposal)throw Error('Usage: node merge-codex-hooks.js <existing.json|-> <proposal.json> (prints preview only)');
    const a=existing==='-'?{}:JSON.parse(fs.readFileSync(existing,'utf8'));
    console.log(JSON.stringify(merge(a,JSON.parse(fs.readFileSync(proposal,'utf8'))),null,2));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={merge};
