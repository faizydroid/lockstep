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

    /// Label used by tests that do not care about equivocation.
    ///
    /// @dev This replaced a `bytes32 DEFAULT_VERSION` constant when `publish` stopped accepting a
    ///      version id and started deriving one. The suite can no longer hold an opinion about what
    ///      a version id is; it can only state a name and a version and let the registry hash them.
    string internal constant DEFAULT_NAME = "test";
    string internal constant DEFAULT_SEMVER = "1.0.0";

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

    // --- publish arguments ---
    //
    // `publish` takes a struct rather than six positional parameters, so building one inline at
    // every call site would bury what each test is about under six lines of field assignment. These
    // two helpers name the shapes the suite needs, and nothing else.

    /// @dev The version id the registry derives for the default label. Asked of the registry rather
    ///      than recomputed here, so a test cannot assert against a stale copy of the derivation.
    function defaultVersionId() internal view returns (bytes32) {
        return registry.computeVersionId(DEFAULT_NAME, DEFAULT_SEMVER);
    }

    function publishParams(
        string memory name,
        string memory version,
        bytes32 skillHash,
        uint256 maxValuePerBatch,
        address[] memory targets,
        bytes4[] memory selectors
    ) internal pure returns (PinRegistry.PublishParams memory) {
        return PinRegistry.PublishParams({
            name: name,
            version: version,
            skillHash: skillHash,
            maxValuePerBatch: maxValuePerBatch,
            targets: targets,
            selectors: selectors
        });
    }

    /// @dev For tests where the label carries no meaning and only the pin's existence matters.
    function defaultParams(
        bytes32 skillHash,
        uint256 maxValuePerBatch,
        address[] memory targets,
        bytes4[] memory selectors
    ) internal pure returns (PinRegistry.PublishParams memory) {
        return publishParams(
            DEFAULT_NAME, DEFAULT_SEMVER, skillHash, maxValuePerBatch, targets, selectors
        );
    }
}
