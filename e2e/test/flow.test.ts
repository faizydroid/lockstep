/**
 * End-to-end: a real chain, real EIP-7702 delegation, and skill hashes computed
 * from the actual demo directories on disk.
 *
 * This is the test that ties the halves together. The unit suites prove the
 * hasher, the guard, and the policy in isolation; this proves that a hash derived
 * from files on disk is the same value the guard accepts, and that the rug-pull
 * artifact in `demo/attack` is genuinely rejected rather than rejected in theory.
 *
 * Requires Anvil on PATH. Skips with a clear message rather than failing if it is
 * missing, so a contributor without Foundry still gets a green unit suite.
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
  keccak256,
  getAddress,
  http,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { hashSkillDirectory } from "@lockstep/runtime";

const ROOT = resolve(import.meta.dirname, "..", "..");
const FOUNDRY_BIN = join(ROOT, ".tools", "foundry");
const ANVIL = join(FOUNDRY_BIN, process.platform === "win32" ? "anvil.exe" : "anvil");
const FORGE = join(FOUNDRY_BIN, process.platform === "win32" ? "forge.exe" : "forge");

const HONEST_SKILL_DIR = join(ROOT, "demo", "skills", "kuru-quote");
const HOSTILE_SKILL_DIR = join(ROOT, "demo", "attack", "kuru-quote-hostile");

const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;

/** Anvil's first two deterministic keys. */
const PUBLISHER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ACCOUNT_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const EXECUTOR_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex;

const guardAbi = parseAbi([
  "function approvePin(bytes32 pinId)",
  "function authorizeExecutor(address executor)",
  "function isPinApproved(bytes32 pinId) view returns (bool)",
  "function execute(bytes32 pinId, bytes32 attestedSkillHash, (address target, uint256 value, bytes data)[] calls)",
  "error SkillHashMismatch(bytes32 attested, bytes32 pinned)",
  "error PinNotApproved(bytes32 pinId)",
  "error CapabilityNotDeclared(address target, bytes4 selector)",
]);

const registryAbi = parseAbi([
  "struct PublishParams { string name; string version; bytes32 skillHash; uint256 maxValuePerBatch; address[] targets; bytes4[] selectors; }",
  "function deposit(uint256 amount)",
  "function publish(PublishParams p) returns (bytes32)",
  "function computeVersionId(string name, string version) pure returns (bytes32)",
  "function computePinId(address publisher, bytes32 skillHash) pure returns (bytes32)",
  "function quoteBond(uint256 capabilityCount, uint256 highRiskCount, bool movesNativeValue) view returns (uint256)",
  "function unlockedBond(address publisher) view returns (uint256)",
  "function lockedBond(address publisher) view returns (uint256)",
  "function bondAsset() view returns (address)",
]);

const bondAssetAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const routerAbi = parseAbi([
  "function swap(uint256 amountIn) payable returns (uint256)",
  "function swaps() view returns (uint256)",
]);

const available = existsSync(ANVIL) && existsSync(FORGE);

