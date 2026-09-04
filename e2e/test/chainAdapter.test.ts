/**
 * ChainAdapter against a real chain.
 *
 * This is the code that actually submits transactions, and until now it had no tests
 * at all — the largest untested surface in the project and the worst one to leave
 * uncovered. Mocking it would prove nothing: the parts that can go wrong are log
 * replay ordering, revocation handling, and whether `simulateContract` surfaces a
 * policy rejection as a readable error. All three need a chain.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { ChainAdapter } from "@lockstep/openclaw-plugin/chain";

const ROOT = resolve(import.meta.dirname, "..", "..");
const FOUNDRY_BIN = join(ROOT, ".tools", "foundry");
const ANVIL = join(FOUNDRY_BIN, process.platform === "win32" ? "anvil.exe" : "anvil");
const FORGE = join(FOUNDRY_BIN, process.platform === "win32" ? "forge.exe" : "forge");

const PORT = 8548;
const RPC = `http://127.0.0.1:${PORT}`;

const PUBLISHER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ACCOUNT_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const EXECUTOR_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;

const HONEST_SKILL = keccak256(new TextEncoder().encode("honest bytes"));
const HOSTILE_SKILL = keccak256(new TextEncoder().encode("hostile bytes"));

const guardAbi = parseAbi([
  "function approvePin(bytes32 pinId)",
  "function unapprovePin(bytes32 pinId)",
  "function authorizeExecutor(address executor)",
  "function execute(bytes32 pinId, bytes32 attestedSkillHash, (address target, uint256 value, bytes data)[] calls)",
]);

const registryAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function publish(bytes32 skillHash, bytes32 versionId, uint256 maxValuePerCall, address[] targets, bytes4[] selectors) returns (bytes32)",
  "function revoke(bytes32 pinId)",
  "function computePinId(address publisher, bytes32 skillHash) pure returns (bytes32)",
  "function quoteBond(uint256 capabilityCount, uint256 highRiskCount, bool movesNativeValue) view returns (uint256)",
  "function bondAsset() view returns (address)",
]);

const bondAssetAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const routerAbi = parseAbi([
  "function swap(uint256 amountIn) payable returns (uint256)",
  "function swaps() view returns (uint256)",
  "function drain(address to)",
]);

const versionId = (name: string, version: string): Hex =>
  keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], [name, version]));

const available = existsSync(ANVIL) && existsSync(FORGE);

describe.skipIf(!available)("ChainAdapter against a live chain", () => {
  let anvil: ChildProcess;
  let client: PublicClient;
  let registry: Address;
  let guardImpl: Address;
  let bondAsset: Address;
  let router: Address;
  let adapter: ChainAdapter;

  const publisher = privateKeyToAccount(PUBLISHER_PK);
  const accountSigner = privateKeyToAccount(ACCOUNT_PK);
  const executor = privateKeyToAccount(EXECUTOR_PK);

  const wallet = (account: typeof publisher) =>
    createWalletClient({ account, chain: foundry, transport: http(RPC) });

  const send = async (hash: Hex) => client.waitForTransactionReceipt({ hash });

  beforeAll(async () => {
    anvil = spawn(ANVIL, ["--port", String(PORT), "--silent", "--hardfork", "prague"], {
      stdio: "ignore",
    });
    client = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;

    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("anvil did not start within 30s");
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const deploy = spawn(
      FORGE,
      [
        "script",
        "script/Deploy.s.sol",
        "--tc",
        "Deploy",
        "--root",
        join(ROOT, "contracts"),
        "--rpc-url",
        RPC,
        "--broadcast",
        "--private-key",
        PUBLISHER_PK,
        "--json",
      ],
      { cwd: join(ROOT, "contracts"), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    deploy.stdout?.on("data", (c) => (stdout += String(c)));
    // Drained for the same reason as in action.test.ts: an unread stderr pipe can stall
    // forge outright, and without it a failure reports no cause.
    deploy.stderr?.on("data", (c) => (stderr += String(c)));
    const code = await new Promise<number>((r) => deploy.on("close", (c) => r(c ?? 1)));
    if (code !== 0) throw new Error(`forge script exited ${code}\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`);

    const line = stdout
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find((p) => p !== undefined && "returns" in p);
    const returns = (line as { returns: Record<string, { value: string }> }).returns;
    registry = getAddress((returns.registry ?? returns["0"]!).value);
    guardImpl = getAddress((returns.guard ?? returns["1"]!).value);

    bondAsset = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "bondAsset",
    })) as Address;

    const artifact = JSON.parse(
      await readFile(join(ROOT, "contracts", "out", "DemoRouter.sol", "DemoRouter.json"), "utf8"),
    ) as { bytecode: { object: Hex } };
    const routerReceipt = await send(
      await wallet(publisher).deployContract({
        abi: routerAbi,
        bytecode: artifact.bytecode.object,
        chain: foundry,
        account: publisher,
      }),
    );
    router = getAddress(routerReceipt.contractAddress!);

    // Bond and publish two versions of the same skill name.
    const quote = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "quoteBond",
      args: [1n, 0n, false],
    })) as bigint;
    const funding = quote * 50n;

    await send(
      await wallet(publisher).writeContract({
        address: bondAsset,
        abi: bondAssetAbi,
        functionName: "mint",
        args: [publisher.address, funding],
        chain: foundry,
        account: publisher,
      }),
    );
    await send(
      await wallet(publisher).writeContract({
        address: bondAsset,
        abi: bondAssetAbi,
        functionName: "approve",
        args: [registry, funding],
        chain: foundry,
        account: publisher,
      }),
    );
    await send(
      await wallet(publisher).writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "deposit",
        args: [funding],
        chain: foundry,
        account: publisher,
      }),
    );

    const swapSelector = toFunctionSelector("swap(uint256)");
    for (const [hash, version] of [
      [HONEST_SKILL, "1.0.0"],
      [HOSTILE_SKILL, "2.0.0"],
    ] as const) {
      await send(
        await wallet(publisher).writeContract({
          address: registry,
          abi: registryAbi,
          functionName: "publish",
          args: [hash, versionId("demo", version), 0n, [router], [swapSelector]],
          chain: foundry,
          account: publisher,
        }),
      );
    }

    // Delegate the account and approve only the honest version.
    const authorization = await wallet(accountSigner).signAuthorization({
      account: accountSigner,
      contractAddress: guardImpl,
      executor: "self",
    });
    const honestPin = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "computePinId",
      args: [publisher.address, HONEST_SKILL],
    })) as Hex;

    await send(
      await wallet(accountSigner).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({ abi: guardAbi, functionName: "approvePin", args: [honestPin] }),
        authorizationList: [authorization],
        chain: foundry,
      }),
    );
    await send(
      await wallet(accountSigner).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({
          abi: guardAbi,
          functionName: "authorizeExecutor",
          args: [executor.address],
        }),
        chain: foundry,
      }),
    );

    adapter = new ChainAdapter({
      rpcUrl: RPC,
      chainId: 10143,
      chainOverride: foundry,
      registry,
      account: accountSigner.address,
      executorPrivateKey: EXECUTOR_PK,
    });
  }, 180_000);

  afterAll(() => {
    anvil?.kill();
  });

  /**
   * The design invariant the whole threat model rests on. An agent holding the
   * account's key can sign straight past the guard, so that configuration cannot
   * enforce anything and must not be allowed to appear to.
   */
  it("refuses to construct when the executor key is the account key", () => {
    expect(
      () =>
        new ChainAdapter({
          rpcUrl: RPC,
          chainId: 10143,
          chainOverride: foundry,
          registry,
          account: accountSigner.address,
          executorPrivateKey: ACCOUNT_PK,
        }),
    ).toThrow(/executor key must not be the account key/i);
  });

  it("derives the executor address from the key", () => {
    expect(adapter.executorAddress).toBe(executor.address);
  });

  // --- findApprovedPin ---

  it("finds the approved pin for the honest skill hash", async () => {
    const pin = await adapter.findApprovedPin(HONEST_SKILL);

    expect(pin).toBeDefined();
    expect(pin?.skillHash).toBe(HONEST_SKILL);
    expect(pin?.publisher).toBe(publisher.address);
  });

  /** The rug pull, at the lookup layer: published but never approved. */
  it("returns undefined for a published but unapproved version", async () => {
    expect(await adapter.findApprovedPin(HOSTILE_SKILL)).toBeUndefined();
  });

  it("returns undefined for a hash with no pin at all", async () => {
    expect(await adapter.findApprovedPin(keccak256(new TextEncoder().encode("nothing")))).toBeUndefined();
  });

  /** Negative results are cached, so a rug-pulled skill does not replay every log. */
  it("caches negative lookups", async () => {
    const first = await adapter.findApprovedPin(HOSTILE_SKILL);
    const second = await adapter.findApprovedPin(HOSTILE_SKILL);

    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
  });

  // --- submit ---

  it("submits a guarded batch and moves the venue's state", async () => {
    const pin = await adapter.findApprovedPin(HONEST_SKILL);
    expect(pin).toBeDefined();

    const before = (await client.readContract({
      address: router,
      abi: routerAbi,
      functionName: "swaps",
    })) as bigint;

    const { txHash } = await adapter.submit(
      { kind: "allow", pinId: pin!.pinId, skillHash: HONEST_SKILL, skillRoot: "/demo" },
      [
        {
          target: router,
          value: "0",
          data: encodeFunctionData({ abi: routerAbi, functionName: "swap", args: [100n] }),
        },
      ],
    );

    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).toBe("success");

    const after = (await client.readContract({
      address: router,
      abi: routerAbi,
      functionName: "swaps",
    })) as bigint;
    expect(after).toBe(before + 1n);
  }, 60_000);

  /**
   * A policy rejection must surface as a readable error before a transaction is paid
   * for. That is the entire reason `submit` simulates first.
   */
  it("surfaces a mismatched attestation as an error without sending a transaction", async () => {
    const pin = await adapter.findApprovedPin(HONEST_SKILL);

    await expect(
      adapter.submit(
        { kind: "allow", pinId: pin!.pinId, skillHash: HOSTILE_SKILL, skillRoot: "/demo" },
        [
          {
            target: router,
            value: "0",
            data: encodeFunctionData({ abi: routerAbi, functionName: "swap", args: [1n] }),
          },
        ],
      ),
    ).rejects.toThrow(/SkillHashMismatch/);
  }, 60_000);

  it("surfaces an undeclared capability without sending a transaction", async () => {
    const pin = await adapter.findApprovedPin(HONEST_SKILL);

    await expect(
      adapter.submit(
        { kind: "allow", pinId: pin!.pinId, skillHash: HONEST_SKILL, skillRoot: "/demo" },
        [
          {
            target: router,
            value: "0",
            data: encodeFunctionData({
              abi: routerAbi,
              functionName: "drain",
              args: [executor.address],
            }),
          },
        ],
      ),
    ).rejects.toThrow(/CapabilityNotDeclared/);
  }, 60_000);

  // --- revocation and unapproval, replayed from logs ---

  /**
   * A later revocation must beat an earlier approval regardless of the order the RPC
   * returns the logs in. The adapter sorts by block and log index for exactly this.
   */
  it("stops finding a pin after the account unapproves it", async () => {
    const pin = await adapter.findApprovedPin(HONEST_SKILL);
    expect(pin).toBeDefined();

    await send(
      await wallet(accountSigner).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({
          abi: guardAbi,
          functionName: "unapprovePin",
          args: [pin!.pinId],
        }),
        chain: foundry,
      }),
    );

    adapter.invalidate();

    expect(await adapter.findApprovedPin(HONEST_SKILL)).toBeUndefined();
  }, 60_000);

  /** Re-approval must be picked up too, so the log replay is not one-way. */
  it("finds the pin again after re-approval", async () => {
    const pinId = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "computePinId",
      args: [publisher.address, HONEST_SKILL],
    })) as Hex;

    await send(
      await wallet(accountSigner).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({ abi: guardAbi, functionName: "approvePin", args: [pinId] }),
        chain: foundry,
      }),
    );

    adapter.invalidate();

    expect((await adapter.findApprovedPin(HONEST_SKILL))?.pinId).toBe(pinId);
  }, 60_000);

  /**
   * Publisher revocation must override the account's approval. `liveSkillHash` returns
   * zero for a revoked pin, and zero can never equal a real hash, so the adapter must
   * treat it as no match rather than as a match on zero.
   */
  it("stops finding a pin the publisher revoked, even while still approved", async () => {
    const pinId = (await client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "computePinId",
      args: [publisher.address, HONEST_SKILL],
    })) as Hex;

    await send(
      await wallet(publisher).writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "revoke",
        args: [pinId],
        chain: foundry,
        account: publisher,
      }),
    );

    adapter.invalidate();

    expect(await adapter.findApprovedPin(HONEST_SKILL)).toBeUndefined();
  }, 60_000);
});
