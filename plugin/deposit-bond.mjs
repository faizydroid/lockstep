#!/usr/bin/env node
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = "http://127.0.0.1:8560";
const REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const PUBLISHER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const account = privateKeyToAccount(PUBLISHER_PK);

const publicClient = createPublicClient({
  transport: http(RPC_URL)
});

const walletClient = createWalletClient({
  account,
  transport: http(RPC_URL)
});

// Get bond asset address
const bondAsset = await publicClient.readContract({
  address: REGISTRY,
  abi: [{ "name": "bondAsset", "type": "function", "stateMutability": "view", "inputs": [], "outputs": [{ "type": "address" }] }],
  functionName: 'bondAsset'
});

console.log("Bond asset:", bondAsset);

// Mint tokens
const mintHash = await walletClient.writeContract({
  address: bondAsset,
  abi: [{ "name": "mint", "type": "function", "inputs": [{ "name": "to", "type": "address" }, { "name": "amount", "type": "uint256" }], "outputs": [] }],
  functionName: 'mint',
  args: [account.address, parseEther('10000')]
});

console.log("Minted tokens:", mintHash);
await publicClient.waitForTransactionReceipt({ hash: mintHash });

// Approve registry
const approveHash = await walletClient.writeContract({
  address: bondAsset,
  abi: [{ "name": "approve", "type": "function", "inputs": [{ "name": "spender", "type": "address" }, { "name": "amount", "type": "uint256" }], "outputs": [{ "type": "bool" }] }],
  functionName: 'approve',
  args: [REGISTRY, parseEther('10000')]
});

console.log("Approved registry:", approveHash);
await publicClient.waitForTransactionReceipt({ hash: approveHash });

// Deposit
const depositHash = await walletClient.writeContract({
  address: REGISTRY,
  abi: [{ "name": "deposit", "type": "function", "inputs": [{ "name": "amount", "type": "uint256" }], "outputs": [] }],
  functionName: 'deposit',
  args: [parseEther('10000')]
});

console.log("Deposited bond:", depositHash);
await publicClient.waitForTransactionReceipt({ hash: depositHash });

console.log("Done! Bond deposited successfully.");
