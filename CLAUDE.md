# Calqen — Claude Code Instructions

## Purpose

Calqen is a private AI orchestration control plane for Kaine Macgregor. It coordinates research and software-development tasks across multiple repositories through Telegram, a Hono API, PostgreSQL, an orchestrator worker, and a local Windows runner.

Calqen is not a chatbot demo. It is designed to make task execution observable, approval-gated, auditable, and safe.

## Current Status

**Phase 1 and Phase 1.1 hardening are complete.**

Current Phase 1 capabilities:

* Telegram task intake with user and chat allow-list checks.
* Durable Telegram outbox delivery.
* Claude-powered task classification and plan-message synthesis.
* Real research workflow using Firecrawl.
* Mocked Architect, Builder, and Verifier agents.
* Task approvals, budget tracking, cancellation handling, audit events, leases, and recovery.
* Local Windows Runner in dry-run simulation mode.

### Phase 1 limitations

The runner is **simulation only**.

It must not:

* Write to local repositories.
* Create Git worktrees.
* Run Git commands.
* Modify files.
* Run real test suites inside repositories.
* Commit, push, create pull requests, deploy, or merge code.

Builder output is a structured mock diff. The diff-policy parser is real, but it runs against mock data.

Phase 2 is not started. Do not begin live-runner work without an explicit approved Phase 2 design and test plan.

## Repository Structure

```text
packages/
  shared/         Shared Drizzle schema, Zod schemas, types, database client, and utilities.
  api/            Hono REST API, authentication middleware, state transitions, leases, outbox routes.
  bot/            grammY Telegram messenger. Delivers outbox messages only.
  orchestrator/   Worker loop, task classification, planning, research, agent execution wrappers.
  runner/         Local Windows runner. Dry-run simulation only in Phase 1.

docs/
  phase-1-spec.md       Original Phase 1 specification.
  architecture.md       System components and data flow.
  security.md           Trust boundaries, authentication, approvals, redaction, and runner safeguards.
  task-lifecycle.md     Task states, transitions, cancellation, leases, and resume logic.
  agent-contracts.md    Agent inputs, outputs, models, real-vs-mocked behaviour.
```

## Architecture and Trust Boundaries

PostgreSQL is the source of truth. Services coordinate through database state, not direct service-to-service assumptions.

```text
Telegram
  ↓
Bot
  ↓
API + PostgreSQL
  ↓
Orchestrator Worker     Local Runner
```

### Bot

The bot is a thin messenger.

It may:

* Receive authorised Telegram messages and commands.
* Call authenticated API routes.
* Poll and deliver rows from `telegram_outbox`.

It must not:

* Call Claude directly.
* Generate outbound message content itself.
* Directly send task, approval, status, or command-response messages outside the outbox.
* Manage task state directly.

### API

The API owns:

* Task creation and transitions.
* Approvals.
* Runner registration and authentication.
* Lease validation.
* Outbox creation and delivery acknowledgements.
* Audit-event persistence.
* Budget and cancellation state.

### Orchestrator

The orchestrator owns:

* Atomic claims for tasks requiring classification or planning.
* Claude-based classification.
* Project resolution and clarification flow.
* Research task execution.
* Architect planning workflow.
* Agent-run logging, spend checks, redaction, and failure handling.

### Runner

The runner receives only approved `runner` tasks.

In Phase 1 it simulates worktree execution and returns structured mock diffs. It must respect task leases, cancellation, protected paths, deletion review, and resume stages.

## Non-Negotiable Rules

1. Use TypeScript strict mode. Do not use `any` or `as unknown as X`.
2. Validate all agent inputs and outputs with Zod before use.
3. Use Drizzle query builder for normal CRUD.
4. Concurrency-critical operations may use parameterised Drizzle `sql` fragments inside transactions.
5. Never use unparameterised SQL string concatenation.
6. Secrets come from environment variables only. Never hardcode secrets or store them in the database.
7. Never pass `.env` file contents or `process.env` objects to agents.
8. Apply `redactSecrets()` or `redactSecretsDeep()` before persisting logs, artifacts, prompts, outputs, errors, or audit payloads.
9. The bot and runner use separate authentication systems. Never share those tokens.
10. Telegram authorisation requires both approved `user.id` and approved `chat.id`.
11. Unauthorised Telegram updates must stop immediately with no reply, no task, and no log entry.
12. Every outbound Telegram message must go through `telegram_outbox`.
13. Outbox delivery is at-least-once. Delivery acknowledgements must validate the active delivery lease.
14. Orchestrator and runner task claims must be atomic.
15. Runner requests with a missing, stale, or invalid lease ID must return `409 Conflict`.
16. Every meaningful state transition must create an audit event.
17. Never claim a mocked workflow is a real repository action.
18. Never silently widen an approved scope.

## Safety Rules for Code Tasks

Code tasks require plan approval before they are queued to the runner.

The runner must never operate on protected branches:

```text
main
master
develop
production
prod
```

Deletion and protected-path policy:

* Deletions are detected from Builder output at the diff-policy boundary.
* A deletion requires explicit approval before verify, commit, push, or completion.
* When deletion is detected, save the diff artifact, release the runner lease, set the task to `awaiting_approval`, and exit cleanly.
* On approved deletion, requeue with `resume_stage = 'verify'`.
* The next runner claim loads the stored diff artifact and skips directly to verification.
* Unplanned protected-path changes must move the task to `needs_human_review`.
* The Git or mock diff is the source of truth for changed files, not the original plan.

## Task Lifecycle Rules

Main lifecycle:

