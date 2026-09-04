// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";

/*
 * Lockstep against MetaMask's Delegation Toolkit, not against a straw man.
 *
 * AllowlistComparison.t.sol makes this argument against a generic spend-limit wallet that
 * this repo wrote. That is a fair rendering of the category, and it is still a control we
 * invented for the purpose of comparing against it.
 *
 * This file makes the same argument against the permission model MetaMask actually ships.
 * The gator CLI grants an agent a delegation with a `functionCall` scope, and the flags
 * that scope takes are documented as:
 *
 *     gator grant --to <agent> --scope functionCall \
 *       --targets <addresses> --selectors <signatures> --valueLte <ether>
 *
 * Targets, selectors, and a per-call native value ceiling. A Lockstep pin declares exactly
 * the same three things. That is not a coincidence and it is worth stating plainly: the two
 * systems agree completely about what an agent may call. They differ on one axis only, and
 * this file is about that axis.
 *
 * WHAT IS MODELLED
 *
 * The caveat enforcement semantics. An ERC-7710-shaped delegation carrying three caveats,
 * each with its own enforcer contract, checked before the delegated execution is performed
 * by the delegator account. Enforcer terms are encoded the way the toolkit encodes them --
 * packed addresses, packed selectors, a single uint256 -- so the checks operate on the same
 * data.
 *
 * WHAT IS NOT
 *
 * The full ERC-7710 wire format. No signature recovery, no delegation hashing, no authority
 * chains for redelegation, no ERC-7579 execution modes. Those govern *who* may redeem a
 * delegation and are orthogonal to the question here, which is what a redemption is
 * permitted to do once the redeemer is established. Claiming a complete implementation
 * would be false; a faithful model of the part under test is what the argument needs.
 *
 * Gator's own documentation is worth quoting on key handling, because it corroborates a
 * claim made in this project's monetisation section rather than being a dig: private keys
 * are stored in plaintext JSON, and the docs say not to use accounts with significant
 * funds.
 */

/// @notice Caveat enforcer for the `--targets` flag.
contract AllowedTargetsEnforcer {
    error TargetNotAllowed(address target);

    /// @param terms Tightly packed 20-byte addresses, as the toolkit encodes them.
    function beforeHook(bytes calldata terms, address target, uint256, bytes calldata)
        external
        pure
    {
        uint256 count = terms.length / 20;
        for (uint256 i = 0; i < count; ++i) {
            if (address(bytes20(terms[i * 20:(i + 1) * 20])) == target) return;
        }
        revert TargetNotAllowed(target);
    }
}

contract AllowedMethodsEnforcer {
    error MethodNotAllowed(bytes4 selector);

    /// @param terms Tightly packed 4-byte selectors.
    ///
    /// @dev Gator's CLI takes human-readable signatures (`"approve(address,uint256)"`)
    ///      and derives the selector itself, explicitly refusing a raw 4-byte value.
    ///      That is a CLI ergonomic; on chain the enforcer compares selectors, which is
    ///      what this does.
    function beforeHook(bytes calldata terms, address, uint256, bytes calldata callData)
        external
        pure
    {
        bytes4 selector = callData.length >= 4 ? bytes4(callData[:4]) : bytes4(0);
        uint256 count = terms.length / 4;
        for (uint256 i = 0; i < count; ++i) {
            if (bytes4(terms[i * 4:(i + 1) * 4]) == selector) return;
        }
        revert MethodNotAllowed(selector);
    }
}

contract ValueLteEnforcer {
    error ValueTooHigh(uint256 value, uint256 limit);

    /// @param terms A single abi-encoded uint256, the `--valueLte` figure in wei.
    function beforeHook(bytes calldata terms, address, uint256 value, bytes calldata)
        external
        pure
    {
        uint256 limit = abi.decode(terms, (uint256));
        if (value > limit) revert ValueTooHigh(value, limit);
    }
}

/// @notice A delegation, in the shape the toolkit uses.
struct Caveat {
    address enforcer;
    bytes terms;
}

struct Delegation {
    address delegate;
    address delegator;
    Caveat[] caveats;
}

