# SupplyChainChain – Hardhat Implementation Guide

*2026-10-11*

## Overview

The prototype runs on a local Hardhat Ethereum network with one Solidity contract, a Node.js backend that signs and indexes transactions, a React frontend, and an off-chain store for files. No Docker is needed. The sections below follow the build order: setup, data model, contract, tests, deployment, backend, frontend, testing and demo.

```text
Only rules and hashes go on-chain; files and indexes stay off-chain

              +--------------------------------+
              |  React web app and public QR   |
              +---------------+----------------+
                              | REST + JWT
+-------------------------------------------------------------------+
|                       Node.js backend API                         |
|  Login (JWT) and role guards, signs transactions with org key     |
|  Indexer listens to contract events; QR codes, alerts, audit      |
+----------+--------------------------+-----------------------+-----+
           | signed transactions      | reads, writes         | files + SHA-256
           v                          v                       v
+----------------------+   +----------------------+   +----------------------+
| Hardhat node +       |   | PostgreSQL           |   | File storage         |
| contract (ON-CHAIN)  |   | Users, lot index,    |   | Certificates, photos |
| SupplyChain.sol:     |   | alerts               |   | Named by SHA-256     |
| roles, rules, lots,  |   | Rebuilt from chain   |   | hash                 |
| owners, status,      |   | events               |   |                      |
| events, doc hashes   |   |                      |   |                      |
+----------------------+   +----------------------+   +----------------------+
```

The backend is the only component that talks to all three stores; the contract never holds files.

**How the Fabric design in the spec maps to Hardhat**

| In the spec (Hyperledger Fabric) | In this implementation |
| --- | --- |
| Organization identity, CA certificate | One Ethereum account per organization; its private key signs transactions |
| Role attributes in certificates | OpenZeppelin `AccessControl` roles checked in each function |
| Chaincode | Solidity smart contract |
| Endorsement policy | Contract rules: only the owner ships, only the recipient confirms |
| Peers and orderer | One Hardhat node (single process) |
| Private data collections | Off-chain files and personal data; only SHA-256 hashes on-chain |
| `GetHistoryForKey` | Append-only event array and Solidity events |
| Certificate revocation | `revokeRole` on-chain, plus disabling the user in the backend |

**Honest limit to state in your report.** A single local node has one validator, so it demonstrates signed transactions, role rules and append-only history, but not real multi-organization consensus. Section 10 lists an optional multi-node upgrade.

---

## 1. Tools and prerequisites

You need only Node.js and a code editor: no Docker, because Hardhat runs a local Ethereum node in one process.

| Layer | Tool | Purpose |
| --- | --- | --- |
| Runtime | Node.js 20 or 22 LTS, npm | Runs Hardhat, backend and frontend |
| Blockchain | Hardhat (`npx hardhat node`) | Local private chain, chain ID 31337, 20 funded test accounts |
| Smart contracts | Solidity 0.8.x | Business rules and lot state machine |
| Contract libraries | OpenZeppelin Contracts 5.x | `AccessControl` for roles, `Pausable` for emergency stop |
| Contract tests | Hardhat Toolbox, Chai, ethers v6 | Unit tests, coverage, gas report |
| Backend | Express or NestJS, ethers v6 | REST API that talks to the contract |
| API docs | swagger-ui-express or `@nestjs/swagger` | OpenAPI documentation (ENF-06) |
| Authentication | JWT (`jsonwebtoken`), bcrypt | Login linked to an organization (EF-02) |
| Off-chain database | PostgreSQL or SQLite | Users, lot index, alerts, file metadata |
| Off-chain files | Local `uploads/` folder or MinIO | Certificates and photos; only the SHA-256 goes on-chain |
| Hashing | Node `crypto` module | SHA-256 of documents |
| QR code | `qrcode` (generate), `html5-qrcode` (scan) | EF-09 |
| Frontend | React with Vite, Tailwind CSS | Six screens from section 6.1 of the spec |
| Wallet (optional) | MetaMask | Browser signing if you do not sign in the backend |
| Security tests | Slither, OWASP ZAP | Static analysis of contracts, API scan |
| Project tools | Git/GitHub, VS Code (Solidity extension), draw.io | Versioning, editing, diagrams |

**Versions.** Hardhat 3 changed its config format and test setup compared with Hardhat 2. The commands in this guide follow the common Hardhat 2 workflow with `@nomicfoundation/hardhat-toolbox`. If you start on Hardhat 3, follow its official getting-started page for init and config, and keep the contract code as is.

