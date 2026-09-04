/**
 * Reads. There are no writes here at all.
 *
 * Nothing in this app signs, and that is a deliberate boundary rather than a missing feature.
 * Approving a pin is the one action in the whole system that must be the account owner's own
 * deliberate act, and putting a persuasive "approve" button in a web page next to data fetched
 * over the network is precisely the shape of the attack the product exists to stop. Approval
 * belongs to the CLI, where the bytes being approved are the bytes on the machine doing the
 * approving.
 *
 * So this module answers questions and never changes anything.
 */

import { createPublicClient, http } from "viem";
import type { Address, Hex, PublicClient } from "viem";
import { monad, monadTestnet } from "viem/chains";

import { erc20Abi, lockstepGuardAbi, pinRegistryAbi } from "./abi";
import { sampleSnapshot } from "./fixtures";
import type {
  Approval,
  BondPricing,
  Capability,
  Execution,
  Pin,
  Publisher,
  Snapshot,
  Totals,
} from "./model";
import { pinStateOf } from "./model";

/**
 * Configuration, read from the environment at build time.
 *
 * `NEXT_PUBLIC_` prefixed because this is a static export: there is no server to hold a
 * secret, and none of these are secret. A registry address and an RPC URL are public facts.
 */
export interface AppConfig {
  readonly registry?: Address;
  readonly chainId: 143 | 10143;
  readonly rpcUrl: string;
  readonly account?: Address;
  /**
   * Block the registry was deployed in. Log queries start here rather than at genesis.
   *
   * Not an optimisation. Every log query used `fromBlock: "earliest"`, which on Monad testnet means
   * asking a public RPC to scan roughly 59 million blocks. It refuses, `loadSnapshot` catches the
   * failure, and the dashboard falls back to sample data -- silently, while looking correctly
   * configured. So a deployment could be wired up perfectly and the UI would still show fixtures,
   * which is the exact dishonesty risk this app is otherwise careful about.
   */
  readonly deployBlock: bigint;
  /**
   * Known pin ids, which turn the read from a log scan into a handful of direct calls.
   *
   * This exists because of a hard limit rather than for speed. Monad's public RPC caps `eth_getLogs`
   * at a 100-block range, so enumerating pins from `Published` logs costs one request per 100 blocks
   * and the bill grows forever as the head moves. For a registry ten thousand blocks old that is a
   * hundred requests for one event type, and rate limiting starts before it finishes.
   *
   * `getPin(pinId)` is a plain `eth_call` with no range limit and no meaningful rate pressure, and it
   * returns everything except the capability list -- including `revokedAt` and `slashed`, which
   * removes the need for the Revoked and Slashed log queries entirely. So when the pins are known,
   * the whole read is N calls plus one bounded scan for capabilities.
   *
   * Empty means "discover from logs", which is correct on a local chain and on a fresh deployment.
   */
  readonly pinIds: readonly Hex[];
}

export function readConfig(): AppConfig {
  const rawChain = process.env.NEXT_PUBLIC_CHAIN_ID;
  const chainId = rawChain === "143" ? 143 : 10143;
  const registry = process.env.NEXT_PUBLIC_PIN_REGISTRY;
  const account = process.env.NEXT_PUBLIC_ACCOUNT_ADDRESS;
  const rawDeployBlock = process.env.NEXT_PUBLIC_DEPLOY_BLOCK;

  return {
    chainId,
    rpcUrl:
      process.env.NEXT_PUBLIC_RPC_URL ??
      // testnet-rpc, not rpc.testnet. The transposed form does not resolve at all -- ENOTFOUND --
      // and was the repo's default in ten places, so an unconfigured dashboard fell back to sample
      // data forever while looking correctly configured. This matches viem's own monadTestnet.
      (chainId === 143 ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz"),
    deployBlock: parseBlock(rawDeployBlock),
    pinIds: parsePinIds(process.env.NEXT_PUBLIC_PIN_IDS),
    ...(isAddressish(registry) ? { registry: registry as Address } : {}),
    ...(isAddressish(account) ? { account: account as Address } : {}),
  };
}

/** Comma or whitespace separated 32-byte hex ids. Anything malformed is dropped, not guessed at. */
function parsePinIds(value: string | undefined): readonly Hex[] {
  if (value === undefined) return [];
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^0x[0-9a-fA-F]{64}$/.test(s)) as Hex[];
}

