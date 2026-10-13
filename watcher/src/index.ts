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
  /**
   * First block to look for `Published` logs in. Default 0.
   *
   * On Monad set this to the registry's first use (or its deployment), not to zero: the public RPC
   * answers one log query per 100 blocks, so a scan from zero is hundreds of thousands of requests.
   */
  readonly fromBlock?: bigint;
  /** Largest block range per log query. Default 100, which is what Monad's public RPC allows. */
  readonly logWindow?: bigint;
  /**
   * Most log queries one scan may send. Default 1,000.
   *
   * A scan that reaches it stops, reports `truncated`, and the next scan resumes from where it stopped,
   * so a watcher catches up over several rounds instead of hammering a shared endpoint or never returning.
   */
  readonly maxLogRequests?: number;
  /** Pins to read directly, without finding them in logs: for example the ids an indexer already holds. */
  readonly knownPinIds?: readonly Hex[];
}

export interface BlockedAttempt {
  readonly txHash: Hex;
  readonly account: Address;
  readonly reason: string;
  readonly attestedSkillHash?: Hex;
  readonly pinnedSkillHash?: Hex;
}

/** The result of reading pins: what was found, and whether the log scan reached the head. */
export interface PinLoad {
  readonly pins: readonly PublishedPin[];
  /**
   * True when the log budget ran out before the head. Pins published after `scannedTo` are not in `pins`
   * yet, so "no equivocation found" means "none among these", not "none".
   */
  readonly truncated: boolean;
  /** The last block whose logs were read. */
  readonly scannedTo: bigint;
}

/** Blocked attempts found in a range, and the blocks that could not be read. */
export interface BlockedScan {
  readonly attempts: readonly BlockedAttempt[];
  /** Blocks that failed to load. One listed here may hold an attempt this scan did not see. */
  readonly unreadable: readonly bigint[];
}

/** How many log windows are requested at once. Few enough to stay polite to a shared public endpoint. */
const LOG_CONCURRENCY = 4;