/// @notice The delegator account. Under Gator this is an EOA upgraded by `gator create`.
///
/// It holds the funds and performs the execution, which is the arrangement that makes a
/// delegation useful: the agent never holds the money.
contract GatorSmartAccount {
    address public immutable manager;

    error OnlyManager();
    error CallFailed();

    constructor(address manager_) {
        manager = manager_;
    }

    function execute(address target, uint256 value, bytes calldata callData)
        external
        returns (bytes memory)
    {
        if (msg.sender != manager) revert OnlyManager();
        (bool ok, bytes memory ret) = target.call{value: value}(callData);
        if (!ok) revert CallFailed();
        return ret;
    }

    receive() external payable {}
}

/// @notice Runs every caveat, then lets the delegator perform the call.
contract DelegationManager {
    error NotTheDelegate(address caller);
    error EnforcerRejected(address enforcer);

    /// @dev Deliberately has nowhere to put a skill hash.
    ///
    ///      This is the observation the whole file exists to make, and it is a property
    ///      of the interface rather than of the implementation. `redeemDelegation` takes
    ///      the delegation, the target, the value and the calldata. There is no
    ///      parameter for which code constructed that calldata, and no caveat enforcer
    ///      could read one if there were, because nothing on chain carries it.
    function redeemDelegation(
        Delegation calldata delegation,
        address target,
        uint256 value,
        bytes calldata callData
    ) external returns (bytes memory) {
        if (msg.sender != delegation.delegate) revert NotTheDelegate(msg.sender);

        for (uint256 i = 0; i < delegation.caveats.length; ++i) {
            Caveat calldata caveat = delegation.caveats[i];
            (bool ok,) = caveat.enforcer.staticcall(
                abi.encodeWithSignature(
                    "beforeHook(bytes,address,uint256,bytes)", caveat.terms, target, value, callData
                )
            );
            if (!ok) revert EnforcerRejected(caveat.enforcer);
        }

        return GatorSmartAccount(payable(delegation.delegator)).execute(target, value, callData);
    }
}

/// @notice A router whose behaviour turns on an argument no allowlist inspects.
contract SwapRouter {
    uint256 public swaps;
    address public lastRecipient;

    function swapTo(address recipient, uint256 amountIn) external returns (uint256) {
        swaps += 1;
        lastRecipient = recipient;
        return amountIn * 2;
    }
}

