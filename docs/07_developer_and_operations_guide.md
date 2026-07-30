# 🛠️ Developer & Operations Guide

> **D365FO Middleware Backend — Operations, Deployment & Azure DevOps Workflow**  
> *Target Audience:* Developers, DevOps Engineers, System Administrators.

---

## 1. Quick Start & Local Setup

```bash
# Clone the repository
git clone https://MescoMBDTeam@dev.azure.com/MescoMBDTeam/D365FOMiddleware_Nestbackend/_git/D365FOMiddleware_Nestbackend
cd D365FOMiddleware_Nestbackend

# Install dependencies via pnpm
pnpm install

# Start local infrastructure (MongoDB 8 & Redis 7) via Docker
pnpm run docker:up

# Run application in development watch mode
pnpm run start:dev
```

---

## 2. API Endpoints Map (Swagger OpenAPI at `/docs`)

| HTTP Method | API Route Endpoint | Purpose & Description | Required Role |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Authenticate user & issue JWT Access/Refresh tokens | Public |
| `POST` | `/api/v1/auth/refresh` | Refresh access token using valid refresh token | Public |
| `POST` | `/api/v1/data-batch/upload` | Upload Excel file, parse, validate, and create batch | Operator / Admin |
| `GET` | `/api/v1/data-batch` | List all data batches with filter & pagination | Operator / Admin |
| `GET` | `/api/v1/data-batch/:id` | Get detailed batch status & line items | Operator / Admin |
| `POST` | `/api/v1/data-batch/:id/process`| Manually trigger queue processing for batch | Admin |
| `POST` | `/api/v1/data-batch/:id/cancel` | Cancel a pending batch | Admin |
| `POST` | `/api/v1/master-data/sync` | Trigger manual master data sync from D365FO | Admin |
| `GET` | `/health` | Application health probe (Mongo, Redis, D365FO status) | Public |

---

## 3. Adding a New Entry Processor (Step-by-Step Guide)

To add a new Excel entry processor (e.g. for Customs Clearance AR):
1. **Define Raw Model:** Create raw data model in `src/modules/[domain]/models/`.
2. **Implement Processor Class:** Create class extending `EntryProcessorBase` in `src/modules/[domain]/processors/`.
3. **Register in Enum:** Add new type to `EntryProcessorTypes` enum in `src/modules/data-batch/enums/data-batch.enum.ts`.
4. **Register in Factory:** Add processor to `EntryProcessorFactory` in `src/modules/entry-processor/entry-processor.factory.ts`.
5. **Register in Module:** Add processor provider to `EntryProcessorsModule`.

---

## 4. Docker Production Build & Deployment

```bash
# Build production Docker image
docker build -t moatazali/middleware-app:1.0.2 .

# Push image to registry
docker push moatazali/middleware-app:1.0.2

# Remote deployment command
pnpm run docker:deploy
```

---

## 5. Git & Azure DevOps Integration Workflow

This project is hosted on Azure DevOps:
- **Repository URI:** `https://MescoMBDTeam@dev.azure.com/MescoMBDTeam/D365FOMiddleware_Nestbackend/_git/D365FOMiddleware_Nestbackend`
- **Main Branch:** `main`

### How Documentation is Maintained in Azure DevOps:
- All Markdown documentation source files are stored in `docs/`.
- All compiled executive PDF manuals are stored in `docs_pdf/`.
- To push updates to Azure DevOps:
  ```bash
  git add docs/ docs_pdf/
  git commit -m "docs: update module documentation and PDF manuals"
  git push origin main
  ```
