const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("SupplyChain", function () {
  async function deployFixture() {
    const [
      admin,
      producer,
      processor,
      transporter,
      warehouse,
      retailer,
      auditor,
      stranger,
    ] = await ethers.getSigners();
    const SupplyChain = await ethers.getContractFactory("SupplyChain");
    const supplyChain = await SupplyChain.deploy();

    const organizations = [
      [producer, "Producer", "PRODUCER"],
      [processor, "Processor", "PROCESSOR"],
      [transporter, "Transporter", "TRANSPORTER"],
      [warehouse, "Warehouse", "WAREHOUSE"],
      [retailer, "Retailer", "RETAILER"],
      [auditor, "Auditor", "AUDITOR"],
    ];
    for (const [account, name, roleName] of organizations) {
      await supplyChain.registerOrganization(
        account.address,
        name,
        await supplyChain[roleName]()
      );
    }

    return {
      supplyChain,
      admin,
      producer,
      processor,
      transporter,
      warehouse,
      retailer,
      auditor,
      stranger,
    };
  }

  function newLot(lotId, quantity = 100, expiresAt = 0) {
    return {
      lotId,
      productType: "Tomatoes",
      quantity,
      unit: "kg",
      origin: "Farm A",
      expiresAt,
      dataHash: `sha256:${lotId}`,
      uri: `ipfs://${lotId}`,
    };
  }

  async function createLot(supplyChain, producer, lotId, quantity = 100, expiresAt = 0) {
    await supplyChain.connect(producer).createLot(newLot(lotId, quantity, expiresAt));
  }

  async function sendTo(
    supplyChain,
    sender,
    recipient,
    lotId,
    temperature = 42
  ) {
    await supplyChain
      .connect(sender)
      .shipLot(lotId, recipient.address, temperature, "", "");
    await supplyChain.connect(recipient).confirmReception(lotId, "", "");
  }

  describe("organizations", function () {
    it("allows only the admin to register and revoke organizations", async function () {
      const { supplyChain, admin, stranger, producer } = await deployFixture();
      const producerRole = await supplyChain.PRODUCER();

      expect(await supplyChain.orgName(producer.address)).to.equal("Producer");
      await expect(
        supplyChain.connect(stranger).registerOrganization(
          stranger.address,
          "Stranger",
          producerRole
        )
      ).to.be.revertedWithCustomError(
        supplyChain,
        "AccessControlUnauthorizedAccount"
      );

      await supplyChain.connect(admin).revokeOrganization(producer.address, producerRole);
      await expect(
        supplyChain.connect(producer).createLot(newLot("REVOKED-LOT"))
      ).to.be.revertedWithCustomError(
        supplyChain,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("lot creation", function () {
    it("creates a lot and records its CREATE event", async function () {
      const { supplyChain, producer } = await deployFixture();

      await expect(
        supplyChain.connect(producer).createLot(newLot("LOT-1"))
      ).to.emit(supplyChain, "LotEvent").withArgs(
        "LOT-1",
        "CREATE",
        producer.address,
        anyValue
      );

      const lot = await supplyChain.getLot("LOT-1");
      const history = await supplyChain.getHistory("LOT-1");
      expect(lot.currentOwner).to.equal(producer.address);
      expect(lot.status).to.equal(0n);
      expect(lot.quantity).to.equal(100n);
      expect(history).to.have.length(1);
      expect(history[0].eventId).to.equal("EVT-1");
    });

    it("rejects missing, zero-quantity, and duplicate lots", async function () {
      const { supplyChain, producer } = await deployFixture();

      await expect(
        supplyChain.connect(producer).createLot(newLot("", 100))
      ).to.be.revertedWith("Lot ID required");
      await expect(
        supplyChain.connect(producer).createLot(newLot("ZERO", 0))
      ).to.be.revertedWith("Quantity must be > 0");

      await createLot(supplyChain, producer, "DUPLICATE");
      await expect(
        supplyChain.connect(producer).createLot(newLot("DUPLICATE"))
      ).to.be.revertedWith("Lot already exists");
    });

    it("rejects creation by a non-producer", async function () {
      const { supplyChain, stranger } = await deployFixture();
      await expect(
        supplyChain.connect(stranger).createLot(newLot("UNAUTHORIZED"))
      ).to.be.revertedWithCustomError(
        supplyChain,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  describe("transformation", function () {
    it("consumes parent lots and preserves their lineage", async function () {
      const { supplyChain, producer, processor } = await deployFixture();
      await createLot(supplyChain, producer, "INPUT-1", 100);
      await createLot(supplyChain, producer, "INPUT-2", 50);
      await sendTo(supplyChain, producer, processor, "INPUT-1");
      await sendTo(supplyChain, producer, processor, "INPUT-2");

      await supplyChain
        .connect(processor)
        .transformLots(["INPUT-1", "INPUT-2"], newLot("OUTPUT", 120));

      const output = await supplyChain.getLot("OUTPUT");
      const input = await supplyChain.getLot("INPUT-1");
      expect(output.status).to.equal(1n);
      expect(output.currentOwner).to.equal(processor.address);
      expect(output.parentLots).to.deep.equal(["INPUT-1", "INPUT-2"]);
      expect(input.quantity).to.equal(0n);
      expect((await supplyChain.getHistory("INPUT-1"))[3].eventType).to.equal(
        "CONSUMED"
      );
    });

    it("rejects unknown, duplicate, unowned, and oversized inputs", async function () {
      const { supplyChain, producer, processor } = await deployFixture();
      await createLot(supplyChain, producer, "INPUT", 10);

      await expect(
        supplyChain.connect(processor).transformLots(["UNKNOWN"], newLot("OUT"))
      ).to.be.revertedWith("Unknown input lot");
      await sendTo(supplyChain, producer, processor, "INPUT");
      await expect(
        supplyChain
          .connect(processor)
          .transformLots(["INPUT", "INPUT"], newLot("OUT"))
      ).to.be.revertedWith("Duplicate input lot");
      await expect(
        supplyChain.connect(processor).transformLots(["INPUT"], newLot("OUT", 11))
      ).to.be.revertedWith("Incoherent quantity");
    });
  });

  describe("shipping and reception", function () {
    it("transfers ownership after reception", async function () {
      const { supplyChain, producer, warehouse } = await deployFixture();
      await createLot(supplyChain, producer, "SHIP-1");

      await expect(
        supplyChain
          .connect(producer)
          .shipLot("SHIP-1", warehouse.address, 42, "hash", "uri")
      ).to.emit(supplyChain, "LotEvent").withArgs(
        "SHIP-1",
        "SHIP",
        producer.address,
        anyValue
      );
      let lot = await supplyChain.getLot("SHIP-1");
      expect(lot.status).to.equal(2n);
      expect(lot.pendingOwner).to.equal(warehouse.address);

      await supplyChain.connect(warehouse).confirmReception("SHIP-1", "", "");
      lot = await supplyChain.getLot("SHIP-1");
      expect(lot.status).to.equal(3n);
      expect(lot.currentOwner).to.equal(warehouse.address);
      expect(lot.pendingOwner).to.equal(ethers.ZeroAddress);
    });

    it("rejects invalid recipients and unauthorized reception", async function () {
      const { supplyChain, producer, warehouse, stranger } = await deployFixture();
      await createLot(supplyChain, producer, "SHIP-2");

      await expect(
        supplyChain.connect(producer).shipLot("SHIP-2", stranger.address, 0, "", "")
      ).to.be.revertedWith("Invalid recipient");
      await supplyChain.connect(producer).shipLot("SHIP-2", warehouse.address, 0, "", "");
      await expect(
        supplyChain.connect(stranger).confirmReception("SHIP-2", "", "")
      ).to.be.revertedWith("Not the recipient");
    });

    it("returns rejected shipments to the previous owner and status", async function () {
      const { supplyChain, producer, warehouse } = await deployFixture();
      await createLot(supplyChain, producer, "REJECT-1");
      await supplyChain.connect(producer).shipLot("REJECT-1", warehouse.address, 0, "", "");

      await expect(
        supplyChain.connect(warehouse).rejectReception("REJECT-1", "")
      ).to.be.revertedWith("Reason required");
      await expect(
        supplyChain
          .connect(warehouse)
          .rejectReception("REJECT-1", "Damaged packaging")
      ).to.emit(supplyChain, "Rejected").withArgs(
        "REJECT-1",
        warehouse.address,
        "Damaged packaging"
      );

      const lot = await supplyChain.getLot("REJECT-1");
      expect(lot.status).to.equal(0n);
      expect(lot.currentOwner).to.equal(producer.address);
      expect(lot.pendingOwner).to.equal(ethers.ZeroAddress);
    });
  });

  describe("transport and storage", function () {
    it("logs transport and emits an alert above the temperature threshold", async function () {
      const { supplyChain, producer, warehouse, transporter } = await deployFixture();
      await createLot(supplyChain, producer, "TEMP-1");
      await supplyChain.connect(producer).shipLot("TEMP-1", warehouse.address, 0, "", "");

      await expect(
        supplyChain.connect(transporter).logTransport("TEMP-1", 120, "hash", "uri")
      ).to.emit(supplyChain, "Alert").withArgs(
        "TEMP-1",
        "TEMP_BREACH",
        transporter.address
      );
      const history = await supplyChain.getHistory("TEMP-1");
      expect(history[2].eventType).to.equal("TRANSPORT");
      expect(history[2].temperatureX10).to.equal(120);
    });

    it("allows the warehouse owner to log storage", async function () {
      const { supplyChain, producer, warehouse } = await deployFixture();
      await createLot(supplyChain, producer, "STORE-1");
      await sendTo(supplyChain, producer, warehouse, "STORE-1");

      await supplyChain.connect(warehouse).logStorage("STORE-1", 40, "hash", "uri");
      const history = await supplyChain.getHistory("STORE-1");
      expect(history[3].eventType).to.equal("STORE");
    });

    it("rejects transport or storage logs in the wrong state", async function () {
      const { supplyChain, producer, transporter, warehouse } = await deployFixture();
      await createLot(supplyChain, producer, "STATE-1");
      await expect(
        supplyChain.connect(transporter).logTransport("STATE-1", 40, "", "")
      ).to.be.revertedWith("Lot not in transit");
      await expect(
        supplyChain.connect(warehouse).logStorage("STATE-1", 40, "", "")
      ).to.be.revertedWith("Not the owner");
    });
  });

  describe("selling and recalls", function () {
    it("prevents selling expired lots", async function () {
      const { supplyChain, producer, retailer } = await deployFixture();
      const expiry = (await time.latest()) + 10;
      await createLot(supplyChain, producer, "EXPIRED", 100, expiry);
      await sendTo(supplyChain, producer, retailer, "EXPIRED");
      await time.increaseTo(expiry);

      await expect(
        supplyChain.connect(retailer).sellLot("EXPIRED")
      ).to.be.revertedWith("Lot expired");
    });

    it("makes a sold lot terminal", async function () {
      const { supplyChain, producer, retailer, warehouse, auditor } =
        await deployFixture();
      await createLot(supplyChain, producer, "SOLD");
      await sendTo(supplyChain, producer, retailer, "SOLD");
      await supplyChain.connect(retailer).sellLot("SOLD");

      await expect(
        supplyChain.connect(retailer).shipLot("SOLD", warehouse.address, 0, "", "")
      ).to.be.revertedWith("Lot cannot be shipped");
      await expect(
        supplyChain.connect(auditor).recallLot("SOLD", "Recall")
      ).to.be.revertedWith("Already sold");
    });

    it("allows an auditor and current owner to recall unsold lots", async function () {
      const { supplyChain, producer, auditor } = await deployFixture();
      await createLot(supplyChain, producer, "RECALL-1");
      await supplyChain.connect(auditor).recallLot("RECALL-1", "Contamination");
      expect((await supplyChain.getLot("RECALL-1")).status).to.equal(5n);

      await createLot(supplyChain, producer, "RECALL-2");
      await supplyChain.connect(producer).recallLot("RECALL-2", "Damaged");
      expect((await supplyChain.getLot("RECALL-2")).status).to.equal(5n);
    });
  });

  describe("corrections and history", function () {
    it("appends a correction referencing an existing event", async function () {
      const { supplyChain, producer, auditor } = await deployFixture();
      await createLot(supplyChain, producer, "CORRECTION-1");

      await supplyChain
        .connect(auditor)
        .addCorrection("CORRECTION-1", "EVT-1", "sha256:correction", "ipfs://correction");

      const history = await supplyChain.getHistory("CORRECTION-1");
      expect(history).to.have.length(2);
      expect(history[0].eventType).to.equal("CREATE");
      expect(history[1].eventType).to.equal("CORRECTION");
      expect(await supplyChain.correctionOf("CORRECTION-1", "EVT-2")).to.equal(
        "EVT-1"
      );
    });

    it("rejects corrections from unauthorized users or unknown events", async function () {
      const { supplyChain, producer, stranger } = await deployFixture();
      await createLot(supplyChain, producer, "CORRECTION-2");

      await expect(
        supplyChain
          .connect(stranger)
          .addCorrection("CORRECTION-2", "EVT-1", "", "")
      ).to.be.revertedWith("Not allowed");
      await expect(
        supplyChain
          .connect(producer)
          .addCorrection("CORRECTION-2", "EVT-99", "", "")
      ).to.be.revertedWith("Unknown original event");
    });
  });
});