contract GatorComparisonTest is Fixtures {
    DelegationManager internal manager;
    GatorSmartAccount internal gatorAccount;
    AllowedTargetsEnforcer internal targetsEnforcer;
    AllowedMethodsEnforcer internal methodsEnforcer;
    ValueLteEnforcer internal valueEnforcer;

    SwapRouter internal router;

    address internal publisher;
    address internal agent;
    address internal attacker;
    address internal user;

    uint256 internal constant ACCOUNT_PK = 0xA11CE;
    address payable internal account;

    bytes4 internal constant SWAP_TO = SwapRouter.swapTo.selector;

    /// The version the owner reviewed and approved.
    bytes32 internal constant HONEST = keccak256("kuru-quote honest bytes");
    /// The same version string, silently republished with different bytes.
    bytes32 internal constant HOSTILE = keccak256("kuru-quote hostile bytes");

    bytes32 internal honestPin;
    Delegation internal grant;

    function setUp() public {
        publisher = makeAddr("publisher");
        agent = makeAddr("agent");
        attacker = makeAddr("attacker");
        user = makeAddr("user");

        deployCore();
        router = new SwapRouter();

        // --- the Gator side: grant the agent a functionCall scope ---
        manager = new DelegationManager();
        gatorAccount = new GatorSmartAccount(address(manager));
        targetsEnforcer = new AllowedTargetsEnforcer();
        methodsEnforcer = new AllowedMethodsEnforcer();
        valueEnforcer = new ValueLteEnforcer();

        // Equivalent to:
        //   gator grant --to <agent> --scope functionCall \
        //     --targets <router> --selectors "swapTo(address,uint256)" --valueLte 0
        grant.delegate = agent;
        grant.delegator = address(gatorAccount);
        grant.caveats.push(
            Caveat({enforcer: address(targetsEnforcer), terms: abi.encodePacked(address(router))})
        );
        grant.caveats.push(
            Caveat({enforcer: address(methodsEnforcer), terms: abi.encodePacked(SWAP_TO)})
        );
        grant.caveats.push(
            Caveat({enforcer: address(valueEnforcer), terms: abi.encode(uint256(0))})
        );

        // --- the Lockstep side: approve the honest version only ---
        fundPublisher(publisher, 100_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(router), SWAP_TO);
        vm.prank(publisher);
        honestPin = registry.publish(HONEST, keccak256("kuru-quote@1.0.0"), 0, targets, selectors);

        account = payable(vm.addr(ACCOUNT_PK));
        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);
        vm.startPrank(account);
        LockstepGuard(account).approvePin(honestPin);
        LockstepGuard(account).authorizeExecutor(agent);
        vm.stopPrank();
    }

    /// Allowlisted target, allowlisted selector, zero value, attacker recipient.
    ///
    /// Every caveat in the grant is satisfied. The recipient lives in the calldata
    /// arguments, and no enforcer in a `functionCall` scope reads arguments.
    function _hostileCall() internal view returns (bytes memory) {
        return abi.encodeCall(SwapRouter.swapTo, (attacker, 1_000));
    }

    /* ------------------------------------------------------------------ the gap */

    /// The delegation permits the poisoned call, and is correct to by its own rules.
    function test_gatorDelegationPermitsThePoisonedCall() public {
        vm.prank(agent);
        manager.redeemDelegation(grant, address(router), 0, _hostileCall());

        assertEq(router.swaps(), 1, "the redemption went through");
        assertEq(router.lastRecipient(), attacker, "funds routed to the attacker");
    }

    /// Lockstep refuses the identical bytes, because the code that produced them is not
    /// the version the owner approved.
    function test_lockstepRefusesTheIdenticalCalldata() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({target: address(router), value: 0, data: _hostileCall()});

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.SkillHashMismatch.selector, HOSTILE, HONEST)
        );
        LockstepGuard(account).execute(honestPin, HOSTILE, calls);

        assertEq(router.swaps(), 0, "nothing executed");
    }

    /// Both layers, one test, identical calldata. The difference is an assertion pair
    /// rather than an argument.
    function test_sameCalldataOneRedeemsTheOtherRefuses() public {
        bytes memory hostile = _hostileCall();

        vm.prank(agent);
        manager.redeemDelegation(grant, address(router), 0, hostile);
        uint256 afterGator = router.swaps();

        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({target: address(router), value: 0, data: hostile});
        vm.prank(agent);
        (bool ok,) =
            account.call(abi.encodeCall(LockstepGuard.execute, (honestPin, HOSTILE, calls)));

        assertEq(afterGator, 1, "the delegation redeemed the poisoned call");
        assertFalse(ok, "Lockstep refused the identical calldata");
        assertEq(router.swaps(), 1, "no second execution occurred");
    }

    /* --------------------------------------------- the layers are complementary */

    /// Each of Gator's three caveats still does its job. Lockstep does not replace them.
    function test_gatorCaveatsRejectWhatTheyAreFor() public {
        // Wrong target.
        SwapRouter other = new SwapRouter();
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                DelegationManager.EnforcerRejected.selector, address(targetsEnforcer)
            )
        );
        manager.redeemDelegation(grant, address(other), 0, _hostileCall());

        // Wrong selector.
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                DelegationManager.EnforcerRejected.selector, address(methodsEnforcer)
            )
        );
        manager.redeemDelegation(grant, address(router), 0, abi.encodeWithSignature("drain()"));

        // Over the value ceiling.
        vm.deal(address(gatorAccount), 10 ether);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                DelegationManager.EnforcerRejected.selector, address(valueEnforcer)
            )
        );
        manager.redeemDelegation(grant, address(router), 1 ether, _hostileCall());
    }

    /// Lockstep enforces the same three things as well, so adopting it loses nothing.
    function test_lockstepEnforcesTheSameThreeConstraints() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);

        // Undeclared target.
        SwapRouter other = new SwapRouter();
        calls[0] = LockstepGuard.Call({target: address(other), value: 0, data: _hostileCall()});
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                LockstepGuard.CapabilityNotDeclared.selector, address(other), SWAP_TO
            )
        );
        LockstepGuard(account).execute(honestPin, HONEST, calls);

        // Undeclared selector.
        calls[0] = LockstepGuard.Call({
            target: address(router),
            value: 0,
            data: abi.encodeWithSignature("drain()")
        });
        vm.prank(agent);
        vm.expectRevert();
        LockstepGuard(account).execute(honestPin, HONEST, calls);

        // Over the ceiling.
        vm.deal(account, 10 ether);
        calls[0] =
            LockstepGuard.Call({target: address(router), value: 1 ether, data: _hostileCall()});
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.ValueExceedsCeiling.selector, 1 ether, 0)
        );
        LockstepGuard(account).execute(honestPin, HONEST, calls);
    }

    /// And the approved version is not obstructed. A control that blocks legitimate use
    /// gets switched off, so this matters as much as the refusal.
    function test_theApprovedVersionStillExecutes() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({
            target: address(router),
            value: 0,
            data: abi.encodeCall(SwapRouter.swapTo, (user, 1_000))
        });

        vm.prank(agent);
        LockstepGuard(account).execute(honestPin, HONEST, calls);

        assertEq(router.swaps(), 1);
        assertEq(router.lastRecipient(), user);
    }

    /* ----------------------------------------------------- the interface itself */

    /// The gap is in the signature, not the enforcement.
    ///
    /// `redeemDelegation(delegation, target, value, callData)` has no parameter for the
    /// code that built `callData`, so no caveat enforcer can consider it however
    /// sophisticated the caveat becomes. `LockstepGuard.execute(pinId, skillHash, calls)`
    /// takes one, which is the entire difference between the two systems.
    ///
    /// Asserted by selector so it fails if either signature changes.
    function test_theDifferenceIsAParameter() public pure {
        assertEq(
            DelegationManager.redeemDelegation.selector,
            bytes4(keccak256("redeemDelegation((address,address,(address,bytes)[]),address,uint256,bytes)")),
            "delegation redemption carries no provenance"
        );
        assertEq(
            LockstepGuard.execute.selector,
            bytes4(keccak256("execute(bytes32,bytes32,(address,uint256,bytes)[])")),
            "guard execution carries an attested skill hash"
        );
    }
}

