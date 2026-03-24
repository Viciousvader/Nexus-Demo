# Architecture Overview

## Agent roles

The demo uses a role-based reasoning flow:

- Analyst
- Adversary
- Auditor
- Final synthesis

## Routing

The system routes requests based on problem type and depth. Simpler requests can use lighter paths, while more complex or strategic prompts can trigger a fuller multi-agent sequence.

## Validation

Intermediate responses are checked for structural validity before final synthesis. This helps reduce malformed or weak outputs from contaminating the final result.

## Quorum gating

The system uses quorum-based logic so final synthesis only proceeds when enough valid agent responses are available.

## Continuity and memory

The demo supports thread-aware follow-ups and memory behavior so later turns can stay grounded in earlier context.

## Deployment

The public demo is deployed separately from the main project to reduce risk and isolate public usage from the primary build.