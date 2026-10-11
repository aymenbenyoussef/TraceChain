// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract SupplyChain is AccessControl {
    bytes32 public constant PRODUCER = keccak256("PRODUCER");
    bytes32 public constant PROCESSOR = keccak256("PROCESSOR");
    bytes32 public constant TRANSPORTER = keccak256("TRANSPORTER");
    bytes32 public constant WAREHOUSE = keccak256("WAREHOUSE");
    bytes32 public constant RETAILER = keccak256("RETAILER");
    bytes32 public constant AUDITOR = keccak256("AUDITOR");

    int16 public constant NO_TEMP = type(int16).min;
    int16 public constant MAX_TEMP_X10 = 80;

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
        Status prevStatus;
        uint64 createdAt;
        uint64 expiresAt;
        string[] parentLots;
    }

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

    struct NewLot {
        string lotId;
        string productType;
        uint256 quantity;
        string unit;
        string origin;
        uint64 expiresAt;
        string dataHash;
        string uri;
    }

    mapping(string => Lot) private lots;
    mapping(string => bool) public lotExists;
    mapping(string => EventRecord[]) private history;
    mapping(address => string) public orgName;
    mapping(string => mapping(string => string)) public correctionOf;

    event LotEvent(
        string lotId,
        string eventType,
        address indexed actor,
        uint64 timestamp
    );
    event Alert(string lotId, string code, address indexed actor);
    event Rejected(string lotId, address indexed by, string reason);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function registerOrganization(
        address org,
        string calldata name,
        bytes32 role
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(org != address(0), "Invalid organization");
        require(bytes(name).length > 0, "Organization name required");
        require(_isBusinessRole(role), "Unknown role");
        orgName[org] = name;
        _grantRole(role, org);
    }

    function revokeOrganization(
        address org,
        bytes32 role
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_isBusinessRole(role), "Unknown role");
        _revokeRole(role, org);
    }

    function createLot(NewLot calldata n) external onlyRole(PRODUCER) {
        require(bytes(n.lotId).length > 0, "Lot ID required");
        require(!lotExists[n.lotId], "Lot already exists");
        require(n.quantity > 0, "Quantity must be > 0");

        Lot storage l = lots[n.lotId];
        l.lotId = n.lotId;
        l.productType = n.productType;
        l.quantity = n.quantity;
        l.unit = n.unit;
        l.origin = n.origin;
        l.currentOwner = msg.sender;
        l.status = Status.PRODUIT;
        l.createdAt = uint64(block.timestamp);
        l.expiresAt = n.expiresAt;
        lotExists[n.lotId] = true;
        _log(n.lotId, "CREATE", NO_TEMP, n.dataHash, n.uri);
    }

    function transformLots(
        string[] calldata inputIds,
        NewLot calldata out
    ) external onlyRole(PROCESSOR) {
        require(inputIds.length > 0, "At least one input lot");
        require(!lotExists[out.lotId], "Output lot already exists");
        require(out.quantity > 0, "Quantity must be > 0");

        uint256 total;
        for (uint256 i = 0; i < inputIds.length; i++) {
            require(lotExists[inputIds[i]], "Unknown input lot");
            for (uint256 j = 0; j < i; j++) {
                require(
                    keccak256(bytes(inputIds[j])) != keccak256(bytes(inputIds[i])),
                    "Duplicate input lot"
                );
            }

            Lot storage inp = lots[inputIds[i]];
            require(inp.currentOwner == msg.sender, "Not the owner");
            require(
                inp.status == Status.STOCKE || inp.status == Status.PRODUIT,
                "Bad input status"
            );
            total += inp.quantity;
        }
        require(out.quantity <= total, "Incoherent quantity");

        for (uint256 i = 0; i < inputIds.length; i++) {
            Lot storage inp = lots[inputIds[i]];
            inp.quantity = 0;
            _log(inputIds[i], "CONSUMED", NO_TEMP, "", "");
        }

        Lot storage l = lots[out.lotId];
        l.lotId = out.lotId;
        l.productType = out.productType;
        l.quantity = out.quantity;
        l.unit = out.unit;
        l.origin = out.origin;
        l.currentOwner = msg.sender;
        l.status = Status.TRANSFORME;
        l.createdAt = uint64(block.timestamp);
        l.expiresAt = out.expiresAt;
        for (uint256 i = 0; i < inputIds.length; i++) {
            l.parentLots.push(inputIds[i]);
        }
        lotExists[out.lotId] = true;
        _log(out.lotId, "TRANSFORM", NO_TEMP, out.dataHash, out.uri);
    }

    function shipLot(
        string calldata lotId,
        address to,
        int16 tempX10,
        string calldata dataHash,
        string calldata uri
    ) external {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(l.currentOwner == msg.sender, "Only the current owner can transfer");
        require(
            l.status == Status.PRODUIT ||
                l.status == Status.TRANSFORME ||
                l.status == Status.STOCKE,
            "Lot cannot be shipped"
        );
        require(_isReceiver(to) && to != msg.sender, "Invalid recipient");

        l.prevStatus = l.status;
        l.pendingOwner = to;
        l.status = Status.EN_TRANSPORT;
        _log(lotId, "SHIP", tempX10, dataHash, uri);
    }

    function confirmReception(
        string calldata lotId,
        string calldata dataHash,
        string calldata uri
    ) external {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(l.status == Status.EN_TRANSPORT, "Lot not in transit");
        require(l.pendingOwner == msg.sender, "Not the recipient");

        l.currentOwner = msg.sender;
        l.pendingOwner = address(0);
        l.status = Status.STOCKE;
        _log(lotId, "RECEIVE", NO_TEMP, dataHash, uri);
    }

    function rejectReception(
        string calldata lotId,
        string calldata reason
    ) external {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(
            l.status == Status.EN_TRANSPORT && l.pendingOwner == msg.sender,
            "Not allowed"
        );
        require(bytes(reason).length > 0, "Reason required");

        l.pendingOwner = address(0);
        l.status = l.prevStatus;
        emit Rejected(lotId, msg.sender, reason);
        _log(lotId, "REJECT", NO_TEMP, "", "");
    }

    function logTransport(
        string calldata lotId,
        int16 tempX10,
        string calldata dataHash,
        string calldata uri
    ) external onlyRole(TRANSPORTER) {
        require(lotExists[lotId], "Unknown lot");
        require(lots[lotId].status == Status.EN_TRANSPORT, "Lot not in transit");
        if (tempX10 != NO_TEMP && tempX10 > MAX_TEMP_X10) {
            emit Alert(lotId, "TEMP_BREACH", msg.sender);
        }
        _log(lotId, "TRANSPORT", tempX10, dataHash, uri);
    }

    function logStorage(
        string calldata lotId,
        int16 tempX10,
        string calldata dataHash,
        string calldata uri
    ) external onlyRole(WAREHOUSE) {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(l.currentOwner == msg.sender, "Not the owner");
        require(l.status == Status.STOCKE, "Lot not in stock");
        if (tempX10 != NO_TEMP && tempX10 > MAX_TEMP_X10) {
            emit Alert(lotId, "TEMP_BREACH", msg.sender);
        }
        _log(lotId, "STORE", tempX10, dataHash, uri);
    }

    function sellLot(string calldata lotId) external onlyRole(RETAILER) {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(l.currentOwner == msg.sender, "Not the owner");
        require(l.status == Status.STOCKE, "Lot blocked or not in stock");
        require(l.expiresAt == 0 || block.timestamp < l.expiresAt, "Lot expired");

        l.status = Status.VENDU;
        _log(lotId, "SELL", NO_TEMP, "", "");
    }

    function recallLot(
        string calldata lotId,
        string calldata reason
    ) external {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(
            hasRole(AUDITOR, msg.sender) ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender) ||
                l.currentOwner == msg.sender,
            "Not allowed"
        );
        require(l.status != Status.VENDU, "Already sold");
        require(bytes(reason).length > 0, "Reason required");

        l.status = Status.BLOQUE_RAPPELE;
        emit Alert(lotId, reason, msg.sender);
        _log(lotId, "RECALL", NO_TEMP, "", "");
    }

    function addCorrection(
        string calldata lotId,
        string calldata originalEventId,
        string calldata dataHash,
        string calldata uri
    ) external {
        Lot storage l = lots[lotId];
        require(lotExists[lotId], "Unknown lot");
        require(
            l.currentOwner == msg.sender || hasRole(AUDITOR, msg.sender),
            "Not allowed"
        );
        require(bytes(originalEventId).length > 0, "Original event required");
        require(_eventExists(lotId, originalEventId), "Unknown original event");

        string memory correctionId = _log(
            lotId,
            "CORRECTION",
            NO_TEMP,
            dataHash,
            uri
        );
        correctionOf[lotId][correctionId] = originalEventId;
    }

    function getLot(string calldata lotId) external view returns (Lot memory) {
        require(lotExists[lotId], "Unknown lot");
        return lots[lotId];
    }

    function getHistory(
        string calldata lotId
    ) external view returns (EventRecord[] memory) {
        return history[lotId];
    }

    function _log(
        string memory lotId,
        string memory eventType,
        int16 temp,
        string memory dataHash,
        string memory uri
    ) internal returns (string memory eventId) {
        uint64 ts = uint64(block.timestamp);
        eventId = string.concat("EVT-", Strings.toString(history[lotId].length + 1));
        history[lotId].push(
            EventRecord(
                eventId,
                lotId,
                eventType,
                msg.sender,
                ts,
                temp,
                dataHash,
                uri
            )
        );
        emit LotEvent(lotId, eventType, msg.sender, ts);
    }

    function _eventExists(
        string memory lotId,
        string memory eventId
    ) internal view returns (bool) {
        EventRecord[] storage records = history[lotId];
        for (uint256 i = 0; i < records.length; i++) {
            if (keccak256(bytes(records[i].eventId)) == keccak256(bytes(eventId))) {
                return true;
            }
        }
        return false;
    }

    function _isBusinessRole(bytes32 role) internal pure returns (bool) {
        return
            role == PRODUCER ||
            role == PROCESSOR ||
            role == TRANSPORTER ||
            role == WAREHOUSE ||
            role == RETAILER ||
            role == AUDITOR;
    }

    function _isReceiver(address account) internal view returns (bool) {
        return
            hasRole(PROCESSOR, account) ||
            hasRole(WAREHOUSE, account) ||
            hasRole(RETAILER, account);
    }
}
