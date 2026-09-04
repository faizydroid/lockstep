/**
 * Chain adapter: turns the pure policy decision into on-chain reads and one write.
 *
 * Two responsibilities, deliberately separated from `policy.ts` so the security
 * logic stays testable without a node:
 *
 *   1. `findApprovedPin` - given a skill hash the plugin computed, find a pin the
 *      account has approved that covers exactly that hash.
 *   2. `submit` - send the guarded batch.
 *
 * The account's approval set is discovered from `PinApproved` / `PinUnapproved`
 * logs on the account address rather than by asking the account holder to
 * configure a list. Configuration would drift; logs cannot.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";

import { lockstepGuardAbi, pinRegistryAbi } from "./abi.ts";
import type { ApprovedPin } from "./policy.ts";
import type { GuardedCall } from "./index.ts";
import type { Decision } from "./policy.ts";

export interface ChainConfig {
  readonly rpcUrl: string;
  readonly chainId: 143 | 10143;
  /**
   * Chain override, for tests against a local node.
   *
   * Production callers omit this and get Monad from `chainId`. Without the override
   * the adapter could only ever be exercised against a real Monad endpoint, which
   * means the code that actually submits transactions would go untested — the worst
   * possible thing to leave uncovered.
   */
  readonly chainOverride?: Chain;
  readonly registry: Address;
  /** The account holding the funds. Delegated to LockstepGuard via EIP-7702. */
  readonly account: Address;
  /**
   * Executor key. Pays gas, holds no funds.
   *
   * This must never be the account's key. If it were, the agent could sign
   * transactions straight to any target and the guard would never run — see the
   * threat model in LockstepGuard.sol.
   */
  readonly executorPrivateKey: Hex;
}

export class ChainAdapter {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: Address;
  private readonly registry: Address;
  private readonly executor: Address;
  private readonly chain: Chain;

  /** skillHash -> pin, or null for a hash known to have no approved pin. */
  private readonly pinCache = new Map<Hex, ApprovedPin | null>();

  // Declared and assigned explicitly rather than as a constructor parameter property.
  // Parameter properties emit assignment code, so Node's type stripping refuses the whole
  // file, and this package has no build step standing between source and runtime.
  private readonly config: ChainConfig;

  constructor(config: ChainConfig) {
    this.config = config;
    const chain = config.chainOverride ?? (config.chainId === 143 ? monad : monadTestnet);
    this.chain = chain;
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient;

    const executorAccount = privateKeyToAccount(config.executorPrivateKey);
    this.executor = executorAccount.address;
    this.walletClient = createWalletClient({
      account: executorAccount,
      chain,
      transport: http(config.rpcUrl),
    });

    this.account = config.account;
    this.registry = config.registry;

    if (this.executor.toLowerCase() === this.account.toLowerCase()) {
      // Fail at construction rather than silently running with a design that
      // cannot enforce anything.
      throw new Error(
        "Lockstep: the executor key must not be the account key. An agent holding the account key can bypass the guard entirely.",
      );
    }
  }

  get executorAddress(): Address {
    return this.executor;
  }

  /**
   * Approved pins for the account, as of the current chain head.
   *
   * Rebuilt from logs on each cache miss. `PinApproved` and `PinUnapproved` are
   * replayed in block order so a later revocation always wins over an earlier
   * approval, regardless of which arrives first from the RPC.
   */
  private async loadApprovals(): Promise<Set<Hex>> {
    const [approved, unapproved] = await Promise.all([
      this.publicClient.getContractEvents({
        address: this.account,
        abi: lockstepGuardAbi,
        eventName: "PinApproved",
        fromBlock: "earliest",
      }),
      this.publicClient.getContractEvents({
        address: this.account,
        abi: lockstepGuardAbi,
        eventName: "PinUnapproved",
        fromBlock: "earliest",
      }),
    ]);

    type Entry = { pinId: Hex; approved: boolean; block: bigint; index: number };
    const entries: Entry[] = [];
    for (const log of approved) {
      const pinId = (log.args as { pinId?: Hex }).pinId;
      if (pinId !== undefined) {
        entries.push({ pinId, approved: true, block: log.blockNumber ?? 0n, index: log.logIndex ?? 0 });
      }
    }
    for (const log of unapproved) {
      const pinId = (log.args as { pinId?: Hex }).pinId;
      if (pinId !== undefined) {
        entries.push({ pinId, approved: false, block: log.blockNumber ?? 0n, index: log.logIndex ?? 0 });
      }
    }
    entries.sort((a, b) => (a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1));

    const live = new Set<Hex>();
    for (const entry of entries) {
      if (entry.approved) live.add(entry.pinId);
      else live.delete(entry.pinId);
    }
    return live;
  }

  /**
   * Finds an approved pin whose live hash equals `skillHash`.
   *
   * Confirms the match against the registry rather than trusting the log stream:
   * an approval can outlive a publisher revocation, and `liveSkillHash` returns
   * zero for a revoked pin, which can never equal a real hash.
   */
  readonly findApprovedPin = async (skillHash: Hex): Promise<ApprovedPin | undefined> => {
    const cached = this.pinCache.get(skillHash);
    if (cached !== undefined) return cached ?? undefined;

    const approvals = await this.loadApprovals();
    let found: ApprovedPin | undefined;

    for (const pinId of approvals) {
      const live = (await this.publicClient.readContract({
        address: this.registry,
        abi: pinRegistryAbi,
        functionName: "liveSkillHash",
        args: [pinId],
      })) as Hex;

      if (live.toLowerCase() === skillHash.toLowerCase()) {
        const pin = (await this.publicClient.readContract({
          address: this.registry,
          abi: pinRegistryAbi,
          functionName: "getPin",
          args: [pinId],
        })) as { publisher: Address };
        found = { pinId, skillHash, publisher: pin.publisher };
        break;
      }
    }

    // Negative results are cached too, so a rug-pulled skill does not trigger a
    // full log replay on every attempted call.
    this.pinCache.set(skillHash, found ?? null);
    return found;
  };

  /** Drops cached approvals. Call when an approval or revocation is observed. */
  invalidate(): void {
    this.pinCache.clear();
  }

  /**
   * Submits a guarded batch.
   *
   * `pinId` and `attestedSkillHash` come from the decision, never from anything
   * the agent supplied. A simulation runs first so a policy rejection surfaces as
   * a readable error rather than a failed transaction the user pays for.
   */
  readonly submit = async (
    decision: Extract<Decision, { kind: "allow" }>,
    calls: readonly GuardedCall[],
  ): Promise<{ txHash: Hex }> => {
    const args = [
      decision.pinId,
      decision.skillHash,
      calls.map((c) => ({ target: c.target, value: BigInt(c.value), data: c.data })),
    ] as const;

    await this.publicClient.simulateContract({
      address: this.account,
      abi: lockstepGuardAbi,
      functionName: "execute",
      args,
      account: this.executor,
    });

    const txHash = await this.walletClient.writeContract({
      address: this.account,
      abi: lockstepGuardAbi,
      functionName: "execute",
      args,
      chain: this.chain,
      account: privateKeyToAccount(this.config.executorPrivateKey),
    });

    return { txHash };
  };
}

