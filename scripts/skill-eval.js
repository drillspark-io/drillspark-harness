#!/usr/bin/env node
/**
 * skill-eval — drillspark-harness の全 skill・agent の入出力契約、トリガー境界、
 * 参照ファイルの実在、サブエージェント要否（4条件）、オラクル/ヌル採点器を決定論で検査する。
 *
 *   node scripts/skill-eval.js [evals/skills-eval.json]
 *   exit 0 = 全件合格 / exit 2 = 違反あり / exit 1 = 実行エラー
 *
 * 依存なし（Node 標準の fs / path のみ）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SPEC = path.join(ROOT, 'evals', 'skills-eval.json');
const VALID_SUBAGENT_REASONS = new Set([
  'independent_verification',
  'parallel_execution',
  'noisy_context_isolation',
  'strict_tool_restriction',
]);

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function gradeOutput(output, graders) {
  const failures = [];
  for (const g of graders || []) {
    if (g.type === 'min_length') {
      if (String(output).length < Number(g.value)) {
        failures.push(`min_length(${g.value}): actual ${String(output).length}`);
      }
    } else if (g.type === 'regex_match') {
      const re = new RegExp(g.pattern, g.flags || 'm');
      if (!re.test(String(output))) {
        failures.push(`regex_match(${g.pattern})`);
      }
    } else if (g.type === 'regex_not_match') {
      const re = new RegExp(g.pattern, g.flags || 'm');
      if (re.test(String(output))) {
        failures.push(`regex_not_match(${g.pattern})`);
      }
    } else {
      failures.push(`unknown_grader_type(${g.type})`);
    }
  }
  return failures;
}

function main() {
  const specPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SPEC;
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (err) {
    console.error(`読み込めない: ${err.message}`);
    process.exit(1);
  }

  const findings = [];
  const add = (code, target, msg) => findings.push({ code, target, msg });

  // 1. skills ディレクトリ内の全スキルが評価定義に含まれているか
  const diskSkills = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort();
  const specSkills = Object.keys(spec.skills || {}).sort();

  for (const s of diskSkills) {
    if (!spec.skills || !spec.skills[s]) {
      add('MISSING_SKILL_EVAL', s, `skills/${s}/SKILL.md が存在するが skills-eval.json に定義が無い`);
    }
  }

  const positivePromptMap = new Map();

  for (const [name, sdef] of Object.entries(spec.skills || {})) {
    const skillFile = path.join(ROOT, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      add('SKILL_NOT_FOUND', name, `skills/${name}/SKILL.md が存在しない`);
      continue;
    }
    const text = fs.readFileSync(skillFile, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm || fm.name !== name || !fm.description) {
      add('BAD_FRONTMATTER', name, `skills/${name}/SKILL.md の frontmatter (name/description) が不正`);
    }

    // 入出力契約の確認
    if (!Array.isArray(sdef.inputs) || sdef.inputs.length === 0) {
      add('MISSING_INPUT_CONTRACT', name, 'inputs（入力契約）が1件も定義されていない');
    }
    if (!Array.isArray(sdef.outputs) || sdef.outputs.length === 0) {
      add('MISSING_OUTPUT_CONTRACT', name, 'outputs（出力契約）が1件も定義されていない');
    }

    // 参照ファイルの実在確認
    for (const ref of sdef.expected_files || []) {
      const refPath = path.join(ROOT, ref);
      if (!fs.existsSync(refPath)) {
        add('MISSING_EXPECTED_FILE', name, `参照ファイル ${ref} が実在しない`);
      }
    }

    // トリガー境界（陽性・陰性）と衝突確認
    const pos = (sdef.triggers && sdef.triggers.positive) || [];
    const neg = (sdef.triggers && sdef.triggers.negative) || [];
    if (pos.length < 2 || neg.length < 2) {
      add('INSUFFICIENT_TRIGGERS', name, `陽性(${pos.length})・陰性(${neg.length})トリガーは各2件以上必要`);
    }
    for (const p of pos) {
      if (positivePromptMap.has(p)) {
        add('TRIGGER_COLLISION', name, `陽性トリガー "${p}" が ${positivePromptMap.get(p)} と重複している`);
      }
      positivePromptMap.set(p, name);
      if (neg.includes(p)) {
        add('TRIGGER_SELF_CONFLICT', name, `トリガー "${p}" が陽性と陰性の両方に入っている`);
      }
    }

    // オラクル検査（oracle_output は全グレーダー通過必須）とヌル検査（null_output は1つ以上失敗必須）
    const graders = sdef.graders || [];
    if (graders.length < 2) {
      add('INSUFFICIENT_GRADERS', name, '決定論的グレーダーは2件以上必要');
    }
    const oracleFailures = gradeOutput(sdef.oracle_output || '', graders);
    if (oracleFailures.length > 0) {
      add('ORACLE_FAILED', name, `oracle_output がグレーダーに落ちた: ${oracleFailures.join(', ')}`);
    }
    const nullFailures = gradeOutput(sdef.null_output || '', graders);
    if (nullFailures.length === 0) {
      add('NULL_PASSED', name, 'null_output（壊れた出力）がすべてのグレーダーを通過してしまった（ザル検査）');
    }
  }

  // 2. agents ディレクトリ内の全エージェントについて、4条件（Single Agent Loop 基準）と書込禁止を確認
  const diskAgents = fs.readdirSync(path.join(ROOT, 'agents'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();

  for (const a of diskAgents) {
    if (!spec.agents || !spec.agents[a]) {
      add('MISSING_AGENT_EVAL', a, `agents/${a}.md が存在するが skills-eval.json の agents に定義が無い`);
      continue;
    }
    const adef = spec.agents[a];
    const reasons = adef.subagent_criteria || [];
    if (!Array.isArray(reasons) || reasons.length === 0 || !reasons.every((r) => VALID_SUBAGENT_REASONS.has(r))) {
      add('INVALID_SUBAGENT_CRITERIA', a, `サブエージェント要否の4条件（${[...VALID_SUBAGENT_REASONS].join('/')}）が正しく指定されていない`);
    }
    const agentText = fs.readFileSync(path.join(ROOT, 'agents', `${a}.md`), 'utf8');
    const fm = parseFrontmatter(agentText);
    if (!fm || fm.name !== a || !fm.description) {
      add('BAD_AGENT_FRONTMATTER', a, `agents/${a}.md の frontmatter が不正`);
    }
    const disallowed = (fm && fm.disallowedTools) || '';
    for (const tool of ['Edit', 'Write', 'mcp__drillspark__update_diagram']) {
      if (!disallowed.includes(tool)) {
        add('AGENT_WRITE_NOT_BLOCKED', a, `agents/${a}.md の disallowedTools に ${tool} が含まれていない`);
      }
    }
  }

  if (findings.length === 0) {
    console.log(`OK  skills=${diskSkills.length} agents=${diskAgents.length} (triggers/io-contracts/oracle-null/subagent-4criteria)`);
    process.exit(0);
  }

  console.error(`NG  ${specPath} — ${findings.length} 件`);
  for (const f of findings) {
    console.error(`  [${f.code}] ${f.target}: ${f.msg}`);
  }
  process.exit(2);
}

main();
