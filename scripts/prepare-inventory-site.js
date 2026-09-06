#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const bundled = path.resolve(__dirname, '../skills/process-improve/assets/sites-template');
const template = fs.existsSync(bundled) ? bundled : path.resolve(__dirname, '../platforms/codex/skills/process-improve/assets/sites-template');
function prepare(destination) {
  if (!destination) throw Error('Usage: prepare-inventory-site.js <empty-site-directory>');
  const target = path.resolve(destination);
  if (target === template || target.startsWith(template + path.sep)) throw Error('Choose an external work directory');
  if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isDirectory() || fs.readdirSync(target).length))
    throw Error('Destination must be an empty directory; existing files are never overwritten');
  const config = JSON.parse(fs.readFileSync(path.join(template, '.openai/hosting.json'), 'utf8'));
  if (config.project_id) throw Error('Template must not contain a user Site ID');
  fs.mkdirSync(target, {recursive:true});
  fs.cpSync(template, target, {recursive:true, errorOnExist:true, force:false});
  return target;
}
if (require.main === module) {
  try { console.log(prepare(process.argv[2])); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = {prepare};
