const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const deploymentPath = path.join(__dirname, "contract.json");
if (!fs.existsSync(deploymentPath)) {
  throw new Error(`Missing deployment file: ${deploymentPath}`);
}

const { address, abi } = require(deploymentPath);
const provider = new ethers.JsonRpcProvider(
  process.env.RPC_URL || "http://127.0.0.1:8545"
);

function contractFor(privateKey) {
  if (!privateKey) {
    throw new Error("No signing key configured for this organization");
  }
  return new ethers.Contract(address, abi, new ethers.Wallet(privateKey, provider));
}

async function send(contract, method, args) {
  const transaction = await contract[method](...args);
  const receipt = await transaction.wait();
  return {
    txHash: receipt.hash || receipt.transactionHash,
    block: receipt.blockNumber,
  };
}

function publicContract() {
  return new ethers.Contract(address, abi, provider);
}

module.exports = { address, abi, provider, contractFor, publicContract, send };