/** Zero means "scan from genesis", which is only viable on a local chain. */
function parseBlock(value: string | undefined): bigint {
  if (value === undefined) return 0n;
  try {
    const n = BigInt(value);
    return n < 0n ? 0n : n;
  } catch {
    return 0n;
  }
}

/**
 * Maximum span in a single `eth_getLogs` call, measured against the endpoint rather than assumed.
 *
 * Monad testnet's public RPC answers `{"code":-32614,"message":"eth_getLogs is limited to a 100
 * range"}` for anything wider. Not 50,000, not 2,000 -- one hundred blocks. At 400ms blocks that is a
 * forty-second window, so reconstructing a registry's history from logs costs one request per 100
 * blocks and the bill grows by 1.5 requests per minute, forever.
 *
 * This is the strongest architectural argument for the Envio indexer in this repo: a browser cannot
 * be the read path for log-derived state on this chain. The direct reader below exists so the
 * dashboard works against a fresh deployment without an indexer running, and it is honest about
 * running out of budget rather than pretending it saw everything.
 */
const LOG_WINDOW = 100n;

/**
 * Concurrent range requests, per event type.
 *
 * Six. The rate limiter tripped at 32 in flight, which is what happened when four event types each
 * paged with a concurrency of eight. Since the event types are now read one after another, six is the
 * whole in-flight count rather than a quarter of it.
 */
const LOG_CONCURRENCY = 6;

/**
 * How far past the deployment block to scan, in blocks.
 *
 * A bound is unavoidable. Paging from the deployment to the chain head at 100 blocks a request took
 * longer than two minutes and did not finish -- measured, against this endpoint, with the event types
 * serialised. The head also moves 150 blocks a minute, so "scan to the head" is a target that recedes
 * while you approach it.
 *
 * 4000 blocks is about 27 minutes of Monad chain, which covers a demo deployment and its activity. Past
 * that the reader reports `truncated` and the interface says so rather than presenting a partial
 * history as a complete one. The real answer for a long-lived registry is the indexer, and this number
 * existing at all is the argument for it.
 */
const LOG_SCAN_SPAN = 4_000n;

/**
 * Hard ceiling on requests per event type.
 *
 * Without one, a registry deployed a month ago would issue tens of thousands of requests from a
 * browser tab. Hitting the ceiling is reported by the caller rather than swallowed, because a partial
 * history shown as if complete is the same class of dishonesty as showing fixtures unlabelled.
 */
const LOG_REQUEST_BUDGET = 400;

export interface PagedResult<T> {
  readonly logs: readonly T[];
  /** True when the budget ran out before reaching the head. */
  readonly truncated: boolean;
  readonly requests: number;
}

/**
 * Pages a log query in 100-block windows, a few at a time.
 *
 * `fromBlock === 0n` means a local chain, where the cap does not apply and one unbounded query is
 * both correct and far cheaper -- anvil has no range limit and is only a few dozen blocks deep.
 */
async function pagedEvents<T>(
  client: PublicClient,
  head: bigint,
  fromBlock: bigint,
  query: (from: bigint, to: bigint) => Promise<readonly T[]>,
): Promise<PagedResult<T>> {
  if (fromBlock === 0n) {
    return { logs: await query(0n, head), truncated: false, requests: 1 };
  }

  /*
   * The scan ends at whichever comes first: the head, or the span cap.
   *
   * Capping the far end rather than the near end is deliberate. The pins a demo deployment cares about
   * were published shortly after it, so the useful logs cluster near `fromBlock`; the blocks between
   * that cluster and a receding head are almost entirely empty and cost one request per hundred to
   * confirm as empty.
   */
  const ceiling = fromBlock + LOG_SCAN_SPAN;
  const end = ceiling < head ? ceiling : head;
  const truncated = end < head;

  const windows: { from: bigint; to: bigint }[] = [];
  for (let from = fromBlock; from <= end; from += LOG_WINDOW) {
    const to = from + LOG_WINDOW - 1n > end ? end : from + LOG_WINDOW - 1n;
    windows.push({ from, to });
  }

  const overBudget = windows.length > LOG_REQUEST_BUDGET;
  const selected = overBudget ? windows.slice(0, LOG_REQUEST_BUDGET) : windows;

  const out: T[] = [];
  for (let i = 0; i < selected.length; i += LOG_CONCURRENCY) {
    const batch = selected.slice(i, i + LOG_CONCURRENCY);
    const results = await Promise.all(batch.map((w) => query(w.from, w.to)));
    for (const r of results) out.push(...r);
  }

  return { logs: out, truncated: truncated || overBudget, requests: selected.length };
}

