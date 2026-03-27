# ai-agent-blueprint

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/your-username/ai-agent-blueprint.svg?style=social)](https://github.com/your-username/ai-agent-blueprint/stargazers)

**A blueprint for building autonomous AI agents with Claude Code.**

---

## Overview

Build self-improving AI agents that delegate work, maintain persistent memory, and evolve through structured PDCA cycles — all powered by Claude Code's sub-agent architecture. This repository provides a ready-to-use template for the orchestrator + sub-agent pattern: a main agent plans and delegates, while specialized sub-agents handle research, coding, and file operations in parallel. Born from real-world production use, every design choice here has been validated through daily autonomous operation.

---

## Architecture

```
                        +-----------+
                        |   User    |
                        +-----+-----+
                              |
                              v
                 +------------+------------+
                 |    Main Agent           |
                 |    (Orchestrator)       |
                 |                         |
                 |  SOUL.md   - Identity   |
                 |  MEMORY.md - Memory     |
                 |  TASKS.md  - Task Queue |
                 +--+-------+----------+---+
                    |       |          |
          +---------+   +--+--+   +---+--------+
          v             v         v
   +-----------+  +-----------+  +-----------+
   | Research  |  | File Ops  |  |  Coding   |
   | Agent     |  | Agent     |  |  Agent    |
   +-----------+  +-----------+  +-----------+

        Plan ──> Do ──> Check ──> Act
         ^                         |
         +-------------------------+
              PDCA Cycle
```

The main agent acts as an **orchestrator** — it never does the work itself. Instead, it delegates tasks to specialized sub-agents, reviews results, and continuously improves its own configuration through PDCA cycles.

---

## Why This Approach?

Most AI agent setups are one-shot: you prompt, you get a response, context is lost. This blueprint solves three problems:

1. **Persistent Memory** — The agent remembers past decisions, mistakes, and improvements across sessions via `MEMORY.md`.
2. **Delegation at Scale** — The orchestrator pattern lets you run multiple sub-agents in parallel, dramatically increasing throughput.
3. **Self-Improvement** — After every task batch, the agent runs a structured retrospective (PDCA) and updates its own configuration files. It gets better over time without manual tuning.

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-username/ai-agent-blueprint.git
cd ai-agent-blueprint

# 2. Define your agent's identity
#    Edit SOUL.md with your agent's role, principles, and behavior rules
vi SOUL.md

# 3. Configure boot instructions
#    Edit CLAUDE.md to set up how your agent initializes each session
vi CLAUDE.md

# 4. Run the agent
claude

# 5. Check what it learned
cat MEMORY.md
```

> **Prerequisite:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) must be installed and authenticated.

---

## Directory Structure

```
ai-agent-blueprint/
├── CLAUDE.md          # Boot instructions — loaded automatically on startup
├── SOUL.md            # Agent identity, role definition, PDCA rules
├── MEMORY.md          # Persistent memory index (auto-maintained)
├── TASKS.md           # Task queue and progress tracking
├── memory/            # Individual memory files (auto-generated)
│   ├── user_*.md      # User profile and preferences
│   ├── feedback_*.md  # Behavioral corrections and confirmations
│   ├── project_*.md   # Project context and decisions
│   └── reference_*.md # Pointers to external resources
├── skills/            # Reusable skill templates for sub-agents
├── content/           # Generated content and drafts
│   └── drafts/        # Work-in-progress outputs
├── logs/              # Sub-agent execution logs
└── scripts/           # Utility scripts
```

---

## Core Files Explained

| File | Purpose |
|------|---------|
| **SOUL.md** | Defines the agent's identity, principles, and operating rules. This is *who* the agent is — its role, how it delegates, and when it runs PDCA cycles. |
| **MEMORY.md** | An index of persistent memories. The agent writes memories to `memory/` and maintains this index automatically. Memories survive across sessions. |
| **TASKS.md** | The agent's task queue. Tasks are added, prioritized, and marked complete here. Acts as the single source of truth for what needs to be done. |
| **CLAUDE.md** | Boot instructions executed when Claude Code starts. Tells the agent to read SOUL.md, load memories, and check tasks before doing anything else. |
| **skills/** | Reusable prompt templates for common sub-agent operations (research, file management, coding). Add your own to extend capabilities. |

---

## Customization Guide

### 1. Define Your Agent's Role
Edit `SOUL.md` to match your use case. The agent can be a research assistant, a DevOps operator, a content creator, or anything else. Define:
- What role the agent plays
- What principles it follows
- How it should delegate work

### 2. Set Up Boot Sequence
Edit `CLAUDE.md` to control what happens when the agent starts. The default sequence reads identity, loads memory, and checks tasks — modify this to add your own initialization steps.

### 3. Add Custom Skills
Create new files in `skills/` with prompt templates for domain-specific sub-agent tasks. For example:
- `skills/deploy.md` — deployment checklist runner
- `skills/review.md` — code review automation
- `skills/report.md` — daily status report generator

### 4. Tune the PDCA Cycle
The retrospective cycle runs after task batches complete. Customize what gets evaluated and how improvements are applied by editing the PDCA rules in `SOUL.md`.

---

## Results

This architecture has been validated in daily production use:

- **100+ queries/day** handled autonomously
- **33 queries processed in 8 minutes** via parallel sub-agent execution
- **Self-improving** — the agent updates its own SOUL.md, CLAUDE.md, and skills based on PDCA retrospectives
- **Zero-context-loss** — persistent memory ensures continuity across sessions

---

## Related Links

- Detailed setup guide — *[coming soon]*
- Introductory article (Qiita) — *[coming soon]*

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Author

**Junya**

- GitHub: *[TBD]*
- X (Twitter): *[TBD]*

---

> Built with [Claude Code](https://claude.ai/code) using the orchestrator + sub-agent pattern.
