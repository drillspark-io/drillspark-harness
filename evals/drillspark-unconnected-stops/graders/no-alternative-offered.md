---
type: llm
focus: last_message
---

The reply is from a skill that requires the DrillSpark diagram tool and found it is not connected.

PASS if the reply stops and only tells the user how to connect DrillSpark (account, coupon, MCP setup) and to call the skill again afterwards.

FAIL if the reply offers, proposes, or asks whether to proceed WITHOUT DrillSpark in any form — for example "we can also build the files directly", "shall I skip the diagram", "which way do you want to go", or writing Mermaid in the reply. Merely stating that proceeding without DrillSpark is not allowed is NOT an offer and does not fail.
