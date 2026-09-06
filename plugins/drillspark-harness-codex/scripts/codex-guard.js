#!/usr/bin/env node
'use strict';
// Codex input adapter. Policy stays in the three existing guards; no file is written here.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const guards = ['harness-view-guard.js', 'process-write-guard.js', 'harness-freeze-guard.js'];
function protectedPath(file) {
  const p = file.replace(/\\/g, '/');
  return /(^|\/)業務改善\//.test(p) || /(^|\/)docs\/harness\/.+\/(合格条件\.md|可視化\/.+\.html?)$/i.test(p);
}
function resolveFile(cwd, file) {
  if (!file || file.includes('\0')) throw Error('Invalid patch path');
  const result = path.resolve(cwd, file);
  // The policy uses lexical project paths. Refuse aliases through symlinks for protected edits.
  let cursor = result;
  while (true) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw Error('Patch path traverses a symbolic link; use the real path: ' + file);
    }
    const parent = path.dirname(cursor);
    if (cursor === parent) break;
    cursor = parent;
  }
  return result;
}

// Deliberately strict subset of the documented apply_patch grammar. Unsupported/ambiguous
// patches are rejected before mutation rather than inventing a candidate different from Codex.
function parsePatch(command, cwd) {
  if (typeof command !== 'string') throw Error('apply_patch requires tool_input.command');
  const lines = command.replace(/\r\n/g, '\n').trimEnd().split('\n');
  if (lines[0] !== '*** Begin Patch' || lines[lines.length - 1] !== '*** End Patch') throw Error('Expected Begin/End Patch');
  const edits = [], touched = new Set();
  let i = 1;
  const mark = file => {
    const key = process.platform === 'win32' ? file.toLowerCase() : file;
    if (touched.has(key)) throw Error('Use one operation per path per patch: ' + file);
    touched.add(key);
  };
  while (i < lines.length - 1) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(lines[i++]);
    if (!header) throw Error('Unsupported patch header');
    const [, kind, raw] = header, file = resolveFile(cwd, raw);
    mark(file);
    if (kind === 'Delete') {
      edits.push({file, content: null, kind});
      continue;
    }
    if (kind === 'Add') {
      if (fs.existsSync(file)) throw Error('Add File must not overwrite an existing file: ' + raw);
      const added = [];
      while (i < lines.length - 1 && !lines[i].startsWith('*** ')) {
        if (!lines[i].startsWith('+')) throw Error('Invalid Add File line');
        added.push(lines[i++].slice(1));
      }
      edits.push({file, content: added.length ? added.join('\n') + '\n' : '', kind});
      continue;
    }
    let destination = file;
    if (lines[i]?.startsWith('*** Move to: ')) {
      destination = resolveFile(cwd, lines[i++].slice(13));
      if (destination !== file) {
        mark(destination);
        if (fs.existsSync(destination)) throw Error('Move destination already exists');
      }
    }
    const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const source = original.split('\n');
    if (source[source.length - 1] === '') source.pop();
    const result = [];
    let cursor = 0, hunks = 0;
    while (i < lines.length - 1 && (lines[i] === '@@' || lines[i].startsWith('@@ '))) {
      const section = lines[i++].slice(2).trimStart();
      if (section) {
        const anchor = source.indexOf(section, cursor);
        if (anchor < 0) throw Error('Section anchor does not match exactly');
        result.push(...source.slice(cursor, anchor + 1)); cursor = anchor + 1;
      }
      const before = [], after = [];
      while (i < lines.length - 1 && !lines[i].startsWith('*** ') && !lines[i].startsWith('@@')) {
        const line = lines[i++];
        if (![' ', '+', '-'].includes(line[0])) throw Error('Invalid hunk line');
        if (line[0] !== '+') before.push(line.slice(1));
        if (line[0] !== '-') after.push(line.slice(1));
      }
      const atEnd = lines[i] === '*** End of File';
      if (atEnd) i++;
      const matches = [];
      // An insertion without context is only unambiguous at EOF.
      if (!before.length) {
        if (!atEnd && source.length) throw Error('Insertion requires context or End of File');
        matches.push(source.length);
      } else {
        for (let pos = cursor; pos <= source.length - before.length; pos++) {
          if (atEnd && pos + before.length !== source.length) continue;
          if (before.every((line, n) => source[pos+n] === line)) matches.push(pos);
        }
      }
      if (matches.length !== 1) throw Error('Patch context must match exactly once; add surrounding context');
      const pos = matches[0];
      result.push(...source.slice(cursor, pos), ...after);
      cursor = pos + before.length; hunks++;
    }
    if (!hunks) throw Error('Update File requires a hunk');
    result.push(...source.slice(cursor));
    if (destination !== file) edits.push({file, content: null, kind: 'Move'});
    edits.push({file: destination, content: result.length ? result.join('\n')+'\n' : '', kind});
  }
  return edits;
}

