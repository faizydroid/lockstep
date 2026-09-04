// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {DeployLens} from "../script/DeployLens.s.sol";

/// @notice Exposes `DeployLens`'s internal identification helpers.
///
/// A harness rather than making them public on the script: the functions under test are
/// the same ones the deploy path calls, and nothing in the script's surface changes to
/// accommodate a test.
contract DeployLensHarness is DeployLens {
    function referencesEip8004(string memory uri) external pure returns (bool) {
        return _referencesEip8004(uri);
    }

    function contains(bytes memory haystack, bytes memory needle) external pure returns (bool) {
        return _contains(haystack, needle);
    }

    function indexOf(bytes memory haystack, bytes memory needle)
        external
        pure
        returns (uint256)
    {
        return _indexOf(haystack, needle);
    }

    function base64Decode(bytes memory data) external pure returns (bytes memory) {
        return _base64Decode(data);
    }

    function base64Value(bytes1 c) external pure returns (uint256) {
        return _base64Value(c);
    }
}

/// @notice Tests the pre-deploy identification in `DeployLens`, against real data.
///
/// The script refuses to deploy unless the address it is handed identifies itself as an
/// ERC-8004 Identity Registry, and the decisive signal is `tokenURI(1)` carrying the ERC
/// reference. That check is only worth having if it fires on the live payload and rejects a
/// lookalike, so both are asserted here rather than assumed.
///
/// `LIVE_TOKEN_URI` is the literal return of `tokenURI(1)` from
/// `0x8004a818bfb912233c491871b3d84c89a494bd9e` on Monad testnet 10143, read with `cast`.
/// It is pinned, not invented.
contract DeployLensChecksTest is Test {
    DeployLensHarness internal script;

    /// Decodes to registration metadata whose `type` is
    /// `https://eips.ethereum.org/EIPS/eip-8004#registration-v1`.
    string internal constant LIVE_TOKEN_URI =
        "data:application/json;base64,eyJ0eXBlIjoiaHR0cHM6Ly9laXBzLmV0aGVyZXVtLm9yZy9FSVBTL2VpcC04MDA0I3JlZ2lzdHJhdGlvbi12MSIsIm5hbWUiOiJNb25hZCBEZW1vIEFnZW50IiwiZGVzY3JpcHRpb24iOiJEZW1vIGFnZW50IGZvciBNb25hZCB0ZXN0bmV0IC0gZGlyZWN0IGNvbnRyYWN0IGNhbGxzIiwiaW1hZ2UiOiJodHRwczovL2kuaW1ndXIuY29tL0pReE00bk8ucG5nIiwic2VydmljZXMiOlt7Im5hbWUiOiJBMkEiLCJlbmRwb2ludCI6Imh0dHBzOi8vbW9uYWQtZGVtby1hZ2VudC5leGFtcGxlLmNvbS8ud2VsbC1rbm93bi9hZ2VudC1jYXJkLmpzb24iLCJ2ZXJzaW9uIjoiMC4zLjAifSx7Im5hbWUiOiJNQ1AiLCJlbmRwb2ludCI6Imh0dHBzOi8vbW9uYWQtZGVtby1hZ2VudC5leGFtcGxlLmNvbS9tY3AiLCJ2ZXJzaW9uIjoiMjAyNS0wNi0xOCJ9XSwieDQwMlN1cHBvcnQiOmZhbHNlLCJhY3RpdmUiOnRydWUsInJlZ2lzdHJhdGlvbnMiOltdLCJzdXBwb3J0ZWRUcnVzdCI6WyJyZXB1dGF0aW9uIl19";

    function setUp() public {
        script = new DeployLensHarness();
    }

    /* ---------------------------------------------------------------- the real thing */

    /// The check fires on the payload the live registry actually serves.
    function test_acceptsTheLiveTokenUri() public view {
        assertTrue(script.referencesEip8004(LIVE_TOKEN_URI));
    }

    /// The reason the decode has to exist: the reference is invisible before it.
    ///
    /// If anyone later "simplifies" this to a plain substring scan, this test says no.
    function test_theReferenceIsNotVisibleWithoutDecoding() public view {
        assertFalse(
            script.contains(bytes(LIVE_TOKEN_URI), bytes("eip-8004")),
            "the raw data URI does not carry the needle in plaintext"
        );
        assertTrue(script.referencesEip8004(LIVE_TOKEN_URI), "and decoding finds it");
    }

    /// Decoding is byte-exact, not merely good enough to find a substring.
    ///
    /// 88 base64 characters is 22 whole groups and 66 bytes out, so this fixture exercises
    /// the aligned path with no padding at all.
    function test_base64DecodesToTheExpectedJson() public view {
        bytes memory decoded = script.base64Decode(
            bytes(
                "eyJ0eXBlIjoiaHR0cHM6Ly9laXBzLmV0aGVyZXVtLm9yZy9FSVBTL2VpcC04MDA0I3JlZ2lzdHJhdGlvbi12MSJ9"
            )
        );
        assertEq(decoded.length, 66);
        assertEq(
            decoded,
            bytes('{"type":"https://eips.ethereum.org/EIPS/eip-8004#registration-v1"}')
        );
    }

    /* -------------------------------------------------------------------- rejections */

    /// A contract serving plausible metadata without the ERC reference is refused. This is
    /// the lookalike case the check exists for: `name()` and `symbol()` are trivial to
    /// imitate, registration metadata naming the standard is not.
    function test_rejectsPlausibleMetadataWithoutTheReference() public view {
        // {"name":"Agent","description":"an agent"}
        assertFalse(
            script.referencesEip8004(
                "data:application/json;base64,eyJuYW1lIjoiQWdlbnQiLCJkZXNjcmlwdGlvbiI6ImFuIGFnZW50In0="
            )
        );
    }

    function test_rejectsAnEmptyUri() public view {
        assertFalse(script.referencesEip8004(""));
    }

    /// No base64 marker means there is nothing to decode, and that must not read as a pass.
    function test_rejectsAPlainUriWithoutTheReference() public view {
        assertFalse(script.referencesEip8004("https://example.com/agent/1.json"));
    }

    /// Not every registry has to serve a data URI. One pointing at HTTP and naming the ERC
    /// in the path is accepted without decoding anything, which is why the raw scan runs
    /// first rather than being replaced by the decode.
    function test_acceptsAPlainUriThatNamesTheErc() public view {
        assertTrue(script.referencesEip8004("https://example.com/eip-8004/agent/1.json"));
    }

    /// A truncated payload fails closed instead of reverting. A deploy script that panics
    /// on an out-of-bounds read is a bug, and one that reverts where a lenient decoder
    /// would have found the answer is a false negative.
    function test_aTruncatedPayloadIsRejectedAndDoesNotRevert() public view {
        assertFalse(script.referencesEip8004("data:application/json;base64,eyJ0eXBlIjoi"));
    }

    /// The marker present but the payload empty. Nothing to decode, no revert.
    function test_anEmptyPayloadIsRejected() public view {
        assertFalse(script.referencesEip8004("data:application/json;base64,"));
    }

    /* ------------------------------------------------------------------- the helpers */

    /// A hit at offset 0 must not be confused with "not found", which is why absence is
    /// `type(uint256).max` rather than zero.
    function test_indexOfReportsAbsenceDistinctlyFromZero() public view {
        assertEq(script.indexOf(bytes("abcdef"), bytes("abc")), 0);
        assertEq(script.indexOf(bytes("abcdef"), bytes("xyz")), type(uint256).max);
    }

    function test_indexOfRejectsAnEmptyNeedleAndAnOversizedOne() public view {
        assertEq(script.indexOf(bytes("abc"), bytes("")), type(uint256).max);
        assertEq(script.indexOf(bytes("ab"), bytes("abc")), type(uint256).max);
    }

    function test_indexOfFindsAMatchAtTheVeryEnd() public view {
        assertEq(script.indexOf(bytes("abcdef"), bytes("def")), 3);
    }

    /// Covers the whole alphabet, including the two characters most often omitted.
    function test_base64ValueCoversTheFullAlphabet() public view {
        assertEq(script.base64Value(bytes1("A")), 0);
        assertEq(script.base64Value(bytes1("Z")), 25);
        assertEq(script.base64Value(bytes1("a")), 26);
        assertEq(script.base64Value(bytes1("z")), 51);
        assertEq(script.base64Value(bytes1("0")), 52);
        assertEq(script.base64Value(bytes1("9")), 61);
        assertEq(script.base64Value(bytes1("+")), 62);
        assertEq(script.base64Value(bytes1("/")), 63);
        assertEq(script.base64Value(bytes1("=")), 0, "padding decodes as zero");
    }

    /// Any three bytes encode to four characters and must come back unchanged.
    function testFuzz_decodeInvertsEncodeForWholeGroups(bytes3 group) public view {
        bytes memory decoded = script.base64Decode(_encode(abi.encodePacked(group)));
        assertEq(decoded.length, 3);
        assertEq(decoded, abi.encodePacked(group));
    }

    /// And the reference is found wherever it sits, including across a group boundary --
    /// the case a hand-rolled encoded-needle search would get wrong.
    function testFuzz_findsTheReferenceAtAnyAlignment(uint8 padLength) public view {
        uint256 pad = padLength % 12;
        bytes memory prefix = new bytes(pad);
        for (uint256 i = 0; i < pad; ++i) {
            prefix[i] = "x";
        }

        bytes memory json = abi.encodePacked('{"a":"', prefix, 'eip-8004"}');
        // Pad to a whole group so the encoder's aligned path applies.
        while (json.length % 3 != 0) {
            json = abi.encodePacked(json, " ");
        }

        string memory uri =
            string(abi.encodePacked("data:application/json;base64,", _encode(json)));
        assertTrue(script.referencesEip8004(uri), "found regardless of byte alignment");
    }

    /* --------------------------------------------------------------------- utilities */

    bytes internal constant ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /// @dev Minimal encoder for whole 3-byte groups, used only to exercise the decoder.
    function _encode(bytes memory input) internal pure returns (bytes memory) {
        bytes memory out = new bytes((input.length / 3) * 4);
        for (uint256 i = 0; i < input.length / 3; ++i) {
            uint256 acc = (uint256(uint8(input[i * 3])) << 16)
                | (uint256(uint8(input[i * 3 + 1])) << 8) | uint256(uint8(input[i * 3 + 2]));
            out[i * 4] = ALPHABET[(acc >> 18) & 0x3f];
            out[i * 4 + 1] = ALPHABET[(acc >> 12) & 0x3f];
            out[i * 4 + 2] = ALPHABET[(acc >> 6) & 0x3f];
            out[i * 4 + 3] = ALPHABET[acc & 0x3f];
        }
        return out;
    }
}
