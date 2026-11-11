# TraceChain

TraceChain is a blockchain-backed supply-chain traceability prototype. It
records the important rules and state transitions of a product lot on an
Ethereum-compatible network while keeping files and application indexes
off-chain.

The current implementation contains:

- A Solidity `SupplyChain` smart contract.
- A Hardhat local blockchain for development.
- A Node.js/Express backend that authenticates organizations, signs
  transactions, hashes uploaded files, generates QR codes, and exposes REST
  endpoints.
- A React/Vite frontend for authentication and public lot verification.
- A Docker Compose environment that starts the blockchain, deploys and seeds
  the contract, starts the backend, and serves the frontend.

> **Prototype limitation:** the default network is a single in-memory Hardhat
> node. It demonstrates signed transactions and contract rules, but it is not
> a production blockchain network or a multi-organization consensus network.

## Table of contents

- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [Domain model](#domain-model)
- [Roles and workflow](#roles-and-workflow)
- [Prerequisites](#prerequisites)
- [Run the complete application with Docker](#run-the-complete-application-with-docker)
- [Run services manually](#run-services-manually)
- [Configuration](#configuration)
- [Backend API](#backend-api)
- [Frontend](#frontend)
- [Smart contract](#smart-contract)
- [Testing](#testing)
- [Files and hashes](#files-and-hashes)
- [Security and production considerations](#security-and-production-considerations)
- [Troubleshooting](#troubleshooting)

## Architecture

```text
                         +----------------------+
                         | React frontend       |
                         | localhost:8080       |
                         +----------+-----------+
                                    |
                              REST + JWT
                                    |
                         +----------v-----------+
                         | Express backend      |
                         | localhost:3000       |
                         +-----+-----------+----+
                               |           |
                     ethers.js |           | uploads volume
                               |           |
                    +----------v--+     +--v------------+
                    | Hardhat RPC |     | Local files   |
                    | localhost:  |     | SHA-256 names |
                    | 8545        |     +---------------+
                    +------+------+
                           |
                    SupplyChain.sol
```

Only identifiers, state transitions, ownership, event metadata, and document
hashes are written to the contract. The original documents remain in backend
storage.

### Docker service flow

The Compose services start in this order:

1. `blockchain` starts Hardhat JSON-RPC on port `8545`.
2. `deploy` waits for the RPC health check, compiles the contract, deploys it,
   registers the local organizations, and seeds `LOT-2026-0001`.
3. `backend` waits for successful deployment, reads the generated deployment
   file, and starts the REST API on port `3000`.
4. `frontend` waits for the backend health check and serves the production
   React bundle through Nginx on port `8080`.

The deployment file is stored in the Compose `deployment` volume rather than
being copied into the source tree.

## Repository structure

```text
TraceChain/
├── backend/
│   ├── auth.js                  # In-memory users, bcrypt, JWT, role guards
│   ├── chain.js                 # ethers provider and contract helpers
│   ├── contract.json            # Local deployment output when generated
│   ├── server.js                # Express API
│   ├── Dockerfile
│   └── uploads/                 # Off-chain uploaded files
├── contracts-project/
│   ├── contracts/
│   │   └── SupplyChain.sol      # Main smart contract
│   ├── scripts/
│   │   ├── deploy.js            # Deploy and register organizations
│   │   └── seed.js              # Create demo lot
│   ├── test/
│   │   └── SupplyChain.test.js
│   ├── hardhat.config.js
│   └── Dockerfile
├── frontend/
│   ├── src/main.jsx             # React application
│   ├── src/style.css
│   ├── vite.config.js
│   └── Dockerfile
├── docs/
│   ├── data-model.md
│   ├── deployment.md
│   └── docker.md
├── docker-compose.yml
├── references.md                # Detailed project implementation notes
└── run-until-step6.md           # Manual setup guide before Docker
```

## Domain model

### Lot

A lot contains:

| Field | Description |
|---|---|
| `lotId` | Unique human-readable lot identifier |
| `productType` | Product description |
| `quantity` | Positive integer quantity |
| `unit` | Unit such as `kg` or `units` |
| `origin` | Origin or producer location |
| `currentOwner` | Current organization wallet |
| `pendingOwner` | Recipient while a lot is in transit |
| `status` | Current contract status |
| `prevStatus` | Status restored after a rejected reception |
| `createdAt` | Blockchain timestamp |
| `expiresAt` | Expiration timestamp; `0` means no expiry |
| `parentLots` | Input lots used for a transformation |

### Status values

The Solidity enum is returned by the API as a numeric value:

| Numeric value | Status | Meaning |
|---:|---|---|
| `0` | `PRODUIT` | Created by a producer |
| `1` | `TRANSFORME` | Created from one or more parent lots |
| `2` | `EN_TRANSPORT` | Shipped and awaiting reception |
| `3` | `STOCKE` | Received and stored |
| `4` | `VENDU` | Sold by a retailer |
| `5` | `BLOQUE_RAPPELE` | Blocked or recalled |

### Event record

Every state-changing operation appends an immutable event containing an event
ID, lot ID, event type, actor, timestamp, temperature, document hash, and URI.
The supported event types include `CREATE`, `TRANSFORM`, `CONSUMED`, `SHIP`,
`RECEIVE`, `REJECT`, `TRANSPORT`, `STORE`, `SELL`, `RECALL`, and `CORRECTION`.

## Roles and workflow

The local deployment maps Hardhat accounts to organizations:

| Hardhat account | Organization | Contract role |
|---:|---|---|
| Account 0 | Administrator | Contract administrator |
| Account 1 | Producer | `PRODUCER` |
| Account 2 | Processor | `PROCESSOR` |
| Account 3 | Transporter | `TRANSPORTER` |
| Account 4 | Warehouse | `WAREHOUSE` |
| Account 5 | Retailer | `RETAILER` |
| Account 6 | Auditor | `AUDITOR` |

Typical workflow:

1. A producer creates a lot.
2. The current owner ships it to a recipient.
3. The transporter records transport conditions.
4. The recipient confirms or rejects reception.
5. A warehouse records storage conditions.
6. A processor transforms one or more owned input lots.
7. A retailer sells a received lot.
8. An auditor or authorized owner recalls an unsold lot when required.

The contract—not the frontend—enforces authorization and state transitions.

## Prerequisites

For manual development:

- Node.js 20 or 22 LTS
- npm
- Git

For the full containerized environment:

- Docker Desktop with Docker Compose v2

## Run the complete application with Docker

From the repository root:

```powershell
docker compose up --build
```

Open:

| Component | URL |
|---|---|
| Frontend | http://localhost:8080 |
| Backend health | http://localhost:3000/health |
| Swagger UI | http://localhost:3000/docs |
| Public demo lot | http://localhost:3000/public/lots/LOT-2026-0001 |
| Hardhat RPC | http://localhost:8545 |

The first build can take several minutes because the contract and backend
dependencies are installed inside their images.

Stop the stack:

```powershell
docker compose down
```

Stop the stack and remove the generated blockchain/deployment/upload volumes:

```powershell
docker compose down -v
```

The Hardhat chain is in memory. Restarting it creates a fresh chain, so the
contract must be deployed and seeded again. Compose performs this automatically.

### Compose environment overrides

The Compose file supplies public Hardhat development keys by default. These
keys are intentionally public and must never be used outside local development.
For local customization, create a root `.env` file:

```env
JWT_SECRET=replace-with-a-long-random-secret
ORG_PRODUCER_PRIVATE_KEY=0x...
ORG_PROCESSOR_PRIVATE_KEY=0x...
ORG_TRANSPORTER_PRIVATE_KEY=0x...
ORG_WAREHOUSE_PRIVATE_KEY=0x...
ORG_RETAILER_PRIVATE_KEY=0x...
ORG_AUDITOR_PRIVATE_KEY=0x...
```

Never commit this file.

## Run services manually

Manual mode is useful when developing a contract or backend change.

### 1. Install dependencies

```powershell
cd contracts-project
npm install

cd ..\backend
npm install

cd ..\frontend
npm install
```

### 2. Start the local blockchain

In the `contracts-project` directory:

```powershell
npx hardhat node
```

Keep this terminal open.

### 3. Deploy and seed

In a second terminal:

```powershell
cd contracts-project
npm run compile
npm run deploy:local
npm run seed:local
```

The deployment script writes `backend/contract.json`. This file is ignored by
Git because it is generated for the current local chain.

### 4. Configure the backend

Copy the example:

```powershell
cd ..\backend
Copy-Item .env.example .env
```

Set `JWT_SECRET` and the six organization private keys printed by
`npx hardhat node`. The keys are local development credentials only.

### 5. Start the backend

```powershell
node server.js
```

### 6. Start the frontend

In another terminal:

```powershell
cd ..\frontend
npm run dev
```

Vite prints the frontend URL, normally http://localhost:5173.

## Configuration

### Backend variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Backend HTTP port |
| `RPC_URL` | No | `http://127.0.0.1:8545` | Ethereum JSON-RPC endpoint |
| `PUBLIC_URL` | No | Backend localhost URL | Base URL embedded in QR codes |
| `CONTRACT_FILE_PATH` | No | `./contract.json` | ABI/address deployment file |
| `JWT_SECRET` | Yes | None | JWT signing secret |
| `ORG_*_PRIVATE_KEY` | For authenticated writes | None | Organization transaction signer |

`frontend` supports the following build-time variable:

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Backend URL used by the browser |

When using Docker Compose, the frontend uses its default browser-visible API
URL because the backend is published on port `3000`.

## Backend API

All JSON request bodies use `Content-Type: application/json` unless stated
otherwise. Authenticated endpoints require:

```http
Authorization: Bearer <JWT>
```

The interactive Swagger UI is available at `/docs`.

### Authentication

#### Register

```http
POST /auth/register
Content-Type: application/json
```

Request:

```json
{
  "email": "producer@example.com",
  "password": "change-this-password",
  "orgId": "producer",
  "role": "PRODUCER"
}
```

Supported application roles are `PRODUCER`, `PROCESSOR`, `TRANSPORTER`,
`WAREHOUSE`, `RETAILER`, and `AUDITOR`.

#### Login

```http
POST /auth/login
Content-Type: application/json
```

Request:

```json
{
  "email": "producer@example.com",
  "password": "change-this-password"
}
```

The response contains a JWT valid for eight hours and a public user profile.
Users are currently held in backend memory, so registrations disappear when
the backend restarts.

### Lot operations

| Method | Endpoint | Required role | Purpose |
|---|---|---|---|
| `POST` | `/lots` | `PRODUCER` | Create a lot |
| `POST` | `/lots/transform` | `PROCESSOR` | Consume parent lots and create an output lot |
| `POST` | `/lots/:id/ship` | Current owner | Ship to another organization |
| `POST` | `/lots/:id/transport` | `TRANSPORTER` | Record transport temperature/document |
| `POST` | `/lots/:id/receive` | Pending recipient | Confirm reception |
| `POST` | `/lots/:id/reject` | Pending recipient | Reject reception with a reason |
| `POST` | `/lots/:id/storage` | `WAREHOUSE` | Record storage conditions |
| `POST` | `/lots/:id/sell` | `RETAILER` | Sell a stored lot |
| `POST` | `/lots/:id/recall` | `AUDITOR` or `ADMIN` | Recall an unsold lot |

#### Create lot request

```json
{
  "lotId": "LOT-2026-0002",
  "productType": "Tomates biologiques",
  "quantity": 1000,
  "unit": "kg",
  "origin": "Ferme A - Tunisie",
  "expiresAt": 0,
  "dataHash": "",
  "uri": ""
}
```

#### Transform request

```json
{
  "inputIds": ["LOT-2026-0001"],
  "lotId": "LOT-2026-0003",
  "productType": "Sauce tomate",
  "quantity": 900,
  "unit": "kg",
  "origin": "Conserverie B",
  "expiresAt": 0,
  "dataHash": "",
  "uri": ""
}
```

#### Ship request

```json
{
  "to": "0xRecipientOrganizationAddress",
  "tempX10": 42,
  "dataHash": "",
  "uri": ""
}
```

`tempX10` is temperature multiplied by ten. For example, `42` means `4.2`
degrees Celsius. If omitted, the contract receives its no-temperature sentinel.

#### Transport and storage request

```json
{
  "tempX10": 120,
  "dataHash": "",
  "uri": ""
}
```

The contract emits a `TEMP_BREACH` alert when a transport temperature is above
`8.0` degrees Celsius.

#### Reject request

```json
{
  "reason": "Damaged packaging"
}
```

#### Recall request

```json
{
  "reason": "Quality control failure"
}
```

Successful state-changing endpoints return a transaction proof:

```json
{
  "txHash": "0x...",
  "block": 12
}
```

### Read endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | No | Service health check |
| `GET` | `/public/lots/:id` | No | Public lot verification view |
| `GET` | `/lots/:id/history` | Yes | Full contract history |
| `GET` | `/alerts` | Yes | In-memory indexed alerts |
| `GET` | `/lots/:id/qr` | Yes | QR code PNG for a lot |
| `GET` | `/uploads/:filename` | No | Stored uploaded document |
| `GET` | `/docs` | No | Swagger UI |

Example public response:

```json
{
  "lotId": "LOT-2026-0001",
  "productType": "Tomates biologiques",
  "origin": "Ferme A - Tunisie",
  "status": 0,
  "currentOwner": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "timeline": [
    {
      "type": "CREATE",
      "date": "2026-11-09T13:01:13.000Z",
      "dataHash": ""
    }
  ]
}
```

### Upload a document

```http
POST /lots/:id/documents
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
```

Use the form field name `file`. The backend:

1. Limits uploads to 10 MB.
2. Computes a SHA-256 hash.
3. Stores the file as `<hash><original-extension>`.
4. Returns the hash and URI.

The returned hash and URI can then be included in a contract event request.

## Frontend

The current frontend is a lightweight React/Vite client with:

- Login using the backend JWT API.
- Session storage for the JWT and public user profile.
- Lot ID search.
- Public lot status and timeline display.
- Role display for the connected organization.
- Link to Swagger API documentation.

The UI intentionally delegates authorization to the backend and smart contract.
Hiding or showing a UI control is not a security boundary.

## Smart contract

The main contract is
[`contracts-project/contracts/SupplyChain.sol`](./contracts-project/contracts/SupplyChain.sol).
It uses OpenZeppelin `AccessControl` for role enforcement.

Important invariants:

1. Lot IDs are unique.
2. Quantities must be positive integers.
3. Only an authorized producer can create a lot.
4. A processor must own all input lots used in a transformation.
5. Only the current owner can ship a lot.
6. Only the pending recipient can accept or reject a shipment.
7. Sold lots cannot be changed through normal supply-chain actions.
8. History is append-only.
9. Documents are represented on-chain by hashes and URIs, not raw content.
10. Temperature values use integer tenths of a degree.

The deploy script:

- Deploys `SupplyChain`.
- Registers producer, processor, transporter, warehouse, retailer, and auditor
  accounts.
- Writes the address and ABI to the configured deployment output path.

The seed script creates:

```text
LOT-2026-0001
Product: Tomates biologiques
Quantity: 1000 kg
Origin: Ferme A - Tunisie
```

## Testing

Run the contract tests:

```powershell
cd contracts-project
npm test
```

Compile the contracts:

```powershell
npm run compile
```

Build the frontend:

```powershell
cd ..\frontend
npm run build
```

Validate Compose configuration:

```powershell
cd ..
docker compose config
```

Build all container images:

```powershell
docker compose build
```

The contract test suite covers organization access, lot creation,
transformation, shipping, reception, rejection, transport, storage, selling,
recalls, alerts, corrections, and history.

## Files and hashes

The blockchain intentionally does not store full certificates, photos, or
sensor documents. The backend stores files under `backend/uploads` during
manual development or in the Compose `uploads` volume.

The SHA-256 hash is used as the stored filename prefix and is returned to the
client. A later verification process can hash the downloaded file again and
compare it with the event's on-chain `dataHash`.

The current upload route accepts any file type. A production implementation
should add MIME allowlists, content inspection, virus scanning, authenticated
download authorization, and durable object storage.

## Security and production considerations

This repository is a local demonstration and requires hardening before use with
real organizations or personal data:

- Replace Hardhat with a persistent, access-controlled blockchain network.
- Never use the default Hardhat private keys on a public or valuable network.
- Supply `JWT_SECRET` through a secret manager, not source control.
- Store users in a durable database with account disable/revocation support.
- Encrypt or isolate organization signing keys; avoid plain environment
  variables in production.
- Add rate limiting, request validation, structured logging, and audit logging.
- Restrict CORS to known frontend origins.
- Add authorization checks for document downloads and lot ownership.
- Add file type validation and malware scanning.
- Configure TLS for the frontend, API, and RPC connections.
- Replace the in-memory event and alert index with durable storage and a
  restart-safe indexer.
- Add database migrations, backups, monitoring, and alerting.
- Review the contract with a Solidity security process before deployment.

## Troubleshooting

### Backend says `JWT_SECRET must be configured`

Set `JWT_SECRET` in `backend/.env` for manual mode or in the Compose
environment. Restart the backend after changing it.

### Backend says `Missing deployment file`

The contract address/ABI file has not been generated, or the backend is using
the wrong path. In manual mode run:

```powershell
cd contracts-project
npm run deploy:local
```

In Docker mode, recreate the deployment volume:

```powershell
docker compose down -v
docker compose up --build
```

### The demo lot is not found

Run the seed script after deployment:

```powershell
cd contracts-project
npm run seed:local
```

With Docker, `deploy` runs this automatically. Check its logs:

```powershell
docker compose logs deploy
```

### A transaction is rejected

Check all of the following:

- The JWT role matches the requested operation.
- The organization private key corresponds to the registered address.
- The lot is in the required status.
- The authenticated organization owns the lot or is the pending recipient.
- The recipient address is a registered organization.
- The quantity and expiration values satisfy the contract rules.

Inspect backend logs:

```powershell
docker compose logs backend
```

### Port already in use

Change the host-side port mapping in `docker-compose.yml`, for example:

```yaml
ports:
  - "8081:8080"
```

The value before the colon is the host port; the value after it is the
container port.

## Related documentation

- [Data model and state machine](./docs/data-model.md)
- [Manual deployment notes](./docs/deployment.md)
- [Docker deployment notes](./docs/docker.md)
- [Detailed implementation references](./references.md)
- [Pre-Docker setup guide](./run-until-step6.md)
