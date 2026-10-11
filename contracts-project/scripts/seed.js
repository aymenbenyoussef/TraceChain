const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const contractFile = path.resolve(__dirname, "../../backend/contract.json");

async function main() {
  if (!fs.existsSync(contractFile)) {
    throw new Error(
      `Missing ${contractFile}. Run deploy.js before seed.js.`
    );
  }

  const [admin, producer] = await ethers.getSigners();
  const deployment = JSON.parse(fs.readFileSync(contractFile, "utf8"));
  const supplyChain = new ethers.Contract(
    deployment.address,
    deployment.abi,
    producer
  );

  const transaction = await supplyChain.createLot({
    lotId: "LOT-2026-0001",
    productType: "Tomates biologiques",
    quantity: 1000,
    unit: "kg",
    origin: "Ferme A - Tunisie",
    expiresAt: 0,
    dataHash: "",
    uri: "",
  });
  await transaction.wait();

  console.log(`Seeded LOT-2026-0001 with producer ${producer.address}`);
  console.log(`Admin available for local administration: ${admin.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