**Check your install**

```bash
node -v    # v20.x or v22.x
npm -v
git --version
```

---

## 2. Step 1: Project setup

Create one repo with three folders, then start a local chain in under 10 minutes.

```bash
mkdir supplychainchain && cd supplychainchain
git init
mkdir contracts-project backend frontend docs

cd contracts-project
npm init -y
npm install --save-dev hardhat@^2 @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
npx hardhat init     # choose: Create a JavaScript project (or TypeScript)
```

Repo layout:

| Folder | Content |
| --- | --- |
| `contracts-project/` | Solidity contracts, tests, deploy scripts, `hardhat.config` |
| `backend/` | REST API, database, file storage, alert service |
| `frontend/` | React web app and public QR verification page |
| `docs/` | Report, diagrams, API documentation, screenshots |

Start the local blockchain and check that it works:

```bash
npx hardhat node          # terminal 1: keep it running
npx hardhat compile       # terminal 2
npx hardhat test
```

The node prints 20 accounts with private keys and 10000 ETH each. These keys are public test keys: never use them anywhere except local development.

**Mapping accounts to organizations.** Use one account per organization (for example account 0 = admin, 1 = producer, 2 = processor, 3 = transporter, 4 = warehouse, 5 = retailer, 6 = auditor). The account address is the organization's identity, and its private key signs every transaction. This replaces the Fabric certificate.

---

## 3. Step 2: Data model and state machine

Design on paper before coding: each lot has one current state, and every change is an event. Keep on-chain data small (ids, owner, status, hashes) and put heavy data off-chain.

**Lot states and who can trigger each transition** (from Figure 4.2 of the spec):

| Transition | From | To | Allowed role |
| --- | --- | --- | --- |
| Create lot | none | PRODUIT | Producer |
| Transform | PRODUIT | TRANSFORMÉ | Processor (owner of input lots) |
| Ship | PRODUIT or TRANSFORMÉ or STOCKÉ | EN_TRANSPORT | Current owner, then Transporter takes custody |
| Confirm reception | EN_TRANSPORT | STOCKÉ | Recipient (warehouse or retailer) |
| Reject reception | EN_TRANSPORT | back to sender, with reason | Recipient |
| Sell | STOCKÉ | VENDU | Retailer |
| Block or recall | any except VENDU | BLOQUÉ_RAPPELÉ | Admin, Auditor, or current owner |

**Core types** (Solidity):

```solidity
enum Status { PRODUIT, TRANSFORME, EN_TRANSPORT, STOCKE, VENDU, BLOQUE_RAPPELE }

struct Lot {
    string  lotId;          // e.g. "LOT-2026-0001"
    string  productType;    // "Tomates biologiques"
    uint256 quantity;       // in grams or units to avoid decimals
    string  unit;           // "kg"
    string  origin;         // "Ferme A - Tunisie"
    address currentOwner;   // organization account
    address pendingOwner;   // set during transfer, zero otherwise
    Status  status;
    uint64  createdAt;
    uint64  expiresAt;      // 0 if none
    string[] parentLots;    // lineage for transformations
}

struct Event {
    string  eventId;        // "EVT-001"
    string  lotId;
    string  eventType;      // CREATE, TRANSFORM, SHIP, RECEIVE, REJECT, STORE, SELL, RECALL, CORRECTION
    address actor;
    uint64  timestamp;
    int16   temperatureX10; // temperature x 10, e.g. 42 = 4.2 C; use a sentinel for none
    string  dataHash;       // SHA-256 of off-chain details
    string  uri;            // off-chain location
}
```

**Design rules to keep**

- Events are append-only: store them in an array or emit them as Solidity events, and never delete.
- Use integers only: Solidity has no floating point, so store temperature and quantity as scaled integers.
- Store full sensor data and documents off-chain, with only their SHA-256 and URI on-chain.
- A correction is a new event of type CORRECTION that references the original event id (rule 4 of the spec).

---

## 4. Step 3: Smart contract

One contract, `SupplyChain.sol`, enforces the business rules. OpenZeppelin `AccessControl` replaces Fabric's certificate attributes: each organization account holds one role, and every function checks it.

**Functions and the spec requirements they cover**