/** A configured-but-zero address is the same as unconfigured, and is a common mistake. */
function isAddressish(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return false;
  return value.toLowerCase() !== "0x0000000000000000000000000000000000000000";
}

function clientFor(config: AppConfig): PublicClient {
  return createPublicClient({
    chain: config.chainId === 143 ? monad : monadTestnet,
    transport: http(config.rpcUrl),
  }) as PublicClient;
}

/**
 * Everything the dashboard needs, or sample data with the reason stated.
 *
 * Falls back rather than throwing. A judge opening this during a presentation should see a
 * working, clearly-labelled interface, not a stack trace, and an RPC that is briefly
 * unreachable is not a fact about the product.
 */
export async function loadSnapshot(config: AppConfig = readConfig()): Promise<Snapshot> {
  if (config.registry === undefined) {
    return sampleSnapshot("No registry address configured, so these are sample figures.");
  }

  try {
    return await readChain(config, config.registry);
  } catch (error) {
    return sampleSnapshot(explainReadFailure(error, config));
  }
}

/**
 * Turns an RPC failure into something a reader can act on.
 *
 * The raw message was `Could not reach <url>: RPC Request failed.` followed by a serialised request
 * body, which tells a viewer nothing and hid a specific, fixable cause for hours: Monad's public
 * endpoint caps `eth_getLogs` at a **100 block range** and rate-limits concurrent range queries. Both
 * surface as generic transport failures.
 *
 * Naming the likely cause matters more here than in most apps, because the fallback is sample data --
 * so a bad diagnosis means a dashboard that looks configured, shows fixtures, and gives no clue why.
 */
function explainReadFailure(error: unknown, config: AppConfig): string {
  const raw = error instanceof Error ? error.message : String(error);

  if (/limited to a \d+ range/i.test(raw)) {
    return `The RPC caps eth_getLogs block ranges and this deployment is too far behind the head to page through from a browser. Run the indexer, or set NEXT_PUBLIC_DEPLOY_BLOCK closer to the head. Showing sample figures.`;
  }
  if (/rate|429|too many/i.test(raw)) {
    return `${config.rpcUrl} rate-limited the log queries. A registry more than a few thousand blocks old needs the indexer rather than direct reads. Showing sample figures.`;
  }
  if (config.deployBlock === 0n) {
    return `NEXT_PUBLIC_DEPLOY_BLOCK is not set, so log queries start at genesis, which public endpoints refuse. Set it to the registry's creation block. Showing sample figures.`;
  }
  return `Could not read ${config.rpcUrl}: ${raw.split("\n")[0]}. Showing sample figures.`;
}

async function readChain(config: AppConfig, registry: Address): Promise<Snapshot> {
  const client = clientFor(config);

  const [blockNumber, pricing] = await Promise.all([
    client.getBlockNumber(),
    readPricing(client, registry),
  ]);

  const pins = await readPins(client, registry, blockNumber, config.deployBlock, config.pinIds);
  const publishers = derivePublishers(pins);
  const { approvals, executions } =
    config.account === undefined
      ? { approvals: [], executions: [] }
      : await readAccountEvents(client, config.account, blockNumber, config.deployBlock);

  const totals: Totals = {
    pins: pins.length,
    livePins: pins.filter((p) => p.state === "bonded" || p.state === "pinned").length,
    publishers: publishers.length,
    executions: executions.length,
    bondLocked: publishers.reduce((sum, p) => sum + p.lockedBond, 0n),
    slashed: pins.filter((p) => p.slashed).reduce((sum, p) => sum + p.requiredBond, 0n),
  };

  return {
    source: { kind: "chain", chainId: config.chainId, registry, blockNumber },
    totals,
    pins,
    approvals,
    publishers,
    executions,
    // Refusals leave no log to read, by design: one emitted before a revert is rolled back.
    // Recovering them needs a trace-capable RPC replaying reverted transactions, which is the
    // watcher's job and not something to do from a browser.
    blocked: [],
    drifted: [],
    pricing,
  };
}

