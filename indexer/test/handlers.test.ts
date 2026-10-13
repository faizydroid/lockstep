/**
 * The handlers, run in process against the events the chain actually emitted.
 *
 * `createTestIndexer` is Envio's own harness: it loads `src/EventHandlers.ts` the way a deployment
 * does and feeds it simulated events, so these tests exercise the real registrations rather than
 * a copy of their logic. It needs `envio codegen` first, which only runs on linux and darwin, so
 * this suite runs in the `indexer` CI job and not on Windows.
 *
 * The first test replays the seven events behind the live deployment, with the values read back
 * from Monad testnet: block numbers, log indexes, transaction hashes, and each indexed `bytes4`
 * selector exactly as the hosted indexer received it, as a whole 32-byte topic. The deployment
 * built from these handlers before the fix showed three wrong fields; the assertions below name
 * them. Two of the three fail at runtime against the old handlers. The third, the missing
 * transaction hash, cannot fail here, because a simulated event carries whatever it is given; the
 * typecheck catches that one instead.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createTestIndexer } from "envio";

const CHAIN = 10143;

const PUBLISHER = "0xcc71E1f66CA325A9D3dEC74b2AA94CDF870194Dc";
const ACCOUNT = "0x209C903f68f169C8e654e0C3C91cAdc4C4A4aFF2";
const EXECUTOR = "0x258981915bF60938809277Eace03a2379aE46472";
const BOND_ASSET = "0xd80c19a863e4247B08f6152773820b87eE49a35C";

const PIN = "0x6520d020348ee7a8a91fcc071d0f62cf83762c47be749e6654c7ca31c0472df4";
const SKILL_HASH = "0x9b68b339278fd5f40079090a0a535d6c687aaacbb36d9ef888a942a12c600b80";
const VERSION_ID = "0xa471c57035177fce9bb1884e4c409e544da6cb23018818ab21ceca4f1e7955a5";
const BOND = 1_150_000_000n;

/** The successful guarded execution, `SkillExecuted` at block 62009032, log index 1. */
const EXECUTION_TX = "0xc372dfb6e82eaf372f347973ad76af6c0186b69870c5e893e4b3184f8a6fb5e8";

/** An indexed `bytes4` as the hosted indexer delivered it: the selector, then 28 zero bytes. */
const topicWord = (selector: string) => selector + "0".repeat(56);

/** `bytes32`-shaped test values, distinct per label. */
const word = (label: number) => "0x" + label.toString(16).padStart(64, "0");

function liveDeployment() {
  return [
    {
      contract: "PinRegistry",
      event: "BondDeposited",
      block: { number: 62008806, timestamp: 1789249349 },
      transaction: { hash: "0x4e68d265d2b942003f8a82b04bd5e111c9cc220ca90d1f0a729b12af367c066a" },
      logIndex: 1,
      params: { publisher: PUBLISHER, amount: BOND, balance: BOND },
    },
    {
      contract: "PinRegistry",
      event: "CapabilityDeclared",
      block: { number: 62008809, timestamp: 1789249350 },
      transaction: { hash: "0xdf1aa06aa6a6a72975db207accdd8ac931c31e7659699de53da8ce2374e2c745" },
      logIndex: 1,
      params: { pinId: PIN, target: BOND_ASSET, selector: topicWord("0x095ea7b3"), highRisk: true },
    },
    {
      contract: "PinRegistry",
      event: "CapabilityDeclared",
      block: { number: 62008809, timestamp: 1789249350 },
      transaction: { hash: "0xdf1aa06aa6a6a72975db207accdd8ac931c31e7659699de53da8ce2374e2c745" },
      logIndex: 2,
      params: { pinId: PIN, target: BOND_ASSET, selector: topicWord("0xa9059cbb"), highRisk: true },
    },
    {
      contract: "PinRegistry",
      event: "BondLocked",
      block: { number: 62008809, timestamp: 1789249350 },
      transaction: { hash: "0xdf1aa06aa6a6a72975db207accdd8ac931c31e7659699de53da8ce2374e2c745" },
      logIndex: 3,
      params: { pinId: PIN, publisher: PUBLISHER, amount: BOND },
    },
    {
      contract: "PinRegistry",
      event: "Published",
      block: { number: 62008809, timestamp: 1789249350 },
      transaction: { hash: "0xdf1aa06aa6a6a72975db207accdd8ac931c31e7659699de53da8ce2374e2c745" },
      logIndex: 4,
      params: {
        pinId: PIN,
        publisher: PUBLISHER,
        skillHash: SKILL_HASH,
        versionId: VERSION_ID,
        name: "kuru-quote",
        version: "3.0.0",
        maxValuePerBatch: 0n,
        capabilityCount: 2n,
        highRiskCount: 2n,
        requiredBond: BOND,
      },
    },
    {
      contract: "LockstepGuard",
      event: "PinApproved",
      srcAddress: ACCOUNT,
      block: { number: 62008822, timestamp: 1789249354 },
      transaction: { hash: "0x115d987a0344181ae1c3d05d0f565701df34636d3beba6d98e2b65cdc43ee4e0" },
      logIndex: 7,
      params: { pinId: PIN },
    },
    {
      contract: "LockstepGuard",
      event: "SkillExecuted",
      srcAddress: ACCOUNT,
      block: { number: 62009032, timestamp: 1789249417 },
      transaction: { hash: EXECUTION_TX },
      logIndex: 1,
      params: { pinId: PIN, skillHash: SKILL_HASH, executor: EXECUTOR, callCount: 2n },
    },
  ] as const;
}