| Function | Who | Spec |
| --- | --- | --- |
| `registerOrganization`, `revokeOrganization` | Admin | EF-01, EF-03, EF-13 |
| `createLot` | Producer | EF-04 |
| `transformLots` | Processor | EF-05 |
| `shipLot`, `logTransport` | Owner, Transporter | EF-06 |
| `confirmReception`, `rejectReception` | Recipient | EF-07 |
| `logStorage` | Warehouse | EF-08 |
| `sellLot` | Retailer | rules 3 and 6 |
| `recallLot` | Admin, Auditor, owner | EF-11 |
| `addCorrection` | Owner, Auditor | rule 4 |
| `getLot`, `getHistory` | Anyone | EF-10, EF-12 |

**Skeleton** (complete the remaining functions the same way):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract SupplyChain is AccessControl {
    bytes32 public constant PRODUCER    = keccak256("PRODUCER");
    bytes32 public constant PROCESSOR   = keccak256("PROCESSOR");
    bytes32 public constant TRANSPORTER = keccak256("TRANSPORTER");
    bytes32 public constant WAREHOUSE   = keccak256("WAREHOUSE");
    bytes32 public constant RETAILER    = keccak256("RETAILER");
    bytes32 public constant AUDITOR     = keccak256("AUDITOR");

    int16 public constant NO_TEMP      = type(int16).min;
    int16 public constant MAX_TEMP_X10 = 80;   // 8.0 C, example threshold

    enum Status { PRODUIT, TRANSFORME, EN_TRANSPORT, STOCKE, VENDU, BLOQUE_RAPPELE }

    struct Lot {
        string lotId; string productType; uint256 quantity; string unit; string origin;
        address currentOwner; address pendingOwner;
        Status status; Status prevStatus;
        uint64 createdAt; uint64 expiresAt; string[] parentLots;
    }
    struct EventRecord {
        string eventId; string lotId; string eventType; address actor;
        uint64 timestamp; int16 temperatureX10; string dataHash; string uri;
    }
    // One struct as input avoids the "stack too deep" compiler error
    struct NewLot {
        string lotId; string productType; uint256 quantity; string unit;
        string origin; uint64 expiresAt; string dataHash; string uri;
    }

    mapping(string => Lot) private lots;
    mapping(string => bool) public lotExists;
    mapping(string => EventRecord[]) private history;
    mapping(address => string) public orgName;

    event LotEvent(string lotId, string eventType, address indexed actor, uint64 timestamp);
    event Alert(string lotId, string code, address indexed actor);
    event Rejected(string lotId, address indexed by, string reason);

    constructor() { _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); }

    // ---------- Organizations (EF-01, EF-13) ----------
    function registerOrganization(address org, string calldata name, bytes32 role)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_isBusinessRole(role), "Unknown role");
        orgName[org] = name;
        _grantRole(role, org);
    }

    function revokeOrganization(address org, bytes32 role) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(role, org);   // past events stay in history
    }

    // ---------- Lots ----------
    function createLot(NewLot calldata n) external onlyRole(PRODUCER) {
        require(!lotExists[n.lotId], "Lot already exists");
        require(n.quantity > 0, "Quantity must be > 0");
        Lot storage l = lots[n.lotId];
        l.lotId = n.lotId; l.productType = n.productType; l.quantity = n.quantity;
        l.unit = n.unit; l.origin = n.origin;
        l.currentOwner = msg.sender; l.status = Status.PRODUIT;
        l.createdAt = uint64(block.timestamp); l.expiresAt = n.expiresAt;
        lotExists[n.lotId] = true;
        _log(n.lotId, "CREATE", NO_TEMP, n.dataHash, n.uri);
    }

    function transformLots(string[] calldata inputIds, NewLot calldata out)
        external onlyRole(PROCESSOR)
    {
        require(inputIds.length > 0, "At least one input lot");
        require(!lotExists[out.lotId], "Output lot already exists");
        uint256 total;
        for (uint256 i = 0; i < inputIds.length; i++) {
            require(lotExists[inputIds[i]], "Unknown input lot");
            Lot storage inp = lots[inputIds[i]];
            require(inp.currentOwner == msg.sender, "Not the owner");
            require(inp.status == Status.STOCKE || inp.status == Status.PRODUIT, "Bad input status");
            total += inp.quantity;
            inp.quantity = 0;                       // consumed
            _log(inputIds[i], "CONSUMED", NO_TEMP, "", "");
        }
        require(out.quantity > 0 && out.quantity <= total, "Incoherent quantity");
        Lot storage l = lots[out.lotId];
        l.lotId = out.lotId; l.productType = out.productType; l.quantity = out.quantity;
        l.unit = out.unit; l.origin = out.origin;
        l.currentOwner = msg.sender; l.status = Status.TRANSFORME;
        l.createdAt = uint64(block.timestamp); l.expiresAt = out.expiresAt;
        for (uint256 i = 0; i < inputIds.length; i++) l.parentLots.push(inputIds[i]);
        lotExists[out.lotId] = true;
        _log(out.lotId, "TRANSFORM", NO_TEMP, out.dataHash, out.uri);
    }

    // ---------- Transfer (rules 2 and 3) ----------
    function shipLot(string calldata lotId, address to, int16 tempX10,
                     string calldata dataHash, string calldata uri) external {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(l.currentOwner == msg.sender, "Only the current owner can transfer");
        require(l.status == Status.PRODUIT || l.status == Status.TRANSFORME
             || l.status == Status.STOCKE, "Lot cannot be shipped");
        require(_isReceiver(to) && to != msg.sender, "Invalid recipient");
        l.prevStatus = l.status;
        l.pendingOwner = to;
        l.status = Status.EN_TRANSPORT;
        _log(lotId, "SHIP", tempX10, dataHash, uri);
    }

    function confirmReception(string calldata lotId, string calldata dataHash, string calldata uri)
        external
    {
        Lot storage l = lots[lotId];
        require(l.status == Status.EN_TRANSPORT, "Lot not in transit");
        require(l.pendingOwner == msg.sender, "Not the recipient");
        l.currentOwner = msg.sender;
        l.pendingOwner = address(0);
        l.status = Status.STOCKE;
        _log(lotId, "RECEIVE", NO_TEMP, dataHash, uri);
    }

    function rejectReception(string calldata lotId, string calldata reason) external {
        Lot storage l = lots[lotId];
        require(l.status == Status.EN_TRANSPORT && l.pendingOwner == msg.sender, "Not allowed");
        require(bytes(reason).length > 0, "Reason required");   // EF-07
        l.pendingOwner = address(0);
        l.status = l.prevStatus;                                // back to the sender
        emit Rejected(lotId, msg.sender, reason);
        _log(lotId, "REJECT", NO_TEMP, "", "");
    }

    function logTransport(string calldata lotId, int16 tempX10,
                          string calldata dataHash, string calldata uri)
        external onlyRole(TRANSPORTER)
    {
        require(lots[lotId].status == Status.EN_TRANSPORT, "Lot not in transit");
        if (tempX10 != NO_TEMP && tempX10 > MAX_TEMP_X10) emit Alert(lotId, "TEMP_BREACH", msg.sender);
        _log(lotId, "TRANSPORT", tempX10, dataHash, uri);
    }

    // ---------- Sale and recall (rule 6) ----------
    function sellLot(string calldata lotId) external onlyRole(RETAILER) {
        Lot storage l = lots[lotId];
        require(l.currentOwner == msg.sender, "Not the owner");
        require(l.status == Status.STOCKE, "Lot blocked or not in stock");
        require(l.expiresAt == 0 || block.timestamp < l.expiresAt, "Lot expired");
        l.status = Status.VENDU;
        _log(lotId, "SELL", NO_TEMP, "", "");
    }

    function recallLot(string calldata lotId, string calldata reason) external {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(hasRole(AUDITOR, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender)
             || l.currentOwner == msg.sender, "Not allowed");
        require(l.status != Status.VENDU, "Already sold");
        l.status = Status.BLOQUE_RAPPELE;
        emit Alert(lotId, reason, msg.sender);
        _log(lotId, "RECALL", NO_TEMP, "", "");
    }

    // TODO: logStorage (EF-08) and addCorrection (rule 4), same pattern as above

    // ---------- Views ----------
    function getLot(string calldata lotId) external view returns (Lot memory) {
        require(lotExists[lotId], "Unknown lot");
        return lots[lotId];
    }
    function getHistory(string calldata lotId) external view returns (EventRecord[] memory) {
        return history[lotId];
    }

    // ---------- Internal ----------
    function _log(string memory lotId, string memory eventType, int16 temp,
                  string memory dataHash, string memory uri) internal {
        uint64 ts = uint64(block.timestamp);
        string memory id = string.concat("EVT-", Strings.toString(history[lotId].length + 1));
        history[lotId].push(EventRecord(id, lotId, eventType, msg.sender, ts, temp, dataHash, uri));
        emit LotEvent(lotId, eventType, msg.sender, ts);
    }
    function _isBusinessRole(bytes32 r) internal view returns (bool) {
        return r == PRODUCER || r == PROCESSOR || r == TRANSPORTER
            || r == WAREHOUSE || r == RETAILER || r == AUDITOR;
    }
    function _isReceiver(address a) internal view returns (bool) {
        return hasRole(PROCESSOR, a) || hasRole(WAREHOUSE, a) || hasRole(RETAILER, a);
    }
}
```

**Things to know before you extend it**

- A received lot becomes STOCKÉ, including at the processor, so that the processor can use it as a transformation input.
- Reading `getHistory` is free and public. If a lot's details must stay hidden from competitors, keep them off-chain and expose only hashes. Anyone with access to a node can read all on-chain state, which is the main confidentiality limit compared with Fabric private data collections.
- Hardhat's default contract size limit is 24 KB. If you hit it, split the contract or enable the optimizer in the config (`solidity.settings.optimizer`).
- Run Slither (`pip install slither-analyzer`, then `slither .`) after each major change.

---

## 5. Step 4: Smart contract tests

Write the tests as you write each function: they double as proof for the acceptance criteria of section 8.2 of the spec. Put them in `contracts-project/test/SupplyChain.test.js`.

```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

