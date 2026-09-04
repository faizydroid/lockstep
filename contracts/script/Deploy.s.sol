// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {HighRiskSelectors} from "../src/HighRiskSelectors.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IIdentityRegistry, IReputationRegistry} from "../src/interfaces/IERC8004.sol";
import {LockstepGuard} from "../src/LockstepGuard.sol";
import {LockstepLens} from "../src/LockstepLens.sol";
import {PinRegistry} from "../src/PinRegistry.sol";

/// @notice Deploys PinRegistry and LockstepGuard.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
///
/// Environment:
///   BOND_ASSET       bond token. Required on mainnet; omit on a test chain to
///                    deploy a throwaway mock.
///   SLASH_RECIPIENT  receives the non-challenger share of slashed bonds.
///                    Defaults to the broadcaster.
///   ERC8004_IDENTITY / ERC8004_REPUTATION
///                    ERC-8004 registries. Both sit at CREATE2-deterministic
///                    addresses that are byte-identical across mainnets, but this
///                    script will not hardcode them: verify on the explorer for the
///                    chain you are deploying to and pass them in. Omit both to skip
///                    deploying LockstepLens.
///
/// Bond parameters are denominated in the bond asset's smallest unit and assume
/// 6 decimals, matching AUSD. Changing the bond asset to an 18-decimal token
/// requires rescaling these or every pin becomes effectively free.
contract Deploy is Script {
    uint256 internal constant ONE = 1e6;

    uint256 public constant BASE_BOND = 100 * ONE;
    uint256 public constant PER_CAPABILITY_BOND = 25 * ONE;
    uint256 public constant HIGH_RISK_BOND = 500 * ONE;
    uint256 public constant NATIVE_VALUE_BOND = 500 * ONE;
    uint64 public constant UNBONDING_DELAY = 7 days;
    /// Half of a slashed bond funds the challenger. Enough to pay for watching
    /// without making challenge farming more attractive than honest publishing.
    uint256 public constant CHALLENGER_REWARD_BPS = 5_000;

    function run()
        external
        returns (PinRegistry registry, LockstepGuard guard, LockstepLens lens)
    {
        address bondAsset = vm.envOr("BOND_ASSET", address(0));
        address slashRecipient = vm.envOr("SLASH_RECIPIENT", msg.sender);
        address identity = vm.envOr("ERC8004_IDENTITY", address(0));
        address reputation = vm.envOr("ERC8004_REPUTATION", address(0));

        vm.startBroadcast();

        if (bondAsset == address(0)) {
            // Deliberately loud. A silent mock on a real network would leave a
            // registry whose bonds are worthless.
            require(block.chainid != 143, "BOND_ASSET is required on Monad mainnet");
            console.log("BOND_ASSET unset: deploying a mock bond asset (test chains only)");
            bondAsset = address(new MockBondAsset());
        }

        registry = new PinRegistry(
            IERC20(bondAsset),
            BASE_BOND,
            PER_CAPABILITY_BOND,
            HIGH_RISK_BOND,
            NATIVE_VALUE_BOND,
            UNBONDING_DELAY,
            CHALLENGER_REWARD_BPS,
            slashRecipient,
            HighRiskSelectors.all()
        );
        guard = new LockstepGuard(registry);

        if (identity != address(0) && reputation != address(0)) {
            lens = new LockstepLens(
                registry, IIdentityRegistry(identity), IReputationRegistry(reputation)
            );
        } else {
            console.log("ERC-8004 registries not supplied: skipping LockstepLens");
        }

        vm.stopBroadcast();

        console.log("chainId        ", block.chainid);
        console.log("bondAsset      ", bondAsset);
        console.log("slashRecipient ", slashRecipient);
        console.log("PinRegistry    ", address(registry));
        console.log("LockstepGuard  ", address(guard));
        console.log("LockstepLens   ", address(lens));
        console.log("guardStorageSlot");
        console.logBytes32(guard.guardStorageSlot());
    }
}

/// @notice Freely mintable stand-in for AUSD on local and test chains.
contract MockBondAsset {
    string public constant name = "Mock Bond Asset";
    string public constant symbol = "mAUSD";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
