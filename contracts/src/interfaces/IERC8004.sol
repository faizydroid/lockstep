// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice ERC-8004 Identity Registry, narrowed to what Lockstep reads.
/// @dev Full spec: https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md
interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function getAgentWallet(uint256 agentId) external view returns (address);
    function getMetadata(uint256 agentId, string calldata metadataKey)
        external
        view
        returns (bytes memory);
}

/// @notice ERC-8004 Reputation Registry, narrowed to what Lockstep reads.
///
/// Note the shape of `getSummary`: `clientAddresses` is **mandatory and must be
/// non-empty**. The spec states plainly that results without filtering by client
/// are subject to Sybil and spam attacks, and its Security Considerations expect an
/// ecosystem of systems that score the reviewers themselves.
///
/// So the standard demands a curated client set as an input and deliberately does
/// not supply one. `LockstepLens` supplies it.
interface IReputationRegistry {
    function getSummary(
        uint256 agentId,
        address[] calldata clientAddresses,
        string calldata tag1,
        string calldata tag2
    ) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals);

    function getClients(uint256 agentId) external view returns (address[] memory);

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (
            int128 value,
            uint8 valueDecimals,
            string memory tag1,
            string memory tag2,
            bool isRevoked
        );

    function getLastIndex(uint256 agentId, address clientAddress)
        external
        view
        returns (uint64);
}