function invoke(input) {
  for (const guard of guards) {
    const result = spawnSync(process.execPath, [path.join(__dirname, guard)], {
      cwd: input.cwd, input: JSON.stringify(input), encoding: 'utf8', timeout: 15000,
    });
    if (result.status !== 0) throw Error((result.stderr || result.stdout || result.error?.message || 'Guard failed').trim());
  }
}
function check(input) {
  if (process.env.DRILLSPARK_HARNESS_GUARDS === 'off') return;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid hook input');
  const cwd = path.resolve(input.cwd || process.cwd());
  if (input.tool_name !== 'apply_patch') {
    if (input.tool_name === 'Bash') {
      const command = String(input.tool_input?.command || '');
      // Shell text is not a complete filesystem policy. Reject known uninspectable writes
      // to protected artifacts; arbitrary helper programs still need sandbox/permission controls.
      const context = (cwd.replace(/\\/g,'/') + '\n' + command.replace(/\\/g,'/'));
      const mentions = /業務改善(?:\/|$)|docs\/harness(?:\/|$)|合格条件\.md|可視化(?:\/|$)/m.test(context);
      const writes = /(?:^|[\s;&|])(?:rm|mv|cp|install|tee|python[\d.]*|py|perl|ruby|php|pwsh|powershell)\b|\bsed\b[^|;&]*\s(?:-i|--in-place)\b|\bnode\s+(?:-e|--eval|-p|--print)\b|\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Rename-Item)\b|\[(?:System\.)?IO\.File\]|(?:^|[\s;&|])\d?>>?(?!&)/i.test(command);
      if (mentions && writes) throw Error('Protected artifacts must be edited with apply_patch so their resulting content can be checked.');
    }
    invoke({...input, cwd});
    return;
  }
  const edits = parsePatch(input.tool_input?.command, cwd);
  // Cross-file table validation reads the existing inventory; avoid checking a mixed snapshot.
  const inventory = edits.filter(e => /(^|[\\/])業務改善[\\/]業務一覧\.md$/.test(e.file));
  if (inventory.length && edits.some(e => !inventory.includes(e) && /(^|[\\/])業務改善[\\/].+\.(md|markdown)$/.test(e.file))) {
    throw Error('Update 業務一覧.md in a separate patch before dependent process tables.');
  }
  for (const edit of edits) {
    if (edit.content === null) {
      if (protectedPath(edit.file)) throw Error('Deleting or moving protected artifacts requires an explicit owner-managed change: ' + edit.file);
      continue;
    }
    invoke({tool_name: 'Write', tool_input: {file_path: edit.file, content: edit.content}, cwd});
  }
}
if (require.main === module) {
  try { check(JSON.parse(fs.readFileSync(0,'utf8'))); }
  catch (error) { process.stderr.write('codex-guard: '+error.message+'\n'); process.exitCode=2; }
}
module.exports = {parsePatch, check};
