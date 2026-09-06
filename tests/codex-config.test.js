'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {merge}=require('../scripts/merge-codex-hooks');
const group=command=>({matcher:'^apply_patch$',hooks:[{type:'command',command,timeout:10}]});
test('integration retains existing restrictions and unrelated events, without mutating inputs',()=>{
  const a={description:'user owned',hooks:{PreToolUse:[group('node deny.js')],Stop:[{hooks:[{type:'command',command:'node notify.js'}]}]}};
  const original=JSON.stringify(a),b={hooks:{PreToolUse:[group('node workflow.js')]}};
  const result=merge(a,b);
  assert.equal(JSON.stringify(a),original);
  assert.deepEqual(result.hooks.Stop,a.hooks.Stop);
  assert.equal(result.description,a.description);
  assert.deepEqual(result.hooks.PreToolUse,[group('node deny.js'),group('node workflow.js')]);
});
test('reapplying the same proposal is idempotent',()=>{
  const proposal={hooks:{PreToolUse:[group('node workflow.js')]}};
  const once=merge({},proposal);assert.deepEqual(merge(once,proposal),once);
});
test('metadata conflicts and malformed definitions require resolution',()=>{
  assert.throws(()=>merge({description:'existing'},{description:'new'}),/Conflicting/);
  assert.throws(()=>merge({hooks:{PreToolUse:'deny'}},{}),/array/);
  assert.throws(()=>merge({}, {hooks:{PreToolUse:[{}]}}),/Invalid/);
});
test('untrusted keys cannot pollute the output prototype',()=>{
  assert.throws(()=>merge({},JSON.parse('{"hooks":{"__proto__":[]}}')),/Invalid event/);
  assert.equal({}.polluted,undefined);
});
