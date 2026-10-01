# Agentia Rollback Dry Run

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](package.json)
[![Agentia 0.122](https://img.shields.io/badge/agentia-0.122.0--alpha.1-blue.svg)](https://developer.copado.com/docs)

**Rollback Dry Run** turns a story's deployment steps into a reviewable
destructive changes preview file. The metadata undo plan to Data Vault's
data recovery.

Preview only, always. Built for the **Agentia Headless Virtual Hackathon**
as an oclif plugin on top of the public `agentia` CLI.

---

## Table of Contents

- [The Problem](#the-problem)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Live Demo Workflow](#live-demo-workflow)
- [Command Reference](#command-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)
- [Security](#security)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Hackathon Fit](#hackathon-fit)
- [License](#license)

---

## The Problem

Undoing a Salesforce deployment means hand writing the destructive
changes file from the deployment payload. Mapping every member to its
type by hand is slow and error prone, and mistakes surface only in
production when the undo itself fails.

## Features

- **Step reading** — deployment steps through the verified list command
  scoped by user story.
- **Flexible mapping** — understands typed objects, dotted `Type.Name`
  strings and solo type plus name fields.
- **Honest unmapped reporting** — anything unrecognized is listed for
  manual review instead of silently dropped.
- **Offline fixture mode** — `--steps-file` accepts a JSON step array
  with zero CLI calls.
- **Valid XML output** — escaped members grouped by type with a stamped
  API version.
- **Pre-flight simulation** — `rollback simulate` checks every member
  against the target org index and scores confidence honestly before
  you write the plan.
- **Zero private imports** — only shells out to public `agentia`
  commands.

## Installation

### Prerequisites

- Node 18 or newer.
- Agentia CLI beta: `npm install -g @copado/agentia-cli@beta`
- Authenticated machine: `agentia setup` (CICD at minimum).

### Install from source

```sh
git clone https://github.com/devkdas/agentia-rollback-dryrun.git
cd agentia-rollback-dryrun
npm install
npm run build
agentia plugins link .
```

Re-run `npm run build` after every change to the TypeScript files.

## Quick Start

### 1. Preview a story's undo plan

```sh
agentia rollback generate --story US-0000024
```

### 2. Offline with a fixture

```sh
agentia rollback generate --steps-file steps.json --out ./rollback.xml --json
```

### 3. Simulate confidence before you plan

```sh
agentia rollback simulate --story US-0000024 --source-credential-id a11hm0000016pTxAAI --source-org-id 00D --json
```

## Live Demo Workflow

Verified live:

```text
1. agentia rollback generate --story US-0000024 --json
   -> 0 steps on this story, valid empty file plus honest note
2. Fixture with ApexClass, ApexTrigger and one mystery step
   -> 2 members across 2 types mapped, mystery listed unmapped
3. Generated XML with escaped members grouped by type, version stamped
4. agentia rollback simulate --steps-file steps.json --source-credential-id ... --source-org-id ... --json
   -> honesty graded confidence, missing members listed before planning
```

## Command Reference

### `agentia rollback generate`

| Flag | Description |
|---|---|
| `-s, --story <id>` | User story owning the deployment steps |
| `--steps-file <path>` | JSON step array for offline use |
| `-o, --out <path>` | Output file (default `./rollback.xml`) |
| `--api-version <v>` | Stamped version (default `61.0`) |
| `-j, --json` | Machine readable JSON summary |

One of `--story` or `--steps-file` is required. The command never
deploys or deletes anything.

### `agentia rollback simulate`

| Flag | Description |
|---|---|
| `-s, --story <id>` | User story owning the deployment steps |
| `--steps-file <path>` | JSON step array for offline use |
| `--source-credential-id <id>` | (required) Target org credential ID for member checks |
| `--source-org-id <id>` | (required) Target org ID for member checks |
| `--pipeline-id <id>` | Pipeline ID scoping gateway calls |
| `-j, --json` | Machine readable JSON summary |

Scores confidence honestly: resolvable members raise it, missing
members lower it and are listed by name. One of `--story` or
`--steps-file` is required. Read only against the org index, never
a deployment.

## Configuration

Output path plus API version only. Review the file before any real
rollback since unmapped entries need human judgment.

## Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Empty member list | Story has no deployment steps yet | Add steps in the story first |
| Unmapped entries | Exotic step shapes | Map them by hand into the file |
| ESM auto-transpile warning | Linked ESM plugin notice | Benign, compiled output is used |

## How It Works

```text
agentia rollback generate
  -> deployment-step list --user-story (or fixture file)
  -> flexible member mapping with honest misses
  -> destructiveChanges XML grouped by type

agentia rollback simulate
  -> same step reading as generate
  -> member check against target org index
  -> honesty graded confidence plus missing list
```

## Security

Pure preview. No org writes, no deletions, no tokens. The file is a plan
for humans to review, never an auto executed undo.

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript on Node 18+ |
| CLI Framework | oclif v4 (ESM, matching the host CLI) |
| Runtime calls | `node:child_process` to public `agentia` commands |

## Architecture

```text
Developer / Agent
       |
agentia rollback generate --story
       |
Rollback Dry Run (this plugin)
  |- reader  -> deployment-step list
  |- mapper  -> typed, dotted and solo shapes
  |- writer  -> escaped XML grouped by type
  |- checker -> org index member check plus confidence
        |
Preview file plus JSON summary, simulate first for confidence
```

## Hackathon Fit

Prototypes the missing undo capability with a safe preview, improves
reliability for every team that fears production rollbacks, and pairs
with Data Vault to cover metadata plus data recovery together.

## License

MIT License — see [LICENSE](LICENSE) for details.
