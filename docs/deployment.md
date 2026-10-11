# Local deployment and identity model

The prototype uses **wallet signing** for local development. Each Hardhat
account represents one organization, and the account signs its own contract
transactions. This keeps the local demo close to the decentralized model
without storing private keys in the project.

Hardhat's accounts and private keys are temporary development credentials.
Never use them for a shared or production deployment.

## Deploy and register organizations

Start the local chain in one terminal:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\contracts-project
npx hardhat node
```

In a second terminal, deploy the contract and register the local identities:

```powershell
cd C:\Users\USER\Desktop\Blockchain_project\contracts-project
npx hardhat run scripts/deploy.js --network localhost
```

The deployment script writes the deployed address and ABI to:

```text
backend/contract.json
```

## Seed the demo lot

After deployment, create the demonstration lot:

```powershell
npx hardhat run scripts/seed.js --network localhost
```

The script creates `LOT-2026-0001` using the producer account.

The Hardhat node stores state only in memory. If it is stopped, deploy again
and run the seed script again.
