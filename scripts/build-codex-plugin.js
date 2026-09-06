#!/usr/bin/env node
'use strict';
// Explicit platform projection, not a recursive copy of a developer checkout.
// Shared policy, criteria, templates and scripts stay in the existing source locations.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'plugins', 'drillspark-harness-codex');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e => {
    const p = path.join(dir,e.name);
    if (e.isSymbolicLink()) throw Error('Symlinks are not distribution inputs: '+p);
    return e.isDirectory() ? walk(p) : [p];
  });
}
function project(text) {
  // Paths/names in prose and examples, never a fabricated permission schema.
  return text.replaceAll('${CLAUDE_PLUGIN_ROOT}', '<plugin-root>')
    .replaceAll('Claude Code', 'Codex')
    .replaceAll('.claude/tests/', 'tests/harness/')
    .replaceAll('.claude/skills/', '.agents/skills/')
    .replaceAll('.claude/hooks/', '.codex/hooks/')
    .replaceAll('CLAUDE.md', 'AGENTS.md')
    .replaceAll('`permissions.ask`', '業務上の承認とCodexの操作許可（対応表を参照）')
    .replaceAll('`Glob`', 'ファイル検索')
    .replaceAll('Read / Grep / Glob', '利用可能な読み取り・検索ツール')
    .replace(/^ToolSearch\(.*\)\n/gm, '// 利用可能なDrillSpark MCPツールを発見してから呼ぶ\n')
    .replaceAll('mcp__drillspark__', '')
    .replaceAll('settings.json', 'hooks.json');
}
function exact(text, from, to) {
  if (!text.includes(from)) throw Error('Shared source changed; review Codex projection: '+from);
  return text.replace(from,to);
}
function files() {
  const output = new Map();
  const set = (file, data) => output.set(file, Buffer.isBuffer(data) ? data : Buffer.from(data));
  const copy = (from, to=from) => set(to,fs.readFileSync(path.join(root,from)));
  const version = JSON.parse(read('.claude-plugin/plugin.json')).version;
  set('.codex-plugin/plugin.json',JSON.stringify({
    name:'drillspark-harness-codex',version:version+'-codex.1',
    description:'Design workflows in DrillSpark, improve human work, and build Codex configuration from approved diagrams. Japanese workflow instructions.',
    author:{name:'DrillSpark'},license:'Apache-2.0',homepage:'https://drillspark.io/',
    repository:'https://github.com/drillspark-io/drillspark-harness',skills:'./skills/',mcpServers:'./.mcp.json',
    interface:{displayName:'DrillSpark Harness — Codex',shortDescription:'業務を図で設計し、Codexの設定にする',longDescription:'業務の棚卸しからDrillSparkでの作図、承認済みの図に基づくCodex設定の生成と独立レビューまでを支援します。',developerName:'DrillSpark',category:'Productivity',
      capabilities:['Read','Write'],defaultPrompt:'DrillSpark Harnessで私の業務を棚卸ししたい。'},
  },null,2)+'\n');
  set('hooks/hooks.json',JSON.stringify({hooks:{PreToolUse:[{
    matcher:'^(apply_patch|Bash)$|^mcp__.*__update_diagram$',
    hooks:[{type:'command',command:'node "${PLUGIN_ROOT}/scripts/codex-guard.js"',timeout:60}],
  }]}},null,2)+'\n');
  for (const file of ['LICENSE','NOTICE']) copy(file);
  const scripts = ['codex-guard','diagram-lint','file-saved-lint','harness-freeze-guard','harness-view-build',
    'harness-view-guard','harness-view-lint','process-abc','process-coverage','process-plan-lint',
    'process-table-lint','process-write-guard','check-codex-package','merge-codex-hooks','prepare-inventory-site'];
  for (const name of scripts) copy('scripts/'+name+'.js');
  for (const name of ['business-improvement-tables.md','business-improvement-criteria.md','workflow-contract.md']) {
    set('reference/'+name, project(read('reference/'+name)));
  }
  let criteria = project(read('reference/harness-design-criteria.md'));
  criteria = exact(criteria,'評価基準は `.claude/rules/` に置く — `AGENTS.md` は実装役が通常運用で編集するので不可',
    '評価基準は所有者が管理する領域に置き、生成役が通常編集しない構成にする。AGENTS.mdへ混ぜない。実際の書込制限を確認する');
  criteria = exact(criteria,'- `claude plugin validate <dir> --strict` が exit 0',
    '- [Codex対応表](MAPPING.md) の形式で構文検査し、新規セッションでスキル/agent/hookの読込と起動を確認済み');
  criteria = exact(criteria,'- `hooks.json` を触ったなら JSON パースが通る',
    '- hooks.jsonはJSON、config.tomlとagent定義はTOMLとしてパースが通る');
  set('reference/harness-design-criteria.md',criteria);
  let template = project(read('reference/設計.md.template'));
  template = template.replaceAll('`hooks.json` の `permissions`','`config.toml` の権限関連設定')
    .replaceAll('止めたとき Claude へ渡す文','止めたときCodexへ渡す文');
  set('reference/設計.md.template',template);
  set('skills/harness-implement/FRONTIER.md',project(read('skills/harness-implement/FRONTIER.md')).replaceAll('](MAPPING.md)','](../../reference/MAPPING.md)'));
  const visual = read('skills/harness-visualize/SKILL.md');
  const start = visual.indexOf('## `map.json` の書き方'), end = visual.indexOf('## 合格条件',start);
  if (start<0 || end<0) throw Error('Visualization schema section not found');
  set('reference/visualization-map.md', project(visual.slice(start,end)).trimEnd()+'\n');
  for (const role of fs.readdirSync(path.join(root,'agents')).filter(f=>f.endsWith('.md'))) {
    let body = project(read('agents/'+role).replace(/^---\n[\s\S]*?\n---\n/,''));
    if (role === 'harness-evaluator.md') {
      const start = body.indexOf('```bash'), end = body.indexOf('```', start+3);
      if(start<0 || end<0) throw Error('Evaluator examples not found');
      body = body.slice(0,start) +
        '生成したJSON/TOMLをそれぞれパーサーに通し、凍結テストをそのまま実行する。\n'+
        'hookは本番操作をせずstdinのJSONで検査する。apply_patchはtool_input.commandにパッチ全文を渡す。\n'+
        '利用者の新規セッションでスキル/agent/MCP/hookの読込と信頼を確認する。\n' + body.slice(end+3);
      body=body.replaceAll('`/hooks` `/skills` `/agents`','ホストのスキル/agent一覧と `/hooks`');
    }
    set('agents/'+role,'<!-- Generated role instructions, explicitly passed to a separate Codex agent. -->\n'+
      '最初に [Codex実行規約](../reference/runtime.md) を読む。親とは別のコンテキストで実行する。\n'+
      'ファイルとMCPは読み取りのみ。指摘を返す。サンドボックスがMCP書込も防ぐとはみなさない。\n\n'+body);
  }
  // Reference policy links to the frozen design records; keep their relative tree intact.
  for(const file of walk(path.join(root,'docs/harness'))) {
    const rel = path.relative(root,file).split(path.sep).join('/');
    copy(rel);
  }
  copy('skills/process-improve/assets/棚卸しシート.html');
  const platform = path.join(root,'platforms/codex');
  for(const file of walk(platform)) {
    const rel = path.relative(platform,file).split(path.sep).join('/');
    copy('platforms/codex/'+rel,rel);
  }
  set('BUILD.json',JSON.stringify({generator:'scripts/build-codex-plugin.js',sourceVersion:version,
    generated:true,files:[...output.keys()].sort()},null,2)+'\n');
  return output;
}
function build(check=false) {
  const output=files(), differences=[];
  for(const [file,data] of output) {
    const target=path.join(dest,file);
    if(!fs.existsSync(target)||!fs.readFileSync(target).equals(data)) {
      differences.push(file);
      if(!check) {fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);}
    }
  }
  const extras=fs.existsSync(dest)?walk(dest).map(f=>path.relative(dest,f).split(path.sep).join('/')).filter(f=>!output.has(f)):[];
  // Never delete unknown user files. Stale output must be reviewed explicitly.
  if(extras.length) throw Error('Unexpected files in generated package: '+extras.join(', '));
  if(check && differences.length) throw Error('Regenerate Codex package: '+differences.join(', '));
  console.log((check?'Checked ':'Generated ')+output.size+' package files');
}
if(require.main===module) {try{build(process.argv.includes('--check'));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build,files};