```text
draft
→ classifying
→ awaiting_clarification | classified
→ planning
→ planned
→ awaiting_approval
→ queued
→ in_progress
→ verifying
→ completed | failed | cancelled | needs_human_review
```

Research tasks are handled by the orchestrator and do not go through the runner.

For research:

```text
draft → classifying → classified → in_progress → completed
```

For code tasks:

```text
draft → classifying → classified → planning → planned
→ awaiting_approval → queued → in_progress → verifying
→ completed | failed | needs_human_review
```

Cancellation rules:

* Queued or earlier tasks may become `cancelled` immediately.
* In-progress tasks set `cancel_requested_at`.
* Every agent and runner stage must check for cancellation before proceeding.
* A cancelled task must never move to `verifying` or `completed`.

## Agents and Truthfulness

### Real in Phase 1

* CalqenOrchestrator task classification.
* Calqen plan-message synthesis.
* ResearchAgent retrieval through Firecrawl.
* Research summarisation using the configured fast Claude model.

### Mocked in Phase 1

* ArchitectAgent.
* BuilderAgent.
* VerifierAgent.

Mock agent requirements:

```text
provider = "mock"
is_mock = true
model_used = null
input_tokens = null
output_tokens = null
cost_usd = null
```

Never invent costs, token counts, file changes, Git actions, test results, or deployment results.

## Spend and Duration Controls

Before any real agent call:

* Check `spent_usd < budget_usd`.
* Check that the task deadline has not passed.
* Check cancellation state.

After a real agent call:

* Persist actual model and usage information.
* Calculate and add cost to `tasks.spent_usd`.
* Store redacted prompt and output.
* Create audit events.

Mock runs do not consume tracked model budget.

## Engineering Operating Principles

### Minimum Necessary Change

Before adding code:

1. Check whether the capability already exists.
2. Prefer existing project code, native platform features, standard libraries, and current dependencies.
3. Do not add abstractions, packages, services, files, configuration, or agents without a demonstrated need.
4. Implement the smallest change that preserves correctness, security, readability, and tests.

### Plan Before Build

For non-trivial work:

1. Inspect relevant code and documentation.
2. Produce a short implementation plan before editing.
3. Include data flow, state transitions, failure modes, trust boundaries, affected files, and tests.
4. Do not expand scope without explicit approval.

### Review Before Completion

Before calling work complete:

1. Review changed files for correctness, race conditions, state-machine mistakes, security regressions, and scope creep.
2. Run the configured typecheck, lint, and test commands.
3. Update documentation when architecture, behaviour, configuration, workflows, or safety rules change.
4. Clearly state what is real, mocked, deferred, or unverified.

### Safe Execution

Never bypass or weaken:

* Approval rules.
* Lease fencing.
* Outbox delivery rules.
* Audit logging.
* Secret redaction.
* Scope-hash verification.
* Task budgets.
* Cancellation handling.
* Phase 1 dry-run restrictions.

## Required Documentation Checks

Before changing core behaviour, read the relevant document:

| Change                                            | Read first                |
| ------------------------------------------------- | ------------------------- |
| Task states, transitions, approvals, cancellation | `docs/task-lifecycle.md`  |
| Authentication, secrets, leases, deletion policy  | `docs/security.md`        |
| Service responsibilities, data flow, outbox       | `docs/architecture.md`    |
| Agent inputs, outputs, models, mock boundaries    | `docs/agent-contracts.md` |
| Original decisions and Phase 1 requirements       | `docs/phase-1-spec.md`    |

If implementation and documentation disagree, do not guess. Flag the conflict, decide the source of truth, and update both in the same change.

## Standard Development Workflow

For meaningful work:

1. Inspect relevant code and docs.
2. State a concise plan.
3. Implement the smallest valid change.
4. Review the changed code.
5. Run validation.
6. Update docs if needed.
7. Show the exact result, limitations, and remaining risks.

Do not start a new major phase while an earlier phase is failing its checks.

## Commands

```bash
pnpm typecheck
pnpm lint
pnpm test

pnpm db:generate
pnpm db:migrate
pnpm db:seed

pnpm dev:api
pnpm dev:bot
pnpm dev:orchestrator
pnpm dev:runner
```

Before declaring any implementation task complete, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Environment

All secrets should be supplied through Doppler or environment variables.

Key environment groups:

* Anthropic model and API configuration.
* Telegram bot token and authorised user/chat IDs.
* Bot-to-API service token.
* Runtime and migration database URLs.
* GitHub and Firecrawl credentials.
* Runner registration secret.
* Task budget, timeout, retry, and polling settings.

Use `.env.example` as the required environment-variable reference. Do not commit real secrets, runner tokens, or live database credentials.

## External Workflow Influences

Calqen takes inspiration from:

* **Ponytail:** minimum necessary code, preference for existing capability, and avoiding needless complexity.
* **gstack:** structured planning, review, QA, security thinking, and disciplined release checks.

These are workflow influences only.

Do not vendor, copy, auto-install, or treat either external repository as a source of truth for Calqen. Calqen's own architecture, documentation, and safety requirements always take priority.

## Phase 2 Entry Rule

Do not begin Phase 2 live repository execution until there is an approved Phase 2 design document covering:

* Claude Agent SDK integration.
* Worktree creation and cleanup.
* Strict tool and command allowlists.
* Real Git diff inspection.
* Real test execution.
* File-system and path safety.
* Commit and push policy.
* Failure recovery.
* Real-world smoke-test plan.
* Rollback and emergency-stop behaviour.
* Updated security review and test coverage.

Until then, preserve the Phase 1 dry-run boundary.
