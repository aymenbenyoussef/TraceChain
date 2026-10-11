const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const backendContractPath = path.resolve(__dirname, "../../backend/contract.json");

async function main() {
  const [
    admin,
    producer,
    processor,
    transporter,
    warehouse,
    retailer,
    auditor,
  ] = await ethers.getSigners();

  const SupplyChain = await ethers.getContractFactory("SupplyChain");
  const supplyChain = await SupplyChain.deploy();
  await supplyChain.waitForDeployment();

  const address = await supplyChain.getAddress();
  console.log(`SupplyChain deployed at ${address}`);

  const organizations = [
    [producer, "Ferme A", "PRODUCER"],
    [processor, "Conserverie B", "PROCESSOR"],
    [transporter, "Transport C", "TRANSPORTER"],
    [warehouse, "Entrepot D", "WAREHOUSE"],
    [retailer, "Magasin E", "RETAILER"],
    [auditor, "Audit F", "AUDITOR"],
  ];

  for (const [account, name, roleName] of organizations) {
    const role = await supplyChain[roleName]();
    const transaction = await supplyChain.registerOrganization(
      account.address,
      name,
      role
    );
    await transaction.wait();
    console.log(`Registered ${name}: ${account.address}`);
  }

  const artifact = require("../artifacts/contracts/SupplyChain.sol/SupplyChain.json");
  fs.mkdirSync(path.dirname(backendContractPath), { recursive: true });
  fs.writeFileSync(
    backendContractPath,
    JSON.stringify({ address, abi: artifact.abi }, null, 2)
  );
  console.log(`Wrote contract address and ABI to ${backendContractPath}`);
  console.log(`Admin: ${admin.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
