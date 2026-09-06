'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {spawnSync}=require('child_process');
const {parsePatch}=require('../scripts/codex-guard');
const ROOT=path.resolve(__dirname,'..');
const script=path.join(ROOT,'scripts/codex-guard.js');
function sandbox(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drillspark-codex-'));
  const put=(file,content)=>{const p=path.join(dir,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content);};
  try{fn(dir,put);}finally{const resolved=fs.realpathSync(dir);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});}
}
const patch=(...lines)=>['*** Begin Patch',...lines,'*** End Patch'].join('\n');
const add=(file,content)=>patch('*** Add File: '+file,...content.trimEnd().split('\n').map(l=>'+'+l));
function run(dir,command,tool='apply_patch',input={},env={}) {
  return spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8',input:JSON.stringify({cwd:dir,tool_name:tool,tool_input:{command,...input}}),env:{...process.env,DRILLSPARK_HARNESS_GUARDS:'',...env},timeout:20000});
}
const ok=(r)=>assert.equal(r.status,0,r.stderr);
const denied=(r,pattern)=>{assert.equal(r.status,2,r.stderr);if(pattern)assert.match(r.stderr,pattern);};
const frozen='docs/harness/demo/処理/記事/合格条件.md';
const freezeText='# 合格条件（凍結） 第1版\n\n| # | 条件 |\n|---|---|\n| 1 | 人が承認する |\n';
const fixture=name=>fs.readFileSync(path.join(__dirname,name),'utf8');

