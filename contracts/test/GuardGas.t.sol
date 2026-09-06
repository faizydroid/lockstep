// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm, console} from "forge-std/Test.sol";

import {Fixtures} from "./Fixtures.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";

contract GasRouter {
    uint256 public swaps;

    function swap(uint256 amountIn) external payable returns (uint256) {
        swaps += 1;
        return amountIn * 2;
    }
}

/// @notice Measures what Lockstep costs per transaction.
///
/// This is the number the "why Monad" argument rests on: enforcement has to be
/// cheap enough to sit in front of consumer-scale agent activity. Reported as
/// overhead against an unguarded call so it is independent of what the target does.
contract GuardGasTest is Fixtures {
    GasRouter internal router;

    uint256 internal constant ACCOUNT_PK = 0xA11CE;
    address payable internal account;
    address internal executor;

    bytes32 internal skillHash = keccak256("gas-bench-skill");
    bytes32 internal pinId;

    function setUp() public {
        executor = makeAddr("executor");
        deployCore();
        router = new GasRouter();
        account = payable(vm.addr(ACCOUNT_PK));

        fundPublisher(address(this), 100_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(router), GasRouter.swap.selector);
        registry.publish(defaultParams(skillHash, 1 ether, targets, selectors));
        pinId = registry.computePinId(address(this), skillHash);

        Vm.SignedDelegation memory d = vm.signDelegation(address(guardImpl), ACCOUNT_PK);
        vm.attachDelegation(d);

        vm.deal(account, 100 ether);
        vm.startPrank(account);
        LockstepGuard(account).approvePin(pinId);
        LockstepGuard(account).authorizeExecutor(executor);
        vm.stopPrank();

        // Warm every storage slot and contract the measured path touches, so the
        // reported overhead reflects steady-state cost rather than first-touch
        // cold-access penalties that a real agent pays once and never again.
        vm.prank(executor);
        LockstepGuard(account).execute(pinId, skillHash, _calls(1));
    }

    function _calls(uint256 n) internal view returns (LockstepGuard.Call[] memory calls) {
        calls = new LockstepGuard.Call[](n);
        for (uint256 i = 0; i < n; ++i) {
            calls[i] = LockstepGuard.Call({
                target: address(router),
                value: 0,
                data: abi.encodeCall(GasRouter.swap, (100))
            });
        }
    }

    function test_gas_overheadPerGuardedCall() public {
        // Baseline: unguarded direct call, warm.
        router.swap(100);
        uint256 g0 = gasleft();
        router.swap(100);
        uint256 baseline = g0 - gasleft();

        // Guarded: same effect, through an approved pin.
        vm.prank(executor);
        uint256 g1 = gasleft();
        LockstepGuard(account).execute(pinId, skillHash, _calls(1));
        uint256 guarded = g1 - gasleft();

        console.log("unguarded direct call   :", baseline);
        console.log("guarded via Lockstep    :", guarded);
        console.log("overhead (1 call)       :", guarded - baseline);

        // Sanity ceiling. Enforcement is two SLOADs, an external view, and a
        // comparison; if this regresses past 60k something structural broke.
        assertLt(guarded - baseline, 60_000, "guard overhead regressed");
    }

    function test_gas_batchAmortisesFixedCost() public {
        vm.prank(executor);
        uint256 g1 = gasleft();
        LockstepGuard(account).execute(pinId, skillHash, _calls(1));
        uint256 one = g1 - gasleft();

        vm.prank(executor);
        uint256 g5 = gasleft();
        LockstepGuard(account).execute(pinId, skillHash, _calls(5));
        uint256 five = g5 - gasleft();

        console.log("guarded batch of 1      :", one);
        console.log("guarded batch of 5      :", five);
        console.log("marginal per extra call :", (five - one) / 4);

        // The pin lookup and attestation check are once per batch, not per call,
        // so each additional call must cost strictly less than the first.
        assertLt((five - one) / 4, one, "batching should amortise the fixed check");
    }

    function test_gas_rejectionIsCheap() public {
        // Raw call rather than try/catch: try/catch reserves 1/64 of remaining
        // gas and wraps the call in returndata handling, which inflated an
        // earlier measurement of this path by roughly 40k and made a two-SLOAD
        // rejection look more expensive than a full successful execution.
        bytes memory payload =
            abi.encodeCall(LockstepGuard.execute, (pinId, keccak256("wrong"), _calls(1)));
        bytes memory authPayload =
            abi.encodeCall(LockstepGuard.execute, (pinId, skillHash, _calls(1)));

        // Foundry resets the access list between setUp and the test body, so the
        // first call measured in a test pays cold-address and cold-slot costs an
        // agent only pays once. Warm the exact paths first, then measure, or the
        // two figures below are not comparable.
        vm.prank(executor);
        (bool warm1,) = account.call(payload);
        vm.prank(makeAddr("nobody"));
        (bool warm2,) = account.call(authPayload);
        assertFalse(warm1);
        assertFalse(warm2);

        vm.prank(executor);
        uint256 g = gasleft();
        (bool ok,) = account.call(payload);
        uint256 used = g - gasleft();
        assertFalse(ok, "mismatched attestation must revert");

        // Floor comparison: the cheapest possible rejection is an unauthorised
        // caller, which fails after a single SLOAD.
        vm.prank(makeAddr("nobody"));
        uint256 g2 = gasleft();
        (bool ok2,) = account.call(authPayload);
        uint256 minimal = g2 - gasleft();
        assertFalse(ok2);

        console.log("minimal rejection (auth) :", minimal);
        console.log("cost to reject a rug pull:", used);

        // The property that matters: refusing must cost less than executing,
        // otherwise blocking a rug pull becomes a griefing vector against
        // whoever pays gas. Measured warm: ~43.2k to reject vs ~66.7k to execute.
        // The ~28.2k floor for even a one-SLOAD rejection is EIP-7702 delegation
        // resolution plus call overhead, not guard logic.
        assertLt(used, 50_000, "rejection path regressed");
        assertGt(used, minimal, "rug-pull check should cost more than an auth failure");
    }
}