describe.skipIf(!available)("end-to-end flow on a real chain", () => {
  let anvil: ChildProcess;
  let publicClient: PublicClient;
  let registry: Address;
  let guardImpl: Address;
  let bondAsset: Address;
  let router: Address;

  const publisher = privateKeyToAccount(PUBLISHER_PK);
  const accountSigner = privateKeyToAccount(ACCOUNT_PK);
  const executor = privateKeyToAccount(EXECUTOR_PK);

  const wallet = (account: typeof publisher) =>
    createWalletClient({ account, chain: foundry, transport: http(RPC) });

  beforeAll(async () => {
    anvil = spawn(ANVIL, ["--port", String(PORT), "--silent", "--hardfork", "prague"], {
      stdio: "ignore",
    });

    publicClient = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;

    // Wait for the node rather than sleeping a fixed amount.
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await publicClient.getBlockNumber();
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("anvil did not start within 30s");
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    // Deploy via the same script that ships, so the test exercises the real
    // parameters rather than a bespoke deployment.
    const deploy = spawn(
      FORGE,
      [
        "script",
        "script/Deploy.s.sol",
        // The file also declares MockBondAsset, so the target must be named.
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
    deploy.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    let stderr = "";
    deploy.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    const code = await new Promise<number>((r) => deploy.on("close", (c) => r(c ?? 1)));
    if (code !== 0) throw new Error(`forge script failed:\n${stderr}\n${stdout}`);

    // `returns` in the --json output carries the two deployed addresses.
    const returnsLine = stdout
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })
      .find((parsed) => parsed !== undefined && "returns" in parsed);

    if (returnsLine === undefined) {
      throw new Error(`no 'returns' object in forge --json output:\n${stdout.slice(0, 2000)}`);
    }
    const returns = (returnsLine as { returns: Record<string, { value: string }> }).returns;

    // `run()` declares named return values, so forge keys them by name. Fall back
    // to positional keys so this keeps working if the signature loses its names.
    const pick = (name: string, position: string): Address => {
      const entry = returns[name] ?? returns[position];
      if (entry === undefined) {
        throw new Error(
          `forge returns had neither '${name}' nor '${position}'. Keys: ${Object.keys(returns).join(", ")}`,
        );
      }
      return getAddress(entry.value);
    };

    registry = pick("registry", "0");
    guardImpl = pick("guard", "1");

    bondAsset = (await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "bondAsset",
    })) as Address;

    // Deploy the stand-in venue from forge's own compiled artifact. Reading the
    // artifact rather than embedding a bytecode literal means the deployed code is
    // provably the code in `src/demo/DemoRouter.sol`.
    const artifactPath = join(ROOT, "contracts", "out", "DemoRouter.sol", "DemoRouter.json");
    if (!existsSync(artifactPath)) {
      throw new Error(`missing artifact ${artifactPath}. Run \`forge build\` in contracts/ first.`);
    }
    const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as {
      bytecode: { object: Hex };
    };

    const routerHash = await wallet(publisher).deployContract({
      abi: routerAbi,
      bytecode: artifact.bytecode.object,
      chain: foundry,
      account: publisher,
    });
    const routerReceipt = await publicClient.waitForTransactionReceipt({ hash: routerHash });
    router = getAddress(routerReceipt.contractAddress!);
  }, 120_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("computes the same hash for the honest skill that the chain will accept", async () => {
    const honest = await hashSkillDirectory(HONEST_SKILL_DIR);

    expect(honest.skillHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(honest.scheme).toBe("lockstep-skill-hash/v2");
  });

  it("gives the hostile update a different hash", async () => {
    const honest = await hashSkillDirectory(HONEST_SKILL_DIR);
    const hostile = await hashSkillDirectory(HOSTILE_SKILL_DIR);

    expect(hostile.skillHash).not.toBe(honest.skillHash);
  });

  it("runs the full honest path and the rug pull against a live chain", async () => {
    const honest = await hashSkillDirectory(HONEST_SKILL_DIR);
    const hostile = await hashSkillDirectory(HOSTILE_SKILL_DIR);
    const swapSelector = toFunctionSelector("swap(uint256)");
    const SKILL_NAME = "kuru-quote";
    const SKILL_VERSION = "1.0.0";

    // Mirror of PinRegistry.computeVersionId: abi.encode(name, version).
    //
    // This used to be passed straight to `publish`, which accepted any bytes32 and checked it
    // against nothing. Now the registry derives the id itself, so the mirror is no longer load
    // bearing for the transaction -- but `cli/src/manifest.ts` still keeps one, to run the
    // equivocation pre-flight check before it has an RPC connection. A drifting mirror there would
    // make the CLI wave through exactly the second claim it exists to refuse. This suite has a real
    // chain, so it asks the chain instead of assuming.
    const VERSION_ID = keccak256(
      encodeAbiParameters([{ type: "string" }, { type: "string" }], [SKILL_NAME, SKILL_VERSION]),
    );
    expect(
      await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "computeVersionId",
        args: [SKILL_NAME, SKILL_VERSION],
      }),
      "the off-chain computeVersionId mirror has drifted from the registry",
    ).toBe(VERSION_ID);

    // --- publisher bonds and pins the honest version ---
    const quote = (await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "quoteBond",
      args: [1n, 0n, false],
    })) as bigint;

    await publicClient.waitForTransactionReceipt({
      hash: await wallet(publisher).writeContract({
        address: bondAsset,
        abi: bondAssetAbi,
        functionName: "mint",
        args: [publisher.address, quote * 100n],
        chain: foundry,
        account: publisher,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await wallet(publisher).writeContract({
        address: bondAsset,
        abi: bondAssetAbi,
        functionName: "approve",
        args: [registry, quote * 100n],
        chain: foundry,
        account: publisher,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await wallet(publisher).writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "deposit",
        args: [quote * 100n],
        chain: foundry,
        account: publisher,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await wallet(publisher).writeContract({
        address: registry,
        abi: registryAbi,
        functionName: "publish",
        args: [
          {
            name: SKILL_NAME,
            version: SKILL_VERSION,
            skillHash: honest.skillHash,
            maxValuePerBatch: 0n,
            targets: [router],
            selectors: [swapSelector],
          },
        ],
        chain: foundry,
        account: publisher,
      }),
    });

    // The bond is now committed and cannot be withdrawn.
    expect(
      (await publicClient.readContract({
        address: registry,
        abi: registryAbi,
        functionName: "lockedBond",
        args: [publisher.address],
      })) as bigint,
    ).toBe(quote);

    const pinId = (await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "computePinId",
      args: [publisher.address, honest.skillHash],
    })) as Hex;

    // --- account delegates to the guard via real EIP-7702 and sets policy ---
    const authorization = await wallet(accountSigner).signAuthorization({
      account: accountSigner,
      contractAddress: guardImpl,
      executor: "self",
    });

    await publicClient.waitForTransactionReceipt({
      hash: await wallet(accountSigner).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({ abi: guardAbi, functionName: "approvePin", args: [pinId] }),
        authorizationList: [authorization],
        chain: foundry,
      }),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await wallet(accountSigner).sendTransaction({
        account: accountSigner,
        to: accountSigner.address,
        data: encodeFunctionData({
          abi: guardAbi,
          functionName: "authorizeExecutor",
          args: [executor.address],
        }),
        chain: foundry,
      }),
    });

    expect(
      await publicClient.readContract({
        address: accountSigner.address,
        abi: guardAbi,
        functionName: "isPinApproved",
        args: [pinId],
      }),
    ).toBe(true);

    const swapCall = {
      target: router,
      value: 0n,
      data: encodeFunctionData({ abi: routerAbi, functionName: "swap", args: [100n] }),
    };

    // --- honest path executes ---
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: await wallet(executor).writeContract({
        address: accountSigner.address,
        abi: guardAbi,
        functionName: "execute",
        args: [pinId, honest.skillHash, [swapCall]],
        chain: foundry,
        account: executor,
      }),
    });
    expect(receipt.status).toBe("success");
    expect(
      (await publicClient.readContract({
        address: router,
        abi: routerAbi,
        functionName: "swaps",
      })) as bigint,
    ).toBe(1n);

    // --- the rug pull: hostile bytes, honestly reported, blocked ---
    await expect(
      publicClient.simulateContract({
        address: accountSigner.address,
        abi: guardAbi,
        functionName: "execute",
        args: [pinId, hostile.skillHash, [swapCall]],
        account: executor,
      }),
    ).rejects.toThrow(/SkillHashMismatch/);

    // --- and the capability bound still holds under an honest attestation ---
    await expect(
      publicClient.simulateContract({
        address: accountSigner.address,
        abi: guardAbi,
        functionName: "execute",
        args: [
          pinId,
          honest.skillHash,
          [{ target: bondAsset, value: 0n, data: "0x095ea7b3" as Hex }],
        ],
        account: executor,
      }),
    ).rejects.toThrow(/CapabilityNotDeclared/);

    // The swap counter proves nothing else landed.
    expect(
      (await publicClient.readContract({
        address: router,
        abi: routerAbi,
        functionName: "swaps",
      })) as bigint,
    ).toBe(1n);
  }, 180_000);
});

if (!available) {
  // eslint-disable-next-line no-console
  console.warn(
    `e2e skipped: anvil/forge not found in ${FOUNDRY_BIN}. Run the toolchain install first.`,
  );
}



