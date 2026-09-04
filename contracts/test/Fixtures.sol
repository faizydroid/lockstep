// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {HighRiskSelectors} from "../src/HighRiskSelectors.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";
import {PinRegistry} from "../src/PinRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Shared deployment for tests, matching the production parameters in
///         `script/Deploy.s.sol` so tests exercise the shape that actually ships.
abstract contract Fixtures is Test {
    /// AUSD has 6 decimals.
    uint256 internal constant ONE_AUSD = 1e6;

    uint256 internal constant BASE_BOND = 100 * ONE_AUSD;
    uint256 internal constant PER_CAPABILITY_BOND = 25 * ONE_AUSD;
    uint256 internal constant HIGH_RISK_BOND = 500 * ONE_AUSD;
    /// Flat premium for permitting native-value movement at all.
    uint256 internal constant NATIVE_VALUE_BOND = 500 * ONE_AUSD;
    uint64 internal constant UNBONDING_DELAY = 7 days;
    /// Half of a slashed bond to the challenger. Enough to fund watchers without
    /// making challenge farming more profitable than honest publishing.
    uint256 internal constant CHALLENGER_REWARD_BPS = 5_000;

    address internal slashRecipient;

    /// Version id used by tests that do not care about equivocation.
    bytes32 internal constant DEFAULT_VERSION = keccak256("test@1.0.0");

    MockERC20 internal ausd;
    PinRegistry internal registry;
    LockstepGuard internal guardImpl;

    function deployCore() internal {
        slashRecipient = makeAddr("slashRecipient");
        ausd = new MockERC20("Agora Dollar", "AUSD", 6);
        registry = new PinRegistry(
            IERC20(address(ausd)),
            BASE_BOND,
            PER_CAPABILITY_BOND,
            HIGH_RISK_BOND,
            NATIVE_VALUE_BOND,
            UNBONDING_DELAY,
            CHALLENGER_REWARD_BPS,
            slashRecipient,
            HighRiskSelectors.all()
        );
        guardImpl = new LockstepGuard(registry);
    }

    /// @dev Funds a publisher and deposits enough bond to publish freely.
    function fundPublisher(address publisher, uint256 amount) internal {
        ausd.mint(publisher, amount);
        vm.startPrank(publisher);
        require(ausd.approve(address(registry), amount), "fixture: approve failed");
        registry.deposit(amount);
        vm.stopPrank();
    }

    function singleCapability(address target, bytes4 selector)
        internal
        pure
        returns (address[] memory targets, bytes4[] memory selectors)
    {
        targets = new address[](1);
        selectors = new bytes4[](1);
        targets[0] = target;
        selectors[0] = selector;
    }
}
