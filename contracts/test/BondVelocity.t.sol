// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
/// @notice Bond velocity: how much value a unit of bonded capital can secure per unit time.
///
/// This is the "why Monad" argument, and it is an economic one rather than a UX one.
/// A bond is committed for the length of the window in which a claim against it can
/// still be raised. With a bond `B` and a window `W`, the capital can back at most
/// `B/W` of value per unit time. Shrinking `W` raises throughput per unit of locked
/// capital with no extra collateral.
///
/// Monad's 300ms blocks make a 20-block window six seconds. The same window at
/// Ethereum's 12s blocks is four minutes. The ratio below is the whole claim, and it
/// is arithmetic on block times rather than a benchmark of this code — which is why
/// it is asserted here rather than measured, and why the assertions are on the ratio
/// and not on wall-clock timings that would vary per machine.
contract BondVelocityTest is Test {
    /// Blocks a challenge window must stay open for. Same count on either chain;
    /// only the wall-clock duration differs.
    uint256 internal constant CHALLENGE_WINDOW_BLOCKS = 20;

    uint256 internal constant MONAD_BLOCK_MS = 300;
    uint256 internal constant ETHEREUM_BLOCK_MS = 12_000;

    function _windowSeconds(uint256 blockMs) internal pure returns (uint256) {
        return (CHALLENGE_WINDOW_BLOCKS * blockMs) / 1000;
    }

    function test_windowDurations() public pure {
        assertEq(_windowSeconds(MONAD_BLOCK_MS), 6, "monad window should be 6s");
        assertEq(_windowSeconds(ETHEREUM_BLOCK_MS), 240, "ethereum window should be 240s");
    }

    /// Bond velocity ratio = window ratio, because velocity is inversely
    /// proportional to the window a bond stays committed for.
    function test_bondVelocityAdvantage() public pure {
        uint256 monad = _windowSeconds(MONAD_BLOCK_MS);
        uint256 ethereum = _windowSeconds(ETHEREUM_BLOCK_MS);
        uint256 advantage = ethereum / monad;

        console.log("challenge window blocks     :", CHALLENGE_WINDOW_BLOCKS);
        console.log("window on Monad (seconds)   :", monad);
        console.log("window on Ethereum (seconds):", ethereum);
        console.log("bond velocity advantage (x) :", advantage);

        assertEq(advantage, 40, "expected a 40x advantage from 300ms vs 12s blocks");
    }

    /// Worked example, so the claim is legible in dollars rather than ratios.
    ///
    /// A 10,000 AUSD bond covering jobs worth 100 AUSD each: how many can it secure
    /// per hour, given the bond is committed for one window per job?
    function test_throughputWorkedExample() public pure {
        uint256 bond = 10_000e6;
        uint256 perJob = 100e6;
        uint256 concurrent = bond / perJob; // 100 jobs in flight at once
        uint256 secondsPerHour = 3600;

        uint256 monadPerHour = (concurrent * secondsPerHour) / _windowSeconds(MONAD_BLOCK_MS);
        uint256 ethereumPerHour = (concurrent * secondsPerHour) / _windowSeconds(ETHEREUM_BLOCK_MS);

        console.log("bond (AUSD)                 :", bond / 1e6);
        console.log("jobs securable per hour, Monad   :", monadPerHour);
        console.log("jobs securable per hour, Ethereum:", ethereumPerHour);

        assertEq(monadPerHour, 60_000);
        assertEq(ethereumPerHour, 1_500);
        assertEq(monadPerHour / ethereumPerHour, 40);
    }
}