/** A `Published` event for `publisher`, preceded by the deposit and lock the registry requires. */
function release(publisher: `0x${string}`, pin: string, block: number) {
  return [
    {
      contract: "PinRegistry",
      event: "BondDeposited",
      block: { number: block, timestamp: block },
      transaction: { hash: word(block * 10 + 1) },
      logIndex: 0,
      params: { publisher, amount: BOND, balance: BOND },
    },
    {
      contract: "PinRegistry",
      event: "BondLocked",
      block: { number: block + 1, timestamp: block + 1 },
      transaction: { hash: word(block * 10 + 2) },
      logIndex: 0,
      params: { pinId: pin, publisher, amount: BOND },
    },
    {
      contract: "PinRegistry",
      event: "Published",
      block: { number: block + 1, timestamp: block + 1 },
      transaction: { hash: word(block * 10 + 2) },
      logIndex: 1,
      params: {
        pinId: pin,
        publisher,
        skillHash: word(block),
        versionId: word(block + 1),
        name: "kuru-quote",
        version: `${block}.0.0`,
        maxValuePerBatch: 0n,
        capabilityCount: 0n,
        highRiskCount: 0n,
        requiredBond: BOND,
      },
    },
  ] as const;
}

describe("a slash", () => {
  const CHALLENGER = "0x00000000000000000000000000000000000000Cc";
  /** Past the registry's start block in config.yaml: an event before it is filtered out and never reaches a handler. */
  const BASE = 62_100_000;

  /** Two conflicting claims about one version by one publisher, then the slash, in the order the contract emits. */
  function equivocation(options: { revokeGuiltyFirst?: boolean } = {}) {
    const honestPin = word(0xa1);
    const guiltyPin = word(0xa2);
    // An unrelated release by the same publisher, which stays live throughout. Without it the live count ends at
    // zero whatever the handlers do, because the count is floored there.
    const bystanderPin = word(0xa3);
    const publish = (pin: string, block: number, skill: number, versionId: string = VERSION_ID) =>
      [
        {
          contract: "PinRegistry",
          event: "BondLocked",
          block: { number: block, timestamp: 1000 + (block - BASE) },
          transaction: { hash: word(block * 10 + 2) },
          logIndex: 0,
          params: { pinId: pin, publisher: PUBLISHER, amount: BOND },
        },
        {
          contract: "PinRegistry",
          event: "Published",
          block: { number: block, timestamp: 1000 + (block - BASE) },
          transaction: { hash: word(block * 10 + 2) },
          logIndex: 1,
          params: {
            pinId: pin,
            publisher: PUBLISHER,
            skillHash: word(skill),
            versionId,
            name: "kuru-quote",
            version: "1.0.0",
            maxValuePerBatch: 0n,
            capabilityCount: 0n,
            highRiskCount: 0n,
            requiredBond: BOND,
          },
        },
      ] as const;
    const slashBlock = BASE + 200;
    const tx = { hash: word(slashBlock * 10) };
    const at = { number: slashBlock, timestamp: 5000 };
    return {
      honestPin,
      guiltyPin,
      events: [
        {
          contract: "PinRegistry",
          event: "BondDeposited",
          block: { number: BASE + 90, timestamp: 1090 },
          transaction: { hash: word(900) },
          logIndex: 0,
          params: { publisher: PUBLISHER, amount: 3n * BOND, balance: 3n * BOND },
        },
        ...publish(honestPin, BASE + 100, 0x51),
        ...publish(guiltyPin, BASE + 110, 0x52),
        ...publish(bystanderPin, BASE + 120, 0x53, word(0x77)),
        ...(options.revokeGuiltyFirst
          ? [
              {
                contract: "PinRegistry",
                event: "Revoked",
                block: { number: BASE + 150, timestamp: 3000 },
                transaction: { hash: word(1500) },
                logIndex: 0,
                params: { pinId: guiltyPin, publisher: PUBLISHER },
              } as const,
            ]
          : []),
        // The contract's own order: `Slashed` for the guilty pin, then `Revoked` for A, then for B.
        {
          contract: "PinRegistry",
          event: "Slashed",
          block: at,
          transaction: tx,
          logIndex: 0,
          params: { pinId: guiltyPin, publisher: PUBLISHER, challenger: CHALLENGER, amount: BOND, challengerReward: BOND / 2n },
        },
        {
          contract: "PinRegistry",
          event: "Revoked",
          block: at,
          transaction: tx,
          logIndex: 1,
          params: { pinId: honestPin, publisher: PUBLISHER },
        },
        {
          contract: "PinRegistry",
          event: "Revoked",
          block: at,
          transaction: tx,
          logIndex: 2,
          params: { pinId: guiltyPin, publisher: PUBLISHER },
        },
      ] as const,
    };
  }

  it("takes the slashed pin out of the live count, once, and stamps when it was revoked", async () => {
    const { events, honestPin, guiltyPin } = equivocation();
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [...events] } } });

    const global = await indexer.Global.getOrThrow("global");
    assert.equal(global.totalPins, 3);
    // The bystander is the only live pin left. Was 2: the slashed pin was marked not-live without being
    // counted out, and the `Revoked` that follows it returns early for a pin that is no longer live.
    assert.equal(global.livePins, 1);

    const guilty = await indexer.Pin.getOrThrow(guiltyPin);
    assert.equal(guilty.slashed, true);
    assert.equal(guilty.live, false);
    // Was undefined: nothing else sets it for the slashed pin.
    assert.equal(guilty.revokedAt, 5000n);

    const honest = await indexer.Pin.getOrThrow(honestPin);
    assert.equal(honest.slashed, false, "the earlier claim is not the offence");
    assert.equal(honest.live, false, "but the contract revokes both while the contradiction stands");
    assert.equal(honest.revokedAt, 5000n);
  });

  it("releases the slashed bond from the locked total and from the publisher", async () => {
    const { events } = equivocation();
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [...events] } } });

    const global = await indexer.Global.getOrThrow("global");
    // Three pins locked 3 * BOND; the slash released BOND. Was 3 * BOND, because only a reclaim lowered it.
    assert.equal(global.totalBondLocked, 2n * BOND);
    assert.equal(global.totalSlashed, BOND);

    const publisher = await indexer.Publisher.getOrThrow(PUBLISHER.toLowerCase());
    assert.equal(publisher.lockedBond, 2n * BOND);
    assert.equal(publisher.totalSlashed, BOND);
    assert.equal(publisher.hasEquivocated, true);
    assert.equal(publisher.slashCount, 1);
  });

  it("does not count a pin out twice when the publisher had already revoked it", async () => {
    const { events, guiltyPin } = equivocation({ revokeGuiltyFirst: true });
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [...events] } } });

    const global = await indexer.Global.getOrThrow("global");
    // A and B are out, B by the publisher's own revocation and A by the contract's, and the bystander is
    // still live. Counting B out a second time on the slash would read 0 here.
    assert.equal(global.livePins, 1);
    assert.equal(global.totalPins, 3);

    // The earlier revocation time is the one that stands.
    assert.equal((await indexer.Pin.getOrThrow(guiltyPin)).revokedAt, 3000n);
  });
});

