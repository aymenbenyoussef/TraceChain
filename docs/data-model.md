# Supply-chain data model and state machine

This document defines the on-chain data needed by the supply-chain prototype.
The smart contract in Step 3 must enforce these rules; files, sensor readings,
and other large documents remain off-chain.

## Lot model

Each lot has one current status and one current owner. A lot is identified by
its unique `lotId`; quantities are integers in the unit declared by `unit`.

```solidity
enum Status {
    PRODUIT,
    TRANSFORME,
    EN_TRANSPORT,
    STOCKE,
    VENDU,
    BLOQUE_RAPPELE
}

struct Lot {
    string lotId;
    string productType;
    uint256 quantity;
    string unit;
    string origin;
    address currentOwner;
    address pendingOwner;
    Status status;
    Status previousStatus;
    uint64 createdAt;
    uint64 expiresAt;
    string[] parentLots;
}
```

### Field rules

- `lotId` is unique and cannot be reused after a lot is created.
- `quantity` is an integer. The contract rejects zero quantities.
- `currentOwner` is the organization currently responsible for the lot.
- `pendingOwner` is set only while a shipment is awaiting reception.
- `expiresAt` is a Unix timestamp; `0` means no expiry.
- `parentLots` contains the input lot IDs for a transformed lot and is never
  modified after creation.
- A sold lot cannot be shipped, transformed, recalled, or otherwise changed.

## Event model

Every state-changing operation appends one history record. Records are never
deleted or overwritten.

```solidity
struct EventRecord {
    string eventId;
    string lotId;
    string eventType;
    address actor;
    uint64 timestamp;
    int16 temperatureX10;
    string dataHash;
    string uri;
}
```

`temperatureX10` stores temperature multiplied by ten. For example, `42`
means `4.2` degrees Celsius. A reserved sentinel value (`type(int16).min`)
means that no temperature was supplied. Full sensor data and documents are
stored off-chain; `dataHash` contains their SHA-256 hash and `uri` identifies
their off-chain location.

Supported event types are:

| Event type | Meaning |
| --- | --- |
| `CREATE` | A producer created a lot |
| `TRANSFORM` | A processor consumed parent lots and created a new lot |
| `SHIP` | The current owner handed a lot to a recipient |
| `RECEIVE` | The recipient accepted a shipment |
| `REJECT` | The recipient rejected a shipment |
| `STORE` | A warehouse recorded storage conditions |
| `SELL` | A retailer sold the lot |
| `RECALL` | A lot was blocked or recalled |
| `CORRECTION` | A new correction referencing an earlier event |

A correction is always a new record. It must reference the original event ID
in its off-chain details or event metadata; the original record remains
unchanged.

## State transitions

| Operation | Required current state | New state | Authorized actor |
| --- | --- | --- | --- |
| Create lot | none | `PRODUIT` | Producer |
| Transform | `PRODUIT` parent lots | `TRANSFORME` | Processor owning every parent |
| Ship | `PRODUIT`, `TRANSFORME`, or `STOCKE` | `EN_TRANSPORT` | Current owner |
| Confirm reception | `EN_TRANSPORT` | `STOCKE` | Recipient |
| Reject reception | `EN_TRANSPORT` | sender's previous state | Recipient |
| Sell | `STOCKE` | `VENDU` | Retailer |
| Block or recall | any state except `VENDU` | `BLOQUE_RAPPELE` | Admin, auditor, or current owner |

When shipping, the lot's current owner becomes the sender and `pendingOwner`
becomes the recipient. Reception changes `currentOwner` to `pendingOwner` and
clears `pendingOwner`. Rejection restores the previous owner and clears the
pending owner.

## Invariants for Step 3

The contract must preserve these invariants:

1. A lot exists in exactly one status at a time.
2. A lot history is append-only and returned in chronological order.
3. Every state change produces a history record.
4. Only an authorized organization can perform its transition.
5. Transformations require all parent lots to exist, be `PRODUIT`, and belong
   to the processor; parent lots are not silently deleted.
6. `VENDU` and `BLOQUE_RAPPELE` are terminal for normal supply-chain actions.
7. No floating-point values are stored; quantities and temperatures use integer
   scaling.
8. Off-chain content is verifiable through its on-chain hash and URI.
