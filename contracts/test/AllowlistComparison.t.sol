// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixtures} from "./Fixtures.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";

/// @notice Stand-in for the ex-ante policy layer that already exists.
///
/// Models what a spend-limit wallet enforces: a target allowlist, a selector
/// allowlist, and a per-call value ceiling. This is not a straw man — it is a fair
/// rendering of a genuinely useful control, and one that is already shipped and widely
/// used.
///
/// The point of this file is that such a wallet is blind to *which code asked*. It
/// sees a call to an allowlisted router with an allowlisted selector and correctly
/// permits it, because by its own rules the call is fine. The rules are just not
/// sufficient.
contract AllowlistWallet {
    mapping(address => mapping(bytes4 => bool)) public allowed;
    uint256 public maxValuePerCall;
    address public immutable owner;

    error NotAllowed(address target, bytes4 selector);
    error OverCeiling(uint256 value, uint256 ceiling);
    error NotOwner();

    constructor(uint256 maxValuePerCall_) {
        owner = msg.sender;
        maxValuePerCall = maxValuePerCall_;
    }

    function allow(address target, bytes4 selector) external {
        if (msg.sender != owner) revert NotOwner();
        allowed[target][selector] = true;
    }

    /// @dev Deliberately takes no provenance argument. There is nowhere to put it,
    ///      which is the entire observation.
    function execute(address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory)
    {
        bytes4 selector = data.length >= 4 ? bytes4(data[:4]) : bytes4(0);
        if (!allowed[target][selector]) revert NotAllowed(target, selector);
        if (value > maxValuePerCall) revert OverCeiling(value, maxValuePerCall);

        (bool ok, bytes memory ret) = target.call{value: value}(data);
        require(ok, "call failed");
        return ret;
    }

    receive() external payable {}
}

/// @notice A router whose behaviour depends on a parameter the wallet cannot judge.
contract SwapRouter {
    uint256 public swaps;
    address public lastRecipient;

    /// The recipient is inside the calldata. An allowlist checks the selector, not
    /// the argument, so a hostile recipient passes cleanly.
    function swapTo(address recipient, uint256 amountIn) external returns (uint256) {
        swaps += 1;
        lastRecipient = recipient;
        return amountIn * 2;
    }
}

/// @notice The comparison the plan calls a non-negotiable for the demo.
contract AllowlistComparisonTest is Fixtures {
    AllowlistWallet internal wallet;
    SwapRouter internal router;

    address internal publisher;
    address internal executor;
    address internal attacker;
    address internal user;

    uint256 internal constant ACCOUNT_PK = 0xA11CE;
    address payable internal account;

    bytes4 internal constant SWAP_TO = SwapRouter.swapTo.selector;

    /// The version the user reviewed and approved.
    bytes32 internal constant HONEST = keccak256("kuru-quote honest bytes");
    /// The same version string, silently republished with different bytes.
    bytes32 internal constant HOSTILE = keccak256("kuru-quote hostile bytes");

    bytes32 internal honestPin;

    function setUp() public {
        publisher = makeAddr("publisher");
        executor = makeAddr("agentExecutor");
        attacker = makeAddr("attacker");
        user = makeAddr("user");

        deployCore();
        router = new SwapRouter();

        // --- the allowlist wallet, configured exactly as a careful user would ---
        wallet = new AllowlistWallet(0);
        wallet.allow(address(router), SWAP_TO);

        // --- the Lockstep account, approving the honest version only ---
        fundPublisher(publisher, 100_000 * ONE_AUSD);
        (address[] memory targets, bytes4[] memory selectors) =
            singleCapability(address(router), SWAP_TO);
        vm.prank(publisher);
        honestPin =
            registry.publish(publishParams("kuru-quote", "1.0.0", HONEST, 0, targets, selectors));

        account = payable(vm.addr(ACCOUNT_PK));
        vm.signAndAttachDelegation(address(guardImpl), ACCOUNT_PK);
        vm.startPrank(account);
        LockstepGuard(account).approvePin(honestPin);
        LockstepGuard(account).authorizeExecutor(executor);
        vm.stopPrank();
    }

    function _hostileCall() internal view returns (bytes memory) {
        // Allowlisted target. Allowlisted selector. Zero value. Attacker recipient.
        return abi.encodeCall(SwapRouter.swapTo, (attacker, 1_000));
    }

    /// The allowlist wallet permits the hostile call, and is right to by its own
    /// rules. Target and selector are approved and no value moves.
    function test_allowlistWalletPermitsTheHostileCall() public {
        wallet.execute(address(router), 0, _hostileCall());

        assertEq(router.swaps(), 1);
        assertEq(router.lastRecipient(), attacker, "funds routed to the attacker");
    }

    /// Lockstep refuses the identical call, because the code that produced it is not
    /// the version the user approved.
    function test_lockstepRefusesTheSameCall() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({target: address(router), value: 0, data: _hostileCall()});

        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.SkillHashMismatch.selector, HOSTILE, HONEST)
        );
        LockstepGuard(account).execute(honestPin, HOSTILE, calls);

        assertEq(router.swaps(), 0, "nothing executed");
    }

    /// Side by side, in one test, so the difference is a single assertion pair rather
    /// than an argument.
    function test_sameCalldataOneLayerAllowsItTheOtherDoesNot() public {
        bytes memory hostile = _hostileCall();

        // Layer 1: spend policy. Permits.
        wallet.execute(address(router), 0, hostile);
        uint256 afterAllowlist = router.swaps();

        // Layer 2: provenance. Refuses.
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({target: address(router), value: 0, data: hostile});
        vm.prank(executor);
        (bool ok,) = account.call(
            abi.encodeCall(LockstepGuard.execute, (honestPin, HOSTILE, calls))
        );

        assertEq(afterAllowlist, 1, "allowlist layer permitted the hostile call");
        assertFalse(ok, "provenance layer refused the identical call");
        assertEq(router.swaps(), 1, "no second execution occurred");
    }

    /// The layers are complementary, not competing. Lockstep does not subsume spend
    /// limits: it still enforces the value ceiling, and the honest version still runs.
    function test_lockstepStillEnforcesTheSpendCeiling() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] =
            LockstepGuard.Call({target: address(router), value: 1 ether, data: _hostileCall()});

        vm.deal(account, 10 ether);
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(LockstepGuard.BatchValueExceedsCeiling.selector, 1 ether, 0)
        );
        LockstepGuard(account).execute(honestPin, HONEST, calls);
    }

    /// And the honest version is not obstructed. A control that blocks legitimate use
    /// gets switched off.
    function test_theApprovedVersionStillWorks() public {
        LockstepGuard.Call[] memory calls = new LockstepGuard.Call[](1);
        calls[0] = LockstepGuard.Call({
            target: address(router),
            value: 0,
            data: abi.encodeCall(SwapRouter.swapTo, (user, 1_000))
        });

        vm.prank(executor);
        LockstepGuard(account).execute(honestPin, HONEST, calls);

        assertEq(router.swaps(), 1);
        assertEq(router.lastRecipient(), user);
    }
}
