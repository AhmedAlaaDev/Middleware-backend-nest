# ⚙️ Core Infrastructure & Framework Modules

> **D365FO Middleware Backend — System Infrastructure & Foundation Services**  
> *Target Audience:* Backend Developers, System Administrators, DevOps Engineers.

---

## 1. Overview of Infrastructure Layer

The core infrastructure modules provide essential framework capabilities: security, authentication, D365FO OData connectivity, batch orchestration (CQRS), asynchronous queue management (BullMQ), resilience (circuit breakers & caching), database persistence, health monitoring, and logging.

---

## 2. Infrastructure Modules Breakdown

### 2.1 AuthModule & UserModule (`src/modules/auth` & `src/modules/user`)

#### Business Purpose & Safeguards
Secures API endpoints against unauthorized access, enforcing Role-Based Access Control (RBAC) for finance operators and system integration clients.

#### Key Components & Code Architecture
- `AuthService`: Handles user authentication, password verification using **Argon2** hashing, and JWT token issuance.
- `JwtAccessStrategy` & `JwtRefreshStrategy`: Passport strategies validating Bearer access tokens and refresh tokens.
- `RolesGuard` & `@Roles()` Decorator: Restricts administrative endpoints (e.g. batch cancellation, master data sync) to authorized roles.
- Mongoose Schema: `UserSchema` storing usernames, Argon2 password hashes, roles, active status, and refresh token hashes.

---

### 2.2 D365FOModule (`src/modules/d365fo`)

#### Business Purpose & D365FO Connection
Manages all direct communication with Microsoft Dynamics 365 Finance & Operations OData REST APIs.

#### Key Components & Code Architecture
- `D365FOAuthService`: Obtains and caches OAuth2 Bearer tokens from Azure Active Directory using Client Credentials Flow (`D365FO_CLIENT_ID`, `D365FO_CLIENT_SECRET`, `D365FO_RESOURCE`). Automatically refreshes tokens before expiry.
- `D365FOClientService`: HTTP wrapper around Axios featuring:
  - **Opossum Circuit Breaker:** Stops outbound calls if D365FO returns consecutive 5xx errors, preventing system cascading failure.
  - **Axios Retry:** Automatic exponential backoff retries for transient network drops (408, 502, 503, 504).
- `ODataQueryBuilderService`: Fluent query builder for constructing OData URL queries (`$filter`, `$select`, `$expand`, `$top`, `$skip`).

---

### 2.3 DataBatchModule (`src/modules/data-batch`)

#### Business Purpose & CQRS Batch Management
Implements the Command Query Responsibility Segregation (CQRS) pattern to manage financial batch lifecycles. Every uploaded Excel sheet is converted into a `DataBatch` entity.

#### Key Components & Code Architecture
- **Commands & Handlers:**
  - `CreateDataBatchCommand` / `CreateDataBatchHandler`: Creates batch records in MongoDB.
  - `UpdateDataBatchStatusCommand` / `UpdateDataBatchStatusHandler`: Transitions batch state (`Pending` -> `Processing` -> `Completed` / `Failed`).
- **Queries & Handlers:**
  - `GetDataBatchByIdQuery`, `GetPendingBatchesQuery`, `GetDataBatchErrorsQuery`.
- **Mongoose Schema (`DataBatchSchema`):** Stores batch ID, processor type, total lines, status, creation date, D365FO voucher identifiers, and line-level error logs.

---

### 2.4 EntryProcessorModule (`src/modules/entry-processor`)

#### Business Purpose & Transformation Engine
Serves as the core data engine that transforms raw Excel rows into normalized, D365FO-compliant payload structures.

#### Key Components & Code Architecture
- `EntryProcessorBase`: Abstract base class providing common transformation methods:
  - `parseDimensions()`: Splitting `ACCOUNTDISPLAYVALUE` into 15 financial dimension tags.
  - `validateMonthIsolation()`: Enforcing single-month rules.
  - `applyVoucherIntegrity()`: Ensuring lines with identical vouchers stay grouped.
- `EntryProcessorFactory`: Factory class maintaining a registry of all 28 entry processors, returning the appropriate processor based on `EntryProcessorTypes` enum.

---

### 2.5 QueueModule (`src/modules/queue`)

#### Business Purpose & Asynchronous Worker Distribution
Leverages **BullMQ** (powered by Redis) to process posting jobs in background threads without blocking API responsiveness.

#### Key Queues & Workers
1. `dfo-free-text-invoice-queue`: Handles AR Free Text Invoices.
2. `dfo-vendor-journal-queue`: Handles AP Vendor Invoice Journals.
3. `dfo-ledger-journal-queue`: Handles Month-End GL Adjustments & Custody Settlement.
4. `dfo-customer-payment-journal-queue`: Handles Customer Payment Receipts.
5. `master-data-sync-queue`: Handles background master data pre-fetching.

---

### 2.6 ResilienceModule & DBModule (`src/modules/resilience` & `src/modules/db`)

#### Business Purpose & High Availability
Ensures system stability under high load or ERP downtime.
- `ResilienceModule`: Provides multi-layer caching (L1 Memory, L2 Redis, L3 MongoDB) and circuit breaker monitoring.
- `DBModule`: Manages Mongoose connection pooling to MongoDB 8 (`MONGODB_URI`), handling reconnection logic.

---

### 2.7 ObservabilityModule, HealthModule, SchedulerModule & SettingsModule

- `ObservabilityModule`: Structured JSON logging powered by **Pino** (`nestjs-pino`), redacting sensitive fields (passwords, tokens, client secrets).
- `HealthModule`: Exposes `/health` probe endpoints checking MongoDB, Redis, and D365FO OData connectivity.
- `SchedulerModule`: Manages cron schedules for automated master data sync and log cleanup.
- `SettingsModule`: Stores dynamic application settings and posting thresholds in MongoDB.
