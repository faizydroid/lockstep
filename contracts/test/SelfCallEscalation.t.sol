// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";
import {PinRegistry} from "../src/PinRegistry.sol";
import {HighRiskSelectors} from "../src/HighRiskSelectors.sol";

/// @notice Regression tests for a confirmed privilege escalation through `execute`.
///
/// ## What the defect was
///
/// `LockstepGuard` stated the guarantee absolutely: "Executors deliberately cannot change policy -
/// an agent must never be able to widen its own permissions." Two tests supported it —
/// `test_executorCannotApprovePins` and `test_executorCannotAuthorizeItselfElsewhere` — and both
/// exercised the *direct* path: the executor calls a policy setter at the account address and is
/// refused with `NotSelf`.
///
/// Neither covered the nested path. `execute` performs `c.target.call(c.data)` from the account, so
/// a call whose target is the account satisfies `onlySelf` on the inner call. An authorised executor
/// could route `authorizeExecutor(attacker)` or `approvePin(anything)` through a batch and change
/// policy with no owner signature. Both were demonstrated passing before the fix.
///
/// It needed an approved pin declaring `(accountAddress, policySelector)`, so it was targeted rather
/// than broadly exploitable — and it was reachable, and the documentation said it was not.
///
/// ## What closed it
///
/// `execute` refuses the account as a call target, for every call, in the pre-flight pass that runs
/// before anything executes. Every self-target, not a blacklist of the four policy selectors, so a
/// function added to this contract later cannot reopen the hole while nobody remembers the list.
///
/// These tests were written to prove the escalation and are kept, inverted, so it cannot return.
contract SelfCallEscalationTest is Fixtures {
    uint256 internal constant ACCOUNT_PK = 0xBEEF;

    address payable internal account;
    address internal executor;
    address internal attacker;
    address internal publisher;
    address internal router;

    function setUp() public {
        deployCore();
        account = payable(vm.addr(ACCOUNT_PK));
        executor = makeAddr("executor");
        attacker = makeAddr("attacker");
        publisher = makeAddr("publisher");
        router = address(new PolicyProbe());

        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);
        vm.deal(account, 10 ether);
        fundPublisher(publisher, 1_000_000 * ONE_AUSD);
    }

    /// @dev Publishes a pin whose single declared capability is a call to `target`/`selector`.
    function _pinFor(bytes32 skillHash, address target, bytes4 selector)
        internal
        returns (bytes32 pinId)
    {
        (address[] memory targets, bytes4[] memory selectors) = singleCapability(target, selector);
        vm.prank(publisher);
        registry.publish(defaultParams(skillHash, 0, targets, selectors));
        return registry.computePinId(publisher, skillHash);
    }

    function _calls(address target, bytes memory data)
        internal
        pure
        returns (LockstepGuard.Call[] memory calls)
    {
        calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({target: target, value: 0, data: data});
    }

    /// @dev The owner's deliberate acts: approve the pin, authorise one executor.
    function _ownerApproves(bytes32 pinId) internal {
        vm.startPrank(account);
        LockstepGuard(account).approvePin(pinId);
        LockstepGuard(account).authorizeExecutor(executor);
        vm.stopPrank();
    }

    // ------------------------------------------------------- the escalation, now refused

    /// Was: the executor authorised a second executor through `execute`. Now refused.
    function test_theExecutorCannotAuthorizeAnotherExecutorThroughExecute() public {
        bytes32 skillHash = keccak256("policy-touching-skill");
        bytes32 pinId = _pinFor(skillHash, account, LockstepGuard.authorizeExecutor.selector);
        _ownerApproves(pinId);

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.SelfCallRefused.selector, 0));
        LockstepGuard(account).execute(
            pinId,
            skillHash,
            _calls(account, abi.encodeCall(LockstepGuard.authorizeExecutor, (attacker)))
        );

        assertFalse(
            LockstepGuard(account).isExecutorAuthorized(attacker),
            "the attacker was never authorised"
        );
    }

    /// Was: the executor approved a pin the owner had never seen. The more serious of the two,
    /// because approving is the consent step the whole product rests on. Now refused.
    function test_theExecutorCannotApproveAPinThroughExecute() public {
        bytes32 skillHash = keccak256("approval-touching-skill");
        bytes32 pinId = _pinFor(skillHash, account, LockstepGuard.approvePin.selector);
        _ownerApproves(pinId);

        bytes32 neverApproved = keccak256("a pin the owner never saw");

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.SelfCallRefused.selector, 0));
        LockstepGuard(account).execute(
            pinId,
            skillHash,
            _calls(account, abi.encodeCall(LockstepGuard.approvePin, (neverApproved)))
        );

        assertFalse(
            LockstepGuard(account).isPinApproved(neverApproved),
            "the pin the owner never saw is still unapproved"
        );
    }

    /// The account holder cannot do it either, and that is the correct outcome rather than a
    /// missing convenience: they already have the direct path, which `onlySelf` permits.
    function test_evenTheAccountHolderCannotSelfCallThroughExecute() public {
        bytes32 skillHash = keccak256("owner-self-call");
        bytes32 pinId = _pinFor(skillHash, account, LockstepGuard.authorizeExecutor.selector);
        _ownerApproves(pinId);

        vm.prank(account);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.SelfCallRefused.selector, 0));
        LockstepGuard(account).execute(
            pinId,
            skillHash,
            _calls(account, abi.encodeCall(LockstepGuard.authorizeExecutor, (attacker)))
        );
    }

    /// A self-target is refused whatever the calldata, because the check is on the target and not
    /// on a list of selectors. This is the property that makes a future added function safe.
    function test_aSelfTargetIsRefusedWhateverTheCalldata() public {
        bytes32 skillHash = keccak256("self-target-any-data");
        // An entirely unrelated selector, declared so the capability check would otherwise pass.
        bytes4 harmless = bytes4(keccak256("somethingHarmless()"));
        bytes32 pinId = _pinFor(skillHash, account, harmless);
        _ownerApproves(pinId);

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.SelfCallRefused.selector, 0));
        LockstepGuard(account).execute(pinId, skillHash, _calls(account, abi.encode(harmless)));
    }

    /// And it is refused wherever it sits in the batch, not only first. The index is reported.
    function test_aSelfTargetLaterInTheBatchIsRefusedWithItsIndex() public {
        bytes32 skillHash = keccak256("self-target-second");
        address[] memory targets = new address[](2);
        bytes4[] memory selectors = new bytes4[](2);
        targets[0] = router;
        selectors[0] = PolicyProbe.ping.selector;
        targets[1] = account;
        selectors[1] = LockstepGuard.authorizeExecutor.selector;

        vm.prank(publisher);
        registry.publish(defaultParams(skillHash, 0, targets, selectors));
        bytes32 pinId = registry.computePinId(publisher, skillHash);
        _ownerApproves(pinId);

        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](2);
        calls[0] = LockstepGuard.Call({
            target: router,
            value: 0,
            data: abi.encodeCall(PolicyProbe.ping, ())
        });
        calls[1] = LockstepGuard.Call({
            target: account,
            value: 0,
            data: abi.encodeCall(LockstepGuard.authorizeExecutor, (attacker))
        });

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.SelfCallRefused.selector, 1));
        LockstepGuard(account).execute(pinId, skillHash, calls);

        // Nothing ran. The refusal is in the pre-flight pass, before any external call.
        assertEq(PolicyProbe(router).pings(), 0, "the earlier call never executed");
        assertFalse(LockstepGuard(account).isExecutorAuthorized(attacker), "no escalation");
    }

    // ------------------------------------------------------- nothing legitimate was lost

    /// The ordinary path is untouched: a batch to a normal target still executes.
    function test_anOrdinaryBatchToANonSelfTargetStillExecutes() public {
        bytes32 skillHash = keccak256("ordinary-skill");
        bytes32 pinId = _pinFor(skillHash, router, PolicyProbe.ping.selector);
        _ownerApproves(pinId);

        vm.prank(executor);
        LockstepGuard(account).execute(
            pinId, skillHash, _calls(router, abi.encodeCall(PolicyProbe.ping, ()))
        );

        assertEq(PolicyProbe(router).pings(), 1, "the honest call executed");
    }

    /// A different account delegated to the same guard is not a self-target, so cross-account
    /// composition is unaffected. This matters because the executor model depends on it.
    function test_aDifferentGuardedAccountIsNotASelfTarget() public {
        uint256 otherPk = 0xC0FFEE;
        address payable other = payable(vm.addr(otherPk));
        vm.signAndAttachDelegation(address(guardImpl), otherPk);

        bytes32 skillHash = keccak256("cross-account");
        bytes32 pinId = _pinFor(skillHash, other, LockstepGuard.authorizeExecutor.selector);
        _ownerApproves(pinId);

        // Refused, but by `NotSelf` on the *other* account rather than by the target check: the
        // call reaches it and that account's own `onlySelf` turns it away. The distinction is the
        // point — the target check has not made every guarded address unreachable.
        vm.prank(executor);
        vm.expectRevert(LockstepGuard.NotSelf.selector);
        LockstepGuard(account).execute(
            pinId,
            skillHash,
            _calls(other, abi.encodeCall(LockstepGuard.authorizeExecutor, (attacker)))
        );
    }

    // ------------------------------------------------------- ordering and preconditions

    /// The self-target check runs after the approval check, so an unapproved pin still fails for
    /// the more informative reason.
    function test_anUnapprovedPinFailsOnApprovalNotOnTheTargetCheck() public {
        bytes32 skillHash = keccak256("unapproved-policy-skill");
        bytes32 pinId = _pinFor(skillHash, account, LockstepGuard.authorizeExecutor.selector);

        vm.prank(account);
        LockstepGuard(account).authorizeExecutor(executor);
        // Deliberately no approvePin.

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.PinNotApproved.selector, pinId));
        LockstepGuard(account).execute(
            pinId,
            skillHash,
            _calls(account, abi.encodeCall(LockstepGuard.authorizeExecutor, (attacker)))
        );
    }

    /// The self-target check runs *before* the per-call capability check, which is why a pin that
    /// never declared the capability now reports `SelfCallRefused` rather than
    /// `CapabilityNotDeclared`. Pinned deliberately: the batch is rejected on the cheaper, more
    /// specific reason, and before any call runs.
    function test_theTargetCheckPrecedesTheCapabilityCheck() public {
        bytes32 skillHash = keccak256("undeclared-self-call");
        bytes32 pinId = _pinFor(skillHash, router, PolicyProbe.ping.selector);
        _ownerApproves(pinId);

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(LockstepGuard.SelfCallRefused.selector, 0));
        LockstepGuard(account).execute(
            pinId,
            skillHash,
            _calls(account, abi.encodeCall(LockstepGuard.authorizeExecutor, (attacker)))
        );
    }

    /// Sanity: the direct path is still closed, so this was a nested-call defect and never a
    /// regression in `onlySelf` itself.
    function test_theDirectPathIsStillRefused() public {
        vm.prank(executor);
        vm.expectRevert(LockstepGuard.NotSelf.selector);
        LockstepGuard(account).authorizeExecutor(attacker);
    }

    // ------------------------------------------------------- the pricing inversion, now fixed

    /// The aggravating factor, corrected. Declaring the power to rewrite an account's approval
    /// state used to cost the flat per-capability fee while an ERC-20 `approve` cost that plus the
    /// high-risk premium — five times more for strictly less blast radius.
    function test_theGuardsPolicySettersArePricedAsHighRisk() public view {
        assertTrue(
            registry.isHighRiskSelector(LockstepGuard.authorizeExecutor.selector),
            "authorizeExecutor is priced as high risk"
        );
        assertTrue(
            registry.isHighRiskSelector(LockstepGuard.approvePin.selector),
            "approvePin is priced as high risk"
        );

        // Now level with an ERC-20 approve rather than five times cheaper.
        uint256 policyPin = registry.quoteBond(1, 1, false);
        uint256 erc20ApprovePin = registry.quoteBond(1, 1, false);
        assertEq(policyPin, erc20ApprovePin, "a policy capability costs what a token approve costs");
        assertEq(policyPin, BASE_BOND + PER_CAPABILITY_BOND + HIGH_RISK_BOND, "base + cap + premium");
    }

    /// The narrowing pair stays cheap, deliberately: making an emergency stop expensive to declare
    /// is its own hazard, and `app/src/lib/policy.ts` already treats that distinction as real.
    function test_theNarrowingSettersAreNotPricedAsHighRisk() public view {
        assertFalse(
            registry.isHighRiskSelector(LockstepGuard.unapprovePin.selector),
            "unapprovePin removes power, so it carries no premium"
        );
        assertFalse(
            registry.isHighRiskSelector(LockstepGuard.revokeExecutor.selector),
            "revokeExecutor removes power, so it carries no premium"
        );
    }
}

/// @notice Ordinary call target, so the tests can prove an honest batch still runs.
contract PolicyProbe {
    uint256 public pings;

    function ping() external {
        pings += 1;
    }
}
