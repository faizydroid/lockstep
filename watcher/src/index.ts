/**
 * Lockstep watcher.
 *
 * Two jobs:
 *
 *   1. Detect equivocation and submit the proof, permissionlessly, for the reward.
 *   2. Surface blocked rug-pull attempts by reading reverted-transaction reasons.
 *
 * On (2): there is deliberately no on-chain event for a blocked attempt. An earlier
 * design emitted one immediately before reverting, which the revert rolls back — so
 * no indexer would ever have received it, and the dead emit made rejection cost more
 * than a success. The revert reason carries the same data and survives in the trace,
 * so blocked attempts are read from failed transactions rather than from logs.
 *
 * Indexed by delegated account, not by chain. Decoding every transaction on Monad
 * against every manifest would scale with network throughput; watching only accounts
 * that hold a Lockstep delegation scales with users instead.
 */

import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";

import {
  findEquivocations,
  isProfitable,
  type EquivocationProof,
  type PublishedPin,
} from "./equivocation.ts";
import { pinRegistryAbi, guardErrorsAbi } from "./abi.ts";

export interface WatcherConfig {
  readonly rpcUrl: string;
  readonly chainId: 143 | 10143;
  readonly registry: Address;
  /** Omit to run in detect-only mode. */
  readonly challengerPrivateKey?: Hex;
  /** Accounts to monitor for blocked attempts. */
  readonly watchedAccounts?: readonly Address[];
  readonly minMarginInBondAsset?: bigint;
  readonly estimatedSlashCostInBondAsset?: bigint;
}

export interface BlockedAttempt {
  readonly txHash: Hex;
  readonly account: Address;
  readonly reason: string;
  readonly attestedSkillHash?: Hex;
  readonly pinnedSkillHash?: Hex;
}

export class Watcher {
  private readonly client: PublicClient;
  private readonly chain;
  // Declared and assigned explicitly rather than as a constructor parameter property.
  // Parameter properties emit assignment code, so Node's type stripping refuses the whole
  // file, and this package has no build step standing between source and runtime.
  private readonly config: WatcherConfig;

