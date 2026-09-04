/**
 * Envio HyperIndex handlers.
 *
 * Two things worth knowing before editing:
 *
 * **Guard events have no fixed address.** Under EIP-7702 the guard's code executes at
 * each delegated account's own address, so `PinApproved` and `SkillExecuted` arrive
 * from many senders. `event.srcAddress` is therefore the account, and it is the only
 * way to attribute an approval to a holder.
 *
 * **Derived state is computed here, not read from chain.** `live`, `hasEquivocated`,
 * and the bond totals are projections. They must be updated on every event that can
 * change them, or the read model silently drifts from the chain it claims to mirror.
 */

import {
  PinRegistry,
  LockstepGuard,
  type Pin,
  type Publisher,
} from "generated";

const GLOBAL_ID = "global";
const ZERO = 0n;

async function loadPublisher(context: any, address: string): Promise<Publisher> {
  const id = address.toLowerCase();
  const existing = await context.Publisher.get(id);
  if (existing !== undefined) return existing;
  return {
    id,
    bondBalance: ZERO,
    lockedBond: ZERO,
    totalDeposited: ZERO,
    totalWithdrawn: ZERO,
    totalSlashed: ZERO,
    pinCount: 0,
    slashCount: 0,
    hasEquivocated: false,
  };
}

async function loadGlobal(context: any) {
  const existing = await context.Global.get(GLOBAL_ID);
  if (existing !== undefined) return existing;
  return {
    id: GLOBAL_ID,
    totalPins: 0,
    livePins: 0,
    totalPublishers: 0,
    totalBondLocked: ZERO,
    totalSlashed: ZERO,
    totalExecutions: 0,
  };
}

PinRegistry.Published.handler(async ({ event, context }) => {
  const publisher = await loadPublisher(context, event.params.publisher);
  const isNew = (await context.Publisher.get(publisher.id)) === undefined;

  const pin: Pin = {
    id: event.params.pinId,
    publisher_id: publisher.id,
    skillHash: event.params.skillHash,
    maxValuePerCall: event.params.maxValuePerCall,
    requiredBond: event.params.requiredBond,
    capabilityCount: Number(event.params.capabilityCount),
    highRiskCount: Number(event.params.highRiskCount),
    publishedAt: BigInt(event.block.timestamp),
    publishedBlock: BigInt(event.block.number),
    revokedAt: undefined,
    slashed: false,
    bondReclaimed: false,
    live: true,
  };
  context.Pin.set(pin);

  context.Publisher.set({
    ...publisher,
    pinCount: publisher.pinCount + 1,
  });

  const global = await loadGlobal(context);
  context.Global.set({
    ...global,
    totalPins: global.totalPins + 1,
    livePins: global.livePins + 1,
    totalPublishers: global.totalPublishers + (isNew ? 1 : 0),
  });
});

PinRegistry.CapabilityDeclared.handler(async ({ event, context }) => {
  context.Capability.set({
    id: `${event.params.pinId}-${event.params.target.toLowerCase()}-${event.params.selector}`,
    pin_id: event.params.pinId,
    target: event.params.target.toLowerCase(),
    selector: event.params.selector,
    highRisk: event.params.highRisk,
  });
});

PinRegistry.Revoked.handler(async ({ event, context }) => {
  const pin = await context.Pin.get(event.params.pinId);
  if (pin === undefined) return;
  // `Revoked` fires twice during a slash, once per conflicting pin. Preserve the
  // first timestamp and only decrement the live counter on the transition.
  if (!pin.live) return;

  context.Pin.set({
    ...pin,
    revokedAt: pin.revokedAt ?? BigInt(event.block.timestamp),
    live: false,
  });

  const global = await loadGlobal(context);
  context.Global.set({ ...global, livePins: Math.max(0, global.livePins - 1) });
});

