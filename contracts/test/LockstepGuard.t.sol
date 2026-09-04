// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Test.sol";

import {Fixtures} from "./Fixtures.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";
import {PinRegistry} from "../src/PinRegistry.sol";

/// @dev Stands in for a real venue such as the Kuru router.
contract MockRouter {
    uint256 public swaps;
    uint256 public received;

    function swap(uint256 amountIn) external payable returns (uint256) {
        swaps += 1;
        received += msg.value;
        return amountIn * 2;
    }

    function drain(address to) external {
        payable(to).transfer(address(this).balance);
    }

    function boom() external pure {
        revert("router: boom");
    }

    receive() external payable {
        received += msg.value;
    }
}

contract LockstepGuardTest is Fixtures {
    MockRouter internal router;

    uint256 internal constant ACCOUNT_PK = 0xA11CE;
    address payable internal account;

    address internal publisher;
    address internal executor;
    address internal attacker;

    bytes4 internal constant SWAP_SELECTOR = MockRouter.swap.selector;
    bytes4 internal constant DRAIN_SELECTOR = MockRouter.drain.selector;

    /// Canonical hash of the honest skill, from `lockstep-skill-hash/v2`.
    /// This is the real golden vector the runtime package produces for the
    /// kuru-quote fixture, so both halves of the system stay pinned together. If
    /// the runtime's golden-vector test changes, this must change with it.
    bytes32 internal constant HONEST_SKILL =
        0x9c66b961fe093d92b35dfed90ec234d617fa4f77899c4871f4e734b1dd5b757b;

    /// Same skill after a silent hostile update. Any single byte change lands here.
    bytes32 internal constant HOSTILE_SKILL = keccak256("hostile update");

    bytes32 internal honestPin;

    function setUp() public {
        publisher = makeAddr("publisher");
        executor = makeAddr("executor");
        attacker = makeAddr("attacker");

        deployCore();
        router = new MockRouter();
        account = payable(vm.addr(ACCOUNT_PK));

        // Publisher pins the honest version, allowing only MockRouter.swap.
        fundPublisher(publisher, 1_000_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(router), SWAP_SELECTOR);

        vm.prank(publisher);
        honestPin = registry.publish(HONEST_SKILL, DEFAULT_VERSION, 1 ether, targets, selectors);

        // Real EIP-7702: the account delegates its code to the guard.
        Vm.SignedDelegation memory delegation = vm.signDelegation(address(guardImpl), ACCOUNT_PK);
        vm.attachDelegation(delegation);

        // Account holder sets policy. Funds live in the account.
        vm.deal(account, 10 ether);
        vm.startPrank(account);
        LockstepGuard(account).approvePin(honestPin);
        LockstepGuard(account).authorizeExecutor(executor);
        vm.stopPrank();
    }

    function _swapCall(uint256 value) internal view returns (LockstepGuard.Call[] memory calls) {
        calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({
            target: address(router),
            value: value,
            data: abi.encodeCall(MockRouter.swap, (100))
        });
    }

    // --- delegation sanity ---

    function test_delegationInstallsGuardCode() public view {
        assertGt(account.code.length, 0, "account should carry a delegation designator");
        assertTrue(LockstepGuard(account).isPinApproved(honestPin));
        assertTrue(LockstepGuard(account).isExecutorAuthorized(executor));
    }

    /// The namespace string is load bearing. If someone edits it without
    /// recomputing the slot, every existing account's approvals become
    /// unreachable, which would read as mass approval loss in production.
    function test_storageSlotMatchesErc7201Derivation() public view {
        bytes32 expected =
            keccak256(abi.encode(uint256(keccak256("lockstep.guard.v1")) - 1)) & ~bytes32(uint256(0xff));

        assertEq(guardImpl.guardStorageSlot(), expected, "ERC-7201 slot derivation drifted");
    }

    // --- happy path ---

    function test_executesApprovedSkill() public {
        vm.prank(executor);
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(0.5 ether));

        assertEq(router.swaps(), 1);
        assertEq(router.received(), 0.5 ether);
        
    }

    function test_accountHolderCanExecuteDirectly() public {
        vm.prank(account);
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(0));

        assertEq(router.swaps(), 1);
    }

    function test_emitsSkillExecuted() public {
        vm.expectEmit(true, true, true, true, account);
        emit LockstepGuard.SkillExecuted(honestPin, HONEST_SKILL, executor, 1);

        vm.prank(executor);
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(0));
    }

    // --- the rug pull ---

    /// Publisher ships a hostile update. The agent honestly reports the new hash.
    /// No approval exists for it, so nothing executes.
    function test_rugPull_blockedWhenHostileVersionIsNotApproved() public {
        address[] memory targets = new address[](1);
        bytes4[] memory selectors = new bytes4[](1);
        targets[0] = address(router);
        selectors[0] = DRAIN_SELECTOR;

        vm.prank(publisher);
        bytes32 hostilePin = registry.publish(HOSTILE_SKILL, DEFAULT_VERSION, 10 ether, targets, selectors);

        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({
            target: address(router),
            value: 0,
            data: abi.encodeCall(MockRouter.drain, (attacker))
        });

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.PinNotApproved.selector, hostilePin));
        LockstepGuard(account).execute(hostilePin, HOSTILE_SKILL, calls);

        assertEq(router.swaps(), 0);
    }

    /// A compromised runtime lies: it reports the approved hash while the pin it
    /// names holds different bytes. The on-chain binding catches the mismatch.
    function test_rugPull_blockedWhenAttestationDoesNotMatchPin() public {
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.SkillHashMismatch.selector, HOSTILE_SKILL, HONEST_SKILL)
        );
        LockstepGuard(account).execute(honestPin, HOSTILE_SKILL, _swapCall(0));
    }

    /// A blocked attempt must be diagnosable off-chain. Logs cannot carry it,
    /// because the revert rolls them back, so the revert reason has to carry both
    /// the attested and the pinned hash for the watcher to read from the trace.
    function test_rugPull_revertCarriesBothHashesForTheWatcher() public {
        vm.prank(executor);
        (bool ok, bytes memory ret) = account.call(
            abi.encodeCall(LockstepGuard.execute, (honestPin, HOSTILE_SKILL, _swapCall(0)))
        );

        assertFalse(ok, "must not execute a mismatched skill");
        assertEq(bytes4(ret), LockstepGuard.SkillHashMismatch.selector);

        (bytes32 attested, bytes32 pinned) = abi.decode(_stripSelector(ret), (bytes32, bytes32));
        assertEq(attested, HOSTILE_SKILL);
        assertEq(pinned, HONEST_SKILL);
    }

    /// No log is emitted on the rejection path. Emitting one would be discarded by
    /// the revert while still costing gas.
    function test_rugPull_emitsNoLogs() public {
        vm.recordLogs();

        vm.prank(executor);
        (bool ok,) = account.call(
            abi.encodeCall(LockstepGuard.execute, (honestPin, HOSTILE_SKILL, _swapCall(0)))
        );

        assertFalse(ok);
        assertEq(vm.getRecordedLogs().length, 0, "rejection must not emit logs");
    }

    function _stripSelector(bytes memory data) internal pure returns (bytes memory out) {
        out = new bytes(data.length - 4);
        for (uint256 i = 0; i < out.length; ++i) {
            out[i] = data[i + 4];
        }
    }

    /// Publisher discovers their own release was compromised and revokes it.
    /// Previously granted approvals stop working without the user doing anything.
    function test_publisherRevocationHaltsExecution() public {
        vm.prank(publisher);
        registry.revoke(honestPin);

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.SkillHashMismatch.selector, HONEST_SKILL, bytes32(0))
        );
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(0));
    }

    // --- authorisation ---

    function test_unauthorizedExecutorCannotExecute() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.NotAuthorizedExecutor.selector, attacker));
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(0));
    }

    /// An agent must never be able to widen its own permissions.
    function test_executorCannotApprovePins() public {
        bytes32 other = keccak256("other");

        vm.prank(executor);
        vm.expectRevert(LockstepGuard.NotSelf.selector);
        LockstepGuard(account).approvePin(other);
    }

    function test_executorCannotAuthorizeItselfElsewhere() public {
        vm.prank(executor);
        vm.expectRevert(LockstepGuard.NotSelf.selector);
        LockstepGuard(account).authorizeExecutor(attacker);
    }

    function test_revokedExecutorIsImmediatelyBlocked() public {
        vm.prank(account);
        LockstepGuard(account).revokeExecutor(executor);

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.NotAuthorizedExecutor.selector, executor));
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(0));
    }

    // --- capability bounds, enforced on-chain regardless of attestation ---

    function test_undeclaredSelectorIsRefused() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({
            target: address(router),
            value: 0,
            data: abi.encodeCall(MockRouter.drain, (attacker))
        });

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                LockstepGuard.CapabilityNotDeclared.selector, address(router), DRAIN_SELECTOR
            )
        );
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, calls);
    }

    function test_undeclaredTargetIsRefused() public {
        MockRouter other = new MockRouter();

        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({
            target: address(other),
            value: 0,
            data: abi.encodeCall(MockRouter.swap, (1))
        });

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                LockstepGuard.CapabilityNotDeclared.selector, address(other), SWAP_SELECTOR
            )
        );
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, calls);
    }

    /// A pin that declares only contract calls must not be usable for bare sends.
    function test_bareValueTransferRequiresSelectorZeroDeclared() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({target: attacker, value: 1 ether, data: ""});

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.CapabilityNotDeclared.selector, attacker, bytes4(0))
        );
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, calls);

        assertEq(attacker.balance, 0);
    }

    function test_valueCeilingIsEnforced() public {
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.ValueExceedsCeiling.selector, 2 ether, 1 ether)
        );
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(2 ether));
    }

    function test_emptyBatchIsRefused() public {
        vm.prank(executor);
        vm.expectRevert(LockstepGuard.EmptyBatch.selector);
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, new LockstepGuard.Call[](0));
    }

    function test_bubblesTargetRevertReason() public {
        address[] memory targets = new address[](1);
        bytes4[] memory selectors = new bytes4[](1);
        targets[0] = address(router);
        selectors[0] = MockRouter.boom.selector;

        vm.prank(publisher);
        bytes32 pin = registry.publish(keccak256("boomskill"), DEFAULT_VERSION, 0, targets, selectors);

        vm.prank(account);
        LockstepGuard(account).approvePin(pin);

        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({
            target: address(router),
            value: 0,
            data: abi.encodeCall(MockRouter.boom, ())
        });

        vm.prank(executor);
        vm.expectRevert("router: boom");
        LockstepGuard(account).execute(pin, keccak256("boomskill"), calls);
    }

    // --- fuzz ---

    /// No attested hash other than the pinned one may ever execute.
    function testFuzz_onlyPinnedHashExecutes(bytes32 attested) public {
        vm.assume(attested != HONEST_SKILL);

        vm.prank(executor);
        vm.expectRevert();
        LockstepGuard(account).execute(honestPin, attested, _swapCall(0));

        assertEq(router.swaps(), 0);
    }

    /// No caller other than an authorised executor or the account may execute.
    function testFuzz_onlyAuthorizedCallersExecute(address caller) public {
        vm.assume(caller != executor && caller != account);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.NotAuthorizedExecutor.selector, caller));
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(0));
    }

    /// Value above the ceiling never passes, whatever the amount.
    function testFuzz_ceilingHolds(uint256 value) public {
        vm.assume(value > 1 ether && value < 100 ether);
        vm.deal(account, 200 ether);

        vm.prank(executor);
        vm.expectRevert();
        LockstepGuard(account).execute(honestPin, HONEST_SKILL, _swapCall(value));
    }
}

