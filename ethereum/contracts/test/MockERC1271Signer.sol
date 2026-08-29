// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockERC1271Signer is IERC1271 {
    address public immutable authorizedSigner;

    constructor(address signer) {
        require(signer != address(0), "Invalid signer");
        authorizedSigner = signer;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(hash, signature);
        if (error == ECDSA.RecoverError.NoError && recovered == authorizedSigner) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }
}
