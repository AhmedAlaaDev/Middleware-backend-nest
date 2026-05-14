# 📌 Project Name: D365FO Middleware (NestJS)

> **Source of truth:** This document is generated from the `D365FOMiddleware_Nestbackend` codebase and standard integration patterns. **Business KPIs in §11 are illustrative estimates**—replace with finance/ops sign-off before external use.

---

## 1. Business Context

- **What was the business problem?**  
  Finance and operations teams need to load high volumes of structured financial activity (vendor activity, customer/receivables, cash, freight/trucking, and period-end closing entries) from **Excel-based operational templates** into **Microsoft Dynamics 365 Finance & Operations** without manual re-keying, with **validation against master data** and **controlled posting** (retries, failures, and traceability).

- **Which department / company was this built for?**  
  **[Confirm]** Target org: finance (AP/AR/GL), logistics/freight operations, and IT integration—serving a D365 FO tenant (single legal entity or multi-entity as configured in D365 and mapping data). Not encoded in the repository.

- **What was broken or inefficient before this system?**  
  **[Estimate]** Manual or semi-automated posting to D365 FO: slow turnaround, spreadsheet errors, weak audit trail between “Excel row” and “posted D365 document,” and API fragility (timeouts, throttling) when calling OData at scale.

- **Why was this project critical?**  
  **[Estimate]** It centralizes **data transformation, validation, batching, and asynchronous posting** so operational Excel remains the UI while the ERP stays the system of record—reducing cut-off risk for month-end and daily operational posting.

---

## 2. Scope & Scale

| Dimension | Value (from repository / config) | Notes |
|-----------|----------------------------------|--------|
| **End users** | **[Confirm—suggest 5–50 for mid implementation]** | API + Excel users; not user-counted in code. |
| **“Entities / tables” (Dataverse)** | **N/A (this project does not use Dataverse)** | **MongoDB:** **23** Mongoose schema files (users, data batches, master-data cache, resilience cache, app settings, counters, etc.). |
| **Data volume (records)** | **[Confirm]** | Batches and line items stored in Mongo; size depends on production usage. |
| **Excel / line batching** | **Default `maxLinesPerBatch = 1000`** | Enforced in entry-processor utilities (`entry-processor-utils.service.ts`). |
| **Environments (Dev / Test / Prod)** | **At least 3 logical targets** | `.env.development`, `.env.production`, Docker dev stack; **remote deploy** script suggests a **production host** (SSH + `docker compose`). Exact UAT/Prod split is org process, not in repo. |
| **Multi-company / multi–business unit** | **Supported in design (not a single-tenant lock)** | Master data, dimensions, and D365 mapping models support company-scoped data; **confirm** legal-entity count in D365. |

---

## 3. Your Role

- **Main developer or team?**  
  **[You fill in]** The repository does not name the team; `package.json` has no single author field.

- **Architecture vs implementation?**  
  The solution shows **intentional architecture**: CQRS (`@nestjs/cqrs`), domain modules (`vendor`, `cash`, `accounts-receivable`, `closing`, `master-data`, `data-batch`), **BullMQ** workers, **D365 FO service layer** with **resilience** (circuit breaker, retry, caching).  

- **Decisions you own (typical for this stack)?**  
  **[You fill in]** Examples to claim if accurate: batching rules (e.g. 1000 lines), queue topology, OAuth + OData client behavior, master-data sync strategy, rollback/posting strategy per document type.

---

## 4. Solution Architecture

### Overall system architecture

1. **Clients** (Excel uploader / internal apps) call the **NestJS REST API** (`/api/v1/...`, URI versioning in `main.ts`).  
2. **Auth:** JWT (access + refresh) with **Argon2** password hashing and refresh-token persistence.  
3. **Application core:** Controllers → **commands/queries (CQRS)** → **entry processors** (raw Excel model → D365-shaped payloads) → **data batch** persistence in **MongoDB**.  
4. **Async posting:** **BullMQ** (Redis) runs **5 queue processors** aligned to D365 document types.  
5. **D365 FO:** **OData** via `D365foClient` with **opossum** circuit breaker, **axios-retry**, and **cache layers** (Redis + optional MongoDB fallback per resilience module).  
6. **Master data:** Synced/cached in Mongo (vendors, customers, dimensions, main accounts, exchange rates, tax, etc.) to reduce D365 round-trips and support validation.  
7. **Observability / API docs:** Swagger at `/docs` in non-production.

### Power Apps type (Canvas / Model-Driven / Both)

- **Not part of this repository.**  
- **Functional equivalent:** **Custom middle tier + Excel ingestion** as the “composite app” surface; D365 FO remains the model-driven ERP UI for inquiry and exception handling.

