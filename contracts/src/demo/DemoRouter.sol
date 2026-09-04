// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Stand-in venue for the demo and the end-to-end suite.
///
/// Lives under `src` rather than `test` so `forge build` emits an artifact the
/// end-to-end suite can deploy. Not intended for any real deployment.
contract DemoRouter {
    uint256 public swaps;
    uint256 public received;

    event Swapped(address indexed caller, uint256 amountIn, uint256 amountOut);

    function swap(uint256 amountIn) external payable returns (uint256 amountOut) {
        swaps += 1;
        received += msg.value;
        amountOut = amountIn * 2;
        emit Swapped(msg.sender, amountIn, amountOut);
    }

    /// @dev A capability a well-behaved pin would never declare. Exists so tests
    ///      can show that an undeclared selector is refused even under an honest
    ///      attestation.
    ///
    ///      It really does send to a caller-chosen address. That is the point, and
    ///      it is why this contract is confined to `src/demo` and named as a demo.
    ///      Never deploy it anywhere that holds value.
    // forge-lint: disable-next-line(arbitrary-send-eth)
    function drain(address to) external {
        payable(to).transfer(address(this).balance);
    }

    receive() external payable {
        received += msg.value;
    }
}
