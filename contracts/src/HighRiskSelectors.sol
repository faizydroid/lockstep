// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Signatures exist only so selectors can be derived by the compiler rather
///      than transcribed as hex literals. A mistyped selector here would silently
///      under-price a dangerous capability, which is exactly the failure this
///      list is meant to prevent.
interface IRiskySurface {
    // Allowance grants. The worst case: hand unlimited spending power to an
    // arbitrary address, after which the token moves without touching the skill.
    function approve(address spender, uint256 amount) external returns (bool);
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool);
    function setApprovalForAll(address operator, bool approved) external;
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    // Direct movement.
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data)
        external;

    // Delegation and upgrade surfaces. A skill able to call these can relocate
    // authority itself, which outlives any single transaction.
    function delegate(address delegatee) external;
    function upgradeTo(address newImplementation) external;
    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable;
}

/// @title HighRiskSelectors
/// @notice The canonical set of selectors priced at a premium by PinRegistry.
///
/// These are not banned. A skill may legitimately need `approve`. The point is
/// that declaring the power costs proportionally more bond, so a manifest claiming
/// sweeping authority is expensive rather than free.
library HighRiskSelectors {
    function all() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](12);
        selectors[0] = IRiskySurface.approve.selector;
        selectors[1] = IRiskySurface.increaseAllowance.selector;
        selectors[2] = IRiskySurface.setApprovalForAll.selector;
        selectors[3] = IRiskySurface.permit.selector;
        selectors[4] = IRiskySurface.transfer.selector;
        selectors[5] = IRiskySurface.transferFrom.selector;
        selectors[6] = bytes4(keccak256("safeTransferFrom(address,address,uint256)"));
        selectors[7] = bytes4(keccak256("safeTransferFrom(address,address,uint256,bytes)"));
        selectors[8] = IRiskySurface.delegate.selector;
        selectors[9] = IRiskySurface.upgradeTo.selector;
        selectors[10] = IRiskySurface.upgradeToAndCall.selector;
        // Empty calldata: a bare native-value send to an arbitrary address. Cheap
        // to declare, and the most direct drain there is.
        selectors[11] = bytes4(0);
    }
}