test('ordinary add/update/delete/move and multi-file patches pass without writing files',()=>sandbox((dir,put)=>{
  put('a.txt','alpha\nbeta\ngamma\n');
  ok(run(dir,add('new.txt','hello\n')));assert.equal(fs.existsSync(path.join(dir,'new.txt')),false);
  ok(run(dir,patch('*** Update File: a.txt','@@',' alpha','-beta','+BETA',' gamma')));
  ok(run(dir,patch('*** Update File: a.txt','*** Move to: b.txt','@@','-alpha','+ALPHA',' beta')));
  ok(run(dir,patch('*** Delete File: a.txt','*** Add File: new.txt','+hello')));
  assert.equal(fs.readFileSync(path.join(dir,'a.txt'),'utf8'),'alpha\nbeta\ngamma\n');
}));
test('preview reconstructs multiple hunks, section anchors, EOF insertions and CRLF',()=>sandbox((dir,put)=>{
  put('a.txt','heading\r\none\r\ntwo\r\nthree\r\n');
  const edits=parsePatch(patch('*** Update File: a.txt','@@ heading','-one','+ONE',' two','@@',' three','+four','*** End of File'),dir);
  assert.equal(edits[0].content,'heading\nONE\ntwo\nthree\nfour\n');
}));
test('ambiguous/fuzzy patches and duplicate paths do not claim a checked candidate',()=>sandbox((dir,put)=>{
  put('a.txt','same\nsame\n');
  denied(run(dir,patch('*** Update File: a.txt','@@','-same','+other')),/exactly once/);
  denied(run(dir,patch('*** Add File: b.txt','+a','*** Update File: b.txt','@@','-a','+b')),/one operation/);
  denied(run(dir,patch('*** Update File: a.txt','@@','-missing','+other')),/exactly once/);
  denied(run(dir,'not a patch'),/Begin\/End/);
}));
test('normal whole-file edit keeps the frozen contract',()=>sandbox((dir,put)=>{
  put(frozen,freezeText);
  ok(run(dir,patch('*** Update File: '+frozen,'@@',' # 合格条件（凍結） 第1版','+備考: 入力を説明する')));
}));
for(const [name,change] of [
  ['modify row',['@@','-| 1 | 人が承認する |','+| 1 | AIが承認する |']],
  ['remove row',['@@','-| 1 | 人が承認する |']],
  ['remove freeze',['@@','-# 合格条件（凍結） 第1版','+# 合格条件 第1版']],
  ['add without version',['@@',' | 1 | 人が承認する |','+| 2 | 保存する |']],
])test('frozen contract denies '+name,()=>sandbox((dir,put)=>{put(frozen,freezeText);denied(run(dir,patch('*** Update File: '+frozen,...change)),/harness-freeze-guard/);}));
test('versioned addition to frozen conditions passes',()=>sandbox((dir,put)=>{
  put(frozen,freezeText);
  ok(run(dir,patch('*** Update File: '+frozen,'@@','-# 合格条件（凍結） 第1版','+# 合格条件（凍結） 第2版','@@',' | 1 | 人が承認する |','+| 2 | 保存する |')));
}));
for(const operation of ['Delete','Move'])test(operation+' cannot bypass a protected source',()=>sandbox((dir,put)=>{
  put(frozen,freezeText);
  const p=operation==='Delete'?patch('*** Delete File: '+frozen):patch('*** Update File: '+frozen,'*** Move to: conditions.md','@@','-| 1 | 人が承認する |','+| 1 | AIが承認する |');
  denied(run(dir,p),/Deleting or moving/);
}));
test('new protected destination is checked on rename',()=>sandbox((dir,put)=>{
  put('notes.md','bad\n');
  denied(run(dir,patch('*** Update File: notes.md','*** Move to: 業務改善/業務一覧.md','@@','-bad','+still bad')),/process-write-guard/);
}));
test('Add cannot overwrite an existing protected file',()=>sandbox((dir,put)=>{
  put(frozen,freezeText);denied(run(dir,add(frozen,'anything')),/must not overwrite/);
}));
test('valid inventory passes and invalid inventory blocks all files in the same patch',()=>sandbox((dir)=>{
  ok(run(dir,add('業務改善/業務一覧.md',fixture('ok-table-minimal.md'))));
  denied(run(dir,patch('*** Add File: okay.txt','+okay','*** Add File: 業務改善/業務一覧.md','+invalid')),/process-write-guard/);
  assert.equal(fs.existsSync(path.join(dir,'okay.txt')),false);
}));
test('multi-file inventory updates require a consistent snapshot',()=>sandbox((dir)=>{
  denied(run(dir,patch('*** Add File: 業務改善/業務一覧.md','+x','*** Add File: 業務改善/改善案.md','+y')),/separate patch/);
}));
test('process HTML is validated and may be replaced with valid content',()=>sandbox((dir,put)=>{
  const file='業務改善/改善計画-請求書.html', valid=fixture('ok-plan-minimal.html');
  ok(run(dir,add(file,valid)));
  denied(run(dir,add(file,fixture('ng-plan-missing-block.html'))),/process-write-guard/);
  put(file,valid);
  const lines=valid.trimEnd().split(/\r?\n/);
  ok(run(dir,patch('*** Update File: '+file,'@@',...lines.map(l=>'-'+l),...lines.map(l=>'+'+l))));
}));
test('view creation, correction count, malformed HTML, and upper bound',()=>sandbox((dir,put)=>{
  const file='docs/harness/demo/可視化/view.html';
  const raw=fixture('ok-view-minimal.html').replace(/\r\n/g,'\n');
  const valid=raw.includes('直し:')?raw:raw.replace(/<!doctype html>/i,'<!doctype html>\n<!-- 直し: 0/2 -->');
  ok(run(dir,add(file,valid)));
  put(file,valid);
  denied(run(dir,patch('*** Update File: '+file,'@@','-<!-- 直し: 0/2 -->','+<!-- 直し: 0/2 -->')),/回数欄/);
  ok(run(dir,patch('*** Update File: '+file,'@@','-<!-- 直し: 0/2 -->','+<!-- 直し: 1/2 -->')));
  put(file,valid.replace('直し: 0/2','直し: 2/2'));
  denied(run(dir,patch('*** Update File: '+file,'@@','-<!-- 直し: 2/2 -->','+<!-- 直し: 3/2 -->')),/上限/);
  denied(run(dir,add('docs/harness/demo/可視化/bad.html','<!doctype html>\n<!-- 直し: 0/2 -->\n<html>bad</html>')),/view-lint/);
}));
test('unrelated notes and reading protected files pass',()=>sandbox((dir)=>{
  ok(run(dir,add('業務改善/教訓.md','後で入力を確認する。')));
  ok(run(dir,'cat 業務改善/業務一覧.md','Bash'));
  ok(run(dir,'sed -n "1,10p" '+frozen,'Bash'));
  ok(run(dir,'git status --short','Bash'));
}));
for(const cmd of ['echo x > 業務改善/業務一覧.md','rm '+frozen,'rm -rf docs/harness','Set-Content '+frozen+' x','node -e "writeFileSync(\"'+frozen+'\",\"x\")"'])
  test('known shell bypass denied: '+cmd,()=>sandbox(dir=>denied(run(dir,cmd,'Bash'),/Protected artifacts/)));
test('MCP own-project check is preserved',()=>sandbox((dir,put)=>{
  put('docs/harness/demo/処理/demo/図.md','https://drillspark.io/editor?id=known-project\n');
  ok(run(dir,undefined,'mcp__drillspark__update_diagram',{project_id:'known-project'}));
  denied(run(dir,undefined,'mcp__drillspark__update_diagram',{project_id:'someone-else'}),/process-write-guard/);
}));
test('explicit owner guard-disable remains supported, not enabled by adapter',()=>sandbox((dir,put)=>{
  put(frozen,freezeText);
  ok(run(dir,patch('*** Delete File: '+frozen),'apply_patch',{}, {DRILLSPARK_HARNESS_GUARDS:'off'}));
}));
