# TraceChain Test Login Profiles

These accounts are for local testing only. They are not production
credentials and must not be used on a public deployment.

## Application URLs

| Service | URL |
|---|---|
| Frontend | http://localhost:8080 |
| Backend API | http://localhost:3000 |
| Swagger documentation | http://localhost:3000/docs |

Start the application first:

```powershell
docker compose up --build
```

## Test profiles

| Profile | Email | Password | Organization ID | Role |
|---|---|---|---|---|
| Producer | `producer@example.com` | `Producer123!` | `producer` | `PRODUCER` |
| Processor | `processor@example.com` | `Processor123!` | `processor` | `PROCESSOR` |
| Transporter | `transporter@example.com` | `Transporter123!` | `transporter` | `TRANSPORTER` |
| Warehouse | `warehouse@example.com` | `Warehouse123!` | `warehouse` | `WAREHOUSE` |
| Retailer | `retailer@example.com` | `Retailer123!` | `retailer` | `RETAILER` |
| Auditor | `auditor@example.com` | `Auditor123!` | `auditor` | `AUDITOR` |

## Create all test profiles

The backend currently stores users in memory. Run this script after starting
the backend, and run it again after restarting the backend container:

```powershell
$profiles = @(
  @{ email = "producer@example.com"; password = "Producer123!"; orgId = "producer"; role = "PRODUCER" },
  @{ email = "processor@example.com"; password = "Processor123!"; orgId = "processor"; role = "PROCESSOR" },
  @{ email = "transporter@example.com"; password = "Transporter123!"; orgId = "transporter"; role = "TRANSPORTER" },
  @{ email = "warehouse@example.com"; password = "Warehouse123!"; orgId = "warehouse"; role = "WAREHOUSE" },
  @{ email = "retailer@example.com"; password = "Retailer123!"; orgId = "retailer"; role = "RETAILER" },
  @{ email = "auditor@example.com"; password = "Auditor123!"; orgId = "auditor"; role = "AUDITOR" }
)

foreach ($profile in $profiles) {
  $body = $profile | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod `
      -Uri "http://localhost:3000/auth/register" `
      -Method Post `
      -ContentType "application/json" `
      -Body $body
  } catch {
    Write-Host "Could not register $($profile.email): $($_.ErrorDetails.Message)"
  }
}
```

If a profile already exists, the API returns `User already exists`. This is
expected and does not indicate a problem.

## Login from the frontend

Open http://localhost:8080 and use any profile from the table above.

Example:

```text
Email:    producer@example.com
Password: Producer123!
```

## Login through the API

Example PowerShell request:

```powershell
$login = @{
  email = "producer@example.com"
  password = "Producer123!"
} | ConvertTo-Json -Compress

$response = Invoke-RestMethod `
  -Uri "http://localhost:3000/auth/login" `
  -Method Post `
  -ContentType "application/json" `
  -Body $login

$response.token
```

Use the returned token for authenticated API requests:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:3000/alerts" `
  -Headers @{ Authorization = "Bearer $($response.token)" }
```

## Role testing

The frontend login currently provides the common authenticated dashboard and
public lot verification view. Use Swagger or PowerShell to test role-specific
operations:

| Role | Example operation |
|---|---|
| `PRODUCER` | Create a lot with `POST /lots` |
| `PROCESSOR` | Transform lots with `POST /lots/transform` |
| `TRANSPORTER` | Record transport with `POST /lots/:id/transport` |
| `WAREHOUSE` | Record storage with `POST /lots/:id/storage` |
| `RETAILER` | Sell a lot with `POST /lots/:id/sell` |
| `AUDITOR` | Recall a lot with `POST /lots/:id/recall` |

The smart contract performs the final authorization check. Frontend visibility
does not replace backend or contract authorization.

## Important limitations

- Users are stored in backend memory and are lost when the backend restarts.
- Passwords are bcrypt-hashed before storage.
- JWTs expire after eight hours.
- The organization private keys used by Docker are Hardhat development keys.
- Do not copy these profiles or keys into a production environment.