  constructor(config: WatcherConfig) {
    this.config = config;
    this.chain = config.chainId === 143 ? monad : monadTestnet;
    this.client = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    }) as PublicClient;
  }

  /** Reads every published pin and its current state. */
  async loadPins(fromBlock: bigint | "earliest" = "earliest"): Promise<readonly PublishedPin[]> {
    const logs = await this.client.getContractEvents({
      address: this.config.registry,
      abi: pinRegistryAbi,
      eventName: "Published",
      fromBlock,
    });

    const pins: PublishedPin[] = [];
    for (const log of logs) {
      const pinId = (log.args as { pinId?: Hex }).pinId;
      if (pinId === undefined) continue;

      const [pin, reclaimed] = await Promise.all([
        this.client.readContract({
          address: this.config.registry,
          abi: pinRegistryAbi,
          functionName: "getPin",
          args: [pinId],
        }) as Promise<{
          publisher: Address;
          skillHash: Hex;
          versionId: Hex;
          requiredBond: bigint;
          publishedAt: bigint;
          slashed: boolean;
          exists: boolean;
        }>,
        this.client.readContract({
          address: this.config.registry,
          abi: pinRegistryAbi,
          functionName: "bondReclaimed",
          args: [pinId],
        }) as Promise<boolean>,
      ]);

      if (!pin.exists) continue;
      pins.push({
        pinId,
        publisher: pin.publisher,
        skillHash: pin.skillHash,
        versionId: pin.versionId,
        publishedAt: pin.publishedAt,
        requiredBond: pin.requiredBond,
        slashed: pin.slashed,
        bondReclaimed: reclaimed,
      });
    }
    return pins;
  }

  /** Detect-only scan. Safe to run without a key. */
  async scan(): Promise<readonly EquivocationProof[]> {
    return findEquivocations(await this.loadPins());
  }

  /**
   * Scans and submits every profitable proof.
   *
   * Simulates before sending so a proof another watcher already claimed costs
   * nothing but an eth_call. In a race the reward goes to whoever lands first, and
   * losing that race must not cost a failed transaction.
   */
  async run(): Promise<{ submitted: readonly Hex[]; skipped: number }> {
    const key = this.config.challengerPrivateKey;
    if (key === undefined) throw new Error("watcher: challengerPrivateKey required to submit");

    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({ account, chain: this.chain, transport: http(this.config.rpcUrl) });

    const rewardBps = (await this.client.readContract({
      address: this.config.registry,
      abi: pinRegistryAbi,
      functionName: "challengerRewardBps",
    })) as bigint;

    const proofs = await this.scan();
    const submitted: Hex[] = [];
    let skipped = 0;

    for (const proof of proofs) {
      const profitable = isProfitable(proof, {
        challengerRewardBps: rewardBps,
        estimatedCostInBondAsset: this.config.estimatedSlashCostInBondAsset ?? 0n,
        minMargin: this.config.minMarginInBondAsset ?? 0n,
      });
      if (!profitable) {
        skipped += 1;
        continue;
      }

      try {
        await this.client.simulateContract({
          address: this.config.registry,
          abi: pinRegistryAbi,
          functionName: "slashEquivocation",
          args: [proof.firstPinId, proof.guiltyPinId],
          account: account.address,
        });
      } catch {
        // Already claimed, or no longer provable. Not an error.
        skipped += 1;
        continue;
      }

      submitted.push(
        await wallet.writeContract({
          address: this.config.registry,
          abi: pinRegistryAbi,
          functionName: "slashEquivocation",
          args: [proof.firstPinId, proof.guiltyPinId],
          chain: this.chain,
          account,
        }),
      );
    }

    return { submitted, skipped };
  }

  /**
   * Reads blocked attempts from reverted transactions sent to watched accounts.
   *
   * Requires a trace-capable RPC. On a node without it, this returns nothing rather
   * than throwing, because losing the feed must not take the slashing loop down with
   * it — enforcement matters more than reporting.
   */
  async blockedAttempts(fromBlock: bigint, toBlock: bigint): Promise<readonly BlockedAttempt[]> {
    const accounts = (this.config.watchedAccounts ?? []).map((a) => a.toLowerCase());
    if (accounts.length === 0) return [];

    const found: BlockedAttempt[] = [];

    for (let n = fromBlock; n <= toBlock; n += 1n) {
      let block;
      try {
        block = await this.client.getBlock({ blockNumber: n, includeTransactions: true });
      } catch {
        continue;
      }

      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        if (tx.to === null || !accounts.includes(tx.to.toLowerCase())) continue;

        const receipt = await this.client.getTransactionReceipt({ hash: tx.hash });
        if (receipt.status === "success") continue;

        // Re-run the call at the failing block to recover the revert data. Receipts
        // do not carry it.
        let decoded: BlockedAttempt = {
          txHash: tx.hash,
          account: tx.to,
          reason: "reverted (no reason recovered)",
        };
        try {
          await this.client.call({ to: tx.to, data: tx.input, blockNumber: n - 1n });
        } catch (error: unknown) {
          decoded = this.decodeRevert(tx.hash, tx.to, error) ?? decoded;
        }
        found.push(decoded);
      }
    }

    return found;
  }

  private decodeRevert(txHash: Hex, account: Address, error: unknown): BlockedAttempt | undefined {
    const data = extractRevertData(error);
    if (data === undefined) return undefined;

    try {
      const result = decodeErrorResult({ abi: guardErrorsAbi, data });
      if (result.errorName === "SkillHashMismatch") {
        const [attested, pinned] = result.args as readonly [Hex, Hex];
        return {
          txHash,
          account,
          reason:
            pinned === `0x${"00".repeat(32)}`
              ? "pin unknown or revoked by publisher"
              : "skill version does not match the approved pin",
          attestedSkillHash: attested,
          pinnedSkillHash: pinned,
        };
      }
      return { txHash, account, reason: result.errorName };
    } catch {
      return undefined;
    }
  }
}

function extractRevertData(error: unknown): Hex | undefined {
  // viem nests the raw data at varying depths depending on transport.
  let cursor: unknown = error;
  for (let depth = 0; depth < 8 && cursor !== null && typeof cursor === "object"; depth += 1) {
    const record = cursor as Record<string, unknown>;
    const data = record.data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      return data as Hex;
    }
    cursor = record.cause;
  }
  return undefined;
}

export { findEquivocations, isProfitable } from "./equivocation.ts";
export type { EquivocationProof, PublishedPin } from "./equivocation.ts";