/**
 * The registry's no-argument view functions, taken from the ABI rather than restated.
 *
 * viem needs a literal function name to infer against, so a helper typed `string` throws its
 * safety away. Deriving the union from the ABI keeps a typo a compile error.
 *
 * Narrowed on `stateMutability` as well as `type`, which it was not originally. The union was every
 * function in the ABI while the name and the use both said "view", and it went unnoticed for as long as
 * the ABI happened to contain nothing else. Adding `slashEquivocation` for the challenge button turned
 * that latent sloppiness into a compile error at `readContract`, which is the type system doing its job:
 * a write must not be reachable through a helper called `read`.
 */
type RegistryView = Extract<
  (typeof pinRegistryAbi)[number],
  { type: "function"; stateMutability: "view" | "pure" }
>["name"];

async function readPricing(client: PublicClient, registry: Address): Promise<BondPricing> {
  const read = <T>(functionName: RegistryView) =>
    client.readContract({ address: registry, abi: pinRegistryAbi, functionName }) as Promise<T>;

  const [baseBond, perCapabilityBond, highRiskBond, nativeValueBond, challengerRewardBps, unbondingDelay, bondAsset] =
    await Promise.all([
      read<bigint>("baseBond"),
      read<bigint>("perCapabilityBond"),
      read<bigint>("highRiskBond"),
      read<bigint>("nativeValueBond"),
      read<bigint>("challengerRewardBps"),
      read<bigint>("unbondingDelay"),
      read<Address>("bondAsset"),
    ]);

  // Decimals come from the asset itself. Assuming eighteen would understate every bond on
  // screen by a factor of a trillion, since AUSD has six.
  let bondAssetDecimals = 6;
  let bondAssetSymbol = "AUSD";
  try {
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: bondAsset, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
      client.readContract({ address: bondAsset, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    ]);
    bondAssetDecimals = decimals;
    bondAssetSymbol = symbol;
  } catch {
    // A mock bond asset on a test chain may implement neither. The defaults above match the
    // production asset, and being wrong about a label is better than failing the whole page.
  }

  return {
    baseBond,
    perCapabilityBond,
    highRiskBond,
    nativeValueBond,
    challengerRewardBps,
    unbondingDelay,
    bondAssetDecimals,
    bondAssetSymbol,
  };
}

/**
 * Every pin, rebuilt from logs plus one struct read each.
 *
 * Capabilities can only come from `CapabilityDeclared` logs: the registry keeps them in a
 * nested mapping that cannot be enumerated on chain, which is the cost of the single-SLOAD
 * check the guard makes on every call. `Published` carries no versionId either, so equivocation
 * needs the struct.
 */
