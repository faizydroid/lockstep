import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These suites are serial because they contend for resources outside the process.
    //
    // Each one starts its own anvil on its own port, which looked like enough isolation.
    // It is not: `forge script --broadcast` also writes a receipt to
    // contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json, and every anvil here is
    // chain 31337, so all of them target one path. On Windows that file lock is exclusive,
    // and the loser fails with os error 32 rather than anything describing the real
    // problem. Giving each suite a different chain id would fix the collision but break
    // viem's `foundry` chain, which is 31337 by definition.
    //
    // Running files one at a time also keeps these tests honest about timing. They spawn
    // anvil, forge and node subprocesses and then wait on real timeouts, so under parallel
    // CPU load they fail for reasons that have nothing to do with the code being tested.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
