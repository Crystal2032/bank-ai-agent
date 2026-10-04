# Project Collaboration Rules

This file is the shared instruction entry point for Codex, Claude Code, and other coding agents. Maintain common rules here; do not create a duplicate CLAUDE.md.

## Project Goal

Build an AI agent for a banking use case and an innovation competition. The backend uses Pi Agent/Pi AI, TypeScript/Fastify and SQLite, with API-only models and DeepSeek for testing. Codex owns the backend; Claude Code owns the frontend. See docs/REQUIREMENTS.md and docs/FRONTEND_HANDOFF.md for current scope and interfaces.

## Language

- Use English for all project artifacts, including documentation, code comments, identifiers, UI text, prompts, sample data, tests, logs, and handoff records. Follow the selected language's naming conventions.
- Use English for communication between coding agents.
- Chinese is reserved for direct conversation between the project owner and Codex. Do not copy Chinese chat messages into project files; summarize relevant requirements in English.

## Taking Over a Task

1. Read README.md and docs/HANDOFF.md when starting a task. Product scope is defined in docs/REQUIREMENTS.md.
2. Check git status, the current branch, and relevant code changes. Preserve existing work.
3. Consult docs/DECISIONS.md before changing architecture, dependencies, or interfaces to avoid repeated selection or unjustified reversals.
4. If the handoff record conflicts with the code, verify the actual state and correct the record. Product requirement changes still follow the user's instructions.

## Execution and Collaboration

- Work sequentially by default: only one agent writes to a working directory at a time. Stop the outgoing agent's writes and background development tasks before handing over.
- For parallel development, first define task owners and file scope, then use separate branches and Git worktrees. Check interface compatibility and conflicts before merging.
- Complete the work required by the current task. Do not rebuild the project, rewrite its architecture, or discard uncommitted changes merely because the coding tool has changed.
- New user instructions take precedence over project files. Label necessary assumptions; do not present unresolved items as confirmed requirements.
- Do not assume another coding agent has access to your chat history or private memory.

## Quality and Data

- Run checks relevant to each change and record commands, results, and verification scope. Clearly state checks that failed or were not run.
- Use synthetic or anonymized sample data for the prototype by default. Supply credentials through external configuration such as environment variables; never put them in code, documentation, or version control.
- Clearly distinguish simulated tool calls from real banking system operations. Real operations require an explicitly defined integration scope and authorization.
- Obtain user authorization for commits, pushes, releases, or deployments. Do not overwrite or revert another contributor's work.

## Handoff Procedure

An empty docs/HANDOFF.md means no work has been handed over yet.

Update docs/HANDOFF.md when finishing a task or preparing to switch tools. Include:

- The task owner, completed work, and relevant files.
- Actual verification commands, results, and unverified behavior.
- Work in progress, remaining issues, and the next action.
- The branch, commit identifier if any, uncommitted changes, and relevant background tasks.

Update docs/REQUIREMENTS.md for confirmed product scope and docs/DECISIONS.md for lasting decisions and their rationale. Keep records concise; do not copy entire conversations or full logs.

## Current Development Commands

Use Node >=24.19 and pnpm. Backend commands: `pnpm install --frozen-lockfile`, `pnpm setup:demo`, `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm start`. README.md documents external configuration and simulation boundaries. Frontend commands belong in frontend/ after implementation. Never expose model keys, passwords, OTPs or server-only session/approval state in frontend code or chat tools.