/// @notice Stand-in for whatever implementation `gator create` upgrades an EOA to.
///
/// Only needs to be distinguishable from LockstepGuard and to have state of its own, so the
/// test can show what happens to that state when the delegation moves.
contract RivalDelegate {
    /// @dev Sequential slot on purpose, to contrast with the guard's ERC-7201 namespace.
    ///      A second delegate using slot 0 is exactly the collision namespacing prevents.
    uint256 public pings;

    function ping() external returns (uint256) {
        pings += 1;
        return pings;
    }
}

/*
 * EIP-7702 delegation is exclusive, and that has a consequence nobody mentions.
 *
 * `gator create` upgrades an EOA to a MetaMask smart account. Lockstep delegates an EOA to
 * LockstepGuard. Both use the same mechanism, and an EOA carries exactly one delegation
 * indicator -- `0xef0100 || implementation`, twenty-three bytes with room for one address.
 *
 * So the two cannot both be installed on one account. This is not a bug in either project;
 * it is what the standard says. It does mean "use Gator and Lockstep together" needs to
 * describe an arrangement rather than being asserted, and the arrangement is not the obvious
 * one.
 *
 * These tests establish the constraint by measurement, then show the composition that works.
 */
contract Eip7702ExclusivityTest is Fixtures {
    RivalDelegate internal rival;

    uint256 internal constant ACCOUNT_PK = 0xBEEF;
    address payable internal account;

    function setUp() public {
        deployCore();
        rival = new RivalDelegate();
        account = payable(vm.addr(ACCOUNT_PK));
    }

    /// @dev The indicator an account carries when delegated to `implementation`.
    function _indicator(address implementation) internal pure returns (bytes memory) {
        return abi.encodePacked(hex"ef0100", implementation);
    }

    function test_anAccountCarriesExactlyOneDelegation() public {
        // Delegate to the guard first, as Lockstep would.
        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);
        assertEq(account.code, _indicator(address(guardImpl)), "delegated to the guard");

        // Now delegate the same account elsewhere, as `gator create` would.
        vm.signAndAttachDelegation(address(rival), ACCOUNT_PK);
        assertEq(account.code, _indicator(address(rival)), "delegation moved, it did not stack");

        // The code is 23 bytes either way. There is no room for two.
        assertEq(account.code.length, 23, "one indicator, one implementation address");
    }

    function test_movingTheDelegationTakesTheGuardWithIt() public {
        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);

        bytes32 pinId = keccak256("some pin");
        vm.prank(account);
        LockstepGuard(account).approvePin(pinId);
        assertTrue(LockstepGuard(account).isPinApproved(pinId), "approval recorded");

        // Upgrade to the other implementation, as a user following Gator's quickstart would.
        vm.signAndAttachDelegation(address(rival), ACCOUNT_PK);

        // The guard's entry points are simply gone. Nothing is enforcing anything now.
        vm.expectRevert();
        LockstepGuard(account).isPinApproved(pinId);

        // And the replacement works, so this is a silent handover rather than a broken account.
        vm.prank(account);
        assertEq(RivalDelegate(account).ping(), 1, "the new delegate is live");
    }

    /// The approval survives in storage, which is the part that makes this dangerous.
    ///
    /// Delegation changes the code, not the storage. The account's ERC-7201 slot still holds
    /// the approval, so re-delegating back to the guard restores it — and in the meantime the
    /// account looked, to anything reading storage directly, exactly as it did before.
    function test_theApprovalSurvivesInStorageWhileUnenforced() public {
        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);
        bytes32 pinId = keccak256("some pin");
        vm.prank(account);
        LockstepGuard(account).approvePin(pinId);

        vm.signAndAttachDelegation(address(rival), ACCOUNT_PK);
        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);

        assertTrue(
            LockstepGuard(account).isPinApproved(pinId),
            "storage was untouched by the round trip"
        );
    }

    /// A second delegate writing slot 0 is why the guard namespaces its storage.
    ///
    /// `RivalDelegate.pings` is at slot 0. If the guard kept its approvals mapping at a
    /// sequential slot, a rival delegate incrementing a counter could flip an approval to
    /// true. ERC-7201 puts the guard's state at a hash-derived slot instead, so the two
    /// cannot alias.
    function test_namespacedStorageSurvivesARivalDelegateWritingSlotZero() public {
        vm.signAndAttachDelegation(address(rival), ACCOUNT_PK);
        vm.prank(account);
        RivalDelegate(account).ping();
        assertEq(uint256(vm.load(account, bytes32(0))), 1, "the rival wrote slot 0");

        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);

        // Slot 0 is dirty, and the guard does not care.
        bytes32 slot = guardImpl.guardStorageSlot();
        assertTrue(slot != bytes32(0), "the guard does not live at slot 0");
        assertFalse(
            LockstepGuard(account).isPinApproved(bytes32(0)),
            "a dirty slot 0 did not become an approval"
        );
    }

    /// The composition that does work, stated as a test so it is not just prose.
    ///
    /// The two systems cannot share an account, but they can share a *flow*: the Gator
    /// delegation names a delegate, and that delegate can be an address whose own spending is
    /// gated by Lockstep. The account holding funds carries one delegation indicator; the
    /// executor is a different address entirely, which is already how Lockstep is designed --
    /// the executor holds no funds and pays its own gas.
    ///
    /// So an operator picks per account, and the two layers stack across accounts rather than
    /// on one. That is a real answer to "can I use both", and it is not the answer the
    /// question expects.
    function test_theExecutorIsADifferentAddressSoTheLayersStackAcrossAccounts() public {
        address executor = makeAddr("agentExecutor");

        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);
        vm.prank(account);
        LockstepGuard(account).authorizeExecutor(executor);

        assertTrue(LockstepGuard(account).isExecutorAuthorized(executor), "executor authorised");
        assertTrue(executor != account, "the executor is not the funded account");
        assertEq(executor.code.length, 0, "and it carries no delegation of its own");
    }
}
