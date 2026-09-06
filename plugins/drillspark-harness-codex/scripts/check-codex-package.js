#!/usr/bin/env node
'use strict';
// Portable structural check. This is not evidence of installation or host hook execution.
const fs=require('fs'),path=require('path');
function check(root) {
  root=path.resolve(root);
  const errors=[];
  const need=p=>{if(!fs.existsSync(path.join(root,p)))errors.push('Missing '+p);};
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'.codex-plugin/plugin.json'),'utf8'));
  if(manifest.name!==path.basename(root))errors.push('Manifest name must match folder');
  if(manifest.skills!=='./skills/')errors.push('Unexpected skills location');
  const names=['process-improve','process-improve-view','harness-implement','harness-compose','harness-improve','harness-visualize'];
  for(const name of names) {
    const file='skills/'+name+'/SKILL.md';need(file);
    if(fs.existsSync(path.join(root,file))) {
      const body=fs.readFileSync(path.join(root,file),'utf8');
      if(!body.startsWith('---\nname: '+name+'\n'))errors.push('Bad skill frontmatter: '+name);
      if(/^allowed-tools:/m.test(body))errors.push('Claude tool allowlist leaked into '+name);
    }
  }
  for(const name of ['harness-asis-reviewer','harness-design-reviewer','harness-evaluator','process-expert','process-improve-reviewer'])need('agents/'+name+'.md');
  for(const name of ['runtime.md','MAPPING.md','workflow-contract.md','drillspark-setup.md','harness-design-criteria.md','business-improvement-tables.md','business-improvement-criteria.md','visualization-map.md'])need('reference/'+name);
  const hooks=JSON.parse(fs.readFileSync(path.join(root,'hooks/hooks.json'),'utf8'));
  const groups=hooks.hooks.PreToolUse;
  for(const tool of ['apply_patch','Bash','mcp__drillspark__update_diagram']) {
    if(!groups.some(g=>new RegExp(g.matcher).test(tool)))errors.push('Missing matcher for '+tool);
  }
  for(const group of groups)for(const hook of group.hooks) {
    const match=/^node "\$\{PLUGIN_ROOT\}\/(scripts\/[\w-]+\.js)"$/.exec(hook.command);
    if(!match)errors.push('Unsupported hook command');else need(match[1]);
  }
  function links(dir) {
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()){links(file);continue;}
      if(!file.endsWith('.md'))continue;
      const text=fs.readFileSync(file,'utf8');
      for(const [,target] of text.matchAll(/\]\(([^)]+)\)/g)) {
        if(/^(https?:|#|<)/.test(target)||target.includes('<'))continue;
        const local=target.split('#')[0];
        if(!local)continue;
        const resolved=path.resolve(path.dirname(file),local);
        if(!resolved.startsWith(root+path.sep)||!fs.existsSync(resolved))errors.push('Broken package link '+path.relative(root,file)+' -> '+target);
      }
    }
  }
  for(const dir of ['skills','agents','reference'])links(path.join(root,dir));
  if(errors.length)throw Error(errors.join('\n'));
  return names.length;
}
if(require.main===module){try{console.log('Package structure OK: '+check(process.argv[2]||path.resolve(__dirname,'..'))+' skills. Host activation not checked.');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={check};
