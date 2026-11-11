# Docker deployment

The complete local demo is orchestrated with Docker Compose:

1. `blockchain` starts a Hardhat JSON-RPC node.
2. `deploy` waits for the node, compiles and deploys `SupplyChain`, then seeds
   `LOT-2026-0001`. The generated ABI and address are stored in the shared
   `deployment` volume.
3. `backend` starts with that deployment, connects to the blockchain service,
   and persists uploaded files in the `uploads` volume.
4. `frontend` serves the React application on port `8080`.

## Run

From the repository root:

```powershell
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). The API and Swagger UI
are available at [http://localhost:3000](http://localhost:3000) and
[http://localhost:3000/docs](http://localhost:3000/docs).

The Compose defaults use Hardhat's public local development accounts. They are
safe only for this local demo. For a different local key set, copy
`.env.example` to `.env` and set all six `ORG_*_PRIVATE_KEY` values plus a
strong `JWT_SECRET`.

To stop and remove the demo chain and its generated data:

```powershell
docker compose down -v
```

Do not use this Compose configuration as a production deployment. Hardhat is
an in-memory development network and the organization keys are supplied as
environment variables.