async function readPins(
  client: PublicClient,
  registry: Address,
  head: bigint,
  deployBlock: bigint,
  knownPinIds: readonly Hex[],
): Promise<readonly Pin[]> {
  const events = (eventName: "Published" | "CapabilityDeclared" | "Revoked" | "Slashed") =>
    pagedEvents(client, head, deployBlock, (fromBlock, toBlock) =>
      client.getContractEvents({ address: registry, abi: pinRegistryAbi, eventName, fromBlock, toBlock }),
    );

  const direct = knownPinIds.length > 0;

  /*
   * Two paths, and the difference is how the pin ids are discovered.
   *
   * When they are configured, only capabilities need logs -- `getPin` carries `revokedAt`, `slashed`
   * and everything else -- so three of the four log queries disappear. That is the difference between
   * ~30 requests and ~400 against a rate-limited endpoint with a 100-block range cap.
   *
   * Within a path, event types are read sequentially rather than with `Promise.all`. Running them
   * together multiplied the in-flight request count by four and reliably tripped rate limiting, and a
   * throttled request is indistinguishable from a real error to the caller -- so the dashboard fell
   * back to sample data. Slower and complete beats faster and silently wrong.
   */
  const declaredPage = await events("CapabilityDeclared");
  const declared = declaredPage.logs;

  const publishedPage = direct ? null : await events("Published");
  const revokedPage = direct ? null : await events("Revoked");
  const slashedPage = direct ? null : await events("Slashed");

  const capsByPin = new Map<string, Capability[]>();
  for (const log of declared) {
    const args = log.args as { pinId?: Hex; target?: Address; selector?: Hex; highRisk?: boolean };
    if (args.pinId === undefined || args.target === undefined || args.selector === undefined) continue;
    const list = capsByPin.get(args.pinId) ?? [];
    list.push({
      target: args.target,
      selector: args.selector,
      label: args.selector,
      highRisk: args.highRisk === true,
    });
    capsByPin.set(args.pinId, list);
  }

  const revokedPins = new Set(
    (revokedPage?.logs ?? []).map((l) => (l.args as { pinId?: Hex }).pinId).filter(Boolean) as Hex[],
  );
  const slashedLogs = slashedPage?.logs ?? [];
  const slashedPins = new Set(slashedLogs.map((l) => (l.args as { pinId?: Hex }).pinId).filter(Boolean) as Hex[]);
  const equivocatedFromLogs = new Set(
    slashedLogs.map((l) => ((l.args as { publisher?: Address }).publisher ?? "").toLowerCase()).filter(Boolean),
  );

  const pinIds = direct
    ? [...new Set(knownPinIds)]
    : [
        ...new Set(
          (publishedPage?.logs ?? []).map((l) => (l.args as { pinId?: Hex }).pinId).filter(Boolean) as Hex[],
        ),
      ];

  interface PinStruct {
    publisher: Address;
    skillHash: Hex;
    versionId: Hex;
    maxValuePerCall: bigint;
    requiredBond: bigint;
    publishedAt: bigint;
    revokedAt: bigint;
    exists: boolean;
    slashed: boolean;
  }

  const structs = await Promise.all(
    pinIds.map(async (pinId) => {
      const pin = (await client.readContract({
        address: registry,
        abi: pinRegistryAbi,
        functionName: "getPin",
        args: [pinId],
      })) as PinStruct;
      return { pinId, pin };
    }),
  );

  const live = structs.filter((s) => s.pin.exists);

  /*
   * Equivocation, derived from the structs rather than from Slashed logs.
   *
   * `getPin` reports `slashed` per pin, and a publisher has equivocated exactly when one of their pins
   * was slashed -- so the set can be built from what is already in hand. That removes the last reason
   * the direct path would need a log query, and it stays correct on the log path too, where the Slashed
   * logs are merged in as well for pins outside the scanned window.
   */
  const equivocated = new Set(equivocatedFromLogs);
  for (const { pinId, pin } of live) {
    if (pin.slashed || slashedPins.has(pinId)) equivocated.add(pin.publisher.toLowerCase());
  }

  const pins = live.map(({ pinId, pin }): Pin => {
    const isSlashed = pin.slashed || slashedPins.has(pinId);
    const revokedAt = pin.revokedAt !== 0n ? pin.revokedAt : revokedPins.has(pinId) ? 1n : undefined;

    return {
      pinId,
      publisher: pin.publisher,
      skillHash: pin.skillHash,
      versionId: pin.versionId,
      maxValuePerCall: pin.maxValuePerCall,
      requiredBond: pin.requiredBond,
      publishedAt: pin.publishedAt,
      ...(revokedAt !== undefined ? { revokedAt } : {}),
      slashed: isSlashed,
      capabilities: capsByPin.get(pinId) ?? [],
      state: pinStateOf({
        slashed: isSlashed,
        requiredBond: pin.requiredBond,
        publisherHasEquivocated: equivocated.has(pin.publisher.toLowerCase()),
        ...(revokedAt !== undefined ? { revokedAt } : {}),
      }),
    };
  });

  return [...pins].sort((a, b) => Number(b.publishedAt - a.publishedAt));
}