PinRegistry.Slashed.handler(async ({ event, context }) => {
  const pin = await context.Pin.get(event.params.pinId);
  const publisher = await loadPublisher(context, event.params.publisher);

  if (pin !== undefined) {
    context.Pin.set({ ...pin, slashed: true, live: false });
  }

  context.Slash.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    pin_id: event.params.pinId,
    publisher_id: publisher.id,
    challenger: event.params.challenger.toLowerCase(),
    amount: event.params.amount,
    challengerReward: event.params.challengerReward,
    timestamp: BigInt(event.block.timestamp),
  });

  // A slash is proof of conflicting version claims, so the flag is permanent. This is
  // the single most important field in the read model: it is what a user should see
  // before approving anything else from this publisher.
  context.Publisher.set({
    ...publisher,
    hasEquivocated: true,
    slashCount: publisher.slashCount + 1,
    totalSlashed: publisher.totalSlashed + event.params.amount,
    bondBalance:
      publisher.bondBalance > event.params.amount
        ? publisher.bondBalance - event.params.amount
        : ZERO,
    lockedBond:
      publisher.lockedBond > event.params.amount ? publisher.lockedBond - event.params.amount : ZERO,
  });

  const global = await loadGlobal(context);
  context.Global.set({
    ...global,
    totalSlashed: global.totalSlashed + event.params.amount,
  });
});

PinRegistry.BondDeposited.handler(async ({ event, context }) => {
  const publisher = await loadPublisher(context, event.params.publisher);
  context.Publisher.set({
    ...publisher,
    // `balance` is authoritative from the event; the running total is ours.
    bondBalance: event.params.balance,
    totalDeposited: publisher.totalDeposited + event.params.amount,
  });
});

PinRegistry.BondWithdrawn.handler(async ({ event, context }) => {
  const publisher = await loadPublisher(context, event.params.publisher);
  context.Publisher.set({
    ...publisher,
    bondBalance: event.params.balance,
    totalWithdrawn: publisher.totalWithdrawn + event.params.amount,
  });
});

PinRegistry.BondLocked.handler(async ({ event, context }) => {
  const publisher = await loadPublisher(context, event.params.publisher);
  context.Publisher.set({
    ...publisher,
    lockedBond: publisher.lockedBond + event.params.amount,
  });

  const global = await loadGlobal(context);
  context.Global.set({
    ...global,
    totalBondLocked: global.totalBondLocked + event.params.amount,
  });
});

PinRegistry.BondReclaimed.handler(async ({ event, context }) => {
  const publisher = await loadPublisher(context, event.params.publisher);
  const pin = await context.Pin.get(event.params.pinId);
  if (pin !== undefined) {
    context.Pin.set({ ...pin, bondReclaimed: true });
  }

  context.Publisher.set({
    ...publisher,
    lockedBond:
      publisher.lockedBond > event.params.amount ? publisher.lockedBond - event.params.amount : ZERO,
  });

  const global = await loadGlobal(context);
  context.Global.set({
    ...global,
    totalBondLocked:
      global.totalBondLocked > event.params.amount
        ? global.totalBondLocked - event.params.amount
        : ZERO,
  });
});

// --- guard events, emitted at each delegated account's own address ---

LockstepGuard.PinApproved.handler(async ({ event, context }) => {
  const account = event.srcAddress.toLowerCase();
  const id = `${account}-${event.params.pinId}`;
  const existing = await context.Approval.get(id);

  context.Approval.set({
    id,
    account,
    pin_id: event.params.pinId,
    approved: true,
    approvedAt: existing?.approvedAt ?? BigInt(event.block.timestamp),
    updatedAt: BigInt(event.block.timestamp),
  });
});

LockstepGuard.PinUnapproved.handler(async ({ event, context }) => {
  const account = event.srcAddress.toLowerCase();
  const id = `${account}-${event.params.pinId}`;
  const existing = await context.Approval.get(id);
  if (existing === undefined) return;

  context.Approval.set({
    ...existing,
    approved: false,
    updatedAt: BigInt(event.block.timestamp),
  });
});

LockstepGuard.SkillExecuted.handler(async ({ event, context }) => {
  context.Execution.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    account: event.srcAddress.toLowerCase(),
    pin_id: event.params.pinId,
    skillHash: event.params.skillHash,
    executor: event.params.executor.toLowerCase(),
    callCount: Number(event.params.callCount),
    timestamp: BigInt(event.block.timestamp),
    block: BigInt(event.block.number),
  });

  const global = await loadGlobal(context);
  context.Global.set({ ...global, totalExecutions: global.totalExecutions + 1 });
});