describe("the read model, replayed from the live deployment's events", () => {
  it("matches what the chain says happened", async () => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN]: { simulate: [...liveDeployment()] } } });

    const pin = await indexer.Pin.getOrThrow(PIN);
    assert.equal(pin.name, "kuru-quote");
    assert.equal(pin.version, "3.0.0");
    assert.equal(pin.requiredBond, BOND);
    assert.equal(pin.publishedBlock, 62008809n);
    assert.equal(pin.live, true);

    const publisher = await indexer.Publisher.getOrThrow(PUBLISHER.toLowerCase());
    assert.equal(publisher.pinCount, 1);
    assert.equal(publisher.lockedBond, BOND);

    const approval = await indexer.Approval.getOrThrow(`${ACCOUNT.toLowerCase()}-${PIN}`);
    assert.equal(approval.approved, true);

    // Live, this read `undefined-1`, because config.yaml selected no transaction fields. A simulated
    // event carries whatever hash it is given, so this line cannot catch a missing selection; the
    // typecheck does, through `logId` in the handlers and the typed `transaction` fields above.
    const executions = await indexer.Execution.getAll();
    assert.deepEqual(
      executions.map((execution) => execution.id),
      [`${EXECUTION_TX}-1`],
    );

    // Was 0: the deposit wrote the publisher's row first, so the first pin never counted as new.
    const global = await indexer.Global.getOrThrow("global");
    assert.equal(global.totalPublishers, 1);
    assert.equal(global.totalPins, 1);
    assert.equal(global.livePins, 1);
    assert.equal(global.totalBondLocked, BOND);
    assert.equal(global.totalExecutions, 1);

    // Were the whole 32-byte topic, so no query for an actual selector could match.
    const capabilities = await indexer.Capability.getAll();
    assert.deepEqual(capabilities.map((capability) => capability.selector).sort(), ["0x095ea7b3", "0xa9059cbb"]);
    assert.deepEqual(
      capabilities.map((capability) => capability.id).sort(),
      [
        `${PIN}-${BOND_ASSET.toLowerCase()}-0x095ea7b3`,
        `${PIN}-${BOND_ASSET.toLowerCase()}-0xa9059cbb`,
      ],
    );
  });

  it("counts a publisher once, however many pins they publish", async () => {
    const indexer = createTestIndexer();
    const other = "0x00000000000000000000000000000000000000Aa";
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            ...release(PUBLISHER, word(1), 62000000),
            ...release(PUBLISHER, word(2), 62000010),
            ...release(other, word(3), 62000020),
          ],
        },
      },
    });

    const global = await indexer.Global.getOrThrow("global");
    assert.equal(global.totalPins, 3);
    assert.equal(global.totalPublishers, 2);
  });

  it("keeps executions from different transactions that share a log index", async () => {
    // Log indexes restart in every block, so an id without the transaction hash collides. Live,
    // every id was `undefined-<logIndex>`, and a second execution at index 1 would have replaced
    // the first.
    const indexer = createTestIndexer();
    const executed = (block: number, hash: string) => ({
      contract: "LockstepGuard",
      event: "SkillExecuted",
      srcAddress: ACCOUNT,
      block: { number: block, timestamp: block },
      transaction: { hash },
      logIndex: 1,
      params: { pinId: PIN, skillHash: SKILL_HASH, executor: EXECUTOR, callCount: 1n },
    }) as const;
    await indexer.process({
      chains: { [CHAIN]: { simulate: [executed(62009100, word(0xa1)), executed(62009200, word(0xb2))] } },
    });

    const ids = (await indexer.Execution.getAll()).map((execution) => execution.id).sort();
    assert.deepEqual(ids, [`${word(0xa1)}-1`, `${word(0xb2)}-1`]);
    assert.equal((await indexer.Global.getOrThrow("global")).totalExecutions, 2);
  });
});
