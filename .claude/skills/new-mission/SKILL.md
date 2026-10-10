---
name: new-mission
description: Add a new real-mission data file (any agency) with stages, odds and cited sources.
disable-model-invocation: true
argument-hint: [mission name]
---
Create data/missions/<slugified $ARGUMENTS>.json following data/missions/apollo-11.json and data/missions/mission.schema.json.
Rules:
- Research first: use the data-source-checker subagent or web search to find at least 2 reliable sources, preferring the operating agency's own pages and mission reports. Record them in `sources` with `used_for`.
- Every stage has base_success_prob in [0,1], at least one decision point or risk factor, and failure_modes whose weights sum to 1.
- Options matching what actually happened get "historical": true. Real failures in history are fine and should be playable.
- Every probability is `tuned: true`; do not invent statistics, and say so in `historical_note` when a value is a judgment call. Add a `todo` list for anything unverified.
- Set design_target_overall_success and a design_target_note; tune until the Monte-Carlo baseline lands inside the band.
- Add or extend tests: schema validation, seed determinism, Monte-Carlo band.
- Show me the stage table (stage, base p, effective baseline p, failure modes) and the sources for review before committing.
