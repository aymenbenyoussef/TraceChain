# Run the project through Step 6

This guide runs the local blockchain, deploys the smart contract, seeds a demo
lot, and starts the backend API.

The project uses Hardhat's local development accounts. Their private keys are
printed by `npx hardhat node`. These keys are public test keys only. Never use
them outside local development, and never commit them to a file or repository.

## 1. Install dependencies

Open PowerShell and install the contract dependencies:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\contracts-project
npm install
```

Install the backend dependencies:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\backend
npm install
```

## 2. Compile and test the contract

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\contracts-project
npm run compile
npm test
```

All contract tests should pass before continuing.

## 3. Start the local blockchain

Keep this terminal open:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\contracts-project
npx hardhat node
```

The node displays accounts and private keys. Use the first accounts for these
organizations:

| Hardhat account | Organization |
| --- | --- |
| Account 0 | Admin |
| Account 1 | Producer |
| Account 2 | Processor |
| Account 3 | Transporter |
| Account 4 | Warehouse |
| Account 5 | Retailer |
| Account 6 | Auditor |

## 4. Deploy and seed the contract

Open a second PowerShell window:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\contracts-project
npm run deploy:local
npm run seed:local
```

Deployment registers the organization roles and writes the contract address and
ABI to `backend/contract.json`. Seeding creates the demo lot
`LOT-2026-0001`.

If the Hardhat node is stopped, its state is erased. Start it again and repeat
both deployment commands.

## 5. Create the backend environment file

Copy the example environment file:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\backend
Copy-Item .env.example .env
```

Open `.env` and set a random JWT secret:

```env
PORT=3000
RPC_URL=http://127.0.0.1:8545
PUBLIC_URL=http://localhost:3000
JWT_SECRET=replace-this-with-a-long-random-secret
```

Generate a local JWT secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Copy the generated value after `JWT_SECRET=`.

## 6. Copy the local Hardhat private keys into `.env`

Copy the private keys from the Hardhat node terminal into the matching
variables below:

```env
ORG_PRODUCER_PRIVATE_KEY=private-key-from-account-1
ORG_PROCESSOR_PRIVATE_KEY=private-key-from-account-2
ORG_TRANSPORTER_PRIVATE_KEY=private-key-from-account-3
ORG_WAREHOUSE_PRIVATE_KEY=private-key-from-account-4
ORG_RETAILER_PRIVATE_KEY=private-key-from-account-5
ORG_AUDITOR_PRIVATE_KEY=private-key-from-account-6
```

Do not include the `0x` prefix only if the key shown by Hardhat does not have
one; normally Hardhat already prints the correct `0x...` format. Do not put the
admin private key in an organization variable.

The organization ID used during registration must match the variable name. For
example, a user registered with `orgId: "producer"` uses
`ORG_PRODUCER_PRIVATE_KEY`.

The `.env` file is ignored by Git. Do not rename it to `.env.example` after
adding keys, and do not paste the keys into source code.

## 7. Start the backend

Keep the Hardhat node running, then start the backend in another terminal:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\backend
node server.js
```

The API runs at:

```text
http://localhost:3000
```

Health check:

```text
http://localhost:3000/health
```

Public demo lot:

```text
http://localhost:3000/public/lots/LOT-2026-0001
```

API documentation:

```text
http://localhost:3000/docs
```

## Development terminal summary

Three terminals are required:

```text
Terminal 1: npx hardhat node
Terminal 2: npm run deploy:local, then npm run seed:local
Terminal 3: node server.js
```
