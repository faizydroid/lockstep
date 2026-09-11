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

    // Authority granting, of the shape LockstepGuard's own policy setters have.
    //
    // These were missing, and the omission priced this system's most dangerous capability at its
    // cheapest rate: declaring the power to rewrite an account's entire approval state cost the
    // flat per-capability fee, while declaring an ERC-20 `approve` cost that plus the high-risk
    // premium — five times more for strictly less blast radius. `LockstepGuard.execute` now refuses
    // the account as a call target, so the guard's own setters are unreachable through a batch; this
    // prices the shape anyway, because `isHighRiskSelector` is keyed on the selector alone and any
    // target exposing a function like these is granting authority that outlives the transaction.
    //
    // Only the widening pair. `unapprovePin` and `revokeExecutor` share this shape and remove power
    // rather than granting it, and `app/src/lib/policy.ts` already treats that distinction as
    // load-bearing: making an emergency stop expensive to declare is its own hazard.
    function approvePin(bytes32 pinId) external;
    function authorizeExecutor(address executor) external;
}

/// @title HighRiskSelectors
/// @notice The canonical set of selectors priced at a premium by PinRegistry.
///
/// These are not banned. A skill may legitimately need `approve`. The point is
/// that declaring the power costs proportionally more bond, so a manifest claiming
/// sweeping authority is expensive rather than free.
library HighRiskSelectors {
    function all() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](14);
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
        // Policy setters: granting authority that outlives the transaction.
        selectors[12] = IRiskySurface.approvePin.selector;
        selectors[13] = IRiskySurface.authorizeExecutor.selector;
    }
}
