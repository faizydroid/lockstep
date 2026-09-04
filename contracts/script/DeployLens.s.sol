// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {IIdentityRegistry, IReputationRegistry} from "../src/interfaces/IERC8004.sol";
import {LockstepLens} from "../src/LockstepLens.sol";
import {PinRegistry} from "../src/PinRegistry.sol";

/// @notice Deploys `LockstepLens` alongside a PinRegistry that is already live.
///
/// `Deploy.s.sol` deploys the whole system from nothing and will happily deploy a second
/// registry. Once a registry is live that is the wrong tool: a second one would split the
/// pins and every published address in this repo would become ambiguous. This script
/// deploys the one contract that was left out and points it at what already exists.
///
/// Usage:
///   forge script script/DeployLens.s.sol --rpc-url $RPC_URL --broadcast
///
/// Environment:
///   PIN_REGISTRY        the live registry. Required.
///   ERC8004_IDENTITY    ERC-8004 Identity Registry. Required.
///   ERC8004_REPUTATION  ERC-8004 Reputation Registry. Required.
///
/// ## Why this script identifies the registries instead of trusting them
///
/// The ERC-8004 addresses cannot be read from documentation. Both Monad's guide and the
/// QuickNode explorer render them client-side, so a fetch returns an empty shell, and
/// copying them out of a third-party repo is how a project ends up reading reputation
/// from whatever contract someone happened to paste. Passing an address that merely has
/// code at it is not much better: `LockstepLens` holds `identity` and `reputation` as
/// `immutable`, so a wrong address is permanent for that deployment.
///
/// So the checks below run before the deploy, on chain, against the actual addresses
/// supplied. They are the same checks a human would run by hand, which is the point --
/// a check that lives in a shell history is not reproducible, and one that lives in a
/// README is not enforced.
///
/// The decisive one is `tokenURI`. Any contract can be named "AgentIdentity"; the
/// registration metadata carrying `eips.ethereum.org/EIPS/eip-8004` is the standard
/// identifying itself.
contract DeployLens is Script {
    /// @dev ERC-721. The Identity Registry is specified as one, so this must hold.
    bytes4 internal constant ERC721_INTERFACE_ID = 0x80ac58cd;

    /// @dev `keccak256("eip1967.proxy.implementation") - 1`. Read, not written: the
    ///      registries turned out to be proxies and that belongs in the deploy log.
    bytes32 internal constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    function run() external returns (LockstepLens lens) {
        address registryAddress = vm.envAddress("PIN_REGISTRY");
        address identity = vm.envAddress("ERC8004_IDENTITY");
        address reputation = vm.envAddress("ERC8004_REPUTATION");

        require(registryAddress.code.length > 0, "PIN_REGISTRY has no code on this chain");
        require(identity.code.length > 0, "ERC8004_IDENTITY has no code on this chain");
        require(reputation.code.length > 0, "ERC8004_REPUTATION has no code on this chain");

        PinRegistry registry = PinRegistry(registryAddress);
        // Cheapest proof that this is a PinRegistry and not some other contract: a
        // wrong address either reverts here or returns something absurd.
        require(address(registry.bondAsset()).code.length > 0, "PIN_REGISTRY.bondAsset is not a contract");

        _identifyIdentityRegistry(identity);
        _identifyReputationRegistry(reputation);
        _reportProxy("identity  ", identity);
        _reportProxy("reputation", reputation);

        vm.startBroadcast();
        lens = new LockstepLens(
            registry, IIdentityRegistry(identity), IReputationRegistry(reputation)
        );
        vm.stopBroadcast();

        // Read the immutables back. A deployment nobody verified is a deployment nobody
        // can rely on, and immutables are the only part that can never be corrected.
        require(address(lens.pins()) == registryAddress, "pins immutable mismatch");
        require(address(lens.identity()) == identity, "identity immutable mismatch");
        require(address(lens.reputation()) == reputation, "reputation immutable mismatch");

        console.log("chainId        ", block.chainid);
        console.log("PinRegistry    ", registryAddress);
        console.log("ERC-8004 id    ", identity);
        console.log("ERC-8004 rep   ", reputation);
        console.log("LockstepLens   ", address(lens));
        console.log("MAX_CANDIDATES ", lens.MAX_CANDIDATES());
    }

    /// @dev Three independent signals, cheapest first.
    function _identifyIdentityRegistry(address identity) internal view {
        require(
            IERC165(identity).supportsInterface(ERC721_INTERFACE_ID),
            "ERC8004_IDENTITY does not report ERC-721"
        );

        // `ownerOf` and `getAgentWallet` are separate functions in the spec and the
        // narrowed interface in IERC8004.sol reads both. If agent 1 exists, both must
        // answer, or this is a different contract than the one that interface describes.
        address owner = IERC721Metadata(identity).ownerOf(1);
        require(owner != address(0), "ERC8004_IDENTITY.ownerOf(1) is the zero address");
        require(
            IIdentityRegistry(identity).getAgentWallet(1) != address(0),
            "ERC8004_IDENTITY.getAgentWallet(1) is the zero address"
        );

        // The one that actually identifies it. Registration metadata is specified to
        // carry a `type` naming the ERC, so the spec URI appears in the token URI.
        string memory uri = IERC721Metadata(identity).tokenURI(1);
        require(
            _referencesEip8004(uri), "ERC8004_IDENTITY.tokenURI(1) does not reference eip-8004"
        );
        console.log("identity  : ERC-721, agent 1 owned by", owner);
    }

    function _identifyReputationRegistry(address reputation) internal view {
        // `getClients` is the function LockstepLens filters, so it is the one that has
        // to answer. An empty list is legitimate for a fresh registry, so this asserts
        // that the call succeeds and is decodable, not that anyone has left feedback.
        address[] memory clients = IReputationRegistry(reputation).getClients(1);

        // The signature is the real check. `getSummary` takes a mandatory
        // `clientAddresses` argument precisely because unfiltered aggregation is
        // spam-vulnerable, and that argument is the whole reason LockstepLens exists.
        // A contract with a different summary shape would revert on decode here.
        address[] memory probe = new address[](1);
        probe[0] = address(1);
        IReputationRegistry(reputation).getSummary(1, probe, "", "");

        console.log("reputation: getSummary answered, clients for agent 1 =", clients.length);
    }

    /// @dev Not a gate, a disclosure. Both registries are UUPS proxies, which means the
    ///      code behind these immutable addresses can change. That is a dependency this
    ///      project should print at deploy time rather than discover later.
    function _reportProxy(string memory label, address proxy) internal view {
        bytes32 slot = vm.load(proxy, ERC1967_IMPLEMENTATION_SLOT);
        if (slot == bytes32(0)) {
            console.log(string.concat(label, ": not an ERC-1967 proxy"));
            return;
        }
        console.log(
            string.concat(label, ": ERC-1967 proxy, implementation ="),
            address(uint160(uint256(slot)))
        );
    }

    /// @dev Looks for `eip-8004` in the token URI, decoding it first when it needs to be.
    ///
    ///      The live registry returns `data:application/json;base64,…`, so a plain
    ///      substring scan of what `tokenURI` hands back finds nothing: the reference is
    ///      inside the base64. Searching for the *encoded* form instead would be wrong,
    ///      because base64 is alignment-dependent and the same eight characters encode
    ///      three different ways depending on their offset. So this decodes.
    ///
    ///      A registry serving an `https:` or `ipfs:` URI instead is handled by the first
    ///      branch, which is why the raw scan happens before the decode rather than being
    ///      replaced by it.
    function _referencesEip8004(string memory uri) internal pure returns (bool) {
        bytes memory raw = bytes(uri);
        bytes memory needle = bytes("eip-8004");

        if (_contains(raw, needle)) return true;

        bytes memory marker = bytes(";base64,");
        uint256 at = _indexOf(raw, marker);
        if (at == type(uint256).max) return false;

        uint256 start = at + marker.length;
        bytes memory payload = new bytes(raw.length - start);
        for (uint256 i = 0; i < payload.length; ++i) {
            payload[i] = raw[start + i];
        }

        return _contains(_base64Decode(payload), needle);
    }

    function _contains(bytes memory haystack, bytes memory needle) internal pure returns (bool) {
        return _indexOf(haystack, needle) != type(uint256).max;
    }

    /// @dev Returns `type(uint256).max` when absent, so a zero offset stays meaningful.
    function _indexOf(bytes memory haystack, bytes memory needle)
        internal
        pure
        returns (uint256)
    {
        if (needle.length == 0 || haystack.length < needle.length) return type(uint256).max;

        for (uint256 i = 0; i + needle.length <= haystack.length; ++i) {
            bool hit = true;
            for (uint256 j = 0; j < needle.length; ++j) {
                if (haystack[i + j] != needle[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return i;
        }
        return type(uint256).max;
    }

    /// @dev Standard base64, four characters to three bytes.
    ///
    ///      A trailing partial group is dropped rather than reverting, and `=` decodes as
    ///      zero. Both are fine here: this feeds a substring search, not a JSON parser,
    ///      and being lenient means a padding quirk cannot block a deploy over something
    ///      that has no bearing on whether the address is correct.
    function _base64Decode(bytes memory data) internal pure returns (bytes memory) {
        uint256 quads = data.length / 4;
        bytes memory out = new bytes(quads * 3);

        for (uint256 i = 0; i < quads; ++i) {
            uint256 acc = 0;
            for (uint256 j = 0; j < 4; ++j) {
                acc = (acc << 6) | _base64Value(data[i * 4 + j]);
            }
            out[i * 3] = bytes1(uint8(acc >> 16));
            out[i * 3 + 1] = bytes1(uint8((acc >> 8) & 0xff));
            out[i * 3 + 2] = bytes1(uint8(acc & 0xff));
        }
        return out;
    }

    function _base64Value(bytes1 c) internal pure returns (uint256) {
        uint8 v = uint8(c);
        if (v >= 0x41 && v <= 0x5a) return v - 0x41; // A-Z
        if (v >= 0x61 && v <= 0x7a) return uint256(v) - 0x61 + 26; // a-z
        if (v >= 0x30 && v <= 0x39) return uint256(v) - 0x30 + 52; // 0-9
        if (v == 0x2b) return 62; // +
        if (v == 0x2f) return 63; // /
        return 0; // '=' padding, and anything unexpected
    }
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC721Metadata {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}