async function deployFixture() {
  const [admin, producer, processor, transporter, warehouse, retailer, auditor, intruder] =
    await ethers.getSigners();
  const sc = await (await ethers.getContractFactory("SupplyChain")).deploy();
  const r = (name) => ethers.keccak256(ethers.toUtf8Bytes(name));
  await sc.registerOrganization(producer.address, "Ferme A", r("PRODUCER"));
  await sc.registerOrganization(processor.address, "Conserverie B", r("PROCESSOR"));
  await sc.registerOrganization(transporter.address, "Transport C", r("TRANSPORTER"));
  await sc.registerOrganization(warehouse.address, "Entrepot D", r("WAREHOUSE"));
  await sc.registerOrganization(retailer.address, "Magasin E", r("RETAILER"));
  await sc.registerOrganization(auditor.address, "Audit F", r("AUDITOR"));
  return { sc, admin, producer, processor, transporter, warehouse, retailer, auditor, intruder };
}

const newLot = (id) => ({
  lotId: id, productType: "Tomates biologiques", quantity: 1200, unit: "kg",
  origin: "Ferme A - Tunisie", expiresAt: 0, dataHash: "abc123", uri: "",
});

describe("SupplyChain", () => {
  it("lets a producer create a lot", async () => {
    const { sc, producer } = await loadFixture(deployFixture);
    await sc.connect(producer).createLot(newLot("LOT-2026-0001"));
    const lot = await sc.getLot("LOT-2026-0001");
    expect(lot.currentOwner).to.equal(producer.address);
  });

  it("rejects an unauthorized actor", async () => {
    const { sc, intruder } = await loadFixture(deployFixture);
    await expect(sc.connect(intruder).createLot(newLot("LOT-X"))).to.be.reverted;
  });
});
```

**Test cases to write, mapped to the acceptance criteria**

| Test | Criterion (section 8.2) |
| --- | --- |
| Full flow: create, ship, receive, transform, ship, receive, sell | 1 and 2 |
| `getHistory` returns events in order with increasing timestamps | 3 |
| No function can edit or delete a past event; correction adds a new one | 4 |
| Intruder, wrong role, or non-owner calls revert | 5 |
| Reception by a wrong address reverts; rejection without reason reverts | rules 2, 3, EF-07 |
| Duplicate `lotId` reverts | rule 1 |
| Transformation with zero inputs, or output quantity above input, reverts | rule 5 |
| Selling a recalled or expired lot reverts (use `time.increase` from the network helpers) | rule 6 |
| Temperature above threshold emits `Alert` (use `.to.emit`) | 7 |
| Revoked organization can no longer act, but its old events remain readable | EF-13 |
| Double transfer: shipping a lot already in transit reverts | security |

Run everything with coverage and a gas report:

```bash
npx hardhat test
npx hardhat coverage
```

Aim for at least 90% line coverage on `SupplyChain.sol`.

---

## 6. Step 5: Deployment and identities

Deploy to the local node, register the organizations, and save the contract address and ABI for the backend.

`scripts/deploy.js`:

```javascript
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  const signers = await ethers.getSigners();
  const [admin, producer, processor, transporter, warehouse, retailer, auditor] = signers;

  const sc = await (await ethers.getContractFactory("SupplyChain")).deploy();
  await sc.waitForDeployment();
  const address = await sc.getAddress();
  console.log("SupplyChain deployed at", address);

  const role = (n) => ethers.keccak256(ethers.toUtf8Bytes(n));
  await sc.registerOrganization(producer.address, "Ferme A", role("PRODUCER"));
  await sc.registerOrganization(processor.address, "Conserverie B", role("PROCESSOR"));
  await sc.registerOrganization(transporter.address, "Transport C", role("TRANSPORTER"));
  await sc.registerOrganization(warehouse.address, "Entrepot D", role("WAREHOUSE"));
  await sc.registerOrganization(retailer.address, "Magasin E", role("RETAILER"));
  await sc.registerOrganization(auditor.address, "Audit F", role("AUDITOR"));

  // Share address + ABI with the backend
  const artifact = require("../artifacts/contracts/SupplyChain.sol/SupplyChain.json");
  fs.writeFileSync("../backend/contract.json", JSON.stringify({ address, abi: artifact.abi }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
```

```bash
npx hardhat run scripts/deploy.js --network localhost
```

**Identity design.** Choose one of two models and write the choice in your report:

| Model | How it works | Pros and cons |
| --- | --- | --- |
| Backend signing (recommended) | Each user logs in with JWT; the backend holds the organization's key in an encrypted keystore and signs for them | Simple UX, works for QR and mobile; the backend is a trusted component |
| Wallet signing | Users sign in the browser with MetaMask connected to `http://127.0.0.1:8545`, chain ID 31337 | Closer to true decentralization; harder demo setup |

**Key management rules**

- Never commit private keys. Use a `.env` file listed in `.gitignore`, or an encrypted keystore (`ethers.Wallet.encrypt`).
- Hardhat's test keys are fine for demo; generate new keys for any shared deployment.
- Revocation (EF-13) = `revokeOrganization` on-chain, plus disabling the user in the backend database.

**Reset behaviour.** The Hardhat node keeps state in memory: stopping it erases all lots. Redeploy and re-seed after every restart with a `scripts/seed.js` that registers organizations and creates the demo lot `LOT-2026-0001`. Keep the off-chain database as an index you can rebuild from events.

---

## 7. Step 6: Backend API

The backend is the single entry point for the frontend: it authenticates users, signs transactions, stores files, indexes events and serves the public page.

```bash
cd backend
npm init -y
npm install express ethers dotenv jsonwebtoken bcryptjs multer qrcode swagger-ui-express cors
npm install pg      # or better-sqlite3 for a simpler setup
```

**Modules to build**

| Module | What it does | Spec |
| --- | --- | --- |
| `auth` | Register and login, bcrypt-hashed passwords, JWT carrying `userId`, `orgId`, `role` | EF-02, EF-03 |
| `chain` | Loads `contract.json`, creates an ethers `Contract` connected to the organization's wallet | all |
| `lots` | One REST route per contract function, with a role guard before calling the chain | EF-04 to EF-08 |
| `files` | Upload with multer, compute SHA-256, store the file, send hash and URI to the contract | rule 8 |
| `qr` | Generate a QR code for `https://<host>/verify/<lotId>` | EF-09 |
| `public` | Unauthenticated `GET /public/lots/:id` returning only publishable fields | EF-10 |
| `indexer` | Listens to `LotEvent` and `Alert`, writes to the database, powers dashboards and alerts | EF-11 |
| `audit` | Rebuilds a lot's timeline and exports CSV or PDF | EF-12 |
| `admin` | Register and revoke organizations and users | EF-01, EF-13 |

**Suggested endpoints**

| Method and path | Role | Action |
| --- | --- | --- |
| `POST /auth/login` | any | Returns a JWT |
| `POST /lots` | Producer | `createLot` |
| `POST /lots/transform` | Processor | `transformLots` |
| `POST /lots/:id/ship` | Owner | `shipLot` |
| `POST /lots/:id/transport` | Transporter | `logTransport` |
| `POST /lots/:id/receive` | Recipient | `confirmReception` |
| `POST /lots/:id/reject` | Recipient | `rejectReception` |
| `POST /lots/:id/sell` | Retailer | `sellLot` |
| `POST /lots/:id/recall` | Admin, Auditor | `recallLot` |
| `POST /lots/:id/documents` | Owner | Upload file, store hash |
| `GET /lots/:id/history` | Authenticated | Full event list |
| `GET /public/lots/:id` | Public | Consumer verification data |
| `GET /audit/lots/:id/export` | Auditor | CSV or PDF timeline |
| `POST /admin/organizations` | Admin | Register or revoke |

**Core pattern** (connect to the chain and call a function as an organization):

```javascript
const { ethers } = require("ethers");
const { address, abi } = require("./contract.json");

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");

function contractFor(privateKey) {
  const wallet = new ethers.Wallet(privateKey, provider);
  return new ethers.Contract(address, abi, wallet);
}

// Example: POST /lots/:id/ship
async function ship(req, res) {
  const sc = contractFor(req.user.privateKey);     // loaded from the encrypted keystore, never sent to the client
  const tx = await sc.shipLot(req.params.id, req.body.to, req.body.tempX10 ?? -32768, "", "");
  const receipt = await tx.wait();
  res.json({ txHash: receipt.hash, block: receipt.blockNumber });
}
```

**File hashing** (documents and photos):

```javascript
const crypto = require("crypto");
const fs = require("fs");

const sha256 = (path) =>
  crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
```

Store the file under `uploads/<sha256>.<ext>`, then send `dataHash` and `uri` with the next contract call. To verify a document later, recompute the hash and compare it with the on-chain value.

**QR code**

```javascript
const QRCode = require("qrcode");
const png = await QRCode.toBuffer(`${process.env.PUBLIC_URL}/verify/${lotId}`);
```

The QR holds only a URL, with no sensitive data (EF-09).

**Alerts (EF-11).** In the indexer, subscribe with `contract.on("Alert", ...)` and `contract.on("LotEvent", ...)`, save alerts in the database, and expose `GET /alerts` for the dashboard. Add off-chain checks that run every few minutes for lots near their `expiresAt` date.

**Public page data.** `GET /public/lots/:id` should return product type, origin, timeline events (type, date, organization name), current status, and document hashes with a "verified" flag. Never return personal data, prices or private documents.

**API docs.** Describe every route in an OpenAPI file and serve it with swagger-ui-express at `/docs` (ENF-06).

**Run order for development**

1. `npx hardhat node` in `contracts-project`.
2. `npx hardhat run scripts/deploy.js --network localhost`.
3. `node server.js` in `backend`.
4. `npm run dev` in `frontend`.

---

## 8. Step 7: Frontend

A responsive React web app covers the web and mobile requirement: the QR scan simply opens the public page in the phone's browser.

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install axios react-router-dom html5-qrcode
npm install -D tailwindcss
```

(For Tailwind setup, follow the current Tailwind installation page for Vite, since the steps changed between major versions.)

**Screens** (section 6.1 of the spec)

| Screen | Route | Content |
| --- | --- | --- |
| Login | `/login` | Email and password, then JWT stored in memory |
| Dashboard | `/` | Owned lots, pending transfers to confirm, alerts, filtered by role |
| Create lot | `/lots/new` | Form (product, origin, quantity, expiry), document upload, QR code preview and print |
| Event form | `/lots/:id/event` | Type, date, place, temperature, comment, attachment |
| Transfer | `/lots/:id/transfer` | Recipient selector, conditions, confirm; receiver sees accept and reject (with reason) |
| Lot detail | `/lots/:id` | Status badge, lineage, timeline, documents with hash check |
| Public verification | `/verify/:id` | No login: origin, vertical timeline, status, verified certificates |
| Admin console | `/admin` | Organizations, roles, revocation, audit export |

**Implementation tips**

- Show or hide buttons by role, but never rely on this: the contract is the real guard.
- Use a status badge with colors per state (green STOCKÉ, orange EN TRANSPORT, red BLOQUÉ).
- Show the transaction hash and block number after each action as proof for the demo.
- On the public page, show a green "verified" badge only if the document hash recomputed by the backend matches the on-chain hash.
- Add a scanner page with `html5-qrcode` for the demo on a laptop webcam or phone.
- Keep the lot creation form short: ENF-05 asks for under 3 minutes.

---

## 9. Step 8: Testing, demo and acceptance

**Test layers**

| Layer | Tool | What to cover |
| --- | --- | --- |
| Contract unit tests | Hardhat, Chai | Rules, roles, state transitions (Step 4) |
| Static analysis | Slither | Reentrancy, access control, unchecked inputs |
| API integration | Jest and Supertest against a local node | Login, role guards, each route calls the right function |
| End-to-end | Postman collection or Playwright | Full producer-to-consumer flow |
| Security | OWASP ZAP, manual cases | JWT tampering, access to another organization's lots, invalid input, SQL injection, file type checks |
| Performance | Autocannon or k6 | Public page under 3 seconds (ENF-01) with 100+ lots |

**Demo script** (matches the spec's scenario)

1. Producer creates `LOT-2026-0001` and prints the QR code.
2. Producer ships the lot to the processor; the processor confirms reception.
3. Processor transforms it into a new lot and ships it.
4. Transporter logs departure and temperature.
5. Warehouse confirms reception and stores the lot.
6. Warehouse ships to the retailer; the retailer confirms and sells.
7. Consumer scans the QR code and sees the verified timeline.
8. Failure demo 1: an unauthorized account tries `createLot` and is rejected.
9. Failure demo 2: an attempt to sell a recalled lot is rejected.
10. Show an alert triggered by a temperature of 12 C.

**Acceptance checklist** (section 8.2 of the spec)

- [ ] The six actors can execute their operations
- [ ] A lot can be created, transformed, transported, received and sold
- [ ] History is shown in chronological order
- [ ] A validated transaction cannot be modified directly
- [ ] An unauthorized actor is refused by the smart contract
- [ ] The QR code opens a consistent verification page
- [ ] An alert is generated for an abnormal condition
- [ ] Tests and documentation are delivered

**Deliverables checklist** (section 1.5)

- [ ] Mockups (Figma or draw.io)
- [ ] Data model and architecture diagrams
- [ ] Documented smart contract (NatSpec comments)
- [ ] Demo web app
- [ ] API with OpenAPI docs and install guide
- [ ] Unit, integration and security tests
- [ ] Final report and presentation

---

## 10. Timeline, team split and pitfalls

The plan below fits 9 weeks for three people; shorten or stretch the weeks to your deadline. Start with a thin vertical slice (create lot, ship, receive, read history) before adding roles, files and alerts.

| Week | Contracts and tests | Backend | Frontend and report |
| --- | --- | --- | --- |
| 1 | Setup, data model, state machine | Repo, DB schema, auth skeleton | Mockups, repo, Vite app |
| 2-3 | Contract functions and unit tests | Chain module, lot routes | Login, dashboard, create-lot form |
| 4 | Roles, revocation, Slither | Role guards, admin routes | Transfer and reception screens |
| 5 | Edge cases, coverage above 90% | File upload and hashing, QR | Lot detail, timeline |
| 6 | Deploy and seed scripts | Indexer, alerts | Public verification page, scanner |
| 7 | Security tests | Audit export, Swagger docs | Admin console, polish |
| 8 | Bug fixes | Integration tests | Demo rehearsal, report |
| 9 | Final tag | Install guide | Slides, final report |

**Suggested ownership**

- Ahmed Messoudi: smart contracts, tests, deployment scripts
- Mohamed Ali Kechrida: backend API, database, indexer, security tests
- Aymen Benyoussef: frontend, mockups, QR flow, report and slides

Swap roles freely, but keep one person responsible for each folder.

**Common pitfalls**

- **State is lost on node restart.** Always keep `deploy.js` and `seed.js` working so the demo can be rebuilt in one minute.
- **"Stack too deep" compiler error.** Group many parameters in a struct, as `NewLot` does.
- **Nonce errors when sending quickly.** Await each `tx.wait()` before the next transaction from the same wallet.
- **Strings cost gas and are inconvenient as keys.** Fine for a prototype; use `bytes32` ids for a production version.
- **Hardhat accounts have public keys.** Never reuse them outside local development.
- **Calling the blockchain "tamper-proof" without nuance.** Say in your report that it guarantees integrity after recording, not truth at the source (section 4.1 of the spec).

**Optional upgrades if time remains:** an Ethereum testnet deployment such as Sepolia, a multi-node private network (for example with Hyperledger Besu) to show real consensus, event indexing with The Graph, and a mobile app.
