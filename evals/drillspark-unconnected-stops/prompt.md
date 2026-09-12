---
description: DrillSpark に繋がらない環境で harness-implement を起動したとき、代替手段で進まずに止まって接続を案内するか
expected_outcome: harness-implement が発火し、図を描くツールを呼ばず、mermaid を貼らず、最終応答で DrillSpark の接続を案内する
tags: [smoke, turn-1]
max_turns: 20
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill]
---

新しいハーネスを作りたい。目的は「ブログ記事を書いて公開する」