function isRangeRefusal(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { details?: string }).details ?? ""}` : String(error);
  return /limited to a \d+ range|-32614|block range|range (is )?too (large|wide|big)|exceed(s|ed)? (the )?(max|maximum|limit)/i.test(
    text,
  );
}

export class Watcher {
  private readonly client: PublicClient;
  private readonly chain;
  // Declared and assigned explicitly rather than as a constructor parameter property.
  // Parameter properties emit assignment code, so Node's type stripping refuses the whole
  // file, and this package has no build step standing between source and runtime.
  private readonly config: WatcherConfig;
  /** Next block whose logs have not been read. Survives between scans so a truncated one resumes. */
  private cursor: bigint | undefined;
  private readonly pinIds = new Set<Hex>();
  private latest: { readonly truncated: boolean; readonly scannedTo: bigint } | undefined;

  constructor(config: WatcherConfig) {
    this.config = config;
    this.chain = config.chainId === 143 ? monad : monadTestnet;
    this.client = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    }) as PublicClient;
    for (const id of config.knownPinIds ?? []) this.pinIds.add(id.toLowerCase() as Hex);
  }

  /** What the most recent scan covered. Undefined before the first one. */
  get lastScan(): { readonly truncated: boolean; readonly scannedTo: bigint } | undefined {
    return this.latest;
  }

  /**
   * Reads every published pin it has found, and its current state.
   *
   * Finding pins means reading `Published` logs, and Monad's public RPC refuses any log query over 100
   * blocks. This used to ask for `fromBlock: "earliest"` in one call, which that endpoint rejects, so the
   * watcher could not run on the chain it exists for. It now pages in windows, spends at most
   * `maxLogRequests` per call, and remembers where it stopped.
   */
  async loadPins(): Promise<PinLoad> {
    // cacheTime 0: viem answers a repeat getBlockNumber from a four-second cache, and a watcher that polls
    // faster than that would scan up to a head it had already passed.
    const head = await this.client.getBlockNumber({ cacheTime: 0 });
    let next = this.cursor ?? this.config.fromBlock ?? 0n;
    let window = this.config.logWindow ?? 100n;
    let budget = this.config.maxLogRequests ?? 1_000;

    while (next <= head && budget > 0) {
      const ranges: { from: bigint; to: bigint }[] = [];
      for (let cursor = next; cursor <= head && ranges.length < Math.min(LOG_CONCURRENCY, budget); cursor += window) {
        const to = cursor + window - 1n < head ? cursor + window - 1n : head;
        ranges.push({ from: cursor, to });
      }
      budget -= ranges.length;

      const results = await Promise.allSettled(
        ranges.map((r) =>
          this.client.getContractEvents({
            address: this.config.registry,
            abi: pinRegistryAbi,
            eventName: "Published",
            fromBlock: r.from,
            toBlock: r.to,
          }),
        ),
      );

      let refused = false;
      for (const [i, result] of results.entries()) {
        const range = ranges[i]!;
        if (result.status === "rejected") {
          // A narrower limit than assumed: halve the window and redo from this range, rather than failing.
          if (window > 1n && isRangeRefusal(result.reason)) {
            window = window / 2n;
            next = range.from;
            refused = true;
            break;
          }
          throw result.reason;
        }
        for (const log of result.value) {
          const pinId = (log.args as { pinId?: Hex }).pinId;
          if (pinId !== undefined) this.pinIds.add(pinId.toLowerCase() as Hex);
        }
        next = range.to + 1n;
      }
      if (refused) continue;
    }

    this.cursor = next;
    const truncated = next <= head;
    const scannedTo = next - 1n;
    this.latest = { truncated, scannedTo };

    const pins: PublishedPin[] = [];
    for (const pinId of this.pinIds) {
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
    return { pins, truncated, scannedTo };
  }

  /** Detect-only scan. Safe to run without a key. Check `lastScan.truncated` before reading silence as safety. */
  async scan(): Promise<readonly EquivocationProof[]> {
    return findEquivocations((await this.loadPins()).pins);
  }

  /**
   * Scans and submits every profitable proof.
   *
   * Simulates before sending so a proof another watcher already claimed costs
   * nothing but an eth_call. In a race the reward goes to whoever lands first, and
   * losing that race must not cost a failed transaction.
   */
  async run(): Promise<{ submitted: readonly Hex[]; skipped: number; truncated: boolean }> {
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
    const truncated = this.latest?.truncated ?? false;
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

      /*
       * The guilty pin goes FIRST.
       *
       * `slashEquivocation(A, B)` takes the later pin's bond, and when both have the same `publishedAt` it
       * takes A's (`a.publishedAt >= b.publishedAt`). Monad's blocks are far shorter than the timestamp's
       * one-second resolution, so two publishes landing together share a timestamp, and with the earlier
       * claim passed first this call slashed the honest earlier pin that users had approved against.
       * Guilty first is correct in both cases: when the guilty pin is strictly later it is the one the
       * contract picks anyway, and on a tie it is the one named first.
       */
      const args = [proof.guiltyPinId, proof.firstPinId] as const;

      try {
        await this.client.simulateContract({
          address: this.config.registry,
          abi: pinRegistryAbi,
          functionName: "slashEquivocation",
          args,
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
          args,
          chain: this.chain,
          account,
        }),
      );
    }

    return { submitted, skipped, truncated };
  }

  /**
   * Reads blocked attempts from reverted transactions sent to watched accounts.
   *
   * Each failed transaction is replayed one block earlier, as the account that sent it, to recover the
   * revert data a receipt does not carry. The replay needs the sender: without it every refusal read as
   * `NotAuthorizedExecutor`, because the guard checks who is calling before it checks anything else, so
   * the feed reported the same reason for a rug pull and for a stranger knocking.
   *
   * Requires an RPC that serves `eth_call` at a past block. A block that cannot be read is listed in
   * `unreadable` rather than skipped silently, so a gap in the feed is visible as a gap.
   */
  async blockedAttempts(fromBlock: bigint, toBlock: bigint): Promise<BlockedScan> {
    const accounts = (this.config.watchedAccounts ?? []).map((a) => a.toLowerCase());
    if (accounts.length === 0) return { attempts: [], unreadable: [] };

    const found: BlockedAttempt[] = [];
    const unreadable: bigint[] = [];

    for (let n = fromBlock; n <= toBlock; n += 1n) {
      let block;
      try {
        block = await this.client.getBlock({ blockNumber: n, includeTransactions: true });
      } catch {
        unreadable.push(n);
        continue;
      }

      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        if (tx.to === null || !accounts.includes(tx.to.toLowerCase())) continue;

        let receipt;
        try {
          receipt = await this.client.getTransactionReceipt({ hash: tx.hash });
        } catch {
          unreadable.push(n);
          continue;
        }
        if (receipt.status === "success") continue;

        let decoded: BlockedAttempt = {
          txHash: tx.hash,
          account: tx.to,
          reason: "reverted (no reason recovered)",
        };
        try {
          await this.client.call({
            account: tx.from,
            to: tx.to,
            data: tx.input,
            value: tx.value,
            blockNumber: n - 1n,
          });
        } catch (error: unknown) {
          decoded = this.decodeRevert(tx.hash, tx.to, error) ?? decoded;
        }
        found.push(decoded);
      }
    }

    return { attempts: found, unreadable };
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