### Dataverse design

- **Not applicable.** Persistence is **MongoDB** (see §2). Relationships are expressed via Mongoose schemas and application logic (e.g. batch → records → errors, master-data documents).

### Backend: APIs / NestJS / Azure Functions

- **NestJS 11** (`package.json`): primary backend.  
- **Azure Functions:** **Not present** in this repo.

### Integration: external systems / APIs

- **Microsoft Dynamics 365 Finance & Operations** — OData entities/actions for posting (e.g. free text invoices, vendor journals, ledger journals, customer payment journals—per queue names).  
- **Azure AD–style OAuth2** client credentials for D365 (`D365FO_TENANT_ID`, `D365FO_CLIENT_ID`, `D365FO_CLIENT_SECRET`, `D365FO_RESOURCE`, `D365FO_AUTHORITY` per `AGENTS.md` / env docs).

### Authentication

- **Application users:** JWT (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`).  
- **D365 FO:** OAuth2 client credentials to obtain bearer tokens for OData.

---

## 5. Power Platform Implementation

This section maps **Power Platform concepts** to **this codebase**:

| Power Platform concept | Implementation in this project |
|------------------------|------------------------------|
| **Canvas Apps** | **N/A in repo** — replaced by REST API + Excel module / client workflows. |
| **Model-Driven Apps** | **D365 FO native UI** for finance users; middleware does not customize D365 forms here. |
| **Business Process Flows** | **Application workflow** via batch **status** (`DataBatchStatus`: Pending → Processing → Completed/Canceled) and queue job lifecycle. |
| **Power Automate** | **BullMQ** asynchronous flows: **5 named queues** (`dfo-free-text-invoice-queue`, `dfo-vendor-journal-queue`, `dfo-ledger-journal-queue`, `dfo-customer-payment-journal-queue`, `master-data-sync-queue`). |
| **Plugins (C#/JS)** | **TypeScript domain logic** in NestJS services, processors, and D365 service wrappers—not Dataverse plugins. |

---

## 6. Advanced Dynamics Usage

> **Note:** This repo targets **D365 FO via OData**, not **Dynamics 365 CE / Dataverse** customization.

| Area | In this solution |
|------|------------------|
| **Security roles & business units** | **App-level:** JWT + user module; **D365:** inherited from D365 security for OData service accounts **[confirm service account scope]**. |
| **Ownership model** | **MongoDB documents** (batches, users); no Dataverse owner fields. |
| **Approval workflows** | **Not implemented as multi-step BPM in repo**; approvals would be **[confirm]** outside this API or in D365. |
| **Ribbon / command bar** | **N/A** (no CE customization). |
| **Web resources (JS/React)** | **N/A** in this backend-only repo. |
| **PCF** | **N/A**. |

**Dynamics FO–specific depth (technical):** OData query builder, posting **strategies** (`IDfoPostingStrategy` pattern per `AGENTS.md`), **rollback** support on failures in queue processors, master-data **dimension validation** and **exchange rate** handling.

---

## 7. Key Features Built (concrete, code-aligned)

- **Excel → canonical raw models → D365 payloads** for multiple **entry processor types** (freight/trucking AR, vendor freight/trucking and payments, cash in/out, ledger closing, custody settlement, closing differences, etc.—see `EntryProcessorTypes` enum, **28 enum values** including reserved/planned types).  
- **Factory-based processor registration** (`entry-processor.factory.ts`) for consistent routing.  
- **Batch orchestration** with **max 1000 lines per batch** default and **month isolation / voucher integrity** rules per project conventions (`AGENTS.md`).  
- **Asynchronous D365 posting** via **BullMQ** with **domain-specific queue processors** (free text invoice, vendor journal, ledger journal, customer payment journal, master-data sync).  
- **Resilience:** circuit breaker, retries, multi-layer caching for D365 and supporting services.  
- **Master data synchronization** queue and cached entities (vendors, customers, dimensions, main accounts, exchange rates, billing codes, tax, payment terms, etc.).  
- **API:** Versioned REST, Swagger, global validation and exception handling, CORS and Helmet.

---

## 8. Technical Challenges (typical for this architecture)

- **OData reliability:** transient failures, concurrency, and entity-specific posting rules—addressed via **retries**, **circuit breaker**, and **queue-based** isolation of failures.  
- **Data correctness:** mapping Excel columns to **financial dimensions**, **main accounts**, **tax**, and **exchange rates**—addressed via **warm-up queries**, validation services, and processor-specific rules.  
- **Large files / batches:** splitting and **1000-line** batch caps while preserving voucher integrity.  
- **D365 limitations:** API contracts differ per document type; **update conflicts** (project has internal analysis artifacts in `.cursor/plans/`)—handled with explicit payload design and service logic.  
- **Dual persistence (Redis + Mongo):** operational complexity for cache coherence—managed via resilience module patterns.

---

## 9. Performance & Optimization

- **Caching:** `@nestjs/cache-manager`, Redis (`ioredis`, `@keyv/redis`), MongoDB-backed cache entries where applicable.  
- **Query discipline:** OData query builder; master-data **prefetch** during processor warmup to avoid N+1 calls to D365.  
- **Async offload:** BullMQ prevents blocking HTTP threads during long OData posts.  
- **HTTP:** Compression middleware; axios retry for resilient calls.  
- **UI:** N/A for this repo (backend only).

**Measured metrics:** **[Add]** APM traces, P95 batch duration, D365 error rates—if not collected, plan **Application Insights** or structured logs with correlation IDs.

---

## 10. DevOps & Deployment

- **Local / dev:** Docker Compose with **MongoDB 8** and **Redis 7**, hot-reload (`pnpm start:dev:docker`).  
- **Production image:** multi-stage Dockerfile; example tag **`moatazali/middleware-app:1.0.2`** in `package.json` scripts.  
- **Deploy script:** `docker:deploy` — build, push image, **SSH** to remote host, `docker compose pull` + `up -d`.  
- **CI/CD:** **Not defined in repository** (no `.github/workflows` referenced in this brief)—**[add]** GitHub Actions / Azure DevOps with `pnpm lint`, `pnpm test`, `pnpm build`, image publish.  
- **Solution import/export (Power Platform):** **N/A**; versioning is **git + Docker image tags**.  
- **Environment management:** `.env.*` files + Compose overrides; secrets must stay out of VCS.

---

## 11. Impact (MANDATORY NUMBERS)

> **Replace the table below with signed-off metrics.** Illustrative ranges show how to quantify; they are **not** measured from this repo.

| Metric | Illustrative placeholder | How to measure |
|--------|-------------------------|----------------|
| **Time saved** | **[e.g. 100–400 hours/year]** | (Manual minutes per batch × batches/year) − (operator time with middleware). |
| **Manual work reduced** | **[e.g. 60–85%]** | Time study before/after for same volume. |
| **Errors reduced** | **[e.g. 40–70%]** | Count posting corrections / reversals in D365 pre vs post. |
| **Users impacted** | **[e.g. 8–25]** | Count active Excel/API users. |
| **Business outcome** | **[e.g. faster month-end close, fewer blocked trucks/invoices]** | 1–2 sentences tied to KPI your CFO cares about. |

---

## 12. Reusable Assets

- **Entry processor base** and **factory** pattern for new Excel → D365 flows.  
- **D365 FO client** stack: auth, OData query builder, domain services (vendor, ledger, free text invoice, etc.).  
- **Queue + strategy** pattern for posting.  
- **Resilience utilities** (circuit breaker, retry, cache).  
- **Internal documentation** under `.docs/` (e.g. env variables, BullMQ, adding processors).  
- **Shared Excel parsing** (`exceljs`).

---

## 13. What You Would Improve

- **Observability:** end-to-end **correlation ID** from API → queue job → D365 request/response logging; dashboards for failure taxonomy.  
- **CI/CD:** automated pipeline and **immutable** env-specific configs (Key Vault / secret manager).  
- **Testing:** broader **e2e** against D365 **sandbox** with recorded OData mocks for regression.  
- **Documentation:** replace generic root `README.md` with project-specific architecture diagram and onboarding.  
- **Power Platform alignment:** if the org standardizes on **Dataverse + Power Apps**, decide whether this middleware stays as **integration hub** or whether some flows move **in-platform**—trade-offs: flexibility vs licensing and citizen-developer ownership.

---

## Appendix — Quick inventory (repository)

| Item | Count / name |
|------|----------------|
| **BullMQ queue names** | 5 (`queues.ts`) |
| **Queue worker files** | 5 processors under `queue/processors` |
| **Nest domain modules (sample)** | `data-batch`, `d365fo`, `queue`, `entry-processor`, `vendor`, `cash`, `accounts-receivable`, `closing`, `master-data`, `excel`, `auth`, `user`, `resilience`, `scheduler`, `settings` |
| **Mongoose schemas** | 23 `*.schema.ts` files under `src` |
| **API** | URI versioning default `v1`, Swagger `/docs` (non-production) |

---

*End of document.*