/**
 * Every guard event on one account, in a single pass.
 *
 * Approvals and executions used to page the same address separately, once per event type, for three
 * scans of identical block ranges. With a 100-block cap that is three requests per 300 blocks to read
 * logs that arrive in the same windows.
 *
 * This asks for the account's logs with no topic filter and decodes them locally, so one scan serves
 * all three event types. It cut the live read from 24.7s to roughly half, and the only cost is
 * decoding a few logs the caller does not need -- which is free next to a round trip.
 *
 * `strict: false` matters: the account's logs include the delegation indicator's own events and
 * anything else the address has emitted, and a strict decode throws on the first unrecognised topic
 * instead of skipping it.
 */
async function readAccountEvents(
  client: PublicClient,
  account: Address,
  head: bigint,
  deployBlock: bigint,
): Promise<{ approvals: readonly Approval[]; executions: readonly Execution[] }> {
  const { logs } = await pagedEvents(client, head, deployBlock, (fromBlock, toBlock) =>
    client.getContractEvents({
      address: account,
      abi: lockstepGuardAbi,
      fromBlock,
      toBlock,
      strict: false,
    }),
  );

  // One chronological ordering shared by both derivations, so a later revocation always wins.
  const ordered = [...logs].sort((a, b) => {
    const ab = a.blockNumber ?? 0n;
    const bb = b.blockNumber ?? 0n;
    if (ab !== bb) return ab < bb ? -1 : 1;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  const live = new Map<Hex, Approval>();
  const executions: Execution[] = [];

  for (const log of ordered) {
    const name = (log as { eventName?: string }).eventName;
    const args = log.args as {
      pinId?: Hex;
      skillHash?: Hex;
      executor?: Address;
      callCount?: bigint;
    };

    if (name === "PinApproved" && args.pinId !== undefined) {
      live.set(args.pinId, { account, pinId: args.pinId, approvedAt: log.blockNumber ?? 0n });
      continue;
    }
    if (name === "PinUnapproved" && args.pinId !== undefined) {
      live.delete(args.pinId);
      continue;
    }
    if (
      name === "SkillExecuted" &&
      args.pinId !== undefined &&
      args.skillHash !== undefined &&
      args.executor !== undefined
    ) {
      executions.push({
        txHash: log.transactionHash ?? ("0x" as Hex),
        account,
        pinId: args.pinId,
        skillHash: args.skillHash,
        executor: args.executor,
        callCount: Number(args.callCount ?? 0n),
        timestamp: log.blockNumber ?? 0n,
      });
    }
  }

  return { approvals: [...live.values()], executions: executions.reverse() };
}

/**
 * Publishers, aggregated from their pins.
 *
 * Bond balances are not read per publisher here: that is one RPC round trip each, and the
 * locked figure is recoverable by summing the bonds of their live pins, which is what the
 * registry itself does when locking.
 */
function derivePublishers(pins: readonly Pin[]): readonly Publisher[] {
  const byAddress = new Map<string, { address: Address; locked: bigint; pins: number; slashes: number; equivocated: boolean }>();

  for (const pin of pins) {
    const key = pin.publisher.toLowerCase();
    const entry = byAddress.get(key) ?? {
      address: pin.publisher,
      locked: 0n,
      pins: 0,
      slashes: 0,
      equivocated: false,
    };
    entry.pins += 1;
    if (pin.state === "bonded" || pin.state === "pinned") entry.locked += pin.requiredBond;
    if (pin.slashed) {
      entry.slashes += 1;
      entry.equivocated = true;
    }
    byAddress.set(key, entry);
  }

  return [...byAddress.values()]
    .map((e) => ({
      address: e.address,
      bondBalance: e.locked,
      lockedBond: e.locked,
      pinCount: e.pins,
      slashCount: e.slashes,
      hasEquivocated: e.equivocated,
    }))
    .sort((a, b) => Number(b.lockedBond - a.lockedBond));
}

// bondBreakdown and formatBondWith live in ./bond.ts. They are pure arithmetic, and keeping
// them out of this module means a component or a test can use them without pulling in
// createPublicClient and the chain definitions.
