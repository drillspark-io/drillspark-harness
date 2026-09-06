'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
const {files}=require('../scripts/build-codex-plugin');
const {check}=require('../scripts/check-codex-package');
const ROOT=path.resolve(__dirname,'..'), PACKAGE=path.join(ROOT,'plugins/drillspark-harness-codex');
function relocated(fn) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'drillspark-package-'));
  const target=path.join(temp,'drillspark-harness-codex');
  fs.cpSync(PACKAGE,target,{recursive:true});
  try{fn(target,temp);}finally{const resolved=fs.realpathSync(temp);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});}
}
test('all generated files match source and regeneration is deterministic',()=>{
  const a=files(),b=files();assert.deepEqual(a,b);
  for(const [name,data]of a)assert.ok(fs.readFileSync(path.join(PACKAGE,name)).equals(data),'Stale output: '+name);
});
test('shared runtime scripts are byte-identical in both distributions',()=>{
  for(const [name,data]of files())if(name.startsWith('scripts/'))assert.ok(data.equals(fs.readFileSync(path.join(ROOT,name))),name);
});
test('package is self-contained after relocation, including executable hook commands',()=>relocated((target,temp)=>{
  assert.equal(check(target),6);
  const hooks=JSON.parse(fs.readFileSync(path.join(target,'hooks/hooks.json'),'utf8'));
  for(const group of hooks.hooks.PreToolUse)for(const hook of group.hooks) {
    const script=hook.command.match(/scripts\/([\w-]+\.js)/)[1];
    const result=spawnSync(process.execPath,[path.join(target,'scripts',script)],{cwd:temp,encoding:'utf8',input:JSON.stringify({cwd:temp,tool_name:'apply_patch',tool_input:{command:'*** Begin Patch\n*** Add File: okay.txt\n+hello\n*** End Patch'}})});
    assert.equal(result.status,0,result.stderr);assert.equal(fs.existsSync(path.join(temp,'okay.txt')),false);
  }
}));
test('missing shared reference is detected before installation',()=>relocated(target=>{
  const file=path.join(target,'reference/workflow-contract.md');fs.unlinkSync(file);
  assert.throws(()=>check(target),/Missing reference\/workflow-contract|Broken package link/);
}));
test('missing or incorrectly matched hooks are rejected',()=>relocated(target=>{
  const file=path.join(target,'hooks/hooks.json'),hooks=JSON.parse(fs.readFileSync(file,'utf8'));
  hooks.hooks.PreToolUse[0].matcher='^Write$';fs.writeFileSync(file,JSON.stringify(hooks));
  assert.throws(()=>check(target),/Missing matcher for apply_patch/);
}));
test('diagram/view builder works from relocated package using external workspace inputs',()=>relocated((target,temp)=>{
  const dir=path.join(temp,'docs/harness/demo/可視化');fs.mkdirSync(dir,{recursive:true});
  const map=path.join(dir,'demo.map.json');
  const input=JSON.parse(fs.readFileSync(path.join(__dirname,'ok-build-minimal.map.json'),'utf8'));
  input.excerpts=[];
  input.harnessMap.shared=[{part:'hook',where:'.codex/hooks.json',cols:['検査']}];
  for(const node of Object.values(input.nodes))node.file='—';
  fs.writeFileSync(map,JSON.stringify(input));
  fs.copyFileSync(path.join(__dirname,'ok-build-minimal.diagrams.json'),path.join(dir,'demo.diagrams.json'));
  const result=spawnSync(process.execPath,[path.join(target,'scripts/harness-view-build.js'),map],{cwd:temp,encoding:'utf8',env:{...process.env,DRILLSPARK_HARNESS_GUARDS:''}});
  assert.equal(result.status,0,result.stderr);
  const html=fs.readFileSync(path.join(dir,'demo.html'),'utf8');
  assert.match(html,/data-node-id/);assert.match(html,/設計のみ/);
}));
