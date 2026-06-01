# IP Centrum — Agentic AI Platform

> **European Patent Validation & Renewals — Orchestrated by 10 Purpose-Built AI Agents**

[![CI](https://github.com/your-org/ip-centrum/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/ip-centrum/actions)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

---

## Architecture Overview

This is a **pnpm monorepo** containing 10 agentic AI modules, a REST API, a Next.js frontend dashboard, a background worker, and full infrastructure code. Every agent is built on Claude (Anthropic) with mandatory human authority gates at all statutory deadline junctures.

```
ip-centrum/
├── apps/
│   ├── api/          # Express REST API (port 3000)
│   ├── frontend/     # Next.js dashboard (port 3001)
│   └── worker/       # Background scheduler (cron jobs)
├── packages/
│   ├── shared/       # Types, constants, events, utilities
│   ├── database/     # Knex schema, migrations, repositories
│   ├── event-bus/    # Redis Streams event bus
│   └── agents/
│       ├── orchestrator/   # Base class + main coordinator
│       ├── doc-intel/      # Agent 1: Patent document intelligence
│       ├── case-health/    # Agent 2: Real-time risk monitor
│       ├── reg-watch/      # Agent 3: Regulatory intelligence
│       ├── trans-orch/     # Agent 4: Translation orchestration
│       ├── agent-net/      # Agent 5: National agent network
│       ├── client-comms/   # Agent 6: Client communications
│       ├── quote-advisor/  # Agent 7: Quote optimisation
│       ├── renew-intel/    # Agent 8: Renewals intelligence
│       ├── data-verify/    # Agent 9: Data quality gateway (CRITICAL)
│       └── biz-signal/     # Agent 10: Business development
└── infrastructure/
    ├── docker/         # Dockerfiles + docker-compose
    └── k8s/            # Kubernetes manifests (optional)
```

---

## The 10 Agents

| # | Agent | Risk | Phase | Role |
|---|-------|------|-------|------|
| 1 | **DocIntel** | LOW | 1 | Retrieves & analyses EP patents from EPO OPS; flags UP eligibility |
| 2 | **CaseHealth** | MEDIUM | 1 | Continuous risk scoring; escalates before deadlines become crises |
| 3 | **RegWatch** | LOW | 1 | Monitors EPO/WIPO/UPC publications; maintains Law Engine |
| 4 | **TransOrch** | MEDIUM | 2 | Matches translation tasks to qualified translators; validates quality |
| 5 | **AgentNet** | HIGH | 3 | Monitors national agent network; tracks filing confirmations |
| 6 | **ClientComms** | LOW | 2 | Drafts proactive status communications; human review for exceptions |
| 7 | **QuoteAdvisor** | LOW | 2 | Advises on UP vs. classical validation; cost-benefit modelling |
| 8 | **RenewIntel** | MEDIUM | 3 | Portfolio renewal analytics; AutoRenew timing optimisation |
| 9 | **DataVerify** | MEDIUM | 1 | **GATEWAY**: no case proceeds without clearance |
| 10 | **BizSignal** | LOW | 4 | EPO grants monitoring; commercial lead generation |

> **Non-negotiable rule:** Agents act. Humans authorise at all statutory deadline junctures and all client-facing exception communications.

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose
- Anthropic API key
- EPO OPS credentials (https://ops.epo.org)

### 1. Clone & Setup

```bash
git clone https://github.com/your-org/ip-centrum.git
cd ip-centrum
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env — minimum required:
# ANTHROPIC_API_KEY=sk-ant-...
# EPO_OPS_KEY=your-key
# EPO_OPS_SECRET=your-secret
# JWT_SECRET=<32+ random chars>
```

### 3. Start Development

```bash
pnpm dev
# API:      http://localhost:3000
# Frontend: http://localhost:3001
# Health:   http://localhost:3000/health
```

### 4. Run Tests

```bash
pnpm test
pnpm test --coverage
```

---

## Docker (Production)

```bash
# Build all images
docker-compose -f infrastructure/docker/docker-compose.yml build

# Start full stack
docker-compose -f infrastructure/docker/docker-compose.yml up -d

# With dev tools (pgAdmin + Redis Commander)
docker-compose -f infrastructure/docker/docker-compose.yml --profile dev-tools up -d
```

---

## API Reference

### Cases
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/cases` | List cases (filterable by status, riskTier) |
| `GET` | `/api/v1/cases/:id` | Get case detail |
| `POST` | `/api/v1/cases` | Create case (triggers DocIntel + DataVerify) |
| `PATCH` | `/api/v1/cases/:id/status` | Update status (human action) |
| `POST` | `/api/v1/cases/:id/release-quarantine` | Release quarantined case (manager only) |
| `GET` | `/api/v1/cases/:id/risk` | Trigger CaseHealth assessment |
| `GET` | `/api/v1/cases/dashboard/at-risk` | Cases due within N days |

### Alerts
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/alerts` | List alerts (filterable) |
| `POST` | `/api/v1/alerts/:id/acknowledge` | Acknowledge with decision + override classification |
| `GET` | `/api/v1/alerts/sla-breaches` | Alerts past SLA |

### Agents (manual triggers)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/agents/doc-intel` | Run DocIntel on EP number |
| `POST` | `/api/v1/agents/quote-advisor` | Run QuoteAdvisor |
| `POST` | `/api/v1/agents/renew-intel` | Run RenewIntel |
| `POST` | `/api/v1/agents/reg-watch/scan` | Trigger regulatory scan |
| `POST` | `/api/v1/agents/biz-signal/scan` | Trigger commercial scan |
| `GET` | `/api/v1/agents/override-stats` | AI Quality Owner override report |

### Regulatory
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/regulatory/changes` | List detected regulatory changes |
| `POST` | `/api/v1/regulatory/changes/:id/approve` | Approve Law Engine update |
| `POST` | `/api/v1/regulatory/changes/:id/reject` | Reject change |

---

## Governance Model

### Human Authority Gates

The following actions **always** require human authorisation:

- Instructing a national agent to file
- Sending client exception notifications
- Updating Law Engine data affecting active cases
- Abandoning or not renewing a patent
- Issuing a materially revised quote
- Filing a Unitary Patent request
- Releasing a quarantined case

### Alert SLAs

| Alert Type | Route To | SLA |
|-----------|----------|-----|
| Deadline < 14 days with open task | Control Centre Manager | 2 hours |
| Data discrepancy | Control Centre Team Lead | 1 hour |
| Translator non-acceptance | Control Centre Team Lead | 4 hours |
| Agent confirmation overdue | Agent Relations Manager | 8 hours |
| Regulatory change (high impact) | Law Engine Manager | 24 hours |

### Override Classification

Every human override of an AI recommendation must be classified:
- **MODEL_ERROR** — Agent reasoning was factually wrong → triggers retraining ticket
- **POLICY_OVERRIDE** — Valid recommendation, human chose differently → audit only
- **INCOMPLETE_INFORMATION** — Agent lacked data the human had → triggers data integration ticket

### Audit Retention

All agent decisions are logged with full reasoning, input data, confidence scores, and model used. Retention: **7 years** (professional indemnity standard).

---

## Deployment Phases

| Phase | Months | Agents | Rationale |
|-------|--------|--------|-----------|
| 1 | 1–4 | DocIntel, CaseHealth, RegWatch, DataVerify | Advisory only — no autonomous actions |
| 2 | 5–9 | TransOrch, ClientComms, QuoteAdvisor | High-volume coordination, no deadline actions |
| 3 | 10–18 | AgentNet, RenewIntel | Higher-consequence; requires Phase 1+2 trust baseline |
| 4 | 19–30 | BizSignal + inter-agent optimisation | Commercial growth + continuous improvement |

---

## Environment Variables

See `.env.example` for the full list. Critical variables:

```bash
ANTHROPIC_API_KEY=          # Required — Claude API access
EPO_OPS_KEY=                # Required — EPO Open Patent Services
EPO_OPS_SECRET=             # Required — EPO OPS secret
DATABASE_URL=               # PostgreSQL connection string
REDIS_URL=                  # Redis connection string
JWT_SECRET=                 # Min 32 chars — API auth
```

---

## GitHub Secrets Required for CI/CD

```
ANTHROPIC_API_KEY_TEST     # Anthropic key for test environment
CODECOV_TOKEN              # Coverage reporting
STAGING_HOST               # Staging server IP
STAGING_USER               # SSH user
STAGING_SSH_KEY            # SSH private key
PROD_HOST                  # Production server IP
PROD_USER                  # SSH user
PROD_SSH_KEY               # SSH private key
SLACK_WEBHOOK_URL          # Deployment notifications
```

---

## Tech Stack

- **AI**: Anthropic Claude (claude-sonnet-4 standard, claude-opus-4 complex tasks)
- **Runtime**: Node.js 20, TypeScript 5
- **Monorepo**: pnpm workspaces + Turborepo
- **API**: Express 4
- **Frontend**: Next.js 14, Tailwind CSS
- **Database**: PostgreSQL 16 (Knex.js)
- **Event Bus**: Redis Streams (ioredis)
- **Containers**: Docker, Docker Compose
- **CI/CD**: GitHub Actions
- **Observability**: LangSmith (agent tracing), structured JSON logs

---

*Framework built for internal strategic use. All agent deployments require technical feasibility assessment and legal review prior to production activation. Zero-error-tolerance domain — validate all human gate protocols before go-live.*
