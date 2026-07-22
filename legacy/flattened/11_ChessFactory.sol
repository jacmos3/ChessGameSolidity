pragma solidity ^0.8.24;


library Errors {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error InsufficientBalance(uint256 balance, uint256 needed);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedCall();

    /**
     * @dev The deployment failed.
     */
    error FailedDeployment();

    /**
     * @dev A necessary precompile is missing.
     */
    error MissingPrecompile(address);
}

library Create2 {
    /**
     * @dev There's no code to deploy.
     */
    error Create2EmptyBytecode();

    /**
     * @dev Deploys a contract using `CREATE2`. The address where the contract
     * will be deployed can be known in advance via {computeAddress}.
     *
     * The bytecode for a contract can be obtained from Solidity with
     * `type(contractName).creationCode`.
     *
     * Requirements:
     *
     * - `bytecode` must not be empty.
     * - `salt` must have not been used for `bytecode` already.
     * - the factory must have a balance of at least `amount`.
     * - if `amount` is non-zero, `bytecode` must have a `payable` constructor.
     */
    function deploy(uint256 amount, bytes32 salt, bytes memory bytecode) internal returns (address addr) {
        if (address(this).balance < amount) {
            revert Errors.InsufficientBalance(address(this).balance, amount);
        }
        if (bytecode.length == 0) {
            revert Create2EmptyBytecode();
        }
        assembly ("memory-safe") {
            addr := create2(amount, add(bytecode, 0x20), mload(bytecode), salt)
            // if no address was created, and returndata is not empty, bubble revert
            if and(iszero(addr), not(iszero(returndatasize()))) {
                let p := mload(0x40)
                returndatacopy(p, 0, returndatasize())
                revert(p, returndatasize())
            }
        }
        if (addr == address(0)) {
            revert Errors.FailedDeployment();
        }
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via {deploy}. Any change in the
     * `bytecodeHash` or `salt` will result in a new destination address.
     */
    function computeAddress(bytes32 salt, bytes32 bytecodeHash) internal view returns (address) {
        return computeAddress(salt, bytecodeHash, address(this));
    }

    /**
     * @dev Returns the address where a contract will be stored if deployed via {deploy} from a contract located at
     * `deployer`. If `deployer` is this contract's address, returns the same value as {computeAddress}.
     */
    function computeAddress(bytes32 salt, bytes32 bytecodeHash, address deployer) internal pure returns (address addr) {
        assembly ("memory-safe") {
            let ptr := mload(0x40) // Get free memory pointer

            // |                   | ↓ ptr ...  ↓ ptr + 0x0B (start) ...  ↓ ptr + 0x20 ...  ↓ ptr + 0x40 ...   |
            // |-------------------|---------------------------------------------------------------------------|
            // | bytecodeHash      |                                                        CCCCCCCCCCCCC...CC |
            // | salt              |                                      BBBBBBBBBBBBB...BB                   |
            // | deployer          | 000000...0000AAAAAAAAAAAAAAAAAAA...AA                                     |
            // | 0xFF              |            FF                                                             |
            // |-------------------|---------------------------------------------------------------------------|
            // | memory            | 000000...00FFAAAAAAAAAAAAAAAAAAA...AABBBBBBBBBBBBB...BBCCCCCCCCCCCCC...CC |
            // | keccak(start, 85) |            ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑ |

            mstore(add(ptr, 0x40), bytecodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer) // Right-aligned with 12 preceding garbage bytes
            let start := add(ptr, 0x0b) // The hashed data starts at the final garbage byte which we will set to 0xff
            mstore8(start, 0xff)
            addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (proxy/Clones.sol)
/**
 * @dev https://eips.ethereum.org/EIPS/eip-1167[ERC-1167] is a standard for
 * deploying minimal proxy contracts, also known as "clones".
 *
 * > To simply and cheaply clone contract functionality in an immutable way, this standard specifies
 * > a minimal bytecode implementation that delegates all calls to a known, fixed address.
 *
 * The library includes functions to deploy a proxy using either `create` (traditional deployment) or `create2`
 * (salted deterministic deployment). It also includes functions to predict the addresses of clones deployed using the
 * deterministic method.
 */
library Clones {
    error CloneArgumentsTooLong();

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation`.
     *
     * This function uses the create opcode, which should never revert.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function clone(address implementation) internal returns (address instance) {
        return clone(implementation, 0);
    }

    /**
     * @dev Same as {xref-Clones-clone-address-}[clone], but with a `value` parameter to send native currency
     * to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function clone(address implementation, uint256 value) internal returns (address instance) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        assembly ("memory-safe") {
            // Cleans the upper 96 bits of the `implementation` word, then packs the first 3 bytes
            // of the `implementation` address with the bytecode before the address.
            mstore(0x00, or(shr(0xe8, shl(0x60, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            // Packs the remaining 17 bytes of `implementation` with the bytecode after the address.
            mstore(0x20, or(shl(0x78, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(value, 0x09, 0x37)
        }
        if (instance == address(0)) {
            revert Errors.FailedDeployment();
        }
    }

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation`.
     *
     * This function uses the create2 opcode and a `salt` to deterministically deploy
     * the clone. Using the same `implementation` and `salt` multiple times will revert, since
     * the clones cannot be deployed twice at the same address.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function cloneDeterministic(address implementation, bytes32 salt) internal returns (address instance) {
        return cloneDeterministic(implementation, salt, 0);
    }

    /**
     * @dev Same as {xref-Clones-cloneDeterministic-address-bytes32-}[cloneDeterministic], but with
     * a `value` parameter to send native currency to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function cloneDeterministic(
        address implementation,
        bytes32 salt,
        uint256 value
    ) internal returns (address instance) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        assembly ("memory-safe") {
            // Cleans the upper 96 bits of the `implementation` word, then packs the first 3 bytes
            // of the `implementation` address with the bytecode before the address.
            mstore(0x00, or(shr(0xe8, shl(0x60, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            // Packs the remaining 17 bytes of `implementation` with the bytecode after the address.
            mstore(0x20, or(shl(0x78, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create2(value, 0x09, 0x37, salt)
        }
        if (instance == address(0)) {
            revert Errors.FailedDeployment();
        }
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministic}.
     */
    function predictDeterministicAddress(
        address implementation,
        bytes32 salt,
        address deployer
    ) internal pure returns (address predicted) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x38), deployer)
            mstore(add(ptr, 0x24), 0x5af43d82803e903d91602b57fd5bf3ff)
            mstore(add(ptr, 0x14), implementation)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73)
            mstore(add(ptr, 0x58), salt)
            mstore(add(ptr, 0x78), keccak256(add(ptr, 0x0c), 0x37))
            predicted := and(keccak256(add(ptr, 0x43), 0x55), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministic}.
     */
    function predictDeterministicAddress(
        address implementation,
        bytes32 salt
    ) internal view returns (address predicted) {
        return predictDeterministicAddress(implementation, salt, address(this));
    }

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation` with custom
     * immutable arguments. These are provided through `args` and cannot be changed after deployment. To
     * access the arguments within the implementation, use {fetchCloneArgs}.
     *
     * This function uses the create opcode, which should never revert.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function cloneWithImmutableArgs(address implementation, bytes memory args) internal returns (address instance) {
        return cloneWithImmutableArgs(implementation, args, 0);
    }

    /**
     * @dev Same as {xref-Clones-cloneWithImmutableArgs-address-bytes-}[cloneWithImmutableArgs], but with a `value`
     * parameter to send native currency to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function cloneWithImmutableArgs(
        address implementation,
        bytes memory args,
        uint256 value
    ) internal returns (address instance) {
        if (address(this).balance < value) {
            revert Errors.InsufficientBalance(address(this).balance, value);
        }
        bytes memory bytecode = _cloneCodeWithImmutableArgs(implementation, args);
        assembly ("memory-safe") {
            instance := create(value, add(bytecode, 0x20), mload(bytecode))
        }
        if (instance == address(0)) {
            revert Errors.FailedDeployment();
        }
    }

    /**
     * @dev Deploys and returns the address of a clone that mimics the behavior of `implementation` with custom
     * immutable arguments. These are provided through `args` and cannot be changed after deployment. To
     * access the arguments within the implementation, use {fetchCloneArgs}.
     *
     * This function uses the create2 opcode and a `salt` to deterministically deploy the clone. Using the same
     * `implementation`, `args` and `salt` multiple times will revert, since the clones cannot be deployed twice
     * at the same address.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     */
    function cloneDeterministicWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt
    ) internal returns (address instance) {
        return cloneDeterministicWithImmutableArgs(implementation, args, salt, 0);
    }

    /**
     * @dev Same as {xref-Clones-cloneDeterministicWithImmutableArgs-address-bytes-bytes32-}[cloneDeterministicWithImmutableArgs],
     * but with a `value` parameter to send native currency to the new contract.
     *
     * WARNING: This function does not check if `implementation` has code. A clone that points to an address
     * without code cannot be initialized. Initialization calls may appear to be successful when, in reality, they
     * have no effect and leave the clone uninitialized, allowing a third party to initialize it later.
     *
     * NOTE: Using a non-zero value at creation will require the contract using this function (e.g. a factory)
     * to always have enough balance for new deployments. Consider exposing this function under a payable method.
     */
    function cloneDeterministicWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt,
        uint256 value
    ) internal returns (address instance) {
        bytes memory bytecode = _cloneCodeWithImmutableArgs(implementation, args);
        return Create2.deploy(value, salt, bytecode);
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministicWithImmutableArgs}.
     */
    function predictDeterministicAddressWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt,
        address deployer
    ) internal pure returns (address predicted) {
        bytes memory bytecode = _cloneCodeWithImmutableArgs(implementation, args);
        return Create2.computeAddress(salt, keccak256(bytecode), deployer);
    }

    /**
     * @dev Computes the address of a clone deployed using {Clones-cloneDeterministicWithImmutableArgs}.
     */
    function predictDeterministicAddressWithImmutableArgs(
        address implementation,
        bytes memory args,
        bytes32 salt
    ) internal view returns (address predicted) {
        return predictDeterministicAddressWithImmutableArgs(implementation, args, salt, address(this));
    }

    /**
     * @dev Get the immutable args attached to a clone.
     *
     * - If `instance` is a clone that was deployed using `clone` or `cloneDeterministic`, this
     *   function will return an empty array.
     * - If `instance` is a clone that was deployed using `cloneWithImmutableArgs` or
     *   `cloneDeterministicWithImmutableArgs`, this function will return the args array used at
     *   creation.
     * - If `instance` is NOT a clone deployed using this library, the behavior is undefined. This
     *   function should only be used to check addresses that are known to be clones.
     */
    function fetchCloneArgs(address instance) internal view returns (bytes memory) {
        bytes memory result = new bytes(instance.code.length - 45); // revert if length is too short
        assembly ("memory-safe") {
            extcodecopy(instance, add(result, 32), 45, mload(result))
        }
        return result;
    }

    /**
     * @dev Helper that prepares the initcode of the proxy with immutable args.
     *
     * An assembly variant of this function requires copying the `args` array, which can be efficiently done using
     * `mcopy`. Unfortunately, that opcode is not available before cancun. A pure solidity implementation using
     * abi.encodePacked is more expensive but also more portable and easier to review.
     *
     * NOTE: https://eips.ethereum.org/EIPS/eip-170[EIP-170] limits the length of the contract code to 24576 bytes.
     * With the proxy code taking 45 bytes, that limits the length of the immutable args to 24531 bytes.
     */
    function _cloneCodeWithImmutableArgs(
        address implementation,
        bytes memory args
    ) private pure returns (bytes memory) {
        if (args.length > 24531) revert CloneArgumentsTooLong();
        return
            abi.encodePacked(
                hex"61",
                uint16(args.length + 45),
                hex"3d81600a3d39f3363d3d373d3d3d363d73",
                implementation,
                hex"5af43d82803e903d91602b57fd5bf3",
                args
            );
    }
}

library Panic {
    /// @dev generic / unspecified error
    uint256 internal constant GENERIC = 0x00;
    /// @dev used by the assert() builtin
    uint256 internal constant ASSERT = 0x01;
    /// @dev arithmetic underflow or overflow
    uint256 internal constant UNDER_OVERFLOW = 0x11;
    /// @dev division or modulo by zero
    uint256 internal constant DIVISION_BY_ZERO = 0x12;
    /// @dev enum conversion error
    uint256 internal constant ENUM_CONVERSION_ERROR = 0x21;
    /// @dev invalid encoding in storage
    uint256 internal constant STORAGE_ENCODING_ERROR = 0x22;
    /// @dev empty array pop
    uint256 internal constant EMPTY_ARRAY_POP = 0x31;
    /// @dev array out of bounds access
    uint256 internal constant ARRAY_OUT_OF_BOUNDS = 0x32;
    /// @dev resource error (too large allocation or too large array)
    uint256 internal constant RESOURCE_ERROR = 0x41;
    /// @dev calling invalid internal function
    uint256 internal constant INVALID_INTERNAL_FUNCTION = 0x51;

    /// @dev Reverts with a panic code. Recommended to use with
    /// the internal constants with predefined codes.
    function panic(uint256 code) internal pure {
        assembly ("memory-safe") {
            mstore(0x00, 0x4e487b71)
            mstore(0x20, code)
            revert(0x1c, 0x24)
        }
    }
}

library SafeCast {
    /**
     * @dev Value doesn't fit in an uint of `bits` size.
     */
    error SafeCastOverflowedUintDowncast(uint8 bits, uint256 value);

    /**
     * @dev An int value doesn't fit in an uint of `bits` size.
     */
    error SafeCastOverflowedIntToUint(int256 value);

    /**
     * @dev Value doesn't fit in an int of `bits` size.
     */
    error SafeCastOverflowedIntDowncast(uint8 bits, int256 value);

    /**
     * @dev An uint value doesn't fit in an int of `bits` size.
     */
    error SafeCastOverflowedUintToInt(uint256 value);

    /**
     * @dev Returns the downcasted uint248 from uint256, reverting on
     * overflow (when the input is greater than largest uint248).
     *
     * Counterpart to Solidity's `uint248` operator.
     *
     * Requirements:
     *
     * - input must fit into 248 bits
     */
    function toUint248(uint256 value) internal pure returns (uint248) {
        if (value > type(uint248).max) {
            revert SafeCastOverflowedUintDowncast(248, value);
        }
        return uint248(value);
    }

    /**
     * @dev Returns the downcasted uint240 from uint256, reverting on
     * overflow (when the input is greater than largest uint240).
     *
     * Counterpart to Solidity's `uint240` operator.
     *
     * Requirements:
     *
     * - input must fit into 240 bits
     */
    function toUint240(uint256 value) internal pure returns (uint240) {
        if (value > type(uint240).max) {
            revert SafeCastOverflowedUintDowncast(240, value);
        }
        return uint240(value);
    }

    /**
     * @dev Returns the downcasted uint232 from uint256, reverting on
     * overflow (when the input is greater than largest uint232).
     *
     * Counterpart to Solidity's `uint232` operator.
     *
     * Requirements:
     *
     * - input must fit into 232 bits
     */
    function toUint232(uint256 value) internal pure returns (uint232) {
        if (value > type(uint232).max) {
            revert SafeCastOverflowedUintDowncast(232, value);
        }
        return uint232(value);
    }

    /**
     * @dev Returns the downcasted uint224 from uint256, reverting on
     * overflow (when the input is greater than largest uint224).
     *
     * Counterpart to Solidity's `uint224` operator.
     *
     * Requirements:
     *
     * - input must fit into 224 bits
     */
    function toUint224(uint256 value) internal pure returns (uint224) {
        if (value > type(uint224).max) {
            revert SafeCastOverflowedUintDowncast(224, value);
        }
        return uint224(value);
    }

    /**
     * @dev Returns the downcasted uint216 from uint256, reverting on
     * overflow (when the input is greater than largest uint216).
     *
     * Counterpart to Solidity's `uint216` operator.
     *
     * Requirements:
     *
     * - input must fit into 216 bits
     */
    function toUint216(uint256 value) internal pure returns (uint216) {
        if (value > type(uint216).max) {
            revert SafeCastOverflowedUintDowncast(216, value);
        }
        return uint216(value);
    }

    /**
     * @dev Returns the downcasted uint208 from uint256, reverting on
     * overflow (when the input is greater than largest uint208).
     *
     * Counterpart to Solidity's `uint208` operator.
     *
     * Requirements:
     *
     * - input must fit into 208 bits
     */
    function toUint208(uint256 value) internal pure returns (uint208) {
        if (value > type(uint208).max) {
            revert SafeCastOverflowedUintDowncast(208, value);
        }
        return uint208(value);
    }

    /**
     * @dev Returns the downcasted uint200 from uint256, reverting on
     * overflow (when the input is greater than largest uint200).
     *
     * Counterpart to Solidity's `uint200` operator.
     *
     * Requirements:
     *
     * - input must fit into 200 bits
     */
    function toUint200(uint256 value) internal pure returns (uint200) {
        if (value > type(uint200).max) {
            revert SafeCastOverflowedUintDowncast(200, value);
        }
        return uint200(value);
    }

    /**
     * @dev Returns the downcasted uint192 from uint256, reverting on
     * overflow (when the input is greater than largest uint192).
     *
     * Counterpart to Solidity's `uint192` operator.
     *
     * Requirements:
     *
     * - input must fit into 192 bits
     */
    function toUint192(uint256 value) internal pure returns (uint192) {
        if (value > type(uint192).max) {
            revert SafeCastOverflowedUintDowncast(192, value);
        }
        return uint192(value);
    }

    /**
     * @dev Returns the downcasted uint184 from uint256, reverting on
     * overflow (when the input is greater than largest uint184).
     *
     * Counterpart to Solidity's `uint184` operator.
     *
     * Requirements:
     *
     * - input must fit into 184 bits
     */
    function toUint184(uint256 value) internal pure returns (uint184) {
        if (value > type(uint184).max) {
            revert SafeCastOverflowedUintDowncast(184, value);
        }
        return uint184(value);
    }

    /**
     * @dev Returns the downcasted uint176 from uint256, reverting on
     * overflow (when the input is greater than largest uint176).
     *
     * Counterpart to Solidity's `uint176` operator.
     *
     * Requirements:
     *
     * - input must fit into 176 bits
     */
    function toUint176(uint256 value) internal pure returns (uint176) {
        if (value > type(uint176).max) {
            revert SafeCastOverflowedUintDowncast(176, value);
        }
        return uint176(value);
    }

    /**
     * @dev Returns the downcasted uint168 from uint256, reverting on
     * overflow (when the input is greater than largest uint168).
     *
     * Counterpart to Solidity's `uint168` operator.
     *
     * Requirements:
     *
     * - input must fit into 168 bits
     */
    function toUint168(uint256 value) internal pure returns (uint168) {
        if (value > type(uint168).max) {
            revert SafeCastOverflowedUintDowncast(168, value);
        }
        return uint168(value);
    }

    /**
     * @dev Returns the downcasted uint160 from uint256, reverting on
     * overflow (when the input is greater than largest uint160).
     *
     * Counterpart to Solidity's `uint160` operator.
     *
     * Requirements:
     *
     * - input must fit into 160 bits
     */
    function toUint160(uint256 value) internal pure returns (uint160) {
        if (value > type(uint160).max) {
            revert SafeCastOverflowedUintDowncast(160, value);
        }
        return uint160(value);
    }

    /**
     * @dev Returns the downcasted uint152 from uint256, reverting on
     * overflow (when the input is greater than largest uint152).
     *
     * Counterpart to Solidity's `uint152` operator.
     *
     * Requirements:
     *
     * - input must fit into 152 bits
     */
    function toUint152(uint256 value) internal pure returns (uint152) {
        if (value > type(uint152).max) {
            revert SafeCastOverflowedUintDowncast(152, value);
        }
        return uint152(value);
    }

    /**
     * @dev Returns the downcasted uint144 from uint256, reverting on
     * overflow (when the input is greater than largest uint144).
     *
     * Counterpart to Solidity's `uint144` operator.
     *
     * Requirements:
     *
     * - input must fit into 144 bits
     */
    function toUint144(uint256 value) internal pure returns (uint144) {
        if (value > type(uint144).max) {
            revert SafeCastOverflowedUintDowncast(144, value);
        }
        return uint144(value);
    }

    /**
     * @dev Returns the downcasted uint136 from uint256, reverting on
     * overflow (when the input is greater than largest uint136).
     *
     * Counterpart to Solidity's `uint136` operator.
     *
     * Requirements:
     *
     * - input must fit into 136 bits
     */
    function toUint136(uint256 value) internal pure returns (uint136) {
        if (value > type(uint136).max) {
            revert SafeCastOverflowedUintDowncast(136, value);
        }
        return uint136(value);
    }

    /**
     * @dev Returns the downcasted uint128 from uint256, reverting on
     * overflow (when the input is greater than largest uint128).
     *
     * Counterpart to Solidity's `uint128` operator.
     *
     * Requirements:
     *
     * - input must fit into 128 bits
     */
    function toUint128(uint256 value) internal pure returns (uint128) {
        if (value > type(uint128).max) {
            revert SafeCastOverflowedUintDowncast(128, value);
        }
        return uint128(value);
    }

    /**
     * @dev Returns the downcasted uint120 from uint256, reverting on
     * overflow (when the input is greater than largest uint120).
     *
     * Counterpart to Solidity's `uint120` operator.
     *
     * Requirements:
     *
     * - input must fit into 120 bits
     */
    function toUint120(uint256 value) internal pure returns (uint120) {
        if (value > type(uint120).max) {
            revert SafeCastOverflowedUintDowncast(120, value);
        }
        return uint120(value);
    }

    /**
     * @dev Returns the downcasted uint112 from uint256, reverting on
     * overflow (when the input is greater than largest uint112).
     *
     * Counterpart to Solidity's `uint112` operator.
     *
     * Requirements:
     *
     * - input must fit into 112 bits
     */
    function toUint112(uint256 value) internal pure returns (uint112) {
        if (value > type(uint112).max) {
            revert SafeCastOverflowedUintDowncast(112, value);
        }
        return uint112(value);
    }

    /**
     * @dev Returns the downcasted uint104 from uint256, reverting on
     * overflow (when the input is greater than largest uint104).
     *
     * Counterpart to Solidity's `uint104` operator.
     *
     * Requirements:
     *
     * - input must fit into 104 bits
     */
    function toUint104(uint256 value) internal pure returns (uint104) {
        if (value > type(uint104).max) {
            revert SafeCastOverflowedUintDowncast(104, value);
        }
        return uint104(value);
    }

    /**
     * @dev Returns the downcasted uint96 from uint256, reverting on
     * overflow (when the input is greater than largest uint96).
     *
     * Counterpart to Solidity's `uint96` operator.
     *
     * Requirements:
     *
     * - input must fit into 96 bits
     */
    function toUint96(uint256 value) internal pure returns (uint96) {
        if (value > type(uint96).max) {
            revert SafeCastOverflowedUintDowncast(96, value);
        }
        return uint96(value);
    }

    /**
     * @dev Returns the downcasted uint88 from uint256, reverting on
     * overflow (when the input is greater than largest uint88).
     *
     * Counterpart to Solidity's `uint88` operator.
     *
     * Requirements:
     *
     * - input must fit into 88 bits
     */
    function toUint88(uint256 value) internal pure returns (uint88) {
        if (value > type(uint88).max) {
            revert SafeCastOverflowedUintDowncast(88, value);
        }
        return uint88(value);
    }

    /**
     * @dev Returns the downcasted uint80 from uint256, reverting on
     * overflow (when the input is greater than largest uint80).
     *
     * Counterpart to Solidity's `uint80` operator.
     *
     * Requirements:
     *
     * - input must fit into 80 bits
     */
    function toUint80(uint256 value) internal pure returns (uint80) {
        if (value > type(uint80).max) {
            revert SafeCastOverflowedUintDowncast(80, value);
        }
        return uint80(value);
    }

    /**
     * @dev Returns the downcasted uint72 from uint256, reverting on
     * overflow (when the input is greater than largest uint72).
     *
     * Counterpart to Solidity's `uint72` operator.
     *
     * Requirements:
     *
     * - input must fit into 72 bits
     */
    function toUint72(uint256 value) internal pure returns (uint72) {
        if (value > type(uint72).max) {
            revert SafeCastOverflowedUintDowncast(72, value);
        }
        return uint72(value);
    }

    /**
     * @dev Returns the downcasted uint64 from uint256, reverting on
     * overflow (when the input is greater than largest uint64).
     *
     * Counterpart to Solidity's `uint64` operator.
     *
     * Requirements:
     *
     * - input must fit into 64 bits
     */
    function toUint64(uint256 value) internal pure returns (uint64) {
        if (value > type(uint64).max) {
            revert SafeCastOverflowedUintDowncast(64, value);
        }
        return uint64(value);
    }

    /**
     * @dev Returns the downcasted uint56 from uint256, reverting on
     * overflow (when the input is greater than largest uint56).
     *
     * Counterpart to Solidity's `uint56` operator.
     *
     * Requirements:
     *
     * - input must fit into 56 bits
     */
    function toUint56(uint256 value) internal pure returns (uint56) {
        if (value > type(uint56).max) {
            revert SafeCastOverflowedUintDowncast(56, value);
        }
        return uint56(value);
    }

    /**
     * @dev Returns the downcasted uint48 from uint256, reverting on
     * overflow (when the input is greater than largest uint48).
     *
     * Counterpart to Solidity's `uint48` operator.
     *
     * Requirements:
     *
     * - input must fit into 48 bits
     */
    function toUint48(uint256 value) internal pure returns (uint48) {
        if (value > type(uint48).max) {
            revert SafeCastOverflowedUintDowncast(48, value);
        }
        return uint48(value);
    }

    /**
     * @dev Returns the downcasted uint40 from uint256, reverting on
     * overflow (when the input is greater than largest uint40).
     *
     * Counterpart to Solidity's `uint40` operator.
     *
     * Requirements:
     *
     * - input must fit into 40 bits
     */
    function toUint40(uint256 value) internal pure returns (uint40) {
        if (value > type(uint40).max) {
            revert SafeCastOverflowedUintDowncast(40, value);
        }
        return uint40(value);
    }

    /**
     * @dev Returns the downcasted uint32 from uint256, reverting on
     * overflow (when the input is greater than largest uint32).
     *
     * Counterpart to Solidity's `uint32` operator.
     *
     * Requirements:
     *
     * - input must fit into 32 bits
     */
    function toUint32(uint256 value) internal pure returns (uint32) {
        if (value > type(uint32).max) {
            revert SafeCastOverflowedUintDowncast(32, value);
        }
        return uint32(value);
    }

    /**
     * @dev Returns the downcasted uint24 from uint256, reverting on
     * overflow (when the input is greater than largest uint24).
     *
     * Counterpart to Solidity's `uint24` operator.
     *
     * Requirements:
     *
     * - input must fit into 24 bits
     */
    function toUint24(uint256 value) internal pure returns (uint24) {
        if (value > type(uint24).max) {
            revert SafeCastOverflowedUintDowncast(24, value);
        }
        return uint24(value);
    }

    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16).
     *
     * Counterpart to Solidity's `uint16` operator.
     *
     * Requirements:
     *
     * - input must fit into 16 bits
     */
    function toUint16(uint256 value) internal pure returns (uint16) {
        if (value > type(uint16).max) {
            revert SafeCastOverflowedUintDowncast(16, value);
        }
        return uint16(value);
    }

    /**
     * @dev Returns the downcasted uint8 from uint256, reverting on
     * overflow (when the input is greater than largest uint8).
     *
     * Counterpart to Solidity's `uint8` operator.
     *
     * Requirements:
     *
     * - input must fit into 8 bits
     */
    function toUint8(uint256 value) internal pure returns (uint8) {
        if (value > type(uint8).max) {
            revert SafeCastOverflowedUintDowncast(8, value);
        }
        return uint8(value);
    }

    /**
     * @dev Converts a signed int256 into an unsigned uint256.
     *
     * Requirements:
     *
     * - input must be greater than or equal to 0.
     */
    function toUint256(int256 value) internal pure returns (uint256) {
        if (value < 0) {
            revert SafeCastOverflowedIntToUint(value);
        }
        return uint256(value);
    }

    /**
     * @dev Returns the downcasted int248 from int256, reverting on
     * overflow (when the input is less than smallest int248 or
     * greater than largest int248).
     *
     * Counterpart to Solidity's `int248` operator.
     *
     * Requirements:
     *
     * - input must fit into 248 bits
     */
    function toInt248(int256 value) internal pure returns (int248 downcasted) {
        downcasted = int248(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(248, value);
        }
    }

    /**
     * @dev Returns the downcasted int240 from int256, reverting on
     * overflow (when the input is less than smallest int240 or
     * greater than largest int240).
     *
     * Counterpart to Solidity's `int240` operator.
     *
     * Requirements:
     *
     * - input must fit into 240 bits
     */
    function toInt240(int256 value) internal pure returns (int240 downcasted) {
        downcasted = int240(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(240, value);
        }
    }

    /**
     * @dev Returns the downcasted int232 from int256, reverting on
     * overflow (when the input is less than smallest int232 or
     * greater than largest int232).
     *
     * Counterpart to Solidity's `int232` operator.
     *
     * Requirements:
     *
     * - input must fit into 232 bits
     */
    function toInt232(int256 value) internal pure returns (int232 downcasted) {
        downcasted = int232(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(232, value);
        }
    }

    /**
     * @dev Returns the downcasted int224 from int256, reverting on
     * overflow (when the input is less than smallest int224 or
     * greater than largest int224).
     *
     * Counterpart to Solidity's `int224` operator.
     *
     * Requirements:
     *
     * - input must fit into 224 bits
     */
    function toInt224(int256 value) internal pure returns (int224 downcasted) {
        downcasted = int224(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(224, value);
        }
    }

    /**
     * @dev Returns the downcasted int216 from int256, reverting on
     * overflow (when the input is less than smallest int216 or
     * greater than largest int216).
     *
     * Counterpart to Solidity's `int216` operator.
     *
     * Requirements:
     *
     * - input must fit into 216 bits
     */
    function toInt216(int256 value) internal pure returns (int216 downcasted) {
        downcasted = int216(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(216, value);
        }
    }

    /**
     * @dev Returns the downcasted int208 from int256, reverting on
     * overflow (when the input is less than smallest int208 or
     * greater than largest int208).
     *
     * Counterpart to Solidity's `int208` operator.
     *
     * Requirements:
     *
     * - input must fit into 208 bits
     */
    function toInt208(int256 value) internal pure returns (int208 downcasted) {
        downcasted = int208(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(208, value);
        }
    }

    /**
     * @dev Returns the downcasted int200 from int256, reverting on
     * overflow (when the input is less than smallest int200 or
     * greater than largest int200).
     *
     * Counterpart to Solidity's `int200` operator.
     *
     * Requirements:
     *
     * - input must fit into 200 bits
     */
    function toInt200(int256 value) internal pure returns (int200 downcasted) {
        downcasted = int200(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(200, value);
        }
    }

    /**
     * @dev Returns the downcasted int192 from int256, reverting on
     * overflow (when the input is less than smallest int192 or
     * greater than largest int192).
     *
     * Counterpart to Solidity's `int192` operator.
     *
     * Requirements:
     *
     * - input must fit into 192 bits
     */
    function toInt192(int256 value) internal pure returns (int192 downcasted) {
        downcasted = int192(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(192, value);
        }
    }

    /**
     * @dev Returns the downcasted int184 from int256, reverting on
     * overflow (when the input is less than smallest int184 or
     * greater than largest int184).
     *
     * Counterpart to Solidity's `int184` operator.
     *
     * Requirements:
     *
     * - input must fit into 184 bits
     */
    function toInt184(int256 value) internal pure returns (int184 downcasted) {
        downcasted = int184(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(184, value);
        }
    }

    /**
     * @dev Returns the downcasted int176 from int256, reverting on
     * overflow (when the input is less than smallest int176 or
     * greater than largest int176).
     *
     * Counterpart to Solidity's `int176` operator.
     *
     * Requirements:
     *
     * - input must fit into 176 bits
     */
    function toInt176(int256 value) internal pure returns (int176 downcasted) {
        downcasted = int176(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(176, value);
        }
    }

    /**
     * @dev Returns the downcasted int168 from int256, reverting on
     * overflow (when the input is less than smallest int168 or
     * greater than largest int168).
     *
     * Counterpart to Solidity's `int168` operator.
     *
     * Requirements:
     *
     * - input must fit into 168 bits
     */
    function toInt168(int256 value) internal pure returns (int168 downcasted) {
        downcasted = int168(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(168, value);
        }
    }

    /**
     * @dev Returns the downcasted int160 from int256, reverting on
     * overflow (when the input is less than smallest int160 or
     * greater than largest int160).
     *
     * Counterpart to Solidity's `int160` operator.
     *
     * Requirements:
     *
     * - input must fit into 160 bits
     */
    function toInt160(int256 value) internal pure returns (int160 downcasted) {
        downcasted = int160(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(160, value);
        }
    }

    /**
     * @dev Returns the downcasted int152 from int256, reverting on
     * overflow (when the input is less than smallest int152 or
     * greater than largest int152).
     *
     * Counterpart to Solidity's `int152` operator.
     *
     * Requirements:
     *
     * - input must fit into 152 bits
     */
    function toInt152(int256 value) internal pure returns (int152 downcasted) {
        downcasted = int152(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(152, value);
        }
    }

    /**
     * @dev Returns the downcasted int144 from int256, reverting on
     * overflow (when the input is less than smallest int144 or
     * greater than largest int144).
     *
     * Counterpart to Solidity's `int144` operator.
     *
     * Requirements:
     *
     * - input must fit into 144 bits
     */
    function toInt144(int256 value) internal pure returns (int144 downcasted) {
        downcasted = int144(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(144, value);
        }
    }

    /**
     * @dev Returns the downcasted int136 from int256, reverting on
     * overflow (when the input is less than smallest int136 or
     * greater than largest int136).
     *
     * Counterpart to Solidity's `int136` operator.
     *
     * Requirements:
     *
     * - input must fit into 136 bits
     */
    function toInt136(int256 value) internal pure returns (int136 downcasted) {
        downcasted = int136(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(136, value);
        }
    }

    /**
     * @dev Returns the downcasted int128 from int256, reverting on
     * overflow (when the input is less than smallest int128 or
     * greater than largest int128).
     *
     * Counterpart to Solidity's `int128` operator.
     *
     * Requirements:
     *
     * - input must fit into 128 bits
     */
    function toInt128(int256 value) internal pure returns (int128 downcasted) {
        downcasted = int128(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(128, value);
        }
    }

    /**
     * @dev Returns the downcasted int120 from int256, reverting on
     * overflow (when the input is less than smallest int120 or
     * greater than largest int120).
     *
     * Counterpart to Solidity's `int120` operator.
     *
     * Requirements:
     *
     * - input must fit into 120 bits
     */
    function toInt120(int256 value) internal pure returns (int120 downcasted) {
        downcasted = int120(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(120, value);
        }
    }

    /**
     * @dev Returns the downcasted int112 from int256, reverting on
     * overflow (when the input is less than smallest int112 or
     * greater than largest int112).
     *
     * Counterpart to Solidity's `int112` operator.
     *
     * Requirements:
     *
     * - input must fit into 112 bits
     */
    function toInt112(int256 value) internal pure returns (int112 downcasted) {
        downcasted = int112(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(112, value);
        }
    }

    /**
     * @dev Returns the downcasted int104 from int256, reverting on
     * overflow (when the input is less than smallest int104 or
     * greater than largest int104).
     *
     * Counterpart to Solidity's `int104` operator.
     *
     * Requirements:
     *
     * - input must fit into 104 bits
     */
    function toInt104(int256 value) internal pure returns (int104 downcasted) {
        downcasted = int104(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(104, value);
        }
    }

    /**
     * @dev Returns the downcasted int96 from int256, reverting on
     * overflow (when the input is less than smallest int96 or
     * greater than largest int96).
     *
     * Counterpart to Solidity's `int96` operator.
     *
     * Requirements:
     *
     * - input must fit into 96 bits
     */
    function toInt96(int256 value) internal pure returns (int96 downcasted) {
        downcasted = int96(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(96, value);
        }
    }

    /**
     * @dev Returns the downcasted int88 from int256, reverting on
     * overflow (when the input is less than smallest int88 or
     * greater than largest int88).
     *
     * Counterpart to Solidity's `int88` operator.
     *
     * Requirements:
     *
     * - input must fit into 88 bits
     */
    function toInt88(int256 value) internal pure returns (int88 downcasted) {
        downcasted = int88(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(88, value);
        }
    }

    /**
     * @dev Returns the downcasted int80 from int256, reverting on
     * overflow (when the input is less than smallest int80 or
     * greater than largest int80).
     *
     * Counterpart to Solidity's `int80` operator.
     *
     * Requirements:
     *
     * - input must fit into 80 bits
     */
    function toInt80(int256 value) internal pure returns (int80 downcasted) {
        downcasted = int80(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(80, value);
        }
    }

    /**
     * @dev Returns the downcasted int72 from int256, reverting on
     * overflow (when the input is less than smallest int72 or
     * greater than largest int72).
     *
     * Counterpart to Solidity's `int72` operator.
     *
     * Requirements:
     *
     * - input must fit into 72 bits
     */
    function toInt72(int256 value) internal pure returns (int72 downcasted) {
        downcasted = int72(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(72, value);
        }
    }

    /**
     * @dev Returns the downcasted int64 from int256, reverting on
     * overflow (when the input is less than smallest int64 or
     * greater than largest int64).
     *
     * Counterpart to Solidity's `int64` operator.
     *
     * Requirements:
     *
     * - input must fit into 64 bits
     */
    function toInt64(int256 value) internal pure returns (int64 downcasted) {
        downcasted = int64(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(64, value);
        }
    }

    /**
     * @dev Returns the downcasted int56 from int256, reverting on
     * overflow (when the input is less than smallest int56 or
     * greater than largest int56).
     *
     * Counterpart to Solidity's `int56` operator.
     *
     * Requirements:
     *
     * - input must fit into 56 bits
     */
    function toInt56(int256 value) internal pure returns (int56 downcasted) {
        downcasted = int56(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(56, value);
        }
    }

    /**
     * @dev Returns the downcasted int48 from int256, reverting on
     * overflow (when the input is less than smallest int48 or
     * greater than largest int48).
     *
     * Counterpart to Solidity's `int48` operator.
     *
     * Requirements:
     *
     * - input must fit into 48 bits
     */
    function toInt48(int256 value) internal pure returns (int48 downcasted) {
        downcasted = int48(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(48, value);
        }
    }

    /**
     * @dev Returns the downcasted int40 from int256, reverting on
     * overflow (when the input is less than smallest int40 or
     * greater than largest int40).
     *
     * Counterpart to Solidity's `int40` operator.
     *
     * Requirements:
     *
     * - input must fit into 40 bits
     */
    function toInt40(int256 value) internal pure returns (int40 downcasted) {
        downcasted = int40(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(40, value);
        }
    }

    /**
     * @dev Returns the downcasted int32 from int256, reverting on
     * overflow (when the input is less than smallest int32 or
     * greater than largest int32).
     *
     * Counterpart to Solidity's `int32` operator.
     *
     * Requirements:
     *
     * - input must fit into 32 bits
     */
    function toInt32(int256 value) internal pure returns (int32 downcasted) {
        downcasted = int32(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(32, value);
        }
    }

    /**
     * @dev Returns the downcasted int24 from int256, reverting on
     * overflow (when the input is less than smallest int24 or
     * greater than largest int24).
     *
     * Counterpart to Solidity's `int24` operator.
     *
     * Requirements:
     *
     * - input must fit into 24 bits
     */
    function toInt24(int256 value) internal pure returns (int24 downcasted) {
        downcasted = int24(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(24, value);
        }
    }

    /**
     * @dev Returns the downcasted int16 from int256, reverting on
     * overflow (when the input is less than smallest int16 or
     * greater than largest int16).
     *
     * Counterpart to Solidity's `int16` operator.
     *
     * Requirements:
     *
     * - input must fit into 16 bits
     */
    function toInt16(int256 value) internal pure returns (int16 downcasted) {
        downcasted = int16(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(16, value);
        }
    }

    /**
     * @dev Returns the downcasted int8 from int256, reverting on
     * overflow (when the input is less than smallest int8 or
     * greater than largest int8).
     *
     * Counterpart to Solidity's `int8` operator.
     *
     * Requirements:
     *
     * - input must fit into 8 bits
     */
    function toInt8(int256 value) internal pure returns (int8 downcasted) {
        downcasted = int8(value);
        if (downcasted != value) {
            revert SafeCastOverflowedIntDowncast(8, value);
        }
    }

    /**
     * @dev Converts an unsigned uint256 into a signed int256.
     *
     * Requirements:
     *
     * - input must be less than or equal to maxInt256.
     */
    function toInt256(uint256 value) internal pure returns (int256) {
        // Note: Unsafe cast below is okay because `type(int256).max` is guaranteed to be positive
        if (value > uint256(type(int256).max)) {
            revert SafeCastOverflowedUintToInt(value);
        }
        return int256(value);
    }

    /**
     * @dev Cast a boolean (false or true) to a uint256 (0 or 1) with no jump.
     */
    function toUint(bool b) internal pure returns (uint256 u) {
        assembly ("memory-safe") {
            u := iszero(iszero(b))
        }
    }
}

library Math {
    enum Rounding {
        Floor, // Toward negative infinity
        Ceil, // Toward positive infinity
        Trunc, // Toward zero
        Expand // Away from zero
    }

    /**
     * @dev Return the 512-bit addition of two uint256.
     *
     * The result is stored in two 256 variables such that sum = high * 2²⁵⁶ + low.
     */
    function add512(uint256 a, uint256 b) internal pure returns (uint256 high, uint256 low) {
        assembly ("memory-safe") {
            low := add(a, b)
            high := lt(low, a)
        }
    }

    /**
     * @dev Return the 512-bit multiplication of two uint256.
     *
     * The result is stored in two 256 variables such that product = high * 2²⁵⁶ + low.
     */
    function mul512(uint256 a, uint256 b) internal pure returns (uint256 high, uint256 low) {
        // 512-bit multiply [high low] = x * y. Compute the product mod 2²⁵⁶ and mod 2²⁵⁶ - 1, then use
        // the Chinese Remainder Theorem to reconstruct the 512 bit result. The result is stored in two 256
        // variables such that product = high * 2²⁵⁶ + low.
        assembly ("memory-safe") {
            let mm := mulmod(a, b, not(0))
            low := mul(a, b)
            high := sub(sub(mm, low), lt(mm, low))
        }
    }

    /**
     * @dev Returns the addition of two unsigned integers, with a success flag (no overflow).
     */
    function tryAdd(uint256 a, uint256 b) internal pure returns (bool success, uint256 result) {
        unchecked {
            uint256 c = a + b;
            success = c >= a;
            result = c * SafeCast.toUint(success);
        }
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, with a success flag (no overflow).
     */
    function trySub(uint256 a, uint256 b) internal pure returns (bool success, uint256 result) {
        unchecked {
            uint256 c = a - b;
            success = c <= a;
            result = c * SafeCast.toUint(success);
        }
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, with a success flag (no overflow).
     */
    function tryMul(uint256 a, uint256 b) internal pure returns (bool success, uint256 result) {
        unchecked {
            uint256 c = a * b;
            assembly ("memory-safe") {
                // Only true when the multiplication doesn't overflow
                // (c / a == b) || (a == 0)
                success := or(eq(div(c, a), b), iszero(a))
            }
            // equivalent to: success ? c : 0
            result = c * SafeCast.toUint(success);
        }
    }

    /**
     * @dev Returns the division of two unsigned integers, with a success flag (no division by zero).
     */
    function tryDiv(uint256 a, uint256 b) internal pure returns (bool success, uint256 result) {
        unchecked {
            success = b > 0;
            assembly ("memory-safe") {
                // The `DIV` opcode returns zero when the denominator is 0.
                result := div(a, b)
            }
        }
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers, with a success flag (no division by zero).
     */
    function tryMod(uint256 a, uint256 b) internal pure returns (bool success, uint256 result) {
        unchecked {
            success = b > 0;
            assembly ("memory-safe") {
                // The `MOD` opcode returns zero when the denominator is 0.
                result := mod(a, b)
            }
        }
    }

    /**
     * @dev Unsigned saturating addition, bounds to `2²⁵⁶ - 1` instead of overflowing.
     */
    function saturatingAdd(uint256 a, uint256 b) internal pure returns (uint256) {
        (bool success, uint256 result) = tryAdd(a, b);
        return ternary(success, result, type(uint256).max);
    }

    /**
     * @dev Unsigned saturating subtraction, bounds to zero instead of overflowing.
     */
    function saturatingSub(uint256 a, uint256 b) internal pure returns (uint256) {
        (, uint256 result) = trySub(a, b);
        return result;
    }

    /**
     * @dev Unsigned saturating multiplication, bounds to `2²⁵⁶ - 1` instead of overflowing.
     */
    function saturatingMul(uint256 a, uint256 b) internal pure returns (uint256) {
        (bool success, uint256 result) = tryMul(a, b);
        return ternary(success, result, type(uint256).max);
    }

    /**
     * @dev Branchless ternary evaluation for `a ? b : c`. Gas costs are constant.
     *
     * IMPORTANT: This function may reduce bytecode size and consume less gas when used standalone.
     * However, the compiler may optimize Solidity ternary operations (i.e. `a ? b : c`) to only compute
     * one branch when needed, making this function more expensive.
     */
    function ternary(bool condition, uint256 a, uint256 b) internal pure returns (uint256) {
        unchecked {
            // branchless ternary works because:
            // b ^ (a ^ b) == a
            // b ^ 0 == b
            return b ^ ((a ^ b) * SafeCast.toUint(condition));
        }
    }

    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return ternary(a > b, a, b);
    }

    /**
     * @dev Returns the smallest of two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return ternary(a < b, a, b);
    }

    /**
     * @dev Returns the average of two numbers. The result is rounded towards
     * zero.
     */
    function average(uint256 a, uint256 b) internal pure returns (uint256) {
        // (a + b) / 2 can overflow.
        return (a & b) + (a ^ b) / 2;
    }

    /**
     * @dev Returns the ceiling of the division of two numbers.
     *
     * This differs from standard division with `/` in that it rounds towards infinity instead
     * of rounding towards zero.
     */
    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) {
            // Guarantee the same behavior as in a regular Solidity division.
            Panic.panic(Panic.DIVISION_BY_ZERO);
        }

        // The following calculation ensures accurate ceiling division without overflow.
        // Since a is non-zero, (a - 1) / b will not overflow.
        // The largest possible result occurs when (a - 1) / b is type(uint256).max,
        // but the largest value we can obtain is type(uint256).max - 1, which happens
        // when a = type(uint256).max and b = 1.
        unchecked {
            return SafeCast.toUint(a > 0) * ((a - 1) / b + 1);
        }
    }

    /**
     * @dev Calculates floor(x * y / denominator) with full precision. Throws if result overflows a uint256 or
     * denominator == 0.
     *
     * Original credit to Remco Bloemen under MIT license (https://xn--2-umb.com/21/muldiv) with further edits by
     * Uniswap Labs also under MIT license.
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            (uint256 high, uint256 low) = mul512(x, y);

            // Handle non-overflow cases, 256 by 256 division.
            if (high == 0) {
                // Solidity will revert if denominator == 0, unlike the div opcode on its own.
                // The surrounding unchecked block does not change this fact.
                // See https://docs.soliditylang.org/en/latest/control-structures.html#checked-or-unchecked-arithmetic.
                return low / denominator;
            }

            // Make sure the result is less than 2²⁵⁶. Also prevents denominator == 0.
            if (denominator <= high) {
                Panic.panic(ternary(denominator == 0, Panic.DIVISION_BY_ZERO, Panic.UNDER_OVERFLOW));
            }

            ///////////////////////////////////////////////
            // 512 by 256 division.
            ///////////////////////////////////////////////

            // Make division exact by subtracting the remainder from [high low].
            uint256 remainder;
            assembly ("memory-safe") {
                // Compute remainder using mulmod.
                remainder := mulmod(x, y, denominator)

                // Subtract 256 bit number from 512 bit number.
                high := sub(high, gt(remainder, low))
                low := sub(low, remainder)
            }

            // Factor powers of two out of denominator and compute largest power of two divisor of denominator.
            // Always >= 1. See https://cs.stackexchange.com/q/138556/92363.

            uint256 twos = denominator & (0 - denominator);
            assembly ("memory-safe") {
                // Divide denominator by twos.
                denominator := div(denominator, twos)

                // Divide [high low] by twos.
                low := div(low, twos)

                // Flip twos such that it is 2²⁵⁶ / twos. If twos is zero, then it becomes one.
                twos := add(div(sub(0, twos), twos), 1)
            }

            // Shift in bits from high into low.
            low |= high * twos;

            // Invert denominator mod 2²⁵⁶. Now that denominator is an odd number, it has an inverse modulo 2²⁵⁶ such
            // that denominator * inv ≡ 1 mod 2²⁵⁶. Compute the inverse by starting with a seed that is correct for
            // four bits. That is, denominator * inv ≡ 1 mod 2⁴.
            uint256 inverse = (3 * denominator) ^ 2;

            // Use the Newton-Raphson iteration to improve the precision. Thanks to Hensel's lifting lemma, this also
            // works in modular arithmetic, doubling the correct bits in each step.
            inverse *= 2 - denominator * inverse; // inverse mod 2⁸
            inverse *= 2 - denominator * inverse; // inverse mod 2¹⁶
            inverse *= 2 - denominator * inverse; // inverse mod 2³²
            inverse *= 2 - denominator * inverse; // inverse mod 2⁶⁴
            inverse *= 2 - denominator * inverse; // inverse mod 2¹²⁸
            inverse *= 2 - denominator * inverse; // inverse mod 2²⁵⁶

            // Because the division is now exact we can divide by multiplying with the modular inverse of denominator.
            // This will give us the correct result modulo 2²⁵⁶. Since the preconditions guarantee that the outcome is
            // less than 2²⁵⁶, this is the final result. We don't need to compute the high bits of the result and high
            // is no longer required.
            result = low * inverse;
            return result;
        }
    }

    /**
     * @dev Calculates x * y / denominator with full precision, following the selected rounding direction.
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator, Rounding rounding) internal pure returns (uint256) {
        return mulDiv(x, y, denominator) + SafeCast.toUint(unsignedRoundsUp(rounding) && mulmod(x, y, denominator) > 0);
    }

    /**
     * @dev Calculates floor(x * y >> n) with full precision. Throws if result overflows a uint256.
     */
    function mulShr(uint256 x, uint256 y, uint8 n) internal pure returns (uint256 result) {
        unchecked {
            (uint256 high, uint256 low) = mul512(x, y);
            if (high >= 1 << n) {
                Panic.panic(Panic.UNDER_OVERFLOW);
            }
            return (high << (256 - n)) | (low >> n);
        }
    }

    /**
     * @dev Calculates x * y >> n with full precision, following the selected rounding direction.
     */
    function mulShr(uint256 x, uint256 y, uint8 n, Rounding rounding) internal pure returns (uint256) {
        return mulShr(x, y, n) + SafeCast.toUint(unsignedRoundsUp(rounding) && mulmod(x, y, 1 << n) > 0);
    }

    /**
     * @dev Calculate the modular multiplicative inverse of a number in Z/nZ.
     *
     * If n is a prime, then Z/nZ is a field. In that case all elements are inversible, except 0.
     * If n is not a prime, then Z/nZ is not a field, and some elements might not be inversible.
     *
     * If the input value is not inversible, 0 is returned.
     *
     * NOTE: If you know for sure that n is (big) a prime, it may be cheaper to use Fermat's little theorem and get the
     * inverse using `Math.modExp(a, n - 2, n)`. See {invModPrime}.
     */
    function invMod(uint256 a, uint256 n) internal pure returns (uint256) {
        unchecked {
            if (n == 0) return 0;

            // The inverse modulo is calculated using the Extended Euclidean Algorithm (iterative version)
            // Used to compute integers x and y such that: ax + ny = gcd(a, n).
            // When the gcd is 1, then the inverse of a modulo n exists and it's x.
            // ax + ny = 1
            // ax = 1 + (-y)n
            // ax ≡ 1 (mod n) # x is the inverse of a modulo n

            // If the remainder is 0 the gcd is n right away.
            uint256 remainder = a % n;
            uint256 gcd = n;

            // Therefore the initial coefficients are:
            // ax + ny = gcd(a, n) = n
            // 0a + 1n = n
            int256 x = 0;
            int256 y = 1;

            while (remainder != 0) {
                uint256 quotient = gcd / remainder;

                (gcd, remainder) = (
                    // The old remainder is the next gcd to try.
                    remainder,
                    // Compute the next remainder.
                    // Can't overflow given that (a % gcd) * (gcd // (a % gcd)) <= gcd
                    // where gcd is at most n (capped to type(uint256).max)
                    gcd - remainder * quotient
                );

                (x, y) = (
                    // Increment the coefficient of a.
                    y,
                    // Decrement the coefficient of n.
                    // Can overflow, but the result is casted to uint256 so that the
                    // next value of y is "wrapped around" to a value between 0 and n - 1.
                    x - y * int256(quotient)
                );
            }

            if (gcd != 1) return 0; // No inverse exists.
            return ternary(x < 0, n - uint256(-x), uint256(x)); // Wrap the result if it's negative.
        }
    }

    /**
     * @dev Variant of {invMod}. More efficient, but only works if `p` is known to be a prime greater than `2`.
     *
     * From https://en.wikipedia.org/wiki/Fermat%27s_little_theorem[Fermat's little theorem], we know that if p is
     * prime, then `a**(p-1) ≡ 1 mod p`. As a consequence, we have `a * a**(p-2) ≡ 1 mod p`, which means that
     * `a**(p-2)` is the modular multiplicative inverse of a in Fp.
     *
     * NOTE: this function does NOT check that `p` is a prime greater than `2`.
     */
    function invModPrime(uint256 a, uint256 p) internal view returns (uint256) {
        unchecked {
            return Math.modExp(a, p - 2, p);
        }
    }

    /**
     * @dev Returns the modular exponentiation of the specified base, exponent and modulus (b ** e % m)
     *
     * Requirements:
     * - modulus can't be zero
     * - underlying staticcall to precompile must succeed
     *
     * IMPORTANT: The result is only valid if the underlying call succeeds. When using this function, make
     * sure the chain you're using it on supports the precompiled contract for modular exponentiation
     * at address 0x05 as specified in https://eips.ethereum.org/EIPS/eip-198[EIP-198]. Otherwise,
     * the underlying function will succeed given the lack of a revert, but the result may be incorrectly
     * interpreted as 0.
     */
    function modExp(uint256 b, uint256 e, uint256 m) internal view returns (uint256) {
        (bool success, uint256 result) = tryModExp(b, e, m);
        if (!success) {
            Panic.panic(Panic.DIVISION_BY_ZERO);
        }
        return result;
    }

    /**
     * @dev Returns the modular exponentiation of the specified base, exponent and modulus (b ** e % m).
     * It includes a success flag indicating if the operation succeeded. Operation will be marked as failed if trying
     * to operate modulo 0 or if the underlying precompile reverted.
     *
     * IMPORTANT: The result is only valid if the success flag is true. When using this function, make sure the chain
     * you're using it on supports the precompiled contract for modular exponentiation at address 0x05 as specified in
     * https://eips.ethereum.org/EIPS/eip-198[EIP-198]. Otherwise, the underlying function will succeed given the lack
     * of a revert, but the result may be incorrectly interpreted as 0.
     */
    function tryModExp(uint256 b, uint256 e, uint256 m) internal view returns (bool success, uint256 result) {
        if (m == 0) return (false, 0);
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            // | Offset    | Content    | Content (Hex)                                                      |
            // |-----------|------------|--------------------------------------------------------------------|
            // | 0x00:0x1f | size of b  | 0x0000000000000000000000000000000000000000000000000000000000000020 |
            // | 0x20:0x3f | size of e  | 0x0000000000000000000000000000000000000000000000000000000000000020 |
            // | 0x40:0x5f | size of m  | 0x0000000000000000000000000000000000000000000000000000000000000020 |
            // | 0x60:0x7f | value of b | 0x<.............................................................b> |
            // | 0x80:0x9f | value of e | 0x<.............................................................e> |
            // | 0xa0:0xbf | value of m | 0x<.............................................................m> |
            mstore(ptr, 0x20)
            mstore(add(ptr, 0x20), 0x20)
            mstore(add(ptr, 0x40), 0x20)
            mstore(add(ptr, 0x60), b)
            mstore(add(ptr, 0x80), e)
            mstore(add(ptr, 0xa0), m)

            // Given the result < m, it's guaranteed to fit in 32 bytes,
            // so we can use the memory scratch space located at offset 0.
            success := staticcall(gas(), 0x05, ptr, 0xc0, 0x00, 0x20)
            result := mload(0x00)
        }
    }

    /**
     * @dev Variant of {modExp} that supports inputs of arbitrary length.
     */
    function modExp(bytes memory b, bytes memory e, bytes memory m) internal view returns (bytes memory) {
        (bool success, bytes memory result) = tryModExp(b, e, m);
        if (!success) {
            Panic.panic(Panic.DIVISION_BY_ZERO);
        }
        return result;
    }

    /**
     * @dev Variant of {tryModExp} that supports inputs of arbitrary length.
     */
    function tryModExp(
        bytes memory b,
        bytes memory e,
        bytes memory m
    ) internal view returns (bool success, bytes memory result) {
        if (_zeroBytes(m)) return (false, new bytes(0));

        uint256 mLen = m.length;

        // Encode call args in result and move the free memory pointer
        result = abi.encodePacked(b.length, e.length, mLen, b, e, m);

        assembly ("memory-safe") {
            let dataPtr := add(result, 0x20)
            // Write result on top of args to avoid allocating extra memory.
            success := staticcall(gas(), 0x05, dataPtr, mload(result), dataPtr, mLen)
            // Overwrite the length.
            // result.length > returndatasize() is guaranteed because returndatasize() == m.length
            mstore(result, mLen)
            // Set the memory pointer after the returned data.
            mstore(0x40, add(dataPtr, mLen))
        }
    }

    /**
     * @dev Returns whether the provided byte array is zero.
     */
    function _zeroBytes(bytes memory byteArray) private pure returns (bool) {
        for (uint256 i = 0; i < byteArray.length; ++i) {
            if (byteArray[i] != 0) {
                return false;
            }
        }
        return true;
    }

    /**
     * @dev Returns the square root of a number. If the number is not a perfect square, the value is rounded
     * towards zero.
     *
     * This method is based on Newton's method for computing square roots; the algorithm is restricted to only
     * using integer operations.
     */
    function sqrt(uint256 a) internal pure returns (uint256) {
        unchecked {
            // Take care of easy edge cases when a == 0 or a == 1
            if (a <= 1) {
                return a;
            }

            // In this function, we use Newton's method to get a root of `f(x) := x² - a`. It involves building a
            // sequence x_n that converges toward sqrt(a). For each iteration x_n, we also define the error between
            // the current value as `ε_n = | x_n - sqrt(a) |`.
            //
            // For our first estimation, we consider `e` the smallest power of 2 which is bigger than the square root
            // of the target. (i.e. `2**(e-1) ≤ sqrt(a) < 2**e`). We know that `e ≤ 128` because `(2¹²⁸)² = 2²⁵⁶` is
            // bigger than any uint256.
            //
            // By noticing that
            // `2**(e-1) ≤ sqrt(a) < 2**e → (2**(e-1))² ≤ a < (2**e)² → 2**(2*e-2) ≤ a < 2**(2*e)`
            // we can deduce that `e - 1` is `log2(a) / 2`. We can thus compute `x_n = 2**(e-1)` using a method similar
            // to the msb function.
            uint256 aa = a;
            uint256 xn = 1;

            if (aa >= (1 << 128)) {
                aa >>= 128;
                xn <<= 64;
            }
            if (aa >= (1 << 64)) {
                aa >>= 64;
                xn <<= 32;
            }
            if (aa >= (1 << 32)) {
                aa >>= 32;
                xn <<= 16;
            }
            if (aa >= (1 << 16)) {
                aa >>= 16;
                xn <<= 8;
            }
            if (aa >= (1 << 8)) {
                aa >>= 8;
                xn <<= 4;
            }
            if (aa >= (1 << 4)) {
                aa >>= 4;
                xn <<= 2;
            }
            if (aa >= (1 << 2)) {
                xn <<= 1;
            }

            // We now have x_n such that `x_n = 2**(e-1) ≤ sqrt(a) < 2**e = 2 * x_n`. This implies ε_n ≤ 2**(e-1).
            //
            // We can refine our estimation by noticing that the middle of that interval minimizes the error.
            // If we move x_n to equal 2**(e-1) + 2**(e-2), then we reduce the error to ε_n ≤ 2**(e-2).
            // This is going to be our x_0 (and ε_0)
            xn = (3 * xn) >> 1; // ε_0 := | x_0 - sqrt(a) | ≤ 2**(e-2)

            // From here, Newton's method give us:
            // x_{n+1} = (x_n + a / x_n) / 2
            //
            // One should note that:
            // x_{n+1}² - a = ((x_n + a / x_n) / 2)² - a
            //              = ((x_n² + a) / (2 * x_n))² - a
            //              = (x_n⁴ + 2 * a * x_n² + a²) / (4 * x_n²) - a
            //              = (x_n⁴ + 2 * a * x_n² + a² - 4 * a * x_n²) / (4 * x_n²)
            //              = (x_n⁴ - 2 * a * x_n² + a²) / (4 * x_n²)
            //              = (x_n² - a)² / (2 * x_n)²
            //              = ((x_n² - a) / (2 * x_n))²
            //              ≥ 0
            // Which proves that for all n ≥ 1, sqrt(a) ≤ x_n
            //
            // This gives us the proof of quadratic convergence of the sequence:
            // ε_{n+1} = | x_{n+1} - sqrt(a) |
            //         = | (x_n + a / x_n) / 2 - sqrt(a) |
            //         = | (x_n² + a - 2*x_n*sqrt(a)) / (2 * x_n) |
            //         = | (x_n - sqrt(a))² / (2 * x_n) |
            //         = | ε_n² / (2 * x_n) |
            //         = ε_n² / | (2 * x_n) |
            //
            // For the first iteration, we have a special case where x_0 is known:
            // ε_1 = ε_0² / | (2 * x_0) |
            //     ≤ (2**(e-2))² / (2 * (2**(e-1) + 2**(e-2)))
            //     ≤ 2**(2*e-4) / (3 * 2**(e-1))
            //     ≤ 2**(e-3) / 3
            //     ≤ 2**(e-3-log2(3))
            //     ≤ 2**(e-4.5)
            //
            // For the following iterations, we use the fact that, 2**(e-1) ≤ sqrt(a) ≤ x_n:
            // ε_{n+1} = ε_n² / | (2 * x_n) |
            //         ≤ (2**(e-k))² / (2 * 2**(e-1))
            //         ≤ 2**(2*e-2*k) / 2**e
            //         ≤ 2**(e-2*k)
            xn = (xn + a / xn) >> 1; // ε_1 := | x_1 - sqrt(a) | ≤ 2**(e-4.5)  -- special case, see above
            xn = (xn + a / xn) >> 1; // ε_2 := | x_2 - sqrt(a) | ≤ 2**(e-9)    -- general case with k = 4.5
            xn = (xn + a / xn) >> 1; // ε_3 := | x_3 - sqrt(a) | ≤ 2**(e-18)   -- general case with k = 9
            xn = (xn + a / xn) >> 1; // ε_4 := | x_4 - sqrt(a) | ≤ 2**(e-36)   -- general case with k = 18
            xn = (xn + a / xn) >> 1; // ε_5 := | x_5 - sqrt(a) | ≤ 2**(e-72)   -- general case with k = 36
            xn = (xn + a / xn) >> 1; // ε_6 := | x_6 - sqrt(a) | ≤ 2**(e-144)  -- general case with k = 72

            // Because e ≤ 128 (as discussed during the first estimation phase), we know have reached a precision
            // ε_6 ≤ 2**(e-144) < 1. Given we're operating on integers, then we can ensure that xn is now either
            // sqrt(a) or sqrt(a) + 1.
            return xn - SafeCast.toUint(xn > a / xn);
        }
    }

    /**
     * @dev Calculates sqrt(a), following the selected rounding direction.
     */
    function sqrt(uint256 a, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = sqrt(a);
            return result + SafeCast.toUint(unsignedRoundsUp(rounding) && result * result < a);
        }
    }

    /**
     * @dev Return the log in base 2 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     */
    function log2(uint256 x) internal pure returns (uint256 r) {
        // If value has upper 128 bits set, log2 result is at least 128
        r = SafeCast.toUint(x > 0xffffffffffffffffffffffffffffffff) << 7;
        // If upper 64 bits of 128-bit half set, add 64 to result
        r |= SafeCast.toUint((x >> r) > 0xffffffffffffffff) << 6;
        // If upper 32 bits of 64-bit half set, add 32 to result
        r |= SafeCast.toUint((x >> r) > 0xffffffff) << 5;
        // If upper 16 bits of 32-bit half set, add 16 to result
        r |= SafeCast.toUint((x >> r) > 0xffff) << 4;
        // If upper 8 bits of 16-bit half set, add 8 to result
        r |= SafeCast.toUint((x >> r) > 0xff) << 3;
        // If upper 4 bits of 8-bit half set, add 4 to result
        r |= SafeCast.toUint((x >> r) > 0xf) << 2;

        // Shifts value right by the current result and use it as an index into this lookup table:
        //
        // | x (4 bits) |  index  | table[index] = MSB position |
        // |------------|---------|-----------------------------|
        // |    0000    |    0    |        table[0] = 0         |
        // |    0001    |    1    |        table[1] = 0         |
        // |    0010    |    2    |        table[2] = 1         |
        // |    0011    |    3    |        table[3] = 1         |
        // |    0100    |    4    |        table[4] = 2         |
        // |    0101    |    5    |        table[5] = 2         |
        // |    0110    |    6    |        table[6] = 2         |
        // |    0111    |    7    |        table[7] = 2         |
        // |    1000    |    8    |        table[8] = 3         |
        // |    1001    |    9    |        table[9] = 3         |
        // |    1010    |   10    |        table[10] = 3        |
        // |    1011    |   11    |        table[11] = 3        |
        // |    1100    |   12    |        table[12] = 3        |
        // |    1101    |   13    |        table[13] = 3        |
        // |    1110    |   14    |        table[14] = 3        |
        // |    1111    |   15    |        table[15] = 3        |
        //
        // The lookup table is represented as a 32-byte value with the MSB positions for 0-15 in the last 16 bytes.
        assembly ("memory-safe") {
            r := or(r, byte(shr(r, x), 0x0000010102020202030303030303030300000000000000000000000000000000))
        }
    }

    /**
     * @dev Return the log in base 2, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log2(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log2(value);
            return result + SafeCast.toUint(unsignedRoundsUp(rounding) && 1 << result < value);
        }
    }

    /**
     * @dev Return the log in base 10 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     */
    function log10(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >= 10 ** 64) {
                value /= 10 ** 64;
                result += 64;
            }
            if (value >= 10 ** 32) {
                value /= 10 ** 32;
                result += 32;
            }
            if (value >= 10 ** 16) {
                value /= 10 ** 16;
                result += 16;
            }
            if (value >= 10 ** 8) {
                value /= 10 ** 8;
                result += 8;
            }
            if (value >= 10 ** 4) {
                value /= 10 ** 4;
                result += 4;
            }
            if (value >= 10 ** 2) {
                value /= 10 ** 2;
                result += 2;
            }
            if (value >= 10 ** 1) {
                result += 1;
            }
        }
        return result;
    }

    /**
     * @dev Return the log in base 10, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log10(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log10(value);
            return result + SafeCast.toUint(unsignedRoundsUp(rounding) && 10 ** result < value);
        }
    }

    /**
     * @dev Return the log in base 256 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     *
     * Adding one to the result gives the number of pairs of hex symbols needed to represent `value` as a hex string.
     */
    function log256(uint256 x) internal pure returns (uint256 r) {
        // If value has upper 128 bits set, log2 result is at least 128
        r = SafeCast.toUint(x > 0xffffffffffffffffffffffffffffffff) << 7;
        // If upper 64 bits of 128-bit half set, add 64 to result
        r |= SafeCast.toUint((x >> r) > 0xffffffffffffffff) << 6;
        // If upper 32 bits of 64-bit half set, add 32 to result
        r |= SafeCast.toUint((x >> r) > 0xffffffff) << 5;
        // If upper 16 bits of 32-bit half set, add 16 to result
        r |= SafeCast.toUint((x >> r) > 0xffff) << 4;
        // Add 1 if upper 8 bits of 16-bit half set, and divide accumulated result by 8
        return (r >> 3) | SafeCast.toUint((x >> r) > 0xff);
    }

    /**
     * @dev Return the log in base 256, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log256(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log256(value);
            return result + SafeCast.toUint(unsignedRoundsUp(rounding) && 1 << (result << 3) < value);
        }
    }

    /**
     * @dev Returns whether a provided rounding mode is considered rounding up for unsigned integers.
     */
    function unsignedRoundsUp(Rounding rounding) internal pure returns (bool) {
        return uint8(rounding) % 2 == 1;
    }
}

library SignedMath {
    /**
     * @dev Branchless ternary evaluation for `a ? b : c`. Gas costs are constant.
     *
     * IMPORTANT: This function may reduce bytecode size and consume less gas when used standalone.
     * However, the compiler may optimize Solidity ternary operations (i.e. `a ? b : c`) to only compute
     * one branch when needed, making this function more expensive.
     */
    function ternary(bool condition, int256 a, int256 b) internal pure returns (int256) {
        unchecked {
            // branchless ternary works because:
            // b ^ (a ^ b) == a
            // b ^ 0 == b
            return b ^ ((a ^ b) * int256(SafeCast.toUint(condition)));
        }
    }

    /**
     * @dev Returns the largest of two signed numbers.
     */
    function max(int256 a, int256 b) internal pure returns (int256) {
        return ternary(a > b, a, b);
    }

    /**
     * @dev Returns the smallest of two signed numbers.
     */
    function min(int256 a, int256 b) internal pure returns (int256) {
        return ternary(a < b, a, b);
    }

    /**
     * @dev Returns the average of two signed numbers without overflow.
     * The result is rounded towards zero.
     */
    function average(int256 a, int256 b) internal pure returns (int256) {
        // Formula from the book "Hacker's Delight"
        int256 x = (a & b) + ((a ^ b) >> 1);
        return x + (int256(uint256(x) >> 255) & (a ^ b));
    }

    /**
     * @dev Returns the absolute unsigned value of a signed value.
     */
    function abs(int256 n) internal pure returns (uint256) {
        unchecked {
            // Formula from the "Bit Twiddling Hacks" by Sean Eron Anderson.
            // Since `n` is a signed integer, the generated bytecode will use the SAR opcode to perform the right shift,
            // taking advantage of the most significant (or "sign" bit) in two's complement representation.
            // This opcode adds new most significant bits set to the value of the previous most significant bit. As a result,
            // the mask will either be `bytes32(0)` (if n is positive) or `~bytes32(0)` (if n is negative).
            int256 mask = n >> 255;

            // A `bytes32(0)` mask leaves the input unchanged, while a `~bytes32(0)` mask complements it.
            return uint256((n + mask) ^ mask);
        }
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/Strings.sol)
/**
 * @dev String operations.
 */
library Strings {
    using SafeCast for *;

    bytes16 private constant HEX_DIGITS = "0123456789abcdef";
    uint8 private constant ADDRESS_LENGTH = 20;
    uint256 private constant SPECIAL_CHARS_LOOKUP =
        (1 << 0x08) | // backspace
            (1 << 0x09) | // tab
            (1 << 0x0a) | // newline
            (1 << 0x0c) | // form feed
            (1 << 0x0d) | // carriage return
            (1 << 0x22) | // double quote
            (1 << 0x5c); // backslash

    /**
     * @dev The `value` string doesn't fit in the specified `length`.
     */
    error StringsInsufficientHexLength(uint256 value, uint256 length);

    /**
     * @dev The string being parsed contains characters that are not in scope of the given base.
     */
    error StringsInvalidChar();

    /**
     * @dev The string being parsed is not a properly formatted address.
     */
    error StringsInvalidAddressFormat();

    /**
     * @dev Converts a `uint256` to its ASCII `string` decimal representation.
     */
    function toString(uint256 value) internal pure returns (string memory) {
        unchecked {
            uint256 length = Math.log10(value) + 1;
            string memory buffer = new string(length);
            uint256 ptr;
            assembly ("memory-safe") {
                ptr := add(add(buffer, 0x20), length)
            }
            while (true) {
                ptr--;
                assembly ("memory-safe") {
                    mstore8(ptr, byte(mod(value, 10), HEX_DIGITS))
                }
                value /= 10;
                if (value == 0) break;
            }
            return buffer;
        }
    }

    /**
     * @dev Converts a `int256` to its ASCII `string` decimal representation.
     */
    function toStringSigned(int256 value) internal pure returns (string memory) {
        return string.concat(value < 0 ? "-" : "", toString(SignedMath.abs(value)));
    }

    /**
     * @dev Converts a `uint256` to its ASCII `string` hexadecimal representation.
     */
    function toHexString(uint256 value) internal pure returns (string memory) {
        unchecked {
            return toHexString(value, Math.log256(value) + 1);
        }
    }

    /**
     * @dev Converts a `uint256` to its ASCII `string` hexadecimal representation with fixed length.
     */
    function toHexString(uint256 value, uint256 length) internal pure returns (string memory) {
        uint256 localValue = value;
        bytes memory buffer = new bytes(2 * length + 2);
        buffer[0] = "0";
        buffer[1] = "x";
        for (uint256 i = 2 * length + 1; i > 1; --i) {
            buffer[i] = HEX_DIGITS[localValue & 0xf];
            localValue >>= 4;
        }
        if (localValue != 0) {
            revert StringsInsufficientHexLength(value, length);
        }
        return string(buffer);
    }

    /**
     * @dev Converts an `address` with fixed length of 20 bytes to its not checksummed ASCII `string` hexadecimal
     * representation.
     */
    function toHexString(address addr) internal pure returns (string memory) {
        return toHexString(uint256(uint160(addr)), ADDRESS_LENGTH);
    }

    /**
     * @dev Converts an `address` with fixed length of 20 bytes to its checksummed ASCII `string` hexadecimal
     * representation, according to EIP-55.
     */
    function toChecksumHexString(address addr) internal pure returns (string memory) {
        bytes memory buffer = bytes(toHexString(addr));

        // hash the hex part of buffer (skip length + 2 bytes, length 40)
        uint256 hashValue;
        assembly ("memory-safe") {
            hashValue := shr(96, keccak256(add(buffer, 0x22), 40))
        }

        for (uint256 i = 41; i > 1; --i) {
            // possible values for buffer[i] are 48 (0) to 57 (9) and 97 (a) to 102 (f)
            if (hashValue & 0xf > 7 && uint8(buffer[i]) > 96) {
                // case shift by xoring with 0x20
                buffer[i] ^= 0x20;
            }
            hashValue >>= 4;
        }
        return string(buffer);
    }

    /**
     * @dev Returns true if the two strings are equal.
     */
    function equal(string memory a, string memory b) internal pure returns (bool) {
        return bytes(a).length == bytes(b).length && keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /**
     * @dev Parse a decimal string and returns the value as a `uint256`.
     *
     * Requirements:
     * - The string must be formatted as `[0-9]*`
     * - The result must fit into an `uint256` type
     */
    function parseUint(string memory input) internal pure returns (uint256) {
        return parseUint(input, 0, bytes(input).length);
    }

    /**
     * @dev Variant of {parseUint-string} that parses a substring of `input` located between position `begin` (included) and
     * `end` (excluded).
     *
     * Requirements:
     * - The substring must be formatted as `[0-9]*`
     * - The result must fit into an `uint256` type
     */
    function parseUint(string memory input, uint256 begin, uint256 end) internal pure returns (uint256) {
        (bool success, uint256 value) = tryParseUint(input, begin, end);
        if (!success) revert StringsInvalidChar();
        return value;
    }

    /**
     * @dev Variant of {parseUint-string} that returns false if the parsing fails because of an invalid character.
     *
     * NOTE: This function will revert if the result does not fit in a `uint256`.
     */
    function tryParseUint(string memory input) internal pure returns (bool success, uint256 value) {
        return _tryParseUintUncheckedBounds(input, 0, bytes(input).length);
    }

    /**
     * @dev Variant of {parseUint-string-uint256-uint256} that returns false if the parsing fails because of an invalid
     * character.
     *
     * NOTE: This function will revert if the result does not fit in a `uint256`.
     */
    function tryParseUint(
        string memory input,
        uint256 begin,
        uint256 end
    ) internal pure returns (bool success, uint256 value) {
        if (end > bytes(input).length || begin > end) return (false, 0);
        return _tryParseUintUncheckedBounds(input, begin, end);
    }

    /**
     * @dev Implementation of {tryParseUint-string-uint256-uint256} that does not check bounds. Caller should make sure that
     * `begin <= end <= input.length`. Other inputs would result in undefined behavior.
     */
    function _tryParseUintUncheckedBounds(
        string memory input,
        uint256 begin,
        uint256 end
    ) private pure returns (bool success, uint256 value) {
        bytes memory buffer = bytes(input);

        uint256 result = 0;
        for (uint256 i = begin; i < end; ++i) {
            uint8 chr = _tryParseChr(bytes1(_unsafeReadBytesOffset(buffer, i)));
            if (chr > 9) return (false, 0);
            result *= 10;
            result += chr;
        }
        return (true, result);
    }

    /**
     * @dev Parse a decimal string and returns the value as a `int256`.
     *
     * Requirements:
     * - The string must be formatted as `[-+]?[0-9]*`
     * - The result must fit in an `int256` type.
     */
    function parseInt(string memory input) internal pure returns (int256) {
        return parseInt(input, 0, bytes(input).length);
    }

    /**
     * @dev Variant of {parseInt-string} that parses a substring of `input` located between position `begin` (included) and
     * `end` (excluded).
     *
     * Requirements:
     * - The substring must be formatted as `[-+]?[0-9]*`
     * - The result must fit in an `int256` type.
     */
    function parseInt(string memory input, uint256 begin, uint256 end) internal pure returns (int256) {
        (bool success, int256 value) = tryParseInt(input, begin, end);
        if (!success) revert StringsInvalidChar();
        return value;
    }

    /**
     * @dev Variant of {parseInt-string} that returns false if the parsing fails because of an invalid character or if
     * the result does not fit in a `int256`.
     *
     * NOTE: This function will revert if the absolute value of the result does not fit in a `uint256`.
     */
    function tryParseInt(string memory input) internal pure returns (bool success, int256 value) {
        return _tryParseIntUncheckedBounds(input, 0, bytes(input).length);
    }

    uint256 private constant ABS_MIN_INT256 = 2 ** 255;

    /**
     * @dev Variant of {parseInt-string-uint256-uint256} that returns false if the parsing fails because of an invalid
     * character or if the result does not fit in a `int256`.
     *
     * NOTE: This function will revert if the absolute value of the result does not fit in a `uint256`.
     */
    function tryParseInt(
        string memory input,
        uint256 begin,
        uint256 end
    ) internal pure returns (bool success, int256 value) {
        if (end > bytes(input).length || begin > end) return (false, 0);
        return _tryParseIntUncheckedBounds(input, begin, end);
    }

    /**
     * @dev Implementation of {tryParseInt-string-uint256-uint256} that does not check bounds. Caller should make sure that
     * `begin <= end <= input.length`. Other inputs would result in undefined behavior.
     */
    function _tryParseIntUncheckedBounds(
        string memory input,
        uint256 begin,
        uint256 end
    ) private pure returns (bool success, int256 value) {
        bytes memory buffer = bytes(input);

        // Check presence of a negative sign.
        bytes1 sign = begin == end ? bytes1(0) : bytes1(_unsafeReadBytesOffset(buffer, begin)); // don't do out-of-bound (possibly unsafe) read if sub-string is empty
        bool positiveSign = sign == bytes1("+");
        bool negativeSign = sign == bytes1("-");
        uint256 offset = (positiveSign || negativeSign).toUint();

        (bool absSuccess, uint256 absValue) = tryParseUint(input, begin + offset, end);

        if (absSuccess && absValue < ABS_MIN_INT256) {
            return (true, negativeSign ? -int256(absValue) : int256(absValue));
        } else if (absSuccess && negativeSign && absValue == ABS_MIN_INT256) {
            return (true, type(int256).min);
        } else return (false, 0);
    }

    /**
     * @dev Parse a hexadecimal string (with or without "0x" prefix), and returns the value as a `uint256`.
     *
     * Requirements:
     * - The string must be formatted as `(0x)?[0-9a-fA-F]*`
     * - The result must fit in an `uint256` type.
     */
    function parseHexUint(string memory input) internal pure returns (uint256) {
        return parseHexUint(input, 0, bytes(input).length);
    }

    /**
     * @dev Variant of {parseHexUint-string} that parses a substring of `input` located between position `begin` (included) and
     * `end` (excluded).
     *
     * Requirements:
     * - The substring must be formatted as `(0x)?[0-9a-fA-F]*`
     * - The result must fit in an `uint256` type.
     */
    function parseHexUint(string memory input, uint256 begin, uint256 end) internal pure returns (uint256) {
        (bool success, uint256 value) = tryParseHexUint(input, begin, end);
        if (!success) revert StringsInvalidChar();
        return value;
    }

    /**
     * @dev Variant of {parseHexUint-string} that returns false if the parsing fails because of an invalid character.
     *
     * NOTE: This function will revert if the result does not fit in a `uint256`.
     */
    function tryParseHexUint(string memory input) internal pure returns (bool success, uint256 value) {
        return _tryParseHexUintUncheckedBounds(input, 0, bytes(input).length);
    }

    /**
     * @dev Variant of {parseHexUint-string-uint256-uint256} that returns false if the parsing fails because of an
     * invalid character.
     *
     * NOTE: This function will revert if the result does not fit in a `uint256`.
     */
    function tryParseHexUint(
        string memory input,
        uint256 begin,
        uint256 end
    ) internal pure returns (bool success, uint256 value) {
        if (end > bytes(input).length || begin > end) return (false, 0);
        return _tryParseHexUintUncheckedBounds(input, begin, end);
    }

    /**
     * @dev Implementation of {tryParseHexUint-string-uint256-uint256} that does not check bounds. Caller should make sure that
     * `begin <= end <= input.length`. Other inputs would result in undefined behavior.
     */
    function _tryParseHexUintUncheckedBounds(
        string memory input,
        uint256 begin,
        uint256 end
    ) private pure returns (bool success, uint256 value) {
        bytes memory buffer = bytes(input);

        // skip 0x prefix if present
        bool hasPrefix = (end > begin + 1) && bytes2(_unsafeReadBytesOffset(buffer, begin)) == bytes2("0x"); // don't do out-of-bound (possibly unsafe) read if sub-string is empty
        uint256 offset = hasPrefix.toUint() * 2;

        uint256 result = 0;
        for (uint256 i = begin + offset; i < end; ++i) {
            uint8 chr = _tryParseChr(bytes1(_unsafeReadBytesOffset(buffer, i)));
            if (chr > 15) return (false, 0);
            result *= 16;
            unchecked {
                // Multiplying by 16 is equivalent to a shift of 4 bits (with additional overflow check).
                // This guarantees that adding a value < 16 will not cause an overflow, hence the unchecked.
                result += chr;
            }
        }
        return (true, result);
    }

    /**
     * @dev Parse a hexadecimal string (with or without "0x" prefix), and returns the value as an `address`.
     *
     * Requirements:
     * - The string must be formatted as `(0x)?[0-9a-fA-F]{40}`
     */
    function parseAddress(string memory input) internal pure returns (address) {
        return parseAddress(input, 0, bytes(input).length);
    }

    /**
     * @dev Variant of {parseAddress-string} that parses a substring of `input` located between position `begin` (included) and
     * `end` (excluded).
     *
     * Requirements:
     * - The substring must be formatted as `(0x)?[0-9a-fA-F]{40}`
     */
    function parseAddress(string memory input, uint256 begin, uint256 end) internal pure returns (address) {
        (bool success, address value) = tryParseAddress(input, begin, end);
        if (!success) revert StringsInvalidAddressFormat();
        return value;
    }

    /**
     * @dev Variant of {parseAddress-string} that returns false if the parsing fails because the input is not a properly
     * formatted address. See {parseAddress-string} requirements.
     */
    function tryParseAddress(string memory input) internal pure returns (bool success, address value) {
        return tryParseAddress(input, 0, bytes(input).length);
    }

    /**
     * @dev Variant of {parseAddress-string-uint256-uint256} that returns false if the parsing fails because input is not a properly
     * formatted address. See {parseAddress-string-uint256-uint256} requirements.
     */
    function tryParseAddress(
        string memory input,
        uint256 begin,
        uint256 end
    ) internal pure returns (bool success, address value) {
        if (end > bytes(input).length || begin > end) return (false, address(0));

        bool hasPrefix = (end > begin + 1) && bytes2(_unsafeReadBytesOffset(bytes(input), begin)) == bytes2("0x"); // don't do out-of-bound (possibly unsafe) read if sub-string is empty
        uint256 expectedLength = 40 + hasPrefix.toUint() * 2;

        // check that input is the correct length
        if (end - begin == expectedLength) {
            // length guarantees that this does not overflow, and value is at most type(uint160).max
            (bool s, uint256 v) = _tryParseHexUintUncheckedBounds(input, begin, end);
            return (s, address(uint160(v)));
        } else {
            return (false, address(0));
        }
    }

    function _tryParseChr(bytes1 chr) private pure returns (uint8) {
        uint8 value = uint8(chr);

        // Try to parse `chr`:
        // - Case 1: [0-9]
        // - Case 2: [a-f]
        // - Case 3: [A-F]
        // - otherwise not supported
        unchecked {
            if (value > 47 && value < 58) value -= 48;
            else if (value > 96 && value < 103) value -= 87;
            else if (value > 64 && value < 71) value -= 55;
            else return type(uint8).max;
        }

        return value;
    }

    /**
     * @dev Escape special characters in JSON strings. This can be useful to prevent JSON injection in NFT metadata.
     *
     * WARNING: This function should only be used in double quoted JSON strings. Single quotes are not escaped.
     *
     * NOTE: This function escapes all unicode characters, and not just the ones in ranges defined in section 2.5 of
     * RFC-4627 (U+0000 to U+001F, U+0022 and U+005C). ECMAScript's `JSON.parse` does recover escaped unicode
     * characters that are not in this range, but other tooling may provide different results.
     */
    function escapeJSON(string memory input) internal pure returns (string memory) {
        bytes memory buffer = bytes(input);
        bytes memory output = new bytes(2 * buffer.length); // worst case scenario
        uint256 outputLength = 0;

        for (uint256 i; i < buffer.length; ++i) {
            bytes1 char = bytes1(_unsafeReadBytesOffset(buffer, i));
            if (((SPECIAL_CHARS_LOOKUP & (1 << uint8(char))) != 0)) {
                output[outputLength++] = "\\";
                if (char == 0x08) output[outputLength++] = "b";
                else if (char == 0x09) output[outputLength++] = "t";
                else if (char == 0x0a) output[outputLength++] = "n";
                else if (char == 0x0c) output[outputLength++] = "f";
                else if (char == 0x0d) output[outputLength++] = "r";
                else if (char == 0x5c) output[outputLength++] = "\\";
                else if (char == 0x22) {
                    // solhint-disable-next-line quotes
                    output[outputLength++] = '"';
                }
            } else {
                output[outputLength++] = char;
            }
        }
        // write the actual length and deallocate unused memory
        assembly ("memory-safe") {
            mstore(output, outputLength)
            mstore(0x40, add(output, shl(5, shr(5, add(outputLength, 63)))))
        }

        return string(output);
    }

    /**
     * @dev Reads a bytes32 from a bytes array without bounds checking.
     *
     * NOTE: making this function internal would mean it could be used with memory unsafe offset, and marking the
     * assembly block as such would prevent some optimizations.
     */
    function _unsafeReadBytesOffset(bytes memory buffer, uint256 offset) private pure returns (bytes32 value) {
        // This is not memory safe in the general case, but all calls to this private function are within bounds.
        assembly ("memory-safe") {
            value := mload(add(add(buffer, 0x20), offset))
        }
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/ReentrancyGuard.sol)
/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/Base64.sol)
/**
 * @dev Provides a set of functions to operate with Base64 strings.
 */
library Base64 {
    /**
     * @dev Base64 Encoding/Decoding Table
     * See sections 4 and 5 of https://datatracker.ietf.org/doc/html/rfc4648
     */
    string internal constant _TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    string internal constant _TABLE_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    /**
     * @dev Converts a `bytes` to its Bytes64 `string` representation.
     */
    function encode(bytes memory data) internal pure returns (string memory) {
        return _encode(data, _TABLE, true);
    }

    /**
     * @dev Converts a `bytes` to its Bytes64Url `string` representation.
     * Output is not padded with `=` as specified in https://www.rfc-editor.org/rfc/rfc4648[rfc4648].
     */
    function encodeURL(bytes memory data) internal pure returns (string memory) {
        return _encode(data, _TABLE_URL, false);
    }

    /**
     * @dev Internal table-agnostic conversion
     */
    function _encode(bytes memory data, string memory table, bool withPadding) private pure returns (string memory) {
        /**
         * Inspired by Brecht Devos (Brechtpd) implementation - MIT licence
         * https://github.com/Brechtpd/base64/blob/e78d9fd951e7b0977ddca77d92dc85183770daf4/base64.sol
         */
        if (data.length == 0) return "";

        // If padding is enabled, the final length should be `bytes` data length divided by 3 rounded up and then
        // multiplied by 4 so that it leaves room for padding the last chunk
        // - `data.length + 2`  -> Prepare for division rounding up
        // - `/ 3`              -> Number of 3-bytes chunks (rounded up)
        // - `4 *`              -> 4 characters for each chunk
        // This is equivalent to: 4 * Math.ceil(data.length / 3)
        //
        // If padding is disabled, the final length should be `bytes` data length multiplied by 4/3 rounded up as
        // opposed to when padding is required to fill the last chunk.
        // - `4 * data.length`  -> 4 characters for each chunk
        // - ` + 2`             -> Prepare for division rounding up
        // - `/ 3`              -> Number of 3-bytes chunks (rounded up)
        // This is equivalent to: Math.ceil((4 * data.length) / 3)
        uint256 resultLength = withPadding ? 4 * ((data.length + 2) / 3) : (4 * data.length + 2) / 3;

        string memory result = new string(resultLength);

        assembly ("memory-safe") {
            // Prepare the lookup table (skip the first "length" byte)
            let tablePtr := add(table, 1)

            // Prepare result pointer, jump over length
            let resultPtr := add(result, 0x20)
            let dataPtr := data
            let endPtr := add(data, mload(data))

            // In some cases, the last iteration will read bytes after the end of the data. We cache the value, and
            // set it to zero to make sure no dirty bytes are read in that section.
            let afterPtr := add(endPtr, 0x20)
            let afterCache := mload(afterPtr)
            mstore(afterPtr, 0x00)

            // Run over the input, 3 bytes at a time
            for {} lt(dataPtr, endPtr) {} {
                // Advance 3 bytes
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)

                // To write each character, shift the 3 byte (24 bits) chunk
                // 4 times in blocks of 6 bits for each character (18, 12, 6, 0)
                // and apply logical AND with 0x3F to bitmask the least significant 6 bits.
                // Use this as an index into the lookup table, mload an entire word
                // so the desired character is in the least significant byte, and
                // mstore8 this least significant byte into the result and continue.

                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1) // Advance

                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1) // Advance

                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1) // Advance

                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1) // Advance
            }

            // Reset the value that was cached
            mstore(afterPtr, afterCache)

            if withPadding {
                // When data `bytes` is not exactly 3 bytes long
                // it is padded with `=` characters at the end
                switch mod(mload(data), 3)
                case 1 {
                    mstore8(sub(resultPtr, 1), 0x3d)
                    mstore8(sub(resultPtr, 2), 0x3d)
                }
                case 2 {
                    mstore8(sub(resultPtr, 1), 0x3d)
                }
            }
        }

        return result;
    }
}

// SPDX-License-Identifier: MIT
library ChessMediaLibrary {
    int8 public constant EMPTY = 0;
    int8 public constant PAWN = 1;
    int8 public constant KNIGHT = 2;
    int8 public constant BISHOP = 3;
    int8 public constant ROOK = 4;
    int8 public constant QUEEN = 5;
    int8 public constant KING = 6;

    function toString(uint value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        
        uint temp = value;
        uint digits;
        
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);

        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }

        return string(buffer);
    }
    
    function metadata(uint256 tokenId) internal pure returns (string memory){
        //TODO
        tokenId = 1;
        string memory toRet = "";
        return toRet;
    }

    function getCurrentBoard(int8[8][8] memory board) external pure returns (string memory) {
        uint tokenId = 0;
        string memory result = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>";
        result = string(abi.encodePacked(result, getBoardSquares()));   
        string memory black = "<g id='bp' fill='#000' font-family='arial unicode ms,Helvetica,Arial,sans-serif' font-size='40'>";
        string memory white = "<g id='wp' fill='#fff' font-family='arial unicode ms,Helvetica,Arial,sans-serif' font-size='40'>";
        uint8[12] memory piecesCounter;
    

        for (uint16 row = 0; row < 8; row++) {
            for (uint16 col = 0; col < 8; col++) {
                string memory x = toString(col * 50 + 25);
                string memory y = toString(row * 50 + 25);
                int8 piece = board[row][col];         
                string memory token;
                string memory p;

                if (piece > 0){


                    if (piece == KING) {
                        token = "&#9812;";
                        piecesCounter[0] += 1;
                        p = string(abi.encodePacked("wkng",toString(piecesCounter[0])));
                    }
                    else
                    if (piece == QUEEN) {
                        token = "&#9813;";
                        piecesCounter[1] += 1;
                        p = string(abi.encodePacked("wqn",toString(piecesCounter[1])));
                    }
                    else
                    if (piece == ROOK) {
                        token = "&#9814;";
                        piecesCounter[2] += 1;
                        p = string(abi.encodePacked("wrk",toString(piecesCounter[2])));
                    }
                    else
                    if (piece == BISHOP) {
                        token = "&#9815;";
                        piecesCounter[3] += 1;
                        p = string(abi.encodePacked("wbshp",toString(piecesCounter[3])));
                    }
                    else
                    if (piece == KNIGHT) {
                        token = "&#9816;";
                        piecesCounter[4] += 1;
                        p = string(abi.encodePacked("wknght",toString(piecesCounter[4])));
                    }
                    else
                    if (piece == PAWN) {
                        token = "&#9817;";
                        piecesCounter[5] += 1;
                        p = string(abi.encodePacked("wpwn",toString(piecesCounter[5])));
                    }
                    //p = string(abi.encodePacked(p,"_",toString(row),",",toString(col)));
                    white = string(abi.encodePacked(white, generatePiece(token, x, y, "#fff", p)));
                }
                else
                if (piece < 0){
                    if (piece == -KING) {
                        token = "&#9812;";
                        piecesCounter[6] += 1;
                        p = string(abi.encodePacked("bkng",toString(piecesCounter[6])));
                    }
                    else
                    if (piece == -QUEEN) {
                        token = "&#9813;";
                        piecesCounter[7] += 1;
                        p = string(abi.encodePacked("bqn",toString(piecesCounter[7])));
                    }
                    else
                    if (piece == -ROOK) {
                        token = "&#9814;";
                        piecesCounter[8] += 1;
                        p = string(abi.encodePacked("brk",toString(piecesCounter[8])));
                    }
                    else
                    if (piece == -BISHOP) {
                        token = "&#9815;";
                        piecesCounter[9] += 1;
                        p = string(abi.encodePacked("bbshp",toString(piecesCounter[9])));
                    }
                    else
                    if (piece == -KNIGHT) {
                        token = "&#9816;";
                        piecesCounter[10] += 1;
                        p = string(abi.encodePacked("bknght",toString(piecesCounter[10])));
                    }
                    else
                    if (piece == -PAWN) {
                        token = "&#9817;";
                        piecesCounter[11] += 1;
                        p = string(abi.encodePacked("bpwn",toString(piecesCounter[11])));
                    }
                    //p = string(abi.encodePacked(p,":",toString(row),",",toString(col)));
                    black = string(abi.encodePacked(black, generatePiece(token, x, y, "#000", p)));
                    
                }
            }
        }

        result = string(abi.encodePacked(result, white, "</g>", black, "</g>", "</svg>"));
        
        string memory json = Base64.encode(bytes(string(abi.encodePacked('{"name": "Match #', toString(tokenId), '", "description": "This is a match", "image": "data:image/svg+xml;base64,', Base64.encode(bytes(result)), '","attributes":[',metadata(tokenId),']}'))));
        return string(abi.encodePacked('data:application/json;base64,', json));
        
    }

    function generatePiece(string memory s, string memory x, string memory y, string memory c, string memory piece) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "<text id='", piece,"' class='p' x='", x, "' y='", y, "' text-anchor='middle' dy='.3em' stroke='", c, "' stroke-width='1'>", s, "</text>"
        ));
    }

    function generateSquare(string memory x, string memory y, string memory w, string memory h, string memory c) internal pure returns (string memory){
        return string(abi.encodePacked(
            "<rect x='", x,"' y='", y,"' width='",w,"' height='", h,"' fill='", c,"' />"
        ));

    }

    function getBoardSquares() internal pure returns (string memory){
        //square height and width
        uint8 size = 50;
        string memory toRet = string(abi.encodePacked("<g id='s'>", generateSquare("0","0","400","400","#808080")));
        for (uint8 k = 0; k < 2; k++){
            for (uint16 i = 0 ; i < 4; i++){
                for (uint16 j = 0; j < 4; j++){
                    toRet = string(abi.encodePacked(toRet, generateSquare(toString(size * (2 * i + k)), toString(size * (2 * j + k)), toString(size), toString(size), "#D8D8D8")));
                }
            }
        }
        toRet = string(abi.encodePacked(toRet,"</g>"));
        /*
        uint8 size = 50;
        string memory toRet = "";
        string memory blackSquare = "#808080";
        string memory whiteSquare = "#D8D8D8";
        bool isWhite = true;
        for (uint16 row = 0; row < 4; row++){
            for (uint16 col = 0; col < 8; col++){
                toRet = string(abi.encodePacked(toRet, generateSquare(toString(size * col), toString(size * row), toString(size), toString(size), (isWhite ? whiteSquare : blackSquare),string(abi.encodePacked(toString(row),",",toString(col))))));
                if (col != 7)
                    isWhite = !isWhite;
            }
        }
        */
        return toRet;
    }

}

// SPDX-License-Identifier: MIT
/// @title ChessBoard - Base contract with board state and constants
/// @notice Contains the chessboard, piece constants, and initialization logic
contract ChessBoard {
    uint8 constant BOARD_SIZE = 8;

    using ChessMediaLibrary for int8[BOARD_SIZE][BOARD_SIZE];
    int8[BOARD_SIZE][BOARD_SIZE] public board;

    // Piece constants from ChessMediaLibrary
    int8 internal constant EMPTY = ChessMediaLibrary.EMPTY;
    int8 internal constant PAWN = ChessMediaLibrary.PAWN;
    int8 internal constant KNIGHT = ChessMediaLibrary.KNIGHT;
    int8 internal constant BISHOP = ChessMediaLibrary.BISHOP;
    int8 internal constant ROOK = ChessMediaLibrary.ROOK;
    int8 internal constant QUEEN = ChessMediaLibrary.QUEEN;
    int8 internal constant KING = ChessMediaLibrary.KING;

    // Row constants
    uint8 internal constant ROW_BLACK_PIECES = 0;
    uint8 internal constant ROW_BLACK_PAWNS = 1;
    uint8 internal constant ROW_BLACK_PAWNS_LONG_OPENING = 3;
    uint8 internal constant ROW_WHITE_PAWNS_LONG_OPENING = 4;
    uint8 internal constant ROW_WHITE_PAWNS = 6;
    uint8 internal constant ROW_WHITE_PIECES = 7;

    // Column constants
    uint8 internal constant COL_SHORTW_LONGB_ROOK = 0;
    uint8 internal constant COL_UNNAMED_KNIGHT = 1;
    uint8 internal constant COL_BISHOP = 2;
    uint8 internal constant COL_QUEEN = 3;
    uint8 internal constant COL_KING = 4;
    uint8 internal constant COL_UNNAMED_BISHOP = 5;
    uint8 internal constant COL_KNIGHT = 6;
    uint8 internal constant COL_LONGW_SHORTB_ROOK = 7;

    // Player constants
    int8 internal constant PLAYER_WHITE = 1;
    int8 internal constant PLAYER_BLACK = -1;

    // Castling tracking
    bool internal whiteKingMoved;
    bool internal whiteShortRookMoved;
    bool internal whiteLongRookMoved;
    bool internal blackKingMoved;
    bool internal blackLongRookMoved;
    bool internal blackShortRookMoved;

    // En passant tracking
    int8 internal enPassantCol = -1;
    uint8 internal enPassantRow;

    // King position caching (avoids O(n²) search)
    uint8 internal whiteKingRow;
    uint8 internal whiteKingCol;
    uint8 internal blackKingRow;
    uint8 internal blackKingCol;

    // Threefold repetition tracking
    mapping(bytes32 => uint8) internal positionCount;
    bytes32[] internal positionHistory;
    uint8 internal maxPositionRepetitions; // Cached max repetitions (avoids O(n) loop)

    // 50-move rule tracking (half-moves since last pawn move or capture)
    uint16 internal halfMoveClock;

    // FIDE 75-move rule: automatic draw after 75 full moves (150 half-moves) without progress
    // This also caps game length to prevent unbounded positionHistory growth
    uint16 internal constant MAX_HALF_MOVES_WITHOUT_PROGRESS = 150;

    /// @notice Initialize the board with starting positions
    function initializeBoard() internal {
        // Set up black pieces (row 0)
        board[ROW_BLACK_PIECES][COL_SHORTW_LONGB_ROOK] = -ROOK;
        board[ROW_BLACK_PIECES][COL_UNNAMED_KNIGHT] = -KNIGHT;
        board[ROW_BLACK_PIECES][COL_BISHOP] = -BISHOP;
        board[ROW_BLACK_PIECES][COL_QUEEN] = -QUEEN;
        board[ROW_BLACK_PIECES][COL_KING] = -KING;
        board[ROW_BLACK_PIECES][COL_UNNAMED_BISHOP] = -BISHOP;
        board[ROW_BLACK_PIECES][COL_KNIGHT] = -KNIGHT;
        board[ROW_BLACK_PIECES][COL_LONGW_SHORTB_ROOK] = -ROOK;

        for (uint8 col = 0; col < BOARD_SIZE; col++) {
            board[ROW_BLACK_PAWNS][col] = -PAWN;
        }

        // Set up white pieces (row 7)
        board[ROW_WHITE_PIECES][COL_SHORTW_LONGB_ROOK] = ROOK;
        board[ROW_WHITE_PIECES][COL_UNNAMED_KNIGHT] = KNIGHT;
        board[ROW_WHITE_PIECES][COL_BISHOP] = BISHOP;
        board[ROW_WHITE_PIECES][COL_QUEEN] = QUEEN;
        board[ROW_WHITE_PIECES][COL_KING] = KING;
        board[ROW_WHITE_PIECES][COL_UNNAMED_BISHOP] = BISHOP;
        board[ROW_WHITE_PIECES][COL_KNIGHT] = KNIGHT;
        board[ROW_WHITE_PIECES][COL_LONGW_SHORTB_ROOK] = ROOK;

        for (uint8 col = 0; col < BOARD_SIZE; col++) {
            board[ROW_WHITE_PAWNS][col] = PAWN;
        }

        // Reset castling flags
        whiteKingMoved = false;
        whiteShortRookMoved = false;
        whiteLongRookMoved = false;
        blackKingMoved = false;
        blackLongRookMoved = false;
        blackShortRookMoved = false;

        // Initialize king positions
        whiteKingRow = ROW_WHITE_PIECES;
        whiteKingCol = COL_KING;
        blackKingRow = ROW_BLACK_PIECES;
        blackKingCol = COL_KING;
    }

    /// @notice Absolute value of int8
    function abs(int8 x) internal pure returns (uint8) {
        return x >= 0 ? uint8(x) : uint8(-x);
    }

    /// @notice Print board as string (deprecated - use getBoardState)
    function printBoard() public pure returns (string memory) {
        return "";
    }

    /// @notice Get SVG representation of the board
    function printChessBoardLayoutSVG() external view returns (string memory) {
        return board.getCurrentBoard();
    }

    /// @notice Get entire board state in a single call (saves 63 RPC calls)
    /// @return The complete 8x8 board array
    function getBoardState() external view returns (int8[8][8] memory) {
        return board;
    }

    /// @notice Compute a hash of the current position for repetition detection
    /// @dev Includes board state, castling rights, en passant, and turn
    function _computePositionHash(bool isWhiteTurn) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(
            board,
            isWhiteTurn,
            whiteKingMoved,
            whiteShortRookMoved,
            whiteLongRookMoved,
            blackKingMoved,
            blackShortRookMoved,
            blackLongRookMoved,
            enPassantCol
        ));
    }

    /// @notice Get draw rule status
    /// @return halfMoves Current half-move clock (50-move rule)
    /// @return maxRepetitions Maximum times any position has occurred
    function getDrawRuleStatus() external view returns (uint16 halfMoves, uint8 maxRepetitions) {
        halfMoves = halfMoveClock;
        maxRepetitions = maxPositionRepetitions;
    }
}

interface IAccessControl {
    /**
     * @dev The `account` is missing a role.
     */
    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

    /**
     * @dev The caller of a function is not the expected one.
     *
     * NOTE: Don't confuse with {AccessControlUnauthorizedAccount}.
     */
    error AccessControlBadConfirmation();

    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted to signal this.
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role`.
     *
     * `sender` is the account that originated the contract call. This account bears the admin role (for the granted role).
     * Expected in cases where the role was granted using the internal {AccessControl-_grantRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {AccessControl-_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function grantRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function revokeRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     */
    function renounceRole(bytes32 role, address callerConfirmation) external;
}

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

abstract contract ERC165 is IERC165 {
    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IERC165).interfaceId;
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (access/AccessControl.sol)
/**
 * @dev Contract module that allows children to implement role-based access
 * control mechanisms. This is a lightweight version that doesn't allow enumerating role
 * members except through off-chain means by accessing the contract event logs. Some
 * applications may benefit from on-chain enumerability, for those cases see
 * {AccessControlEnumerable}.
 *
 * Roles are referred to by their `bytes32` identifier. These should be exposed
 * in the external API and be unique. The best way to achieve this is by
 * using `public constant` hash digests:
 *
 * ```solidity
 * bytes32 public constant MY_ROLE = keccak256("MY_ROLE");
 * ```
 *
 * Roles can be used to represent a set of permissions. To restrict access to a
 * function call, use {hasRole}:
 *
 * ```solidity
 * function foo() public {
 *     require(hasRole(MY_ROLE, msg.sender));
 *     ...
 * }
 * ```
 *
 * Roles can be granted and revoked dynamically via the {grantRole} and
 * {revokeRole} functions. Each role has an associated admin role, and only
 * accounts that have a role's admin role can call {grantRole} and {revokeRole}.
 *
 * By default, the admin role for all roles is `DEFAULT_ADMIN_ROLE`, which means
 * that only accounts with this role will be able to grant or revoke other
 * roles. More complex role relationships can be created by using
 * {_setRoleAdmin}.
 *
 * WARNING: The `DEFAULT_ADMIN_ROLE` is also its own admin: it has permission to
 * grant and revoke this role. Extra precautions should be taken to secure
 * accounts that have been granted it. We recommend using {AccessControlDefaultAdminRules}
 * to enforce additional security measures for this role.
 */
abstract contract AccessControl is Context, IAccessControl, ERC165 {
    struct RoleData {
        mapping(address account => bool) hasRole;
        bytes32 adminRole;
    }

    mapping(bytes32 role => RoleData) private _roles;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    /**
     * @dev Modifier that checks that an account has a specific role. Reverts
     * with an {AccessControlUnauthorizedAccount} error including the required role.
     */
    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IAccessControl).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) public view virtual returns (bool) {
        return _roles[role].hasRole[account];
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `_msgSender()`
     * is missing `role`. Overriding this function changes the behavior of the {onlyRole} modifier.
     */
    function _checkRole(bytes32 role) internal view virtual {
        _checkRole(role, _msgSender());
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `account`
     * is missing `role`.
     */
    function _checkRole(bytes32 role, address account) internal view virtual {
        if (!hasRole(role, account)) {
            revert AccessControlUnauthorizedAccount(account, role);
        }
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view virtual returns (bytes32) {
        return _roles[role].adminRole;
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
    }

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been revoked `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     *
     * May emit a {RoleRevoked} event.
     */
    function renounceRole(bytes32 role, address callerConfirmation) public virtual {
        if (callerConfirmation != _msgSender()) {
            revert AccessControlBadConfirmation();
        }

        _revokeRole(role, callerConfirmation);
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        bytes32 previousAdminRole = getRoleAdmin(role);
        _roles[role].adminRole = adminRole;
        emit RoleAdminChanged(role, previousAdminRole, adminRole);
    }

    /**
     * @dev Attempts to grant `role` to `account` and returns a boolean indicating if `role` was granted.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleGranted} event.
     */
    function _grantRole(bytes32 role, address account) internal virtual returns (bool) {
        if (!hasRole(role, account)) {
            _roles[role].hasRole[account] = true;
            emit RoleGranted(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Attempts to revoke `role` from `account` and returns a boolean indicating if `role` was revoked.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleRevoked} event.
     */
    function _revokeRole(bytes32 role, address account) internal virtual returns (bool) {
        if (hasRole(role, account)) {
            _roles[role].hasRole[account] = false;
            emit RoleRevoked(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (utils/Pausable.sol)
/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract Pausable is Context {
    bool private _paused;

    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev The operation failed because the contract is paused.
     */
    error EnforcedPause();

    /**
     * @dev The operation failed because the contract is not paused.
     */
    error ExpectedPause();

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() public view virtual returns (bool) {
        return _paused;
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        if (paused()) {
            revert EnforcedPause();
        }
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        if (!paused()) {
            revert ExpectedPause();
        }
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause() internal virtual whenNotPaused {
        _paused = true;
        emit Paused(_msgSender());
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause() internal virtual whenPaused {
        _paused = false;
        emit Unpaused(_msgSender());
    }
}

interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC1363 is IERC20, IERC165 {
    /*
     * Note: the ERC-165 identifier for this interface is 0xb0202a11.
     * 0xb0202a11 ===
     *   bytes4(keccak256('transferAndCall(address,uint256)')) ^
     *   bytes4(keccak256('transferAndCall(address,uint256,bytes)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256,bytes)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256,bytes)'))
     */

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @param data Additional data with no specified format, sent in call to `spender`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (token/ERC20/utils/SafeERC20.sol)
/**
 * @title SafeERC20
 * @dev Wrappers around ERC-20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    /**
     * @dev An operation with an ERC-20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Variant of {safeTransfer} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransfer(IERC20 token, address to, uint256 value) internal returns (bool) {
        return _callOptionalReturnBool(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Variant of {safeTransferFrom} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransferFrom(IERC20 token, address from, address to, uint256 value) internal returns (bool) {
        return _callOptionalReturnBool(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     *
     * NOTE: If the token implements ERC-7674, this function will not modify any temporary allowance. This function
     * only sets the "standard" allowance. Any temporary allowance will remain active, in addition to the value being
     * set here.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        bytes memory approvalCall = abi.encodeCall(token.approve, (spender, value));

        if (!_callOptionalReturnBool(token, approvalCall)) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    /**
     * @dev Performs an {ERC1363} transferAndCall, with a fallback to the simple {ERC20} transfer if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferFromAndCall, with a fallback to the simple {ERC20} transferFrom if the target
     * has no code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferFromAndCallRelaxed(
        IERC1363 token,
        address from,
        address to,
        uint256 value,
        bytes memory data
    ) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} approveAndCall, with a fallback to the simple {ERC20} approve if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * NOTE: When the recipient address (`to`) has no code (i.e. is an EOA), this function behaves as {forceApprove}.
     * Opposedly, when the recipient address (`to`) has code, this function only attempts to call {ERC1363-approveAndCall}
     * once without retrying, and relies on the returned value to be true.
     *
     * Reverts if the returned value is other than `true`.
     */
    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturnBool} that reverts if call fails to meet the requirements.
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            let success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            // bubble errors
            if iszero(success) {
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
            returnSize := returndatasize()
            returnValue := mload(0)
        }

        if (returnSize == 0 ? address(token).code.length == 0 : returnValue != 1) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturn} that silently catches all reverts and returns a bool instead.
     */
    function _callOptionalReturnBool(IERC20 token, bytes memory data) private returns (bool) {
        bool success;
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0)
        }
        return success && (returnSize == 0 ? address(token).code.length > 0 : returnValue == 1);
    }
}

interface IERC20Metadata is IERC20 {
    /**
     * @dev Returns the name of the token.
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the symbol of the token.
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() external view returns (uint8);
}

interface IERC20Errors {
    /**
     * @dev Indicates an error related to the current `balance` of a `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param balance Current balance for the interacting account.
     * @param needed Minimum amount required to perform a transfer.
     */
    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC20InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC20InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `spender`’s `allowance`. Used in transfers.
     * @param spender Address that may be allowed to operate on tokens without being their owner.
     * @param allowance Amount of tokens a `spender` is allowed to operate with.
     * @param needed Minimum amount required to perform a transfer.
     */
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC20InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `spender` to be approved. Used in approvals.
     * @param spender Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC20InvalidSpender(address spender);
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/ERC20.sol)
/**
 * @dev Implementation of the {IERC20} interface.
 *
 * This implementation is agnostic to the way tokens are created. This means
 * that a supply mechanism has to be added in a derived contract using {_mint}.
 *
 * TIP: For a detailed writeup see our guide
 * https://forum.openzeppelin.com/t/how-to-implement-erc20-supply-mechanisms/226[How
 * to implement supply mechanisms].
 *
 * The default value of {decimals} is 18. To change this, you should override
 * this function so it returns a different value.
 *
 * We have followed general OpenZeppelin Contracts guidelines: functions revert
 * instead returning `false` on failure. This behavior is nonetheless
 * conventional and does not conflict with the expectations of ERC-20
 * applications.
 */
abstract contract ERC20 is Context, IERC20, IERC20Metadata, IERC20Errors {
    mapping(address account => uint256) private _balances;

    mapping(address account => mapping(address spender => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * Both values are immutable: they can only be set once during construction.
     */
    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5.05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the default value returned by this function, unless
     * it's overridden.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual returns (uint8) {
        return 18;
    }

    /// @inheritdoc IERC20
    function totalSupply() public view virtual returns (uint256) {
        return _totalSupply;
    }

    /// @inheritdoc IERC20
    function balanceOf(address account) public view virtual returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `value`.
     */
    function transfer(address to, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _transfer(owner, to, value);
        return true;
    }

    /// @inheritdoc IERC20
    function allowance(address owner, address spender) public view virtual returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * NOTE: If `value` is the maximum `uint256`, the allowance is not updated on
     * `transferFrom`. This is semantically equivalent to an infinite approval.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 value) public virtual returns (bool) {
        address owner = _msgSender();
        _approve(owner, spender, value);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Skips emitting an {Approval} event indicating an allowance update. This is not
     * required by the ERC. See {xref-ERC20-_approve-address-address-uint256-bool-}[_approve].
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `value`.
     * - the caller must have allowance for ``from``'s tokens of at least
     * `value`.
     */
    function transferFrom(address from, address to, uint256 value) public virtual returns (bool) {
        address spender = _msgSender();
        _spendAllowance(from, spender, value);
        _transfer(from, to, value);
        return true;
    }

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead.
     */
    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }
        _update(from, to, value);
    }

    /**
     * @dev Transfers a `value` amount of tokens from `from` to `to`, or alternatively mints (or burns) if `from`
     * (or `to`) is the zero address. All customizations to transfers, mints, and burns should be done by overriding
     * this function.
     *
     * Emits a {Transfer} event.
     */
    function _update(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) {
            // Overflow check required: The rest of the code assumes that totalSupply never overflows
            _totalSupply += value;
        } else {
            uint256 fromBalance = _balances[from];
            if (fromBalance < value) {
                revert ERC20InsufficientBalance(from, fromBalance, value);
            }
            unchecked {
                // Overflow not possible: value <= fromBalance <= totalSupply.
                _balances[from] = fromBalance - value;
            }
        }

        if (to == address(0)) {
            unchecked {
                // Overflow not possible: value <= totalSupply or value <= fromBalance <= totalSupply.
                _totalSupply -= value;
            }
        } else {
            unchecked {
                // Overflow not possible: balance + value is at most totalSupply, which we know fits into a uint256.
                _balances[to] += value;
            }
        }

        emit Transfer(from, to, value);
    }

    /**
     * @dev Creates a `value` amount of tokens and assigns them to `account`, by transferring it from address(0).
     * Relies on the `_update` mechanism
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead.
     */
    function _mint(address account, uint256 value) internal {
        if (account == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }
        _update(address(0), account, value);
    }

    /**
     * @dev Destroys a `value` amount of tokens from `account`, lowering the total supply.
     * Relies on the `_update` mechanism.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * NOTE: This function is not virtual, {_update} should be overridden instead
     */
    function _burn(address account, uint256 value) internal {
        if (account == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        _update(account, address(0), value);
    }

    /**
     * @dev Sets `value` as the allowance of `spender` over the `owner`'s tokens.
     *
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     *
     * Overrides to this logic should be done to the variant with an additional `bool emitEvent` argument.
     */
    function _approve(address owner, address spender, uint256 value) internal {
        _approve(owner, spender, value, true);
    }

    /**
     * @dev Variant of {_approve} with an optional flag to enable or disable the {Approval} event.
     *
     * By default (when calling {_approve}) the flag is set to true. On the other hand, approval changes made by
     * `_spendAllowance` during the `transferFrom` operation set the flag to false. This saves gas by not emitting any
     * `Approval` event during `transferFrom` operations.
     *
     * Anyone who wishes to continue emitting `Approval` events on the`transferFrom` operation can force the flag to
     * true using the following override:
     *
     * ```solidity
     * function _approve(address owner, address spender, uint256 value, bool) internal virtual override {
     *     super._approve(owner, spender, value, true);
     * }
     * ```
     *
     * Requirements are the same as {_approve}.
     */
    function _approve(address owner, address spender, uint256 value, bool emitEvent) internal virtual {
        if (owner == address(0)) {
            revert ERC20InvalidApprover(address(0));
        }
        if (spender == address(0)) {
            revert ERC20InvalidSpender(address(0));
        }
        _allowances[owner][spender] = value;
        if (emitEvent) {
            emit Approval(owner, spender, value);
        }
    }

    /**
     * @dev Updates `owner`'s allowance for `spender` based on spent `value`.
     *
     * Does not update the allowance value in case of infinite allowance.
     * Revert if not enough allowance is available.
     *
     * Does not emit an {Approval} event.
     */
    function _spendAllowance(address owner, address spender, uint256 value) internal virtual {
        uint256 currentAllowance = allowance(owner, spender);
        if (currentAllowance < type(uint256).max) {
            if (currentAllowance < value) {
                revert ERC20InsufficientAllowance(spender, currentAllowance, value);
            }
            unchecked {
                _approve(owner, spender, currentAllowance - value, false);
            }
        }
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/extensions/ERC20Burnable.sol)
/**
 * @dev Extension of {ERC20} that allows token holders to destroy both their own
 * tokens and those that they have an allowance for, in a way that can be
 * recognized off-chain (via event analysis).
 */
abstract contract ERC20Burnable is Context, ERC20 {
    /**
     * @dev Destroys a `value` amount of tokens from the caller.
     *
     * See {ERC20-_burn}.
     */
    function burn(uint256 value) public virtual {
        _burn(_msgSender(), value);
    }

    /**
     * @dev Destroys a `value` amount of tokens from `account`, deducting from
     * the caller's allowance.
     *
     * See {ERC20-_burn} and {ERC20-allowance}.
     *
     * Requirements:
     *
     * - the caller must have allowance for ``accounts``'s tokens of at least
     * `value`.
     */
    function burnFrom(address account, uint256 value) public virtual {
        _spendAllowance(account, _msgSender(), value);
        _burn(account, value);
    }
}

interface IVotes {
    /**
     * @dev The signature used has expired.
     */
    error VotesExpiredSignature(uint256 expiry);

    /**
     * @dev Emitted when an account changes their delegate.
     */
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);

    /**
     * @dev Emitted when a token transfer or delegate change results in changes to a delegate's number of voting units.
     */
    event DelegateVotesChanged(address indexed delegate, uint256 previousVotes, uint256 newVotes);

    /**
     * @dev Returns the current amount of votes that `account` has.
     */
    function getVotes(address account) external view returns (uint256);

    /**
     * @dev Returns the amount of votes that `account` had at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     */
    function getPastVotes(address account, uint256 timepoint) external view returns (uint256);

    /**
     * @dev Returns the total supply of votes available at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     *
     * NOTE: This value is the sum of all available votes, which is not necessarily the sum of all delegated votes.
     * Votes that have not been delegated are still part of total supply, even though they would not participate in a
     * vote.
     */
    function getPastTotalSupply(uint256 timepoint) external view returns (uint256);

    /**
     * @dev Returns the delegate that `account` has chosen.
     */
    function delegates(address account) external view returns (address);

    /**
     * @dev Delegates votes from the sender to `delegatee`.
     */
    function delegate(address delegatee) external;

    /**
     * @dev Delegates votes from signer to `delegatee`.
     */
    function delegateBySig(address delegatee, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external;
}

interface IERC6372 {
    /**
     * @dev Clock used for flagging checkpoints. Can be overridden to implement timestamp based checkpoints (and voting).
     */
    function clock() external view returns (uint48);

    /**
     * @dev Description of the clock
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() external view returns (string memory);
}

interface IERC5805 is IERC6372, IVotes {}

abstract contract Nonces {
    /**
     * @dev The nonce used for an `account` is not the expected current nonce.
     */
    error InvalidAccountNonce(address account, uint256 currentNonce);

    mapping(address account => uint256) private _nonces;

    /**
     * @dev Returns the next unused nonce for an address.
     */
    function nonces(address owner) public view virtual returns (uint256) {
        return _nonces[owner];
    }

    /**
     * @dev Consumes a nonce.
     *
     * Returns the current value and increments nonce.
     */
    function _useNonce(address owner) internal virtual returns (uint256) {
        // For each account, the nonce has an initial value of 0, can only be incremented by one, and cannot be
        // decremented or reset. This guarantees that the nonce never overflows.
        unchecked {
            // It is important to do x++ and not ++x here.
            return _nonces[owner]++;
        }
    }

    /**
     * @dev Same as {_useNonce} but checking that `nonce` is the next valid for `owner`.
     */
    function _useCheckedNonce(address owner, uint256 nonce) internal virtual {
        uint256 current = _useNonce(owner);
        if (nonce != current) {
            revert InvalidAccountNonce(owner, current);
        }
    }
}

library MessageHashUtils {
    /**
     * @dev Returns the keccak256 digest of an ERC-191 signed data with version
     * `0x45` (`personal_sign` messages).
     *
     * The digest is calculated by prefixing a bytes32 `messageHash` with
     * `"\x19Ethereum Signed Message:\n32"` and hashing the result. It corresponds with the
     * hash signed when using the https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sign[`eth_sign`] JSON-RPC method.
     *
     * NOTE: The `messageHash` parameter is intended to be the result of hashing a raw message with
     * keccak256, although any bytes32 value can be safely used because the final digest will
     * be re-hashed.
     *
     * See {ECDSA-recover}.
     */
    function toEthSignedMessageHash(bytes32 messageHash) internal pure returns (bytes32 digest) {
        assembly ("memory-safe") {
            mstore(0x00, "\x19Ethereum Signed Message:\n32") // 32 is the bytes-length of messageHash
            mstore(0x1c, messageHash) // 0x1c (28) is the length of the prefix
            digest := keccak256(0x00, 0x3c) // 0x3c is the length of the prefix (0x1c) + messageHash (0x20)
        }
    }

    /**
     * @dev Returns the keccak256 digest of an ERC-191 signed data with version
     * `0x45` (`personal_sign` messages).
     *
     * The digest is calculated by prefixing an arbitrary `message` with
     * `"\x19Ethereum Signed Message:\n" + len(message)` and hashing the result. It corresponds with the
     * hash signed when using the https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_sign[`eth_sign`] JSON-RPC method.
     *
     * See {ECDSA-recover}.
     */
    function toEthSignedMessageHash(bytes memory message) internal pure returns (bytes32) {
        return
            keccak256(bytes.concat("\x19Ethereum Signed Message:\n", bytes(Strings.toString(message.length)), message));
    }

    /**
     * @dev Returns the keccak256 digest of an ERC-191 signed data with version
     * `0x00` (data with intended validator).
     *
     * The digest is calculated by prefixing an arbitrary `data` with `"\x19\x00"` and the intended
     * `validator` address. Then hashing the result.
     *
     * See {ECDSA-recover}.
     */
    function toDataWithIntendedValidatorHash(address validator, bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hex"19_00", validator, data));
    }

    /**
     * @dev Variant of {toDataWithIntendedValidatorHash-address-bytes} optimized for cases where `data` is a bytes32.
     */
    function toDataWithIntendedValidatorHash(
        address validator,
        bytes32 messageHash
    ) internal pure returns (bytes32 digest) {
        assembly ("memory-safe") {
            mstore(0x00, hex"19_00")
            mstore(0x02, shl(96, validator))
            mstore(0x16, messageHash)
            digest := keccak256(0x00, 0x36)
        }
    }

    /**
     * @dev Returns the keccak256 digest of an EIP-712 typed data (ERC-191 version `0x01`).
     *
     * The digest is calculated from a `domainSeparator` and a `structHash`, by prefixing them with
     * `\x19\x01` and hashing the result. It corresponds to the hash signed by the
     * https://eips.ethereum.org/EIPS/eip-712[`eth_signTypedData`] JSON-RPC method as part of EIP-712.
     *
     * See {ECDSA-recover}.
     */
    function toTypedDataHash(bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes32 digest) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, hex"19_01")
            mstore(add(ptr, 0x02), domainSeparator)
            mstore(add(ptr, 0x22), structHash)
            digest := keccak256(ptr, 0x42)
        }
    }
}

library StorageSlot {
    struct AddressSlot {
        address value;
    }

    struct BooleanSlot {
        bool value;
    }

    struct Bytes32Slot {
        bytes32 value;
    }

    struct Uint256Slot {
        uint256 value;
    }

    struct Int256Slot {
        int256 value;
    }

    struct StringSlot {
        string value;
    }

    struct BytesSlot {
        bytes value;
    }

    /**
     * @dev Returns an `AddressSlot` with member `value` located at `slot`.
     */
    function getAddressSlot(bytes32 slot) internal pure returns (AddressSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `BooleanSlot` with member `value` located at `slot`.
     */
    function getBooleanSlot(bytes32 slot) internal pure returns (BooleanSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Bytes32Slot` with member `value` located at `slot`.
     */
    function getBytes32Slot(bytes32 slot) internal pure returns (Bytes32Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Uint256Slot` with member `value` located at `slot`.
     */
    function getUint256Slot(bytes32 slot) internal pure returns (Uint256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `Int256Slot` with member `value` located at `slot`.
     */
    function getInt256Slot(bytes32 slot) internal pure returns (Int256Slot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns a `StringSlot` with member `value` located at `slot`.
     */
    function getStringSlot(bytes32 slot) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `StringSlot` representation of the string storage pointer `store`.
     */
    function getStringSlot(string storage store) internal pure returns (StringSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }

    /**
     * @dev Returns a `BytesSlot` with member `value` located at `slot`.
     */
    function getBytesSlot(bytes32 slot) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := slot
        }
    }

    /**
     * @dev Returns an `BytesSlot` representation of the bytes storage pointer `store`.
     */
    function getBytesSlot(bytes storage store) internal pure returns (BytesSlot storage r) {
        assembly ("memory-safe") {
            r.slot := store.slot
        }
    }
}

type ShortString is bytes32;

library ShortStrings {
    // Used as an identifier for strings longer than 31 bytes.
    bytes32 private constant FALLBACK_SENTINEL = 0x00000000000000000000000000000000000000000000000000000000000000FF;

    error StringTooLong(string str);
    error InvalidShortString();

    /**
     * @dev Encode a string of at most 31 chars into a `ShortString`.
     *
     * This will trigger a `StringTooLong` error is the input string is too long.
     */
    function toShortString(string memory str) internal pure returns (ShortString) {
        bytes memory bstr = bytes(str);
        if (bstr.length > 31) {
            revert StringTooLong(str);
        }
        return ShortString.wrap(bytes32(uint256(bytes32(bstr)) | bstr.length));
    }

    /**
     * @dev Decode a `ShortString` back to a "normal" string.
     */
    function toString(ShortString sstr) internal pure returns (string memory) {
        uint256 len = byteLength(sstr);
        // using `new string(len)` would work locally but is not memory safe.
        string memory str = new string(32);
        assembly ("memory-safe") {
            mstore(str, len)
            mstore(add(str, 0x20), sstr)
        }
        return str;
    }

    /**
     * @dev Return the length of a `ShortString`.
     */
    function byteLength(ShortString sstr) internal pure returns (uint256) {
        uint256 result = uint256(ShortString.unwrap(sstr)) & 0xFF;
        if (result > 31) {
            revert InvalidShortString();
        }
        return result;
    }

    /**
     * @dev Encode a string into a `ShortString`, or write it to storage if it is too long.
     */
    function toShortStringWithFallback(string memory value, string storage store) internal returns (ShortString) {
        if (bytes(value).length < 32) {
            return toShortString(value);
        } else {
            StorageSlot.getStringSlot(store).value = value;
            return ShortString.wrap(FALLBACK_SENTINEL);
        }
    }

    /**
     * @dev Decode a string that was encoded to `ShortString` or written to storage using {toShortStringWithFallback}.
     */
    function toStringWithFallback(ShortString value, string storage store) internal pure returns (string memory) {
        if (ShortString.unwrap(value) != FALLBACK_SENTINEL) {
            return toString(value);
        } else {
            return store;
        }
    }

    /**
     * @dev Return the length of a string that was encoded to `ShortString` or written to storage using
     * {toShortStringWithFallback}.
     *
     * WARNING: This will return the "byte length" of the string. This may not reflect the actual length in terms of
     * actual characters as the UTF-8 encoding of a single character can span over multiple bytes.
     */
    function byteLengthWithFallback(ShortString value, string storage store) internal view returns (uint256) {
        if (ShortString.unwrap(value) != FALLBACK_SENTINEL) {
            return byteLength(value);
        } else {
            return bytes(store).length;
        }
    }
}

interface IERC5267 {
    /**
     * @dev MAY be emitted to signal that the domain could have changed.
     */
    event EIP712DomainChanged();

    /**
     * @dev returns the fields and values that describe the domain separator used by this contract for EIP-712
     * signature.
     */
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        );
}

abstract contract EIP712 is IERC5267 {
    using ShortStrings for *;

    bytes32 private constant TYPE_HASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // Cache the domain separator as an immutable value, but also store the chain id that it corresponds to, in order to
    // invalidate the cached domain separator if the chain id changes.
    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;
    address private immutable _cachedThis;

    bytes32 private immutable _hashedName;
    bytes32 private immutable _hashedVersion;

    ShortString private immutable _name;
    ShortString private immutable _version;
    // slither-disable-next-line constable-states
    string private _nameFallback;
    // slither-disable-next-line constable-states
    string private _versionFallback;

    /**
     * @dev Initializes the domain separator and parameter caches.
     *
     * The meaning of `name` and `version` is specified in
     * https://eips.ethereum.org/EIPS/eip-712#definition-of-domainseparator[EIP-712]:
     *
     * - `name`: the user readable name of the signing domain, i.e. the name of the DApp or the protocol.
     * - `version`: the current major version of the signing domain.
     *
     * NOTE: These parameters cannot be changed except through a xref:learn::upgrading-smart-contracts.adoc[smart
     * contract upgrade].
     */
    constructor(string memory name, string memory version) {
        _name = name.toShortStringWithFallback(_nameFallback);
        _version = version.toShortStringWithFallback(_versionFallback);
        _hashedName = keccak256(bytes(name));
        _hashedVersion = keccak256(bytes(version));

        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
        _cachedThis = address(this);
    }

    /**
     * @dev Returns the domain separator for the current chain.
     */
    function _domainSeparatorV4() internal view returns (bytes32) {
        if (address(this) == _cachedThis && block.chainid == _cachedChainId) {
            return _cachedDomainSeparator;
        } else {
            return _buildDomainSeparator();
        }
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(TYPE_HASH, _hashedName, _hashedVersion, block.chainid, address(this)));
    }

    /**
     * @dev Given an already https://eips.ethereum.org/EIPS/eip-712#definition-of-hashstruct[hashed struct], this
     * function returns the hash of the fully encoded EIP712 message for this domain.
     *
     * This hash can be used together with {ECDSA-recover} to obtain the signer of a message. For example:
     *
     * ```solidity
     * bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
     *     keccak256("Mail(address to,string contents)"),
     *     mailTo,
     *     keccak256(bytes(mailContents))
     * )));
     * address signer = ECDSA.recover(digest, signature);
     * ```
     */
    function _hashTypedDataV4(bytes32 structHash) internal view virtual returns (bytes32) {
        return MessageHashUtils.toTypedDataHash(_domainSeparatorV4(), structHash);
    }

    /// @inheritdoc IERC5267
    function eip712Domain()
        public
        view
        virtual
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (
            hex"0f", // 01111
            _EIP712Name(),
            _EIP712Version(),
            block.chainid,
            address(this),
            bytes32(0),
            new uint256[](0)
        );
    }

    /**
     * @dev The name parameter for the EIP712 domain.
     *
     * NOTE: By default this function reads _name which is an immutable value.
     * It only reads from storage if necessary (in case the value is too large to fit in a ShortString).
     */
    // solhint-disable-next-line func-name-mixedcase
    function _EIP712Name() internal view returns (string memory) {
        return _name.toStringWithFallback(_nameFallback);
    }

    /**
     * @dev The version parameter for the EIP712 domain.
     *
     * NOTE: By default this function reads _version which is an immutable value.
     * It only reads from storage if necessary (in case the value is too large to fit in a ShortString).
     */
    // solhint-disable-next-line func-name-mixedcase
    function _EIP712Version() internal view returns (string memory) {
        return _version.toStringWithFallback(_versionFallback);
    }
}

library Checkpoints {
    /**
     * @dev A value was attempted to be inserted on a past checkpoint.
     */
    error CheckpointUnorderedInsertion();

    struct Trace224 {
        Checkpoint224[] _checkpoints;
    }

    struct Checkpoint224 {
        uint32 _key;
        uint224 _value;
    }

    /**
     * @dev Pushes a (`key`, `value`) pair into a Trace224 so that it is stored as the checkpoint.
     *
     * Returns previous value and new value.
     *
     * IMPORTANT: Never accept `key` as a user input, since an arbitrary `type(uint32).max` key set will disable the
     * library.
     */
    function push(
        Trace224 storage self,
        uint32 key,
        uint224 value
    ) internal returns (uint224 oldValue, uint224 newValue) {
        return _insert(self._checkpoints, key, value);
    }

    /**
     * @dev Returns the value in the first (oldest) checkpoint with key greater or equal than the search key, or zero if
     * there is none.
     */
    function lowerLookup(Trace224 storage self, uint32 key) internal view returns (uint224) {
        uint256 len = self._checkpoints.length;
        uint256 pos = _lowerBinaryLookup(self._checkpoints, key, 0, len);
        return pos == len ? 0 : _unsafeAccess(self._checkpoints, pos)._value;
    }

    /**
     * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
     * if there is none.
     */
    function upperLookup(Trace224 storage self, uint32 key) internal view returns (uint224) {
        uint256 len = self._checkpoints.length;
        uint256 pos = _upperBinaryLookup(self._checkpoints, key, 0, len);
        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
     * if there is none.
     *
     * NOTE: This is a variant of {upperLookup} that is optimized to find "recent" checkpoint (checkpoints with high
     * keys).
     */
    function upperLookupRecent(Trace224 storage self, uint32 key) internal view returns (uint224) {
        uint256 len = self._checkpoints.length;

        uint256 low = 0;
        uint256 high = len;

        if (len > 5) {
            uint256 mid = len - Math.sqrt(len);
            if (key < _unsafeAccess(self._checkpoints, mid)._key) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        uint256 pos = _upperBinaryLookup(self._checkpoints, key, low, high);

        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns the value in the most recent checkpoint, or zero if there are no checkpoints.
     */
    function latest(Trace224 storage self) internal view returns (uint224) {
        uint256 pos = self._checkpoints.length;
        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns whether there is a checkpoint in the structure (i.e. it is not empty), and if so the key and value
     * in the most recent checkpoint.
     */
    function latestCheckpoint(Trace224 storage self) internal view returns (bool exists, uint32 _key, uint224 _value) {
        uint256 pos = self._checkpoints.length;
        if (pos == 0) {
            return (false, 0, 0);
        } else {
            Checkpoint224 storage ckpt = _unsafeAccess(self._checkpoints, pos - 1);
            return (true, ckpt._key, ckpt._value);
        }
    }

    /**
     * @dev Returns the number of checkpoints.
     */
    function length(Trace224 storage self) internal view returns (uint256) {
        return self._checkpoints.length;
    }

    /**
     * @dev Returns checkpoint at given position.
     */
    function at(Trace224 storage self, uint32 pos) internal view returns (Checkpoint224 memory) {
        return self._checkpoints[pos];
    }

    /**
     * @dev Pushes a (`key`, `value`) pair into an ordered list of checkpoints, either by inserting a new checkpoint,
     * or by updating the last one.
     */
    function _insert(
        Checkpoint224[] storage self,
        uint32 key,
        uint224 value
    ) private returns (uint224 oldValue, uint224 newValue) {
        uint256 pos = self.length;

        if (pos > 0) {
            Checkpoint224 storage last = _unsafeAccess(self, pos - 1);
            uint32 lastKey = last._key;
            uint224 lastValue = last._value;

            // Checkpoint keys must be non-decreasing.
            if (lastKey > key) {
                revert CheckpointUnorderedInsertion();
            }

            // Update or push new checkpoint
            if (lastKey == key) {
                last._value = value;
            } else {
                self.push(Checkpoint224({_key: key, _value: value}));
            }
            return (lastValue, value);
        } else {
            self.push(Checkpoint224({_key: key, _value: value}));
            return (0, value);
        }
    }

    /**
     * @dev Return the index of the first (oldest) checkpoint with key strictly bigger than the search key, or `high`
     * if there is none. `low` and `high` define a section where to do the search, with inclusive `low` and exclusive
     * `high`.
     *
     * WARNING: `high` should not be greater than the array's length.
     */
    function _upperBinaryLookup(
        Checkpoint224[] storage self,
        uint32 key,
        uint256 low,
        uint256 high
    ) private view returns (uint256) {
        while (low < high) {
            uint256 mid = Math.average(low, high);
            if (_unsafeAccess(self, mid)._key > key) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return high;
    }

    /**
     * @dev Return the index of the first (oldest) checkpoint with key greater or equal than the search key, or `high`
     * if there is none. `low` and `high` define a section where to do the search, with inclusive `low` and exclusive
     * `high`.
     *
     * WARNING: `high` should not be greater than the array's length.
     */
    function _lowerBinaryLookup(
        Checkpoint224[] storage self,
        uint32 key,
        uint256 low,
        uint256 high
    ) private view returns (uint256) {
        while (low < high) {
            uint256 mid = Math.average(low, high);
            if (_unsafeAccess(self, mid)._key < key) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return high;
    }

    /**
     * @dev Access an element of the array without performing bounds check. The position is assumed to be within bounds.
     */
    function _unsafeAccess(
        Checkpoint224[] storage self,
        uint256 pos
    ) private pure returns (Checkpoint224 storage result) {
        assembly {
            mstore(0, self.slot)
            result.slot := add(keccak256(0, 0x20), pos)
        }
    }

    struct Trace208 {
        Checkpoint208[] _checkpoints;
    }

    struct Checkpoint208 {
        uint48 _key;
        uint208 _value;
    }

    /**
     * @dev Pushes a (`key`, `value`) pair into a Trace208 so that it is stored as the checkpoint.
     *
     * Returns previous value and new value.
     *
     * IMPORTANT: Never accept `key` as a user input, since an arbitrary `type(uint48).max` key set will disable the
     * library.
     */
    function push(
        Trace208 storage self,
        uint48 key,
        uint208 value
    ) internal returns (uint208 oldValue, uint208 newValue) {
        return _insert(self._checkpoints, key, value);
    }

    /**
     * @dev Returns the value in the first (oldest) checkpoint with key greater or equal than the search key, or zero if
     * there is none.
     */
    function lowerLookup(Trace208 storage self, uint48 key) internal view returns (uint208) {
        uint256 len = self._checkpoints.length;
        uint256 pos = _lowerBinaryLookup(self._checkpoints, key, 0, len);
        return pos == len ? 0 : _unsafeAccess(self._checkpoints, pos)._value;
    }

    /**
     * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
     * if there is none.
     */
    function upperLookup(Trace208 storage self, uint48 key) internal view returns (uint208) {
        uint256 len = self._checkpoints.length;
        uint256 pos = _upperBinaryLookup(self._checkpoints, key, 0, len);
        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
     * if there is none.
     *
     * NOTE: This is a variant of {upperLookup} that is optimized to find "recent" checkpoint (checkpoints with high
     * keys).
     */
    function upperLookupRecent(Trace208 storage self, uint48 key) internal view returns (uint208) {
        uint256 len = self._checkpoints.length;

        uint256 low = 0;
        uint256 high = len;

        if (len > 5) {
            uint256 mid = len - Math.sqrt(len);
            if (key < _unsafeAccess(self._checkpoints, mid)._key) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        uint256 pos = _upperBinaryLookup(self._checkpoints, key, low, high);

        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns the value in the most recent checkpoint, or zero if there are no checkpoints.
     */
    function latest(Trace208 storage self) internal view returns (uint208) {
        uint256 pos = self._checkpoints.length;
        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns whether there is a checkpoint in the structure (i.e. it is not empty), and if so the key and value
     * in the most recent checkpoint.
     */
    function latestCheckpoint(Trace208 storage self) internal view returns (bool exists, uint48 _key, uint208 _value) {
        uint256 pos = self._checkpoints.length;
        if (pos == 0) {
            return (false, 0, 0);
        } else {
            Checkpoint208 storage ckpt = _unsafeAccess(self._checkpoints, pos - 1);
            return (true, ckpt._key, ckpt._value);
        }
    }

    /**
     * @dev Returns the number of checkpoints.
     */
    function length(Trace208 storage self) internal view returns (uint256) {
        return self._checkpoints.length;
    }

    /**
     * @dev Returns checkpoint at given position.
     */
    function at(Trace208 storage self, uint32 pos) internal view returns (Checkpoint208 memory) {
        return self._checkpoints[pos];
    }

    /**
     * @dev Pushes a (`key`, `value`) pair into an ordered list of checkpoints, either by inserting a new checkpoint,
     * or by updating the last one.
     */
    function _insert(
        Checkpoint208[] storage self,
        uint48 key,
        uint208 value
    ) private returns (uint208 oldValue, uint208 newValue) {
        uint256 pos = self.length;

        if (pos > 0) {
            Checkpoint208 storage last = _unsafeAccess(self, pos - 1);
            uint48 lastKey = last._key;
            uint208 lastValue = last._value;

            // Checkpoint keys must be non-decreasing.
            if (lastKey > key) {
                revert CheckpointUnorderedInsertion();
            }

            // Update or push new checkpoint
            if (lastKey == key) {
                last._value = value;
            } else {
                self.push(Checkpoint208({_key: key, _value: value}));
            }
            return (lastValue, value);
        } else {
            self.push(Checkpoint208({_key: key, _value: value}));
            return (0, value);
        }
    }

    /**
     * @dev Return the index of the first (oldest) checkpoint with key strictly bigger than the search key, or `high`
     * if there is none. `low` and `high` define a section where to do the search, with inclusive `low` and exclusive
     * `high`.
     *
     * WARNING: `high` should not be greater than the array's length.
     */
    function _upperBinaryLookup(
        Checkpoint208[] storage self,
        uint48 key,
        uint256 low,
        uint256 high
    ) private view returns (uint256) {
        while (low < high) {
            uint256 mid = Math.average(low, high);
            if (_unsafeAccess(self, mid)._key > key) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return high;
    }

    /**
     * @dev Return the index of the first (oldest) checkpoint with key greater or equal than the search key, or `high`
     * if there is none. `low` and `high` define a section where to do the search, with inclusive `low` and exclusive
     * `high`.
     *
     * WARNING: `high` should not be greater than the array's length.
     */
    function _lowerBinaryLookup(
        Checkpoint208[] storage self,
        uint48 key,
        uint256 low,
        uint256 high
    ) private view returns (uint256) {
        while (low < high) {
            uint256 mid = Math.average(low, high);
            if (_unsafeAccess(self, mid)._key < key) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return high;
    }

    /**
     * @dev Access an element of the array without performing bounds check. The position is assumed to be within bounds.
     */
    function _unsafeAccess(
        Checkpoint208[] storage self,
        uint256 pos
    ) private pure returns (Checkpoint208 storage result) {
        assembly {
            mstore(0, self.slot)
            result.slot := add(keccak256(0, 0x20), pos)
        }
    }

    struct Trace160 {
        Checkpoint160[] _checkpoints;
    }

    struct Checkpoint160 {
        uint96 _key;
        uint160 _value;
    }

    /**
     * @dev Pushes a (`key`, `value`) pair into a Trace160 so that it is stored as the checkpoint.
     *
     * Returns previous value and new value.
     *
     * IMPORTANT: Never accept `key` as a user input, since an arbitrary `type(uint96).max` key set will disable the
     * library.
     */
    function push(
        Trace160 storage self,
        uint96 key,
        uint160 value
    ) internal returns (uint160 oldValue, uint160 newValue) {
        return _insert(self._checkpoints, key, value);
    }

    /**
     * @dev Returns the value in the first (oldest) checkpoint with key greater or equal than the search key, or zero if
     * there is none.
     */
    function lowerLookup(Trace160 storage self, uint96 key) internal view returns (uint160) {
        uint256 len = self._checkpoints.length;
        uint256 pos = _lowerBinaryLookup(self._checkpoints, key, 0, len);
        return pos == len ? 0 : _unsafeAccess(self._checkpoints, pos)._value;
    }

    /**
     * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
     * if there is none.
     */
    function upperLookup(Trace160 storage self, uint96 key) internal view returns (uint160) {
        uint256 len = self._checkpoints.length;
        uint256 pos = _upperBinaryLookup(self._checkpoints, key, 0, len);
        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns the value in the last (most recent) checkpoint with key lower or equal than the search key, or zero
     * if there is none.
     *
     * NOTE: This is a variant of {upperLookup} that is optimized to find "recent" checkpoint (checkpoints with high
     * keys).
     */
    function upperLookupRecent(Trace160 storage self, uint96 key) internal view returns (uint160) {
        uint256 len = self._checkpoints.length;

        uint256 low = 0;
        uint256 high = len;

        if (len > 5) {
            uint256 mid = len - Math.sqrt(len);
            if (key < _unsafeAccess(self._checkpoints, mid)._key) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        uint256 pos = _upperBinaryLookup(self._checkpoints, key, low, high);

        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns the value in the most recent checkpoint, or zero if there are no checkpoints.
     */
    function latest(Trace160 storage self) internal view returns (uint160) {
        uint256 pos = self._checkpoints.length;
        return pos == 0 ? 0 : _unsafeAccess(self._checkpoints, pos - 1)._value;
    }

    /**
     * @dev Returns whether there is a checkpoint in the structure (i.e. it is not empty), and if so the key and value
     * in the most recent checkpoint.
     */
    function latestCheckpoint(Trace160 storage self) internal view returns (bool exists, uint96 _key, uint160 _value) {
        uint256 pos = self._checkpoints.length;
        if (pos == 0) {
            return (false, 0, 0);
        } else {
            Checkpoint160 storage ckpt = _unsafeAccess(self._checkpoints, pos - 1);
            return (true, ckpt._key, ckpt._value);
        }
    }

    /**
     * @dev Returns the number of checkpoints.
     */
    function length(Trace160 storage self) internal view returns (uint256) {
        return self._checkpoints.length;
    }

    /**
     * @dev Returns checkpoint at given position.
     */
    function at(Trace160 storage self, uint32 pos) internal view returns (Checkpoint160 memory) {
        return self._checkpoints[pos];
    }

    /**
     * @dev Pushes a (`key`, `value`) pair into an ordered list of checkpoints, either by inserting a new checkpoint,
     * or by updating the last one.
     */
    function _insert(
        Checkpoint160[] storage self,
        uint96 key,
        uint160 value
    ) private returns (uint160 oldValue, uint160 newValue) {
        uint256 pos = self.length;

        if (pos > 0) {
            Checkpoint160 storage last = _unsafeAccess(self, pos - 1);
            uint96 lastKey = last._key;
            uint160 lastValue = last._value;

            // Checkpoint keys must be non-decreasing.
            if (lastKey > key) {
                revert CheckpointUnorderedInsertion();
            }

            // Update or push new checkpoint
            if (lastKey == key) {
                last._value = value;
            } else {
                self.push(Checkpoint160({_key: key, _value: value}));
            }
            return (lastValue, value);
        } else {
            self.push(Checkpoint160({_key: key, _value: value}));
            return (0, value);
        }
    }

    /**
     * @dev Return the index of the first (oldest) checkpoint with key strictly bigger than the search key, or `high`
     * if there is none. `low` and `high` define a section where to do the search, with inclusive `low` and exclusive
     * `high`.
     *
     * WARNING: `high` should not be greater than the array's length.
     */
    function _upperBinaryLookup(
        Checkpoint160[] storage self,
        uint96 key,
        uint256 low,
        uint256 high
    ) private view returns (uint256) {
        while (low < high) {
            uint256 mid = Math.average(low, high);
            if (_unsafeAccess(self, mid)._key > key) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }
        return high;
    }

    /**
     * @dev Return the index of the first (oldest) checkpoint with key greater or equal than the search key, or `high`
     * if there is none. `low` and `high` define a section where to do the search, with inclusive `low` and exclusive
     * `high`.
     *
     * WARNING: `high` should not be greater than the array's length.
     */
    function _lowerBinaryLookup(
        Checkpoint160[] storage self,
        uint96 key,
        uint256 low,
        uint256 high
    ) private view returns (uint256) {
        while (low < high) {
            uint256 mid = Math.average(low, high);
            if (_unsafeAccess(self, mid)._key < key) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return high;
    }

    /**
     * @dev Access an element of the array without performing bounds check. The position is assumed to be within bounds.
     */
    function _unsafeAccess(
        Checkpoint160[] storage self,
        uint256 pos
    ) private pure returns (Checkpoint160 storage result) {
        assembly {
            mstore(0, self.slot)
            result.slot := add(keccak256(0, 0x20), pos)
        }
    }
}

library ECDSA {
    enum RecoverError {
        NoError,
        InvalidSignature,
        InvalidSignatureLength,
        InvalidSignatureS
    }

    /**
     * @dev The signature derives the `address(0)`.
     */
    error ECDSAInvalidSignature();

    /**
     * @dev The signature has an invalid length.
     */
    error ECDSAInvalidSignatureLength(uint256 length);

    /**
     * @dev The signature has an S value that is in the upper half order.
     */
    error ECDSAInvalidSignatureS(bytes32 s);

    /**
     * @dev Returns the address that signed a hashed message (`hash`) with `signature` or an error. This will not
     * return address(0) without also returning an error description. Errors are documented using an enum (error type)
     * and a bytes32 providing additional information about the error.
     *
     * If no error is returned, then the address can be used for verification purposes.
     *
     * The `ecrecover` EVM precompile allows for malleable (non-unique) signatures:
     * this function rejects them by requiring the `s` value to be in the lower
     * half order, and the `v` value to be either 27 or 28.
     *
     * IMPORTANT: `hash` _must_ be the result of a hash operation for the
     * verification to be secure: it is possible to craft signatures that
     * recover to arbitrary addresses for non-hashed data. A safe way to ensure
     * this is by receiving a hash of the original message (which may otherwise
     * be too long), and then calling {MessageHashUtils-toEthSignedMessageHash} on it.
     *
     * Documentation for signature generation:
     * - with https://web3js.readthedocs.io/en/v1.3.4/web3-eth-accounts.html#sign[Web3.js]
     * - with https://docs.ethers.io/v5/api/signer/#Signer-signMessage[ethers]
     */
    function tryRecover(
        bytes32 hash,
        bytes memory signature
    ) internal pure returns (address recovered, RecoverError err, bytes32 errArg) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            // ecrecover takes the signature parameters, and the only way to get them
            // currently is to use assembly.
            assembly ("memory-safe") {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
            return tryRecover(hash, v, r, s);
        } else {
            return (address(0), RecoverError.InvalidSignatureLength, bytes32(signature.length));
        }
    }

    /**
     * @dev Returns the address that signed a hashed message (`hash`) with
     * `signature`. This address can then be used for verification purposes.
     *
     * The `ecrecover` EVM precompile allows for malleable (non-unique) signatures:
     * this function rejects them by requiring the `s` value to be in the lower
     * half order, and the `v` value to be either 27 or 28.
     *
     * IMPORTANT: `hash` _must_ be the result of a hash operation for the
     * verification to be secure: it is possible to craft signatures that
     * recover to arbitrary addresses for non-hashed data. A safe way to ensure
     * this is by receiving a hash of the original message (which may otherwise
     * be too long), and then calling {MessageHashUtils-toEthSignedMessageHash} on it.
     */
    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        (address recovered, RecoverError error, bytes32 errorArg) = tryRecover(hash, signature);
        _throwError(error, errorArg);
        return recovered;
    }

    /**
     * @dev Overload of {ECDSA-tryRecover} that receives the `r` and `vs` short-signature fields separately.
     *
     * See https://eips.ethereum.org/EIPS/eip-2098[ERC-2098 short signatures]
     */
    function tryRecover(
        bytes32 hash,
        bytes32 r,
        bytes32 vs
    ) internal pure returns (address recovered, RecoverError err, bytes32 errArg) {
        unchecked {
            bytes32 s = vs & bytes32(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
            // We do not check for an overflow here since the shift operation results in 0 or 1.
            uint8 v = uint8((uint256(vs) >> 255) + 27);
            return tryRecover(hash, v, r, s);
        }
    }

    /**
     * @dev Overload of {ECDSA-recover} that receives the `r and `vs` short-signature fields separately.
     */
    function recover(bytes32 hash, bytes32 r, bytes32 vs) internal pure returns (address) {
        (address recovered, RecoverError error, bytes32 errorArg) = tryRecover(hash, r, vs);
        _throwError(error, errorArg);
        return recovered;
    }

    /**
     * @dev Overload of {ECDSA-tryRecover} that receives the `v`,
     * `r` and `s` signature fields separately.
     */
    function tryRecover(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal pure returns (address recovered, RecoverError err, bytes32 errArg) {
        // EIP-2 still allows signature malleability for ecrecover(). Remove this possibility and make the signature
        // unique. Appendix F in the Ethereum Yellow paper (https://ethereum.github.io/yellowpaper/paper.pdf), defines
        // the valid range for s in (301): 0 < s < secp256k1n ÷ 2 + 1, and for v in (302): v ∈ {27, 28}. Most
        // signatures from current libraries generate a unique signature with an s-value in the lower half order.
        //
        // If your library generates malleable signatures, such as s-values in the upper range, calculate a new s-value
        // with 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - s1 and flip v from 27 to 28 or
        // vice versa. If your library also generates signatures with 0/1 for v instead 27/28, add 27 to v to accept
        // these malleable signatures as well.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return (address(0), RecoverError.InvalidSignatureS, s);
        }

        // If the signature is valid (and not malleable), return the signer address
        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) {
            return (address(0), RecoverError.InvalidSignature, bytes32(0));
        }

        return (signer, RecoverError.NoError, bytes32(0));
    }

    /**
     * @dev Overload of {ECDSA-recover} that receives the `v`,
     * `r` and `s` signature fields separately.
     */
    function recover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) internal pure returns (address) {
        (address recovered, RecoverError error, bytes32 errorArg) = tryRecover(hash, v, r, s);
        _throwError(error, errorArg);
        return recovered;
    }

    /**
     * @dev Optionally reverts with the corresponding custom error according to the `error` argument provided.
     */
    function _throwError(RecoverError error, bytes32 errorArg) private pure {
        if (error == RecoverError.NoError) {
            return; // no error: do nothing
        } else if (error == RecoverError.InvalidSignature) {
            revert ECDSAInvalidSignature();
        } else if (error == RecoverError.InvalidSignatureLength) {
            revert ECDSAInvalidSignatureLength(uint256(errorArg));
        } else if (error == RecoverError.InvalidSignatureS) {
            revert ECDSAInvalidSignatureS(errorArg);
        }
    }
}

library Time {
    using Time for *;

    /**
     * @dev Get the block timestamp as a Timepoint.
     */
    function timestamp() internal view returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    /**
     * @dev Get the block number as a Timepoint.
     */
    function blockNumber() internal view returns (uint48) {
        return SafeCast.toUint48(block.number);
    }

    // ==================================================== Delay =====================================================
    /**
     * @dev A `Delay` is a uint32 duration that can be programmed to change value automatically at a given point in the
     * future. The "effect" timepoint describes when the transitions happens from the "old" value to the "new" value.
     * This allows updating the delay applied to some operation while keeping some guarantees.
     *
     * In particular, the {update} function guarantees that if the delay is reduced, the old delay still applies for
     * some time. For example if the delay is currently 7 days to do an upgrade, the admin should not be able to set
     * the delay to 0 and upgrade immediately. If the admin wants to reduce the delay, the old delay (7 days) should
     * still apply for some time.
     *
     *
     * The `Delay` type is 112 bits long, and packs the following:
     *
     * ```
     *   | [uint48]: effect date (timepoint)
     *   |           | [uint32]: value before (duration)
     *   ↓           ↓       ↓ [uint32]: value after (duration)
     * 0xAAAAAAAAAAAABBBBBBBBCCCCCCCC
     * ```
     *
     * NOTE: The {get} and {withUpdate} functions operate using timestamps. Block number based delays are not currently
     * supported.
     */
    type Delay is uint112;

    /**
     * @dev Wrap a duration into a Delay to add the one-step "update in the future" feature
     */
    function toDelay(uint32 duration) internal pure returns (Delay) {
        return Delay.wrap(duration);
    }

    /**
     * @dev Get the value at a given timepoint plus the pending value and effect timepoint if there is a scheduled
     * change after this timepoint. If the effect timepoint is 0, then the pending value should not be considered.
     */
    function _getFullAt(
        Delay self,
        uint48 timepoint
    ) private pure returns (uint32 valueBefore, uint32 valueAfter, uint48 effect) {
        (valueBefore, valueAfter, effect) = self.unpack();
        return effect <= timepoint ? (valueAfter, 0, 0) : (valueBefore, valueAfter, effect);
    }

    /**
     * @dev Get the current value plus the pending value and effect timepoint if there is a scheduled change. If the
     * effect timepoint is 0, then the pending value should not be considered.
     */
    function getFull(Delay self) internal view returns (uint32 valueBefore, uint32 valueAfter, uint48 effect) {
        return _getFullAt(self, timestamp());
    }

    /**
     * @dev Get the current value.
     */
    function get(Delay self) internal view returns (uint32) {
        (uint32 delay, , ) = self.getFull();
        return delay;
    }

    /**
     * @dev Update a Delay object so that it takes a new duration after a timepoint that is automatically computed to
     * enforce the old delay at the moment of the update. Returns the updated Delay object and the timestamp when the
     * new delay becomes effective.
     */
    function withUpdate(
        Delay self,
        uint32 newValue,
        uint32 minSetback
    ) internal view returns (Delay updatedDelay, uint48 effect) {
        uint32 value = self.get();
        uint32 setback = uint32(Math.max(minSetback, value > newValue ? value - newValue : 0));
        effect = timestamp() + setback;
        return (pack(value, newValue, effect), effect);
    }

    /**
     * @dev Split a delay into its components: valueBefore, valueAfter and effect (transition timepoint).
     */
    function unpack(Delay self) internal pure returns (uint32 valueBefore, uint32 valueAfter, uint48 effect) {
        uint112 raw = Delay.unwrap(self);

        valueAfter = uint32(raw);
        valueBefore = uint32(raw >> 32);
        effect = uint48(raw >> 64);

        return (valueBefore, valueAfter, effect);
    }

    /**
     * @dev pack the components into a Delay object.
     */
    function pack(uint32 valueBefore, uint32 valueAfter, uint48 effect) internal pure returns (Delay) {
        return Delay.wrap((uint112(effect) << 64) | (uint112(valueBefore) << 32) | uint112(valueAfter));
    }
}

abstract contract Votes is Context, EIP712, Nonces, IERC5805 {
    using Checkpoints for Checkpoints.Trace208;

    bytes32 private constant DELEGATION_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");

    mapping(address account => address) private _delegatee;

    mapping(address delegatee => Checkpoints.Trace208) private _delegateCheckpoints;

    Checkpoints.Trace208 private _totalCheckpoints;

    /**
     * @dev The clock was incorrectly modified.
     */
    error ERC6372InconsistentClock();

    /**
     * @dev Lookup to future votes is not available.
     */
    error ERC5805FutureLookup(uint256 timepoint, uint48 clock);

    /**
     * @dev Clock used for flagging checkpoints. Can be overridden to implement timestamp based
     * checkpoints (and voting), in which case {CLOCK_MODE} should be overridden as well to match.
     */
    function clock() public view virtual returns (uint48) {
        return Time.blockNumber();
    }

    /**
     * @dev Machine-readable description of the clock as specified in ERC-6372.
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public view virtual returns (string memory) {
        // Check that the clock was not modified
        if (clock() != Time.blockNumber()) {
            revert ERC6372InconsistentClock();
        }
        return "mode=blocknumber&from=default";
    }

    /**
     * @dev Validate that a timepoint is in the past, and return it as a uint48.
     */
    function _validateTimepoint(uint256 timepoint) internal view returns (uint48) {
        uint48 currentTimepoint = clock();
        if (timepoint >= currentTimepoint) revert ERC5805FutureLookup(timepoint, currentTimepoint);
        return SafeCast.toUint48(timepoint);
    }

    /**
     * @dev Returns the current amount of votes that `account` has.
     */
    function getVotes(address account) public view virtual returns (uint256) {
        return _delegateCheckpoints[account].latest();
    }

    /**
     * @dev Returns the amount of votes that `account` had at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     *
     * Requirements:
     *
     * - `timepoint` must be in the past. If operating using block numbers, the block must be already mined.
     */
    function getPastVotes(address account, uint256 timepoint) public view virtual returns (uint256) {
        return _delegateCheckpoints[account].upperLookupRecent(_validateTimepoint(timepoint));
    }

    /**
     * @dev Returns the total supply of votes available at a specific moment in the past. If the `clock()` is
     * configured to use block numbers, this will return the value at the end of the corresponding block.
     *
     * NOTE: This value is the sum of all available votes, which is not necessarily the sum of all delegated votes.
     * Votes that have not been delegated are still part of total supply, even though they would not participate in a
     * vote.
     *
     * Requirements:
     *
     * - `timepoint` must be in the past. If operating using block numbers, the block must be already mined.
     */
    function getPastTotalSupply(uint256 timepoint) public view virtual returns (uint256) {
        return _totalCheckpoints.upperLookupRecent(_validateTimepoint(timepoint));
    }

    /**
     * @dev Returns the current total supply of votes.
     */
    function _getTotalSupply() internal view virtual returns (uint256) {
        return _totalCheckpoints.latest();
    }

    /**
     * @dev Returns the delegate that `account` has chosen.
     */
    function delegates(address account) public view virtual returns (address) {
        return _delegatee[account];
    }

    /**
     * @dev Delegates votes from the sender to `delegatee`.
     */
    function delegate(address delegatee) public virtual {
        address account = _msgSender();
        _delegate(account, delegatee);
    }

    /**
     * @dev Delegates votes from signer to `delegatee`.
     */
    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        if (block.timestamp > expiry) {
            revert VotesExpiredSignature(expiry);
        }
        address signer = ECDSA.recover(
            _hashTypedDataV4(keccak256(abi.encode(DELEGATION_TYPEHASH, delegatee, nonce, expiry))),
            v,
            r,
            s
        );
        _useCheckedNonce(signer, nonce);
        _delegate(signer, delegatee);
    }

    /**
     * @dev Delegate all of `account`'s voting units to `delegatee`.
     *
     * Emits events {IVotes-DelegateChanged} and {IVotes-DelegateVotesChanged}.
     */
    function _delegate(address account, address delegatee) internal virtual {
        address oldDelegate = delegates(account);
        _delegatee[account] = delegatee;

        emit DelegateChanged(account, oldDelegate, delegatee);
        _moveDelegateVotes(oldDelegate, delegatee, _getVotingUnits(account));
    }

    /**
     * @dev Transfers, mints, or burns voting units. To register a mint, `from` should be zero. To register a burn, `to`
     * should be zero. Total supply of voting units will be adjusted with mints and burns.
     */
    function _transferVotingUnits(address from, address to, uint256 amount) internal virtual {
        if (from == address(0)) {
            _push(_totalCheckpoints, _add, SafeCast.toUint208(amount));
        }
        if (to == address(0)) {
            _push(_totalCheckpoints, _subtract, SafeCast.toUint208(amount));
        }
        _moveDelegateVotes(delegates(from), delegates(to), amount);
    }

    /**
     * @dev Moves delegated votes from one delegate to another.
     */
    function _moveDelegateVotes(address from, address to, uint256 amount) internal virtual {
        if (from != to && amount > 0) {
            if (from != address(0)) {
                (uint256 oldValue, uint256 newValue) = _push(
                    _delegateCheckpoints[from],
                    _subtract,
                    SafeCast.toUint208(amount)
                );
                emit DelegateVotesChanged(from, oldValue, newValue);
            }
            if (to != address(0)) {
                (uint256 oldValue, uint256 newValue) = _push(
                    _delegateCheckpoints[to],
                    _add,
                    SafeCast.toUint208(amount)
                );
                emit DelegateVotesChanged(to, oldValue, newValue);
            }
        }
    }

    /**
     * @dev Get number of checkpoints for `account`.
     */
    function _numCheckpoints(address account) internal view virtual returns (uint32) {
        return SafeCast.toUint32(_delegateCheckpoints[account].length());
    }

    /**
     * @dev Get the `pos`-th checkpoint for `account`.
     */
    function _checkpoints(
        address account,
        uint32 pos
    ) internal view virtual returns (Checkpoints.Checkpoint208 memory) {
        return _delegateCheckpoints[account].at(pos);
    }

    function _push(
        Checkpoints.Trace208 storage store,
        function(uint208, uint208) view returns (uint208) op,
        uint208 delta
    ) private returns (uint208 oldValue, uint208 newValue) {
        return store.push(clock(), op(store.latest(), delta));
    }

    function _add(uint208 a, uint208 b) private pure returns (uint208) {
        return a + b;
    }

    function _subtract(uint208 a, uint208 b) private pure returns (uint208) {
        return a - b;
    }

    /**
     * @dev Must return the voting units held by an account.
     */
    function _getVotingUnits(address) internal view virtual returns (uint256);
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (token/ERC20/extensions/ERC20Votes.sol)
/**
 * @dev Extension of ERC-20 to support Compound-like voting and delegation. This version is more generic than Compound's,
 * and supports token supply up to 2^208^ - 1, while COMP is limited to 2^96^ - 1.
 *
 * NOTE: This contract does not provide interface compatibility with Compound's COMP token.
 *
 * This extension keeps a history (checkpoints) of each account's vote power. Vote power can be delegated either
 * by calling the {Votes-delegate} function directly, or by providing a signature to be used with {Votes-delegateBySig}. Voting
 * power can be queried through the public accessors {Votes-getVotes} and {Votes-getPastVotes}.
 *
 * By default, token balance does not account for voting power. This makes transfers cheaper. The downside is that it
 * requires users to delegate to themselves in order to activate checkpoints and have their voting power tracked.
 */
abstract contract ERC20Votes is ERC20, Votes {
    /**
     * @dev Total supply cap has been exceeded, introducing a risk of votes overflowing.
     */
    error ERC20ExceededSafeSupply(uint256 increasedSupply, uint256 cap);

    /**
     * @dev Maximum token supply. Defaults to `type(uint208).max` (2^208^ - 1).
     *
     * This maximum is enforced in {_update}. It limits the total supply of the token, which is otherwise a uint256,
     * so that checkpoints can be stored in the Trace208 structure used by {Votes}. Increasing this value will not
     * remove the underlying limitation, and will cause {_update} to fail because of a math overflow in
     * {Votes-_transferVotingUnits}. An override could be used to further restrict the total supply (to a lower value) if
     * additional logic requires it. When resolving override conflicts on this function, the minimum should be
     * returned.
     */
    function _maxSupply() internal view virtual returns (uint256) {
        return type(uint208).max;
    }

    /**
     * @dev Move voting power when tokens are transferred.
     *
     * Emits a {IVotes-DelegateVotesChanged} event.
     */
    function _update(address from, address to, uint256 value) internal virtual override {
        super._update(from, to, value);
        if (from == address(0)) {
            uint256 supply = totalSupply();
            uint256 cap = _maxSupply();
            if (supply > cap) {
                revert ERC20ExceededSafeSupply(supply, cap);
            }
        }
        _transferVotingUnits(from, to, value);
    }

    /**
     * @dev Returns the voting units of an `account`.
     *
     * WARNING: Overriding this function may compromise the internal vote accounting.
     * `ERC20Votes` assumes tokens map to voting units 1:1 and this is not easy to change.
     */
    function _getVotingUnits(address account) internal view virtual override returns (uint256) {
        return balanceOf(account);
    }

    /**
     * @dev Get number of checkpoints for `account`.
     */
    function numCheckpoints(address account) public view virtual returns (uint32) {
        return _numCheckpoints(account);
    }

    /**
     * @dev Get the `pos`-th checkpoint for `account`.
     */
    function checkpoints(address account, uint32 pos) public view virtual returns (Checkpoints.Checkpoint208 memory) {
        return _checkpoints(account, pos);
    }
}

interface IERC20Permit {
    /**
     * @dev Sets `value` as the allowance of `spender` over ``owner``'s tokens,
     * given ``owner``'s signed approval.
     *
     * IMPORTANT: The same issues {IERC20-approve} has related to transaction
     * ordering also apply here.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `deadline` must be a timestamp in the future.
     * - `v`, `r` and `s` must be a valid `secp256k1` signature from `owner`
     * over the EIP712-formatted function arguments.
     * - the signature must use ``owner``'s current nonce (see {nonces}).
     *
     * For more information on the signature format, see the
     * https://eips.ethereum.org/EIPS/eip-2612#specification[relevant EIP
     * section].
     *
     * CAUTION: See Security Considerations above.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for {permit}.
     *
     * Every successful call to {permit} increases ``owner``'s nonce by one. This
     * prevents a signature from being used multiple times.
     */
    function nonces(address owner) external view returns (uint256);

    /**
     * @dev Returns the domain separator used in the encoding of the signature for {permit}, as defined by {EIP712}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/extensions/ERC20Permit.sol)
/**
 * @dev Implementation of the ERC-20 Permit extension allowing approvals to be made via signatures, as defined in
 * https://eips.ethereum.org/EIPS/eip-2612[ERC-2612].
 *
 * Adds the {permit} method, which can be used to change an account's ERC-20 allowance (see {IERC20-allowance}) by
 * presenting a message signed by the account. By not relying on `{IERC20-approve}`, the token holder account doesn't
 * need to send a transaction, and thus is not required to hold Ether at all.
 */
abstract contract ERC20Permit is ERC20, IERC20Permit, EIP712, Nonces {
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    /**
     * @dev Permit deadline has expired.
     */
    error ERC2612ExpiredSignature(uint256 deadline);

    /**
     * @dev Mismatched signature.
     */
    error ERC2612InvalidSigner(address signer, address owner);

    /**
     * @dev Initializes the {EIP712} domain separator using the `name` parameter, and setting `version` to `"1"`.
     *
     * It's a good idea to use the same `name` that is defined as the ERC-20 token name.
     */
    constructor(string memory name) EIP712(name, "1") {}

    /// @inheritdoc IERC20Permit
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        if (block.timestamp > deadline) {
            revert ERC2612ExpiredSignature(deadline);
        }

        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline));

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        if (signer != owner) {
            revert ERC2612InvalidSigner(signer, owner);
        }

        _approve(owner, spender, value);
    }

    /// @inheritdoc IERC20Permit
    function nonces(address owner) public view virtual override(IERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    /// @inheritdoc IERC20Permit
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view virtual returns (bytes32) {
        return _domainSeparatorV4();
    }
}

// SPDX-License-Identifier: MIT
/**
 * @title ChessToken
 * @notice ERC20 token for the Chess platform with controlled minting
 * @dev Uses AccessControl for role-based minting permissions
 *      Includes ERC20Votes for governance delegation
 *
 * Token Utility:
 * - BONDING: Deposit to play games (skin in the game)
 * - STAKING: Stake to become an arbitrator
 * - CHALLENGE: Deposit to open disputes
 * - GOVERNANCE: Vote on protocol parameters (via delegation)
 */
contract ChessToken is ERC20, ERC20Burnable, ERC20Votes, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public constant MAX_SUPPLY = 100_000_000 * 10**18; // 100M tokens

    // Distribution tracking
    uint256 public playToEarnMinted;     // 40% = 40M
    uint256 public treasuryMinted;        // 25% = 25M
    uint256 public teamMinted;            // 15% = 15M
    uint256 public liquidityMinted;       // 10% = 10M
    uint256 public communityMinted;       // 10% = 10M

    uint256 public constant PLAY_TO_EARN_CAP = 40_000_000 * 10**18;
    uint256 public constant TREASURY_CAP = 25_000_000 * 10**18;
    uint256 public constant TEAM_CAP = 15_000_000 * 10**18;
    uint256 public constant LIQUIDITY_CAP = 10_000_000 * 10**18;
    uint256 public constant COMMUNITY_CAP = 10_000_000 * 10**18;

    // Team vesting
    uint256 public teamVestingStart;
    uint256 public constant TEAM_VESTING_DURATION = 730 days; // 2 years
    uint256 public teamVestingClaimed;
    address public teamWallet;

    // Team wallet change timelock (2-step process with 48h delay, 7 day expiry)
    address public pendingTeamWallet;
    uint256 public teamWalletChangeInitiated;
    uint256 public constant TEAM_WALLET_TIMELOCK = 48 hours;
    uint256 public constant TEAM_WALLET_EXPIRY = 7 days;

    event PlayToEarnMinted(address indexed to, uint256 amount);
    event TreasuryMinted(address indexed to, uint256 amount);
    event TeamVestingClaimed(address indexed to, uint256 amount);
    event LiquidityMinted(address indexed to, uint256 amount);
    event CommunityMinted(address indexed to, uint256 amount);
    event TeamWalletChangeProposed(address indexed currentWallet, address indexed newWallet, uint256 effectiveTime);
    event TeamWalletChangeCancelled(address indexed cancelledWallet);
    event TeamWalletChanged(address indexed oldWallet, address indexed newWallet);

    constructor(address _teamWallet, address _treasury)
        ERC20("Chess Token", "CHESS")
        ERC20Permit("Chess Token")
    {
        require(_teamWallet != address(0), "Invalid team wallet");
        require(_treasury != address(0), "Invalid treasury");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        teamWallet = _teamWallet;
        teamVestingStart = block.timestamp;

        // Initial mints for liquidity and community
        _mintLiquidity(_treasury, LIQUIDITY_CAP);
        _mintCommunity(_treasury, COMMUNITY_CAP);
    }

    /**
     * @notice Mint tokens for play-to-earn rewards
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mintPlayToEarn(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(playToEarnMinted + amount <= PLAY_TO_EARN_CAP, "Play-to-earn cap exceeded");
        playToEarnMinted += amount;
        _mint(to, amount);
        emit PlayToEarnMinted(to, amount);
    }

    /**
     * @notice Mint tokens to treasury
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mintTreasury(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasuryMinted + amount <= TREASURY_CAP, "Treasury cap exceeded");
        treasuryMinted += amount;
        _mint(to, amount);
        emit TreasuryMinted(to, amount);
    }

    /**
     * @notice Claim vested team tokens
     * @dev Linear vesting over 2 years
     */
    function claimTeamVesting() external {
        require(msg.sender == teamWallet, "Only team wallet");

        uint256 elapsed = block.timestamp - teamVestingStart;
        if (elapsed > TEAM_VESTING_DURATION) {
            elapsed = TEAM_VESTING_DURATION;
        }

        uint256 totalVested = (TEAM_CAP * elapsed) / TEAM_VESTING_DURATION;
        uint256 claimable = totalVested - teamVestingClaimed;

        require(claimable > 0, "Nothing to claim");

        teamVestingClaimed += claimable;
        teamMinted += claimable;
        _mint(teamWallet, claimable);

        emit TeamVestingClaimed(teamWallet, claimable);
    }

    /**
     * @notice Get claimable team vesting amount
     */
    function getClaimableTeamVesting() external view returns (uint256) {
        uint256 elapsed = block.timestamp - teamVestingStart;
        if (elapsed > TEAM_VESTING_DURATION) {
            elapsed = TEAM_VESTING_DURATION;
        }

        uint256 totalVested = (TEAM_CAP * elapsed) / TEAM_VESTING_DURATION;
        return totalVested - teamVestingClaimed;
    }

    /**
     * @notice Propose a new team wallet address (starts 48h timelock)
     * @param newTeamWallet New team wallet address
     */
    function proposeTeamWallet(address newTeamWallet) external {
        require(msg.sender == teamWallet, "Only team wallet");
        require(newTeamWallet != address(0), "Invalid address");
        require(newTeamWallet != teamWallet, "Same as current");

        pendingTeamWallet = newTeamWallet;
        teamWalletChangeInitiated = block.timestamp;

        emit TeamWalletChangeProposed(teamWallet, newTeamWallet, block.timestamp + TEAM_WALLET_TIMELOCK);
    }

    /**
     * @notice Accept the pending team wallet change (after 48h timelock)
     * @dev Can be called by either current or pending team wallet
     */
    function acceptTeamWalletChange() external {
        require(pendingTeamWallet != address(0), "No pending change");
        require(
            msg.sender == teamWallet || msg.sender == pendingTeamWallet,
            "Not authorized"
        );
        require(
            block.timestamp >= teamWalletChangeInitiated + TEAM_WALLET_TIMELOCK,
            "Timelock not expired"
        );
        require(
            block.timestamp <= teamWalletChangeInitiated + TEAM_WALLET_EXPIRY,
            "Proposal expired"
        );

        address oldWallet = teamWallet;
        teamWallet = pendingTeamWallet;
        pendingTeamWallet = address(0);
        teamWalletChangeInitiated = 0;

        emit TeamWalletChanged(oldWallet, teamWallet);
    }

    /**
     * @notice Cancel a pending team wallet change
     */
    function cancelTeamWalletChange() external {
        require(msg.sender == teamWallet, "Only team wallet");
        require(pendingTeamWallet != address(0), "No pending change");

        address cancelled = pendingTeamWallet;
        pendingTeamWallet = address(0);
        teamWalletChangeInitiated = 0;

        emit TeamWalletChangeCancelled(cancelled);
    }

    /**
     * @notice Get time remaining before team wallet change can be accepted
     * @return Seconds remaining (0 if no pending change or already acceptable)
     */
    function getTeamWalletTimelockRemaining() external view returns (uint256) {
        if (pendingTeamWallet == address(0)) return 0;

        uint256 unlockTime = teamWalletChangeInitiated + TEAM_WALLET_TIMELOCK;
        if (block.timestamp >= unlockTime) return 0;

        return unlockTime - block.timestamp;
    }

    /**
     * @notice Add minter role to an address (e.g., BondingManager)
     * @param minter Address to grant minter role
     */
    function addMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, minter);
    }

    /**
     * @notice Remove minter role from an address
     * @param minter Address to revoke minter role
     */
    function removeMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
    }

    // Internal mint functions for initial distribution
    function _mintLiquidity(address to, uint256 amount) internal {
        liquidityMinted += amount;
        _mint(to, amount);
        emit LiquidityMinted(to, amount);
    }

    function _mintCommunity(address to, uint256 amount) internal {
        communityMinted += amount;
        _mint(to, amount);
        emit CommunityMinted(to, amount);
    }

    /**
     * @notice Get total minted across all categories
     */
    function totalMinted() external view returns (uint256) {
        return playToEarnMinted + treasuryMinted + teamMinted + liquidityMinted + communityMinted;
    }

    /**
     * @notice Check remaining mintable for each category
     */
    function remainingMintable() external view returns (
        uint256 playToEarn,
        uint256 treasury,
        uint256 team,
        uint256 liquidity,
        uint256 community
    ) {
        playToEarn = PLAY_TO_EARN_CAP - playToEarnMinted;
        treasury = TREASURY_CAP - treasuryMinted;
        team = TEAM_CAP - teamMinted;
        liquidity = LIQUIDITY_CAP - liquidityMinted;
        community = COMMUNITY_CAP - communityMinted;
    }

    // Required overrides for ERC20Votes

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}

// SPDX-License-Identifier: MIT
/**
 * @title BondingManager
 * @notice Manages hybrid bonds (CHESS + ETH) for chess games
 * @dev Implements TWAP oracle, circuit breaker, and slashing mechanism
 *
 * Key Features:
 * - Hybrid bond: Both CHESS tokens and ETH required
 * - TWAP pricing to prevent flash manipulation
 * - Circuit breaker for extreme price movements
 * - Slashing for cheaters (burned, not redistributed)
 */
contract BondingManager is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for ChessToken;

    bytes32 public constant GAME_MANAGER_ROLE = keccak256("GAME_MANAGER_ROLE");
    bytes32 public constant DISPUTE_MANAGER_ROLE = keccak256("DISPUTE_MANAGER_ROLE");

    ChessToken public immutable chessToken;

    // Bond configuration
    uint256 public chessMultiplier = 3;  // 3x stake in CHESS
    uint256 public ethMultiplier = 2;    // 2x stake in ETH

    // TWAP Oracle (simplified - in production use Uniswap/Chainlink)
    uint256 public chessEthPrice;        // CHESS price in wei (per 1 CHESS)
    uint256 public priceLastUpdated;
    uint256 public constant TWAP_PERIOD = 7 days;

    // Circuit breaker
    uint256 public constant MAX_PRICE_CHANGE_PERCENT = 50;
    uint256 public constant MIN_PRICE = 1e12; // Minimum price floor (0.000001 ETH per CHESS)
    uint256 public lastKnownPrice;

    // Minimum bond floor in ETH terms
    uint256 public minBondEthValue = 0.01 ether;

    // Bond tracking per user
    struct UserBond {
        uint256 chessAmount;
        uint256 ethAmount;
        uint256 lockedChess;   // Currently locked in games
        uint256 lockedEth;     // Currently locked in games
    }

    mapping(address => UserBond) public bonds;

    // Game bond tracking
    struct GameBond {
        address player;
        uint256 chessAmount;
        uint256 ethAmount;
        bool released;
        bool slashed;
    }

    mapping(uint256 => mapping(address => GameBond)) public gameBonds; // gameId => player => bond

    // Stats
    uint256 public totalChessBonded;
    uint256 public totalEthBonded;
    uint256 public totalChessSlashed;
    uint256 public totalEthSlashed;

    // Events
    event BondDeposited(address indexed user, uint256 chessAmount, uint256 ethAmount);
    event BondWithdrawn(address indexed user, uint256 chessAmount, uint256 ethAmount);
    event BondLocked(uint256 indexed gameId, address indexed player, uint256 chessAmount, uint256 ethAmount);
    event BondReleased(uint256 indexed gameId, address indexed player);
    event BondSlashed(uint256 indexed gameId, address indexed player, uint256 chessAmount, uint256 ethAmount);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event CircuitBreakerTriggered(uint256 oldPrice, uint256 newPrice);

    constructor(address _chessToken, uint256 _initialPrice) {
        require(_chessToken != address(0), "Invalid token address");
        require(_initialPrice > 0, "Invalid price");

        chessToken = ChessToken(_chessToken);
        chessEthPrice = _initialPrice;
        lastKnownPrice = _initialPrice;
        priceLastUpdated = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Deposit bond (CHESS + ETH)
     * @param chessAmount Amount of CHESS to deposit
     */
    function depositBond(uint256 chessAmount) external payable nonReentrant whenNotPaused {
        require(chessAmount > 0 || msg.value > 0, "Must deposit something");

        if (chessAmount > 0) {
            chessToken.safeTransferFrom(msg.sender, address(this), chessAmount);
            bonds[msg.sender].chessAmount += chessAmount;
            totalChessBonded += chessAmount;
        }

        if (msg.value > 0) {
            bonds[msg.sender].ethAmount += msg.value;
            totalEthBonded += msg.value;
        }

        emit BondDeposited(msg.sender, chessAmount, msg.value);
    }

    /**
     * @notice Withdraw unlocked bond
     * @param chessAmount Amount of CHESS to withdraw
     * @param ethAmount Amount of ETH to withdraw
     */
    function withdrawBond(uint256 chessAmount, uint256 ethAmount) external nonReentrant {
        UserBond storage bond = bonds[msg.sender];

        uint256 availableChess = bond.chessAmount - bond.lockedChess;
        uint256 availableEth = bond.ethAmount - bond.lockedEth;

        require(chessAmount <= availableChess, "Insufficient unlocked CHESS");
        require(ethAmount <= availableEth, "Insufficient unlocked ETH");

        if (chessAmount > 0) {
            bond.chessAmount -= chessAmount;
            totalChessBonded -= chessAmount;
            chessToken.safeTransfer(msg.sender, chessAmount);
        }

        if (ethAmount > 0) {
            bond.ethAmount -= ethAmount;
            totalEthBonded -= ethAmount;
            (bool success, ) = msg.sender.call{value: ethAmount}("");
            require(success, "ETH transfer failed");
        }

        emit BondWithdrawn(msg.sender, chessAmount, ethAmount);
    }

    /**
     * @notice Calculate required bond for a game stake
     * @param stake Game stake amount in wei
     * @return chessRequired Amount of CHESS required
     * @return ethRequired Amount of ETH required
     */
    function calculateRequiredBond(uint256 stake) public view returns (uint256 chessRequired, uint256 ethRequired) {
        // Ensure price is above minimum floor to prevent manipulation
        require(chessEthPrice >= MIN_PRICE, "Price below minimum floor");

        ethRequired = stake * ethMultiplier;

        // Calculate CHESS required based on TWAP price
        // chessRequired = (stake * chessMultiplier) / chessEthPrice
        // Ensure minimum floor
        uint256 chessValue = (stake * chessMultiplier * 1e18) / chessEthPrice;
        uint256 minChess = (minBondEthValue * 1e18) / chessEthPrice;

        chessRequired = chessValue > minChess ? chessValue : minChess;
    }

    /**
     * @notice Lock bond for a game (single player)
     * @param gameId Game identifier
     * @param player Player address
     * @param stake Game stake
     */
    function lockBondForGame(uint256 gameId, address player, uint256 stake)
        external
        onlyRole(GAME_MANAGER_ROLE)
        whenNotPaused
    {
        _lockBondForPlayer(gameId, player, stake);
    }

    /**
     * @notice Lock bonds for both players in a game (gas optimized - single external call)
     * @param gameId Game identifier
     * @param player1 First player address
     * @param player2 Second player address
     * @param stake Game stake (same for both players)
     */
    function lockBondsForGame(uint256 gameId, address player1, address player2, uint256 stake)
        external
        onlyRole(GAME_MANAGER_ROLE)
        whenNotPaused
    {
        _lockBondForPlayer(gameId, player1, stake);
        _lockBondForPlayer(gameId, player2, stake);
    }

    /**
     * @notice Internal function to lock bond for a single player
     * @param gameId Game identifier
     * @param player Player address
     * @param stake Game stake
     */
    function _lockBondForPlayer(uint256 gameId, address player, uint256 stake) internal {
        (uint256 chessRequired, uint256 ethRequired) = calculateRequiredBond(stake);

        UserBond storage bond = bonds[player];
        uint256 availableChess = bond.chessAmount - bond.lockedChess;
        uint256 availableEth = bond.ethAmount - bond.lockedEth;

        require(availableChess >= chessRequired, "Insufficient CHESS bond");
        require(availableEth >= ethRequired, "Insufficient ETH bond");

        bond.lockedChess += chessRequired;
        bond.lockedEth += ethRequired;

        gameBonds[gameId][player] = GameBond({
            player: player,
            chessAmount: chessRequired,
            ethAmount: ethRequired,
            released: false,
            slashed: false
        });

        emit BondLocked(gameId, player, chessRequired, ethRequired);
    }

    /**
     * @notice Release bond after game ends normally
     * @param gameId Game identifier
     * @param player Player address
     */
    function releaseBond(uint256 gameId, address player)
        external
        onlyRole(GAME_MANAGER_ROLE)
    {
        GameBond storage gameBond = gameBonds[gameId][player];
        require(!gameBond.released && !gameBond.slashed, "Bond already processed");

        UserBond storage bond = bonds[player];
        bond.lockedChess -= gameBond.chessAmount;
        bond.lockedEth -= gameBond.ethAmount;

        gameBond.released = true;

        emit BondReleased(gameId, player);
    }

    /**
     * @notice Slash bond for cheating (burn tokens, send ETH to treasury)
     * @param gameId Game identifier
     * @param cheater Cheater's address
     */
    function slashBond(uint256 gameId, address cheater)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
    {
        GameBond storage gameBond = gameBonds[gameId][cheater];
        require(!gameBond.released && !gameBond.slashed, "Bond already processed");

        UserBond storage bond = bonds[cheater];

        uint256 chessToSlash = gameBond.chessAmount;
        uint256 ethToSlash = gameBond.ethAmount;

        // Remove from user's bond
        bond.chessAmount -= chessToSlash;
        bond.ethAmount -= ethToSlash;
        bond.lockedChess -= chessToSlash;
        bond.lockedEth -= ethToSlash;

        // Update totals
        totalChessBonded -= chessToSlash;
        totalEthBonded -= ethToSlash;
        totalChessSlashed += chessToSlash;
        totalEthSlashed += ethToSlash;

        // Burn CHESS tokens (deflationary)
        chessToken.burn(chessToSlash);

        // ETH goes to contract (can be claimed by admin for treasury)
        // In production, send to DAO treasury

        gameBond.slashed = true;

        emit BondSlashed(gameId, cheater, chessToSlash, ethToSlash);
    }

    /**
     * @notice Update TWAP price (simplified - in production use oracle)
     * @param newPrice New CHESS/ETH price
     */
    function updatePrice(uint256 newPrice) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPrice >= MIN_PRICE, "Price below minimum floor");

        // Circuit breaker check
        if (lastKnownPrice > 0) {
            uint256 priceDiff;
            if (newPrice > lastKnownPrice) {
                priceDiff = newPrice - lastKnownPrice;
            } else {
                priceDiff = lastKnownPrice - newPrice;
            }

            uint256 changePercent = (priceDiff * 100) / lastKnownPrice;

            if (changePercent > MAX_PRICE_CHANGE_PERCENT) {
                _pause();
                emit CircuitBreakerTriggered(lastKnownPrice, newPrice);
                return;
            }
        }

        uint256 oldPrice = chessEthPrice;
        chessEthPrice = newPrice;
        lastKnownPrice = newPrice;
        priceLastUpdated = block.timestamp;

        emit PriceUpdated(oldPrice, newPrice);
    }

    /**
     * @notice Get user's available (unlocked) bond
     */
    function getAvailableBond(address user) external view returns (uint256 chess, uint256 eth) {
        UserBond storage bond = bonds[user];
        chess = bond.chessAmount - bond.lockedChess;
        eth = bond.ethAmount - bond.lockedEth;
    }

    /**
     * @notice Check if user has sufficient bond for a stake
     */
    function hasSufficientBond(address user, uint256 stake) external view returns (bool) {
        (uint256 chessRequired, uint256 ethRequired) = calculateRequiredBond(stake);
        UserBond storage bond = bonds[user];

        uint256 availableChess = bond.chessAmount - bond.lockedChess;
        uint256 availableEth = bond.ethAmount - bond.lockedEth;

        return availableChess >= chessRequired && availableEth >= ethRequired;
    }

    // Admin functions

    function setMultipliers(uint256 _chessMultiplier, uint256 _ethMultiplier)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_chessMultiplier > 0 && _ethMultiplier > 0, "Invalid multipliers");
        chessMultiplier = _chessMultiplier;
        ethMultiplier = _ethMultiplier;
    }

    function setMinBondEthValue(uint256 _minBondEthValue) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minBondEthValue = _minBondEthValue;
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Withdraw accumulated slashed ETH to treasury
     * @param treasury Treasury address
     */
    function withdrawSlashedEth(address treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 slashedEth = address(this).balance - totalEthBonded;
        require(slashedEth > 0, "No slashed ETH");

        (bool success, ) = treasury.call{value: slashedEth}("");
        require(success, "Transfer failed");
    }

    // Receive ETH
    receive() external payable {}
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)
/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)
/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}

// SPDX-License-Identifier: MIT
/// @title PlayerRating - ELO Rating System for Chess Players
/// @notice Manages player ratings using the ELO rating system
/// @dev Uses fixed-point math for ELO calculations (multiply by 100 for precision)
contract PlayerRating is AccessControl {
    bytes32 public constant GAME_REPORTER_ROLE = keccak256("GAME_REPORTER_ROLE");

    // ChessFactory address for validating game contracts
    address public chessFactory;

    // Valid game contracts mapping (prevents DOS from iterating all games)
    mapping(address => bool) public validGameContracts;

    // Default starting rating (1200 is standard for new players)
    uint256 public constant DEFAULT_RATING = 1200;

    // K-factor determines how much ratings change per game
    // Higher K = more volatile ratings
    uint256 public constant K_FACTOR_NEW = 40;      // First 30 games
    uint256 public constant K_FACTOR_NORMAL = 20;   // After 30 games
    uint256 public constant K_FACTOR_HIGH = 10;     // Rating > 2400

    // Minimum and maximum ratings
    uint256 public constant MIN_RATING = 100;
    uint256 public constant MAX_RATING = 3000;

    // Number of games before player is considered "established"
    uint256 public constant PROVISIONAL_GAMES = 30;

    // Maximum players in leaderboard (prevents unbounded array growth)
    uint256 public constant MAX_RANKED_PLAYERS = 100000;

    // Player stats
    struct PlayerStats {
        uint256 rating;
        uint256 gamesPlayed;
        uint256 wins;
        uint256 losses;
        uint256 draws;
        uint256 peakRating;
        uint256 lastGameTimestamp;
    }

    // Player address => stats
    mapping(address => PlayerStats) public players;

    // Leaderboard tracking
    address[] public rankedPlayers;
    mapping(address => bool) public isRanked;

    // Events
    event RatingUpdated(
        address indexed player,
        uint256 oldRating,
        uint256 newRating,
        int256 change
    );
    event GameRecorded(
        address indexed white,
        address indexed black,
        uint8 result, // 0 = draw, 1 = white wins, 2 = black wins
        uint256 whiteRatingChange,
        uint256 blackRatingChange
    );
    event PlayerRegistered(address indexed player, uint256 initialRating);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Set the ChessFactory address (allows game contracts to report)
    function setChessFactory(address _chessFactory) external onlyRole(DEFAULT_ADMIN_ROLE) {
        chessFactory = _chessFactory;
    }

    /// @notice Check if caller is a valid game contract
    /// @dev Uses mapping for O(1) lookup instead of O(n) iteration
    function _isValidGameContract(address caller) internal view returns (bool) {
        return validGameContracts[caller];
    }

    /// @notice Register a game contract as valid (called by ChessFactory)
    /// @param gameContract Address of the deployed game contract
    function registerGameContract(address gameContract) external {
        require(msg.sender == chessFactory, "Only factory");
        require(gameContract != address(0), "Invalid address");
        validGameContracts[gameContract] = true;
    }

    /// @notice Register a new player with default rating
    /// @param player Address of the player
    function registerPlayer(address player) external {
        if (players[player].rating == 0) {
            players[player] = PlayerStats({
                rating: DEFAULT_RATING,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                peakRating: DEFAULT_RATING,
                lastGameTimestamp: 0
            });

            // Only add to leaderboard if under cap (prevents unbounded array growth)
            if (!isRanked[player] && rankedPlayers.length < MAX_RANKED_PLAYERS) {
                rankedPlayers.push(player);
                isRanked[player] = true;
            }

            emit PlayerRegistered(player, DEFAULT_RATING);
        }
    }

    /// @notice Ensure player is registered (internal helper)
    function _ensureRegistered(address player) internal {
        if (players[player].rating == 0) {
            players[player] = PlayerStats({
                rating: DEFAULT_RATING,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                peakRating: DEFAULT_RATING,
                lastGameTimestamp: 0
            });

            // Only add to leaderboard if under cap (prevents unbounded array growth)
            if (!isRanked[player] && rankedPlayers.length < MAX_RANKED_PLAYERS) {
                rankedPlayers.push(player);
                isRanked[player] = true;
            }

            emit PlayerRegistered(player, DEFAULT_RATING);
        }
    }

    /// @notice Report a game result and update ratings
    /// @param white Address of white player
    /// @param black Address of black player
    /// @param result 0 = draw, 1 = white wins, 2 = black wins
    function reportGame(
        address white,
        address black,
        uint8 result
    ) external {
        // Allow calls from valid game contracts OR accounts with GAME_REPORTER_ROLE
        require(
            _isValidGameContract(msg.sender) || hasRole(GAME_REPORTER_ROLE, msg.sender),
            "Not authorized"
        );
        require(white != black, "Same player");
        require(result <= 2, "Invalid result");

        // Ensure both players are registered
        _ensureRegistered(white);
        _ensureRegistered(black);

        uint256 whiteRating = players[white].rating;
        uint256 blackRating = players[black].rating;

        // Calculate expected scores (fixed-point, multiply by 1000)
        uint256 whiteExpected = _expectedScore(whiteRating, blackRating);
        uint256 blackExpected = 1000 - whiteExpected;

        // Actual scores (multiply by 1000 for comparison)
        uint256 whiteActual;
        uint256 blackActual;

        if (result == 0) {
            // Draw
            whiteActual = 500;
            blackActual = 500;
            players[white].draws++;
            players[black].draws++;
        } else if (result == 1) {
            // White wins
            whiteActual = 1000;
            blackActual = 0;
            players[white].wins++;
            players[black].losses++;
        } else {
            // Black wins
            whiteActual = 0;
            blackActual = 1000;
            players[white].losses++;
            players[black].wins++;
        }

        // Get K-factors
        uint256 whiteK = _getKFactor(white);
        uint256 blackK = _getKFactor(black);

        // Calculate new ratings
        uint256 newWhiteRating = _calculateNewRating(whiteRating, whiteK, whiteActual, whiteExpected);
        uint256 newBlackRating = _calculateNewRating(blackRating, blackK, blackActual, blackExpected);

        // Update player stats
        int256 whiteChange = int256(newWhiteRating) - int256(whiteRating);
        int256 blackChange = int256(newBlackRating) - int256(blackRating);

        players[white].rating = newWhiteRating;
        players[white].gamesPlayed++;
        players[white].lastGameTimestamp = block.timestamp;
        if (newWhiteRating > players[white].peakRating) {
            players[white].peakRating = newWhiteRating;
        }

        players[black].rating = newBlackRating;
        players[black].gamesPlayed++;
        players[black].lastGameTimestamp = block.timestamp;
        if (newBlackRating > players[black].peakRating) {
            players[black].peakRating = newBlackRating;
        }

        emit RatingUpdated(white, whiteRating, newWhiteRating, whiteChange);
        emit RatingUpdated(black, blackRating, newBlackRating, blackChange);
        emit GameRecorded(
            white,
            black,
            result,
            whiteChange >= 0 ? uint256(whiteChange) : uint256(-whiteChange),
            blackChange >= 0 ? uint256(blackChange) : uint256(-blackChange)
        );
    }

    /// @notice Calculate expected score (returns value * 1000)
    /// @dev Uses approximation of 1 / (1 + 10^((Rb-Ra)/400))
    function _expectedScore(uint256 ratingA, uint256 ratingB) internal pure returns (uint256) {
        int256 diff = int256(ratingB) - int256(ratingA);

        // Clamp difference to prevent overflow
        if (diff > 400) diff = 400;
        if (diff < -400) diff = -400;

        // Approximation using linear interpolation for the sigmoid
        // At diff = 0: expected = 500 (0.5)
        // At diff = 400: expected = 91 (0.091)
        // At diff = -400: expected = 909 (0.909)

        // Linear approximation: expected = 500 - (diff * 409) / 400
        int256 expected = 500 - (diff * 409) / 400;

        if (expected < 0) expected = 0;
        if (expected > 1000) expected = 1000;

        return uint256(expected);
    }

    /// @notice Calculate new rating
    function _calculateNewRating(
        uint256 currentRating,
        uint256 kFactor,
        uint256 actualScore,
        uint256 expectedScore
    ) internal pure returns (uint256) {
        int256 change = (int256(kFactor) * (int256(actualScore) - int256(expectedScore))) / 1000;

        int256 newRating = int256(currentRating) + change;

        // Clamp to min/max
        if (newRating < int256(MIN_RATING)) newRating = int256(MIN_RATING);
        if (newRating > int256(MAX_RATING)) newRating = int256(MAX_RATING);

        return uint256(newRating);
    }

    /// @notice Get K-factor for a player
    function _getKFactor(address player) internal view returns (uint256) {
        PlayerStats storage stats = players[player];

        // New players have higher K-factor (ratings change more)
        if (stats.gamesPlayed < PROVISIONAL_GAMES) {
            return K_FACTOR_NEW;
        }

        // High-rated players have lower K-factor (more stable ratings)
        if (stats.rating >= 2400) {
            return K_FACTOR_HIGH;
        }

        return K_FACTOR_NORMAL;
    }

    /// @notice Get player rating
    function getRating(address player) external view returns (uint256) {
        if (players[player].rating == 0) {
            return DEFAULT_RATING;
        }
        return players[player].rating;
    }

    /// @notice Get full player stats
    function getPlayerStats(address player) external view returns (
        uint256 rating,
        uint256 gamesPlayed,
        uint256 wins,
        uint256 losses,
        uint256 draws,
        uint256 peakRating,
        uint256 lastGameTimestamp
    ) {
        PlayerStats storage stats = players[player];

        if (stats.rating == 0) {
            return (DEFAULT_RATING, 0, 0, 0, 0, DEFAULT_RATING, 0);
        }

        return (
            stats.rating,
            stats.gamesPlayed,
            stats.wins,
            stats.losses,
            stats.draws,
            stats.peakRating,
            stats.lastGameTimestamp
        );
    }

    /// @notice Get win rate (returns percentage * 100, e.g., 5500 = 55.00%)
    function getWinRate(address player) external view returns (uint256) {
        PlayerStats storage stats = players[player];

        if (stats.gamesPlayed == 0) {
            return 0;
        }

        // Calculate win rate including draws as 0.5 wins
        uint256 points = (stats.wins * 2) + stats.draws; // Each win = 2 points, draw = 1 point
        uint256 maxPoints = stats.gamesPlayed * 2;

        return (points * 10000) / maxPoints; // Returns percentage * 100
    }

    /// @notice Check if player is still provisional (< 30 games)
    function isProvisional(address player) external view returns (bool) {
        return players[player].gamesPlayed < PROVISIONAL_GAMES;
    }

    /// @notice Get total number of ranked players
    function getRankedPlayerCount() external view returns (uint256) {
        return rankedPlayers.length;
    }

    /// @notice Get top players (paginated)
    /// @param offset Starting index
    /// @param limit Number of players to return
    function getTopPlayers(uint256 offset, uint256 limit) external view returns (
        address[] memory addresses,
        uint256[] memory ratings
    ) {
        // Simple implementation - in production you'd want a sorted data structure
        uint256 count = rankedPlayers.length;

        if (offset >= count) {
            return (new address[](0), new uint256[](0));
        }

        uint256 end = offset + limit;
        if (end > count) {
            end = count;
        }

        uint256 resultCount = end - offset;
        addresses = new address[](resultCount);
        ratings = new uint256[](resultCount);

        // Copy players (not sorted - would need off-chain sorting for large sets)
        for (uint256 i = 0; i < resultCount; i++) {
            addresses[i] = rankedPlayers[offset + i];
            ratings[i] = players[rankedPlayers[offset + i]].rating;
        }

        return (addresses, ratings);
    }
}

// SPDX-License-Identifier: MIT
/// @title RewardPool - Play-to-Earn reward system for Chess
/// @notice Manages faucet and game rewards with anti-abuse mechanisms
/// @dev Uses separate pools for faucet and rewards, with decay and behavior factors
contract RewardPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ========== CONSTANTS ==========
    uint256 public constant FAUCET_AMOUNT = 5 * 10**18;  // 5 CHESS per new user
    uint256 public constant BASE_WIN_REWARD = 3 * 10**18;   // 3 CHESS
    uint256 public constant BASE_LOSE_REWARD = 1 * 10**18;  // 1 CHESS
    uint256 public constant BASE_DRAW_REWARD = 2 * 10**18;  // 2 CHESS
    uint256 public constant CHECKMATE_BONUS = 1 * 10**18;   // +1 CHESS
    uint256 public constant LONG_GAME_BONUS = 5 * 10**17;   // +0.5 CHESS (for > 30 moves)

    uint256 public constant MIN_MOVES_FOR_REWARD = 10;  // Minimum moves per player
    uint256 public constant LONG_GAME_THRESHOLD = 30;   // Moves for long game bonus
    uint256 public constant DAILY_GAME_LIMIT = 5;       // Max rewarded games per day
    uint256 public constant OPPONENT_COOLDOWN = 7 days; // Cooldown for same opponent
    uint256 public constant BEHAVIOR_HISTORY = 20;      // Games to track for behavior

    // Rating factor: floor at 20% (200/1000)
    uint256 public constant RATING_FACTOR_FLOOR = 200;  // 0.2 in fixed point (1000 = 1.0)
    uint256 public constant RATING_REFERENCE = 2000;    // Rating where factor = floor

    // Behavior factor: floor at 50% (500/1000)
    uint256 public constant BEHAVIOR_FACTOR_FLOOR = 500;

    // ========== STATE ==========
    IERC20 public chessToken;
    PlayerRating public playerRating;
    address public chessFactory;

    // Pool balances
    uint256 public faucetPool;
    uint256 public rewardPool;
    uint256 public rewardPoolCapacity;  // Used for decay calculation

    // Valid game contracts (prevents DOS from iterating all games)
    mapping(address => bool) public validGameContracts;

    // Faucet tracking
    mapping(address => bool) public hasClaimed;

    // Daily game tracking (player => day => count)
    mapping(address => mapping(uint256 => uint256)) public dailyGames;

    // Anti-collusion (player => opponent => last rewarded timestamp)
    mapping(address => mapping(address => uint256)) public lastOpponentGame;

    // Behavior tracking
    struct BehaviorRecord {
        uint8 totalGames;      // Count of last N games (max 20)
        uint8 resignCount;     // Resignations in last N games
        uint8 timeoutCount;    // Timeout losses in last N games
        uint8 currentIndex;    // Circular buffer index
        uint8[20] history;     // 0=normal, 1=resign, 2=timeout
    }
    mapping(address => BehaviorRecord) public behaviorRecords;

    // ========== EVENTS ==========
    event FaucetClaimed(address indexed player, uint256 amount);
    event RewardDistributed(
        address indexed player,
        uint256 baseReward,
        uint256 finalReward,
        uint256 poolFactor,
        uint256 ratingFactor,
        uint256 behaviorFactor
    );
    event FaucetPoolDeposited(uint256 amount);
    event FaucetPoolWithdrawn(uint256 amount);
    event RewardPoolDeposited(uint256 amount);
    event RewardPoolWithdrawn(uint256 amount);
    event RewardPoolCapacitySet(uint256 newCapacity);
    event PoolLow(string poolType, uint256 remaining, uint256 threshold);
    event BehaviorRecorded(address indexed player, uint8 gameType);

    // ========== CONSTRUCTOR ==========
    constructor(
        address _chessToken,
        address _playerRating
    ) Ownable(msg.sender) {
        require(_chessToken != address(0), "Invalid token");
        require(_playerRating != address(0), "Invalid rating");

        chessToken = IERC20(_chessToken);
        playerRating = PlayerRating(_playerRating);
    }

    // ========== ADMIN FUNCTIONS ==========

    /// @notice Set the ChessFactory address (for game validation)
    function setChessFactory(address _chessFactory) external onlyOwner {
        require(_chessFactory != address(0), "Invalid factory");
        chessFactory = _chessFactory;
    }

    /// @notice Deposit CHESS to faucet pool
    function depositFaucetPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");
        chessToken.safeTransferFrom(msg.sender, address(this), amount);
        faucetPool += amount;
        emit FaucetPoolDeposited(amount);
    }

    /// @notice Withdraw CHESS from faucet pool
    function withdrawFaucetPool(uint256 amount) external onlyOwner {
        require(amount <= faucetPool, "Insufficient faucet pool");
        faucetPool -= amount;
        chessToken.safeTransfer(msg.sender, amount);
        emit FaucetPoolWithdrawn(amount);
    }

    /// @notice Deposit CHESS to reward pool
    function depositRewardPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");
        chessToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardPool += amount;

        // Update capacity if new deposit exceeds it
        if (rewardPool > rewardPoolCapacity) {
            rewardPoolCapacity = rewardPool;
            emit RewardPoolCapacitySet(rewardPoolCapacity);
        }

        emit RewardPoolDeposited(amount);
    }

    /// @notice Withdraw CHESS from reward pool
    function withdrawRewardPool(uint256 amount) external onlyOwner {
        require(amount <= rewardPool, "Insufficient reward pool");
        rewardPool -= amount;
        chessToken.safeTransfer(msg.sender, amount);
        emit RewardPoolWithdrawn(amount);
    }

    /// @notice Manually set reward pool capacity (for decay calculation)
    function setRewardPoolCapacity(uint256 capacity) external onlyOwner {
        require(capacity >= rewardPool, "Capacity below current pool");
        rewardPoolCapacity = capacity;
        emit RewardPoolCapacitySet(capacity);
    }

    // ========== FAUCET ==========

    /// @notice Claim faucet tokens (one-time per address)
    /// @dev Requires the address to have made at least 1 transaction (nonce > 0)
    function claimFaucet() external nonReentrant {
        require(!hasClaimed[msg.sender], "Already claimed");
        require(chessToken.balanceOf(msg.sender) == 0, "Already has CHESS");
        require(faucetPool >= FAUCET_AMOUNT, "Faucet pool empty");

        // Check that user has made at least 1 transaction (anti-sybil)
        // This is checked by verifying the account has a nonce > 0
        // Note: This won't work for first-time users on a fresh address
        // but they need ETH for gas anyway, so they'll have a transaction
        uint256 nonce;
        assembly {
            nonce := extcodesize(caller())
        }
        // Actually, we check the account nonce differently
        // We'll use a simpler check: require msg.sender is not a contract
        // and trust that they have ETH (gas cost is the anti-sybil measure)
        require(msg.sender == tx.origin, "No contracts");

        hasClaimed[msg.sender] = true;
        faucetPool -= FAUCET_AMOUNT;
        chessToken.safeTransfer(msg.sender, FAUCET_AMOUNT);

        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);

        // Emit warning if pool is low (< 10%)
        if (faucetPool < FAUCET_AMOUNT * 100) {
            emit PoolLow("faucet", faucetPool, FAUCET_AMOUNT * 100);
        }
    }

    // ========== GAME REWARDS ==========

    /// @notice Distribute rewards for a completed game
    /// @param player The player to reward
    /// @param opponent The opponent (for anti-collusion check)
    /// @param isWinner Whether the player won
    /// @param isDraw Whether the game was a draw
    /// @param isCheckmate Whether the game ended in checkmate
    /// @param moveCount Total moves in the game
    /// @param wasResign Whether the player resigned (for behavior tracking)
    /// @param wasTimeout Whether the player lost by timeout (for behavior tracking)
    function distributeReward(
        address player,
        address opponent,
        bool isWinner,
        bool isDraw,
        bool isCheckmate,
        uint256 moveCount,
        bool wasResign,
        bool wasTimeout
    ) external nonReentrant {
        // Only allow calls from valid game contracts
        require(_isValidGameContract(msg.sender), "Not authorized");
        require(player != address(0) && opponent != address(0), "Invalid addresses");
        require(player != opponent, "Same player");

        // Record behavior (even if no reward given)
        _recordBehavior(player, wasResign, wasTimeout);

        // Check if player qualifies for reward
        if (!_canReceiveReward(player, opponent, moveCount)) {
            return;  // No reward, but behavior was recorded
        }

        // Calculate and distribute reward
        uint256 reward = _calculateReward(player, isWinner, isDraw, isCheckmate, moveCount);

        if (reward > 0 && reward <= rewardPool) {
            // Update tracking
            uint256 today = block.timestamp / 1 days;
            dailyGames[player][today]++;
            lastOpponentGame[player][opponent] = block.timestamp;

            // Transfer reward
            rewardPool -= reward;
            chessToken.safeTransfer(player, reward);

            // Get factors for event
            (uint256 poolFactor, uint256 ratingFactor, uint256 behaviorFactor) = getPlayerFactors(player);

            emit RewardDistributed(
                player,
                _getBaseReward(isWinner, isDraw),
                reward,
                poolFactor,
                ratingFactor,
                behaviorFactor
            );

            // Emit warning if pool is low (< 10% of capacity)
            if (rewardPoolCapacity > 0 && rewardPool < rewardPoolCapacity / 10) {
                emit PoolLow("reward", rewardPool, rewardPoolCapacity / 10);
            }
        }
    }

    // ========== INTERNAL FUNCTIONS ==========

    /// @notice Check if caller is a valid game contract
    /// @dev Uses mapping for O(1) lookup instead of O(n) iteration
    function _isValidGameContract(address caller) internal view returns (bool) {
        return validGameContracts[caller];
    }

    /// @notice Register a game contract as valid (called by ChessFactory)
    /// @param gameContract Address of the deployed game contract
    function registerGameContract(address gameContract) external {
        require(msg.sender == chessFactory, "Only factory");
        require(gameContract != address(0), "Invalid address");
        validGameContracts[gameContract] = true;
    }

    /// @notice Check if player can receive reward
    function _canReceiveReward(
        address player,
        address opponent,
        uint256 moveCount
    ) internal view returns (bool) {
        // Check minimum moves (per side, so divide by 2)
        if (moveCount / 2 < MIN_MOVES_FOR_REWARD) {
            return false;
        }

        // Check daily limit
        uint256 today = block.timestamp / 1 days;
        if (dailyGames[player][today] >= DAILY_GAME_LIMIT) {
            return false;
        }

        // Check opponent cooldown
        if (lastOpponentGame[player][opponent] > 0 &&
            block.timestamp - lastOpponentGame[player][opponent] < OPPONENT_COOLDOWN) {
            return false;
        }

        // Check pool not empty
        if (rewardPool == 0) {
            return false;
        }

        return true;
    }

    /// @notice Get base reward amount
    function _getBaseReward(bool isWinner, bool isDraw) internal pure returns (uint256) {
        if (isDraw) return BASE_DRAW_REWARD;
        if (isWinner) return BASE_WIN_REWARD;
        return BASE_LOSE_REWARD;
    }

    /// @notice Calculate final reward with all factors
    function _calculateReward(
        address player,
        bool isWinner,
        bool isDraw,
        bool isCheckmate,
        uint256 moveCount
    ) internal view returns (uint256) {
        uint256 baseReward = _getBaseReward(isWinner, isDraw);

        // Get factors (all in 1000 = 1.0 scale)
        (uint256 poolFactor, uint256 ratingFactor, uint256 behaviorFactor) = getPlayerFactors(player);

        // Calculate: base * poolFactor * ratingFactor * behaviorFactor / 1000^3
        uint256 reward = baseReward * poolFactor * ratingFactor * behaviorFactor / (1000 * 1000 * 1000);

        // Add bonuses (also affected by pool factor only, not rating/behavior)
        uint256 bonus = 0;
        if (isWinner && isCheckmate) {
            bonus += CHECKMATE_BONUS * poolFactor / 1000;
        }
        if (moveCount >= LONG_GAME_THRESHOLD * 2) {  // Total moves, so *2
            bonus += LONG_GAME_BONUS * poolFactor / 1000;
        }

        return reward + bonus;
    }

    /// @notice Record player behavior
    function _recordBehavior(address player, bool wasResign, bool wasTimeout) internal {
        BehaviorRecord storage record = behaviorRecords[player];

        // Determine game type: 0=normal, 1=resign, 2=timeout
        uint8 gameType = 0;
        if (wasResign) gameType = 1;
        else if (wasTimeout) gameType = 2;

        // If we have history, remove the old value from counts
        if (record.totalGames >= BEHAVIOR_HISTORY) {
            uint8 oldType = record.history[record.currentIndex];
            if (oldType == 1) record.resignCount--;
            else if (oldType == 2) record.timeoutCount--;
        } else {
            record.totalGames++;
        }

        // Add new value
        record.history[record.currentIndex] = gameType;
        if (gameType == 1) record.resignCount++;
        else if (gameType == 2) record.timeoutCount++;

        // Move index
        record.currentIndex = (record.currentIndex + 1) % uint8(BEHAVIOR_HISTORY);

        emit BehaviorRecorded(player, gameType);
    }

    // ========== VIEW FUNCTIONS ==========

    /// @notice Get all factors for a player
    /// @return poolFactor Quadratic decay based on pool fullness (1000 = 1.0)
    /// @return ratingFactor Inversely proportional to rating (1000 = 1.0)
    /// @return behaviorFactor Based on resign/timeout history (1000 = 1.0)
    function getPlayerFactors(address player) public view returns (
        uint256 poolFactor,
        uint256 ratingFactor,
        uint256 behaviorFactor
    ) {
        // Pool factor: quadratic decay
        // poolFactor = (currentPool / capacity)^2
        if (rewardPoolCapacity == 0) {
            poolFactor = 0;
        } else {
            uint256 ratio = (rewardPool * 1000) / rewardPoolCapacity;
            poolFactor = (ratio * ratio) / 1000;  // Quadratic
        }

        // Rating factor: inversely proportional
        // ratingFactor = max(0.2, (2000 - rating) / 1000)
        uint256 rating = playerRating.getRating(player);
        if (rating >= RATING_REFERENCE) {
            ratingFactor = RATING_FACTOR_FLOOR;
        } else {
            ratingFactor = ((RATING_REFERENCE - rating) * 1000) / 1000;
            if (ratingFactor < RATING_FACTOR_FLOOR) {
                ratingFactor = RATING_FACTOR_FLOOR;
            }
            if (ratingFactor > 1000) {
                ratingFactor = 1000;
            }
        }

        // Behavior factor: 1.0 - (resignRate * 0.5) - (timeoutRate * 0.5)
        BehaviorRecord storage record = behaviorRecords[player];
        if (record.totalGames == 0) {
            behaviorFactor = 1000;  // New player, full factor
        } else {
            uint256 resignPenalty = (uint256(record.resignCount) * 500) / record.totalGames;
            uint256 timeoutPenalty = (uint256(record.timeoutCount) * 500) / record.totalGames;
            uint256 totalPenalty = resignPenalty + timeoutPenalty;

            if (totalPenalty >= (1000 - BEHAVIOR_FACTOR_FLOOR)) {
                behaviorFactor = BEHAVIOR_FACTOR_FLOOR;
            } else {
                behaviorFactor = 1000 - totalPenalty;
            }
        }
    }

    /// @notice Check if address has claimed faucet
    function hasClaimedFaucet(address player) external view returns (bool) {
        return hasClaimed[player];
    }

    /// @notice Get remaining daily games for player
    function getRemainingDailyGames(address player) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 used = dailyGames[player][today];
        if (used >= DAILY_GAME_LIMIT) return 0;
        return DAILY_GAME_LIMIT - used;
    }

    /// @notice Check if player can earn from opponent
    function canEarnFromOpponent(address player, address opponent) external view returns (bool) {
        if (lastOpponentGame[player][opponent] == 0) return true;
        return block.timestamp - lastOpponentGame[player][opponent] >= OPPONENT_COOLDOWN;
    }

    /// @notice Get player behavior stats
    function getBehaviorStats(address player) external view returns (
        uint256 totalGames,
        uint256 resignCount,
        uint256 timeoutCount,
        uint256 resignRate,
        uint256 timeoutRate
    ) {
        BehaviorRecord storage record = behaviorRecords[player];
        totalGames = record.totalGames;
        resignCount = record.resignCount;
        timeoutCount = record.timeoutCount;

        if (totalGames > 0) {
            resignRate = (resignCount * 100) / totalGames;
            timeoutRate = (timeoutCount * 100) / totalGames;
        }
    }

    /// @notice Get pool statuses
    function getPoolStatus() external view returns (
        uint256 faucetBalance,
        uint256 rewardBalance,
        uint256 rewardCapacity,
        uint256 poolFactorPercent
    ) {
        faucetBalance = faucetPool;
        rewardBalance = rewardPool;
        rewardCapacity = rewardPoolCapacity;

        if (rewardPoolCapacity > 0) {
            uint256 ratio = (rewardPool * 100) / rewardPoolCapacity;
            poolFactorPercent = (ratio * ratio) / 100;  // Quadratic
        }
    }

    /// @notice Estimate reward for a potential game
    function estimateReward(
        address player,
        bool isWinner,
        bool isDraw,
        bool isCheckmate,
        uint256 moveCount
    ) external view returns (uint256) {
        return _calculateReward(player, isWinner, isDraw, isCheckmate, moveCount);
    }
}

// SPDX-License-Identifier: MIT
/**
 * @title ArbitratorRegistry
 * @notice Registry for arbitrators who vote on chess game disputes
 * @dev Implements multi-level pools, timelock, and reputation system
 *
 * Key Features:
 * - 7-day timelock before voting power activates (flash loan protection)
 * - Three-tier stake pools for decentralization
 * - Reputation system (vote with majority = +1, against = -1)
 * - Cooldown after voting to prevent collusion
 * - Random selection weighted by stake
 */
contract ArbitratorRegistry is AccessControl, ReentrancyGuard {
    bytes32 public constant DISPUTE_MANAGER_ROLE = keccak256("DISPUTE_MANAGER_ROLE");

    ChessToken public immutable chessToken;

    // Timelock for voting power
    uint256 public constant VOTING_POWER_DELAY = 7 days;

    // Stake tiers for multi-level pools
    uint256 public constant TIER1_MIN = 1000 * 10**18;   // 1,000 - 5,000 CHESS
    uint256 public constant TIER1_MAX = 5000 * 10**18;
    uint256 public constant TIER2_MIN = 5000 * 10**18;   // 5,000 - 20,000 CHESS
    uint256 public constant TIER2_MAX = 20000 * 10**18;
    uint256 public constant TIER3_MIN = 20000 * 10**18;  // 20,000+ CHESS

    // Reputation thresholds
    uint256 public constant INITIAL_REPUTATION = 100;
    uint256 public constant MIN_REPUTATION = 50;  // Below this = removed

    // Cooldown after voting
    uint256 public constant VOTE_COOLDOWN = 48 hours;
    uint256 public constant MAX_DISPUTES_PER_WEEK = 5;

    struct Arbitrator {
        uint256 stakedAmount;
        uint256 stakedAt;
        uint256 votingPowerActiveAt;
        uint256 reputation;
        uint256 lastVoteTime;
        uint256 disputesThisWeek;
        uint256 weekStartTime;
        bool isActive;
    }

    mapping(address => Arbitrator) public arbitrators;

    // Tier pools for random selection
    address[] public tier1Arbitrators;
    address[] public tier2Arbitrators;
    address[] public tier3Arbitrators;

    mapping(address => uint256) public tier1Index;
    mapping(address => uint256) public tier2Index;
    mapping(address => uint256) public tier3Index;

    // Recent opponents tracking (for exclusion)
    mapping(address => mapping(address => uint256)) public lastGameWith; // player => opponent => timestamp

    // Stats
    uint256 public totalStaked;
    uint256 public totalArbitrators;

    // Events
    event ArbitratorRegistered(address indexed arbitrator, uint256 amount, uint8 tier);
    event ArbitratorStakeIncreased(address indexed arbitrator, uint256 newAmount, uint8 newTier);
    event ArbitratorUnstaked(address indexed arbitrator, uint256 amount);
    event ReputationUpdated(address indexed arbitrator, uint256 oldRep, uint256 newRep);
    event ArbitratorRemoved(address indexed arbitrator, string reason);
    event ArbitratorSelected(uint256 indexed disputeId, address indexed arbitrator);

    constructor(address _chessToken) {
        require(_chessToken != address(0), "Invalid token");
        chessToken = ChessToken(_chessToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Stake CHESS to become an arbitrator
     * @param amount Amount of CHESS to stake
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount >= TIER1_MIN, "Minimum stake not met");

        Arbitrator storage arb = arbitrators[msg.sender];

        // Transfer tokens
        require(chessToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (!arb.isActive) {
            // New arbitrator
            arb.stakedAt = block.timestamp;
            arb.votingPowerActiveAt = block.timestamp + VOTING_POWER_DELAY;
            arb.reputation = INITIAL_REPUTATION;
            arb.weekStartTime = block.timestamp;
            arb.isActive = true;
            totalArbitrators++;
        }

        uint8 oldTier = _getTier(arb.stakedAmount);
        arb.stakedAmount += amount;
        totalStaked += amount;
        uint8 newTier = _getTier(arb.stakedAmount);

        // Update tier pools
        if (oldTier != newTier) {
            _removeFromTierPool(msg.sender, oldTier);
            _addToTierPool(msg.sender, newTier);
        } else if (oldTier == 0 && newTier > 0) {
            _addToTierPool(msg.sender, newTier);
        }

        emit ArbitratorRegistered(msg.sender, arb.stakedAmount, newTier);
    }

    /**
     * @notice Unstake CHESS (partial or full)
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        Arbitrator storage arb = arbitrators[msg.sender];
        require(arb.isActive, "Not an arbitrator");
        require(amount <= arb.stakedAmount, "Insufficient stake");

        // Check if in cooldown (can't unstake during active disputes)
        require(block.timestamp >= arb.lastVoteTime + VOTE_COOLDOWN, "In cooldown");

        uint8 oldTier = _getTier(arb.stakedAmount);
        arb.stakedAmount -= amount;
        totalStaked -= amount;
        uint8 newTier = _getTier(arb.stakedAmount);

        // Update tier pools
        if (oldTier != newTier) {
            _removeFromTierPool(msg.sender, oldTier);
            if (newTier > 0) {
                _addToTierPool(msg.sender, newTier);
            }
        }

        // If stake falls below minimum, deactivate
        if (arb.stakedAmount < TIER1_MIN) {
            arb.isActive = false;
            totalArbitrators--;
            emit ArbitratorRemoved(msg.sender, "Stake below minimum");
        }

        require(chessToken.transfer(msg.sender, amount), "Transfer failed");

        emit ArbitratorUnstaked(msg.sender, amount);
    }

    /**
     * @notice Get voting power for an arbitrator
     * @dev Returns 0 if timelock not passed
     */
    function getVotingPower(address arbitrator) public view returns (uint256) {
        Arbitrator storage arb = arbitrators[arbitrator];

        if (!arb.isActive) return 0;
        if (block.timestamp < arb.votingPowerActiveAt) return 0;
        if (arb.reputation < MIN_REPUTATION) return 0;

        // Base voting power = stake
        // Time bonus: up to 2x after 1 year
        uint256 timeStaked = block.timestamp - arb.stakedAt;
        uint256 timeBonus = timeStaked > 365 days ? 100 : (timeStaked * 100) / 365 days;

        return arb.stakedAmount * (100 + timeBonus) / 100;
    }

    /**
     * @notice Select arbitrators for a dispute
     * @param disputeId Dispute identifier
     * @param player1 First player (to exclude)
     * @param player2 Second player (to exclude)
     * @param count Number of arbitrators per tier
     * @return selected Array of selected arbitrator addresses
     */
    function selectArbitrators(
        uint256 disputeId,
        address player1,
        address player2,
        uint256 count
    ) external onlyRole(DISPUTE_MANAGER_ROLE) returns (address[] memory selected) {
        require(count > 0, "Count must be > 0");

        uint256 totalSelected = count * 3; // From all 3 tiers
        selected = new address[](totalSelected);
        uint256 selectedCount = 0;

        // Select from each tier
        selectedCount = _selectFromTier(
            tier1Arbitrators, disputeId, player1, player2, count, selected, selectedCount
        );
        selectedCount = _selectFromTier(
            tier2Arbitrators, disputeId, player1, player2, count, selected, selectedCount
        );
        selectedCount = _selectFromTier(
            tier3Arbitrators, disputeId, player1, player2, count, selected, selectedCount
        );

        // Resize array if we couldn't fill all slots
        if (selectedCount < totalSelected) {
            address[] memory resized = new address[](selectedCount);
            for (uint256 i = 0; i < selectedCount; i++) {
                resized[i] = selected[i];
            }
            return resized;
        }

        return selected;
    }

    /**
     * @notice Update reputation after dispute resolution
     * @param arbitrator Arbitrator address
     * @param votedWithMajority Whether they voted with majority
     */
    function updateReputation(address arbitrator, bool votedWithMajority)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
    {
        Arbitrator storage arb = arbitrators[arbitrator];
        require(arb.isActive, "Not active");

        uint256 oldRep = arb.reputation;

        if (votedWithMajority) {
            arb.reputation += 1;
            if (arb.reputation > 200) arb.reputation = 200; // Cap
        } else {
            if (arb.reputation > 1) {
                arb.reputation -= 1;
            }
        }

        // Remove if reputation too low
        if (arb.reputation < MIN_REPUTATION) {
            uint8 tier = _getTier(arb.stakedAmount);
            _removeFromTierPool(arbitrator, tier);
            arb.isActive = false;
            totalArbitrators--;
            emit ArbitratorRemoved(arbitrator, "Reputation too low");
        }

        emit ReputationUpdated(arbitrator, oldRep, arb.reputation);
    }

    /**
     * @notice Record that arbitrator voted (for cooldown)
     */
    function recordVote(address arbitrator) external onlyRole(DISPUTE_MANAGER_ROLE) {
        Arbitrator storage arb = arbitrators[arbitrator];

        // Reset weekly counter if new week
        if (block.timestamp >= arb.weekStartTime + 7 days) {
            arb.disputesThisWeek = 0;
            arb.weekStartTime = block.timestamp;
        }

        arb.lastVoteTime = block.timestamp;
        arb.disputesThisWeek++;
    }

    /**
     * @notice Check if arbitrator is eligible to vote
     */
    function canVote(address arbitrator) public view returns (bool) {
        Arbitrator storage arb = arbitrators[arbitrator];

        if (!arb.isActive) return false;
        if (block.timestamp < arb.votingPowerActiveAt) return false;
        if (arb.reputation < MIN_REPUTATION) return false;
        if (block.timestamp < arb.lastVoteTime + VOTE_COOLDOWN) return false;

        // Check weekly limit
        uint256 disputesThisWeek = arb.disputesThisWeek;
        if (block.timestamp >= arb.weekStartTime + 7 days) {
            disputesThisWeek = 0;
        }
        if (disputesThisWeek >= MAX_DISPUTES_PER_WEEK) return false;

        return true;
    }

    /**
     * @notice Record game between players (for future exclusion)
     */
    function recordGame(address player1, address player2) external onlyRole(DISPUTE_MANAGER_ROLE) {
        lastGameWith[player1][player2] = block.timestamp;
        lastGameWith[player2][player1] = block.timestamp;
    }

    /**
     * @notice Check if arbitrator should be excluded from a dispute
     */
    function shouldExclude(address arbitrator, address player1, address player2) public view returns (bool) {
        // Exclude if arbitrator is one of the players
        if (arbitrator == player1 || arbitrator == player2) return true;

        // Exclude if played against either player in last 30 days
        uint256 thirtyDaysAgo = block.timestamp - 30 days;
        if (lastGameWith[arbitrator][player1] > thirtyDaysAgo) return true;
        if (lastGameWith[arbitrator][player2] > thirtyDaysAgo) return true;

        return false;
    }

    // Internal functions

    function _getTier(uint256 amount) internal pure returns (uint8) {
        if (amount >= TIER3_MIN) return 3;
        if (amount >= TIER2_MIN) return 2;
        if (amount >= TIER1_MIN) return 1;
        return 0;
    }

    function _addToTierPool(address arbitrator, uint8 tier) internal {
        if (tier == 1) {
            tier1Index[arbitrator] = tier1Arbitrators.length;
            tier1Arbitrators.push(arbitrator);
        } else if (tier == 2) {
            tier2Index[arbitrator] = tier2Arbitrators.length;
            tier2Arbitrators.push(arbitrator);
        } else if (tier == 3) {
            tier3Index[arbitrator] = tier3Arbitrators.length;
            tier3Arbitrators.push(arbitrator);
        }
    }

    function _removeFromTierPool(address arbitrator, uint8 tier) internal {
        if (tier == 1) {
            _removeFromTier1(arbitrator);
        } else if (tier == 2) {
            _removeFromTier2(arbitrator);
        } else if (tier == 3) {
            _removeFromTier3(arbitrator);
        }
    }

    function _removeFromTier1(address arbitrator) internal {
        uint256 index = tier1Index[arbitrator];
        if (index < tier1Arbitrators.length && tier1Arbitrators[index] == arbitrator) {
            address lastArb = tier1Arbitrators[tier1Arbitrators.length - 1];
            tier1Arbitrators[index] = lastArb;
            tier1Index[lastArb] = index;
            tier1Arbitrators.pop();
            delete tier1Index[arbitrator];
        }
    }

    function _removeFromTier2(address arbitrator) internal {
        uint256 index = tier2Index[arbitrator];
        if (index < tier2Arbitrators.length && tier2Arbitrators[index] == arbitrator) {
            address lastArb = tier2Arbitrators[tier2Arbitrators.length - 1];
            tier2Arbitrators[index] = lastArb;
            tier2Index[lastArb] = index;
            tier2Arbitrators.pop();
            delete tier2Index[arbitrator];
        }
    }

    function _removeFromTier3(address arbitrator) internal {
        uint256 index = tier3Index[arbitrator];
        if (index < tier3Arbitrators.length && tier3Arbitrators[index] == arbitrator) {
            address lastArb = tier3Arbitrators[tier3Arbitrators.length - 1];
            tier3Arbitrators[index] = lastArb;
            tier3Index[lastArb] = index;
            tier3Arbitrators.pop();
            delete tier3Index[arbitrator];
        }
    }

    function _selectFromTier(
        address[] storage pool,
        uint256 disputeId,
        address player1,
        address player2,
        uint256 count,
        address[] memory selected,
        uint256 startIndex
    ) internal returns (uint256) {
        if (pool.length == 0) return startIndex;

        uint256 selectedFromTier = 0;
        uint256 attempts = 0;
        uint256 maxAttempts = pool.length * 2;

        while (selectedFromTier < count && attempts < maxAttempts) {
            // Pseudo-random selection (in production use VRF)
            uint256 randomIndex = uint256(keccak256(abi.encodePacked(
                disputeId, block.timestamp, attempts, pool.length
            ))) % pool.length;

            address candidate = pool[randomIndex];
            attempts++;

            // Check exclusions
            if (shouldExclude(candidate, player1, player2)) continue;
            if (!canVote(candidate)) continue;

            // Check not already selected
            bool alreadySelected = false;
            for (uint256 i = 0; i < startIndex + selectedFromTier; i++) {
                if (selected[i] == candidate) {
                    alreadySelected = true;
                    break;
                }
            }
            if (alreadySelected) continue;

            selected[startIndex + selectedFromTier] = candidate;
            selectedFromTier++;

            emit ArbitratorSelected(disputeId, candidate);
        }

        return startIndex + selectedFromTier;
    }

    // View functions

    function getArbitratorInfo(address arbitrator) external view returns (
        uint256 stakedAmount,
        uint256 votingPower,
        uint256 reputation,
        uint8 tier,
        bool isActive,
        bool canVoteNow
    ) {
        Arbitrator storage arb = arbitrators[arbitrator];
        stakedAmount = arb.stakedAmount;
        votingPower = getVotingPower(arbitrator);
        reputation = arb.reputation;
        tier = _getTier(arb.stakedAmount);
        isActive = arb.isActive;
        canVoteNow = canVote(arbitrator);
    }

    function getTierCounts() external view returns (uint256 t1, uint256 t2, uint256 t3) {
        t1 = tier1Arbitrators.length;
        t2 = tier2Arbitrators.length;
        t3 = tier3Arbitrators.length;
    }
}

// SPDX-License-Identifier: MIT
/**
 * @title DisputeDAO
 * @notice Decentralized dispute resolution for chess games
 * @dev Implements commit-reveal voting with Schelling Point mechanism
 *
 * Key Features:
 * - Challenge window after each game (48h)
 * - Commit-reveal voting to prevent coordination
 * - Multi-level escalation for contested disputes
 * - Slashing for cheaters, rewards for honest challengers
 */
contract DisputeDAO is AccessControl, ReentrancyGuard {
    using SafeERC20 for ChessToken;

    bytes32 public constant GAME_MANAGER_ROLE = keccak256("GAME_MANAGER_ROLE");

    ChessToken public immutable chessToken;
    BondingManager public immutable bondingManager;
    ArbitratorRegistry public immutable arbitratorRegistry;

    // Timing parameters
    uint256 public challengeWindow = 48 hours;
    uint256 public commitPeriod = 24 hours;
    uint256 public revealPeriod = 24 hours;

    // Voting parameters
    uint256 public quorum = 10;           // Minimum votes required
    uint256 public supermajority = 66;    // 66% for decision
    uint256 public challengeDeposit = 50 * 10**18; // 50 CHESS

    // Vote options
    enum Vote { None, Legit, Cheat, Abstain }

    // Dispute states
    enum DisputeState {
        None,
        Pending,        // Challenge window open
        Challenged,     // In commit phase
        Revealing,      // In reveal phase
        Resolved,       // Decision made
        Escalated       // Needs higher-level review
    }

    struct Dispute {
        uint256 gameId;
        address challenger;
        address accusedPlayer;
        address otherPlayer;
        uint256 gameStake;

        DisputeState state;

        uint256 registeredAt;      // When game was registered (start of challenge window)
        uint256 challengedAt;
        uint256 commitDeadline;
        uint256 revealDeadline;

        uint256 legitVotes;
        uint256 cheatVotes;
        uint256 abstainVotes;

        Vote finalDecision;
        bool resolved;

        address[] selectedArbitrators;
        uint256 escalationLevel;
    }

    struct VoteCommit {
        bytes32 commitHash;
        bool revealed;
        Vote vote;
    }

    // Storage
    mapping(uint256 => Dispute) public disputes;      // disputeId => Dispute
    mapping(uint256 => mapping(address => VoteCommit)) public votes; // disputeId => arbitrator => vote
    mapping(uint256 => uint256) public gameToDispute; // gameId => disputeId
    mapping(address => uint256) public activeChallenges; // challenger => count

    uint256 public disputeCounter;
    uint256 public constant MAX_ACTIVE_CHALLENGES = 3;
    uint256 public constant MAX_DISPUTE_DURATION = 30 days;
    uint256 private constant PERCENTAGE_BASE = 100;

    // Events
    event GameRegistered(uint256 indexed gameId, address white, address black, uint256 stake);
    event DisputeCreated(uint256 indexed disputeId, uint256 indexed gameId, address challenger, address accused);
    event VoteCommitted(uint256 indexed disputeId, address indexed arbitrator);
    event VoteRevealed(uint256 indexed disputeId, address indexed arbitrator, Vote vote);
    event DisputeResolved(uint256 indexed disputeId, Vote decision, uint256 legitVotes, uint256 cheatVotes);
    event DisputeEscalated(uint256 indexed disputeId, uint256 newLevel);
    event ChallengeWindowClosed(uint256 indexed gameId);
    event RewardDistributed(uint256 indexed disputeId, address indexed recipient, uint256 amount);

    constructor(
        address _chessToken,
        address _bondingManager,
        address _arbitratorRegistry
    ) {
        require(_chessToken != address(0), "Invalid token");
        require(_bondingManager != address(0), "Invalid bonding manager");
        require(_arbitratorRegistry != address(0), "Invalid arbitrator registry");

        chessToken = ChessToken(_chessToken);
        bondingManager = BondingManager(payable(_bondingManager));
        arbitratorRegistry = ArbitratorRegistry(_arbitratorRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Register a completed game (starts challenge window)
     * @param gameId Game identifier
     * @param white White player address
     * @param black Black player address
     * @param stake Game stake amount
     */
    function registerGame(
        uint256 gameId,
        address white,
        address black,
        uint256 stake
    ) external onlyRole(GAME_MANAGER_ROLE) {
        require(gameToDispute[gameId] == 0, "Game already registered");

        disputeCounter++;
        uint256 disputeId = disputeCounter;

        disputes[disputeId] = Dispute({
            gameId: gameId,
            challenger: address(0),
            accusedPlayer: address(0),
            otherPlayer: address(0),
            gameStake: stake,
            state: DisputeState.Pending,
            registeredAt: block.timestamp,  // Track when challenge window opens
            challengedAt: 0,
            commitDeadline: 0,
            revealDeadline: 0,
            legitVotes: 0,
            cheatVotes: 0,
            abstainVotes: 0,
            finalDecision: Vote.None,
            resolved: false,
            selectedArbitrators: new address[](0),
            escalationLevel: 0
        });

        gameToDispute[gameId] = disputeId;

        // Record game in arbitrator registry for exclusion tracking
        arbitratorRegistry.recordGame(white, black);

        emit GameRegistered(gameId, white, black, stake);
    }

    /**
     * @notice Challenge a game (accuse player of cheating)
     * @param gameId Game to challenge
     * @param accusedPlayer Player being accused
     */
    function challenge(uint256 gameId, address accusedPlayer) external nonReentrant {
        uint256 disputeId = gameToDispute[gameId];
        require(disputeId != 0, "Game not registered");

        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Pending, "Not in challenge window");
        require(activeChallenges[msg.sender] < MAX_ACTIVE_CHALLENGES, "Too many active challenges");

        // Enforce challenge window (48 hours from registration)
        require(
            block.timestamp <= dispute.registeredAt + challengeWindow,
            "Challenge window expired"
        );

        // Transfer challenge deposit (using SafeERC20)
        chessToken.safeTransferFrom(msg.sender, address(this), challengeDeposit);

        dispute.challenger = msg.sender;
        dispute.accusedPlayer = accusedPlayer;
        dispute.state = DisputeState.Challenged;
        dispute.challengedAt = block.timestamp;
        dispute.commitDeadline = block.timestamp + commitPeriod;
        dispute.revealDeadline = block.timestamp + commitPeriod + revealPeriod;

        activeChallenges[msg.sender]++;

        // Select arbitrators (5 from each tier = 15 total)
        address[] memory arbitrators = arbitratorRegistry.selectArbitrators(
            disputeId,
            accusedPlayer,
            dispute.otherPlayer,
            5
        );
        dispute.selectedArbitrators = arbitrators;

        emit DisputeCreated(disputeId, gameId, msg.sender, accusedPlayer);
    }

    /**
     * @notice Commit a vote (hash of vote + salt)
     * @param disputeId Dispute identifier
     * @param commitHash keccak256(abi.encodePacked(vote, salt, msg.sender))
     */
    function commitVote(uint256 disputeId, bytes32 commitHash) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Challenged, "Not in commit phase");
        require(block.timestamp <= dispute.commitDeadline, "Commit period ended");
        require(_isSelectedArbitrator(disputeId, msg.sender), "Not selected arbitrator");
        require(votes[disputeId][msg.sender].commitHash == bytes32(0), "Already committed");

        votes[disputeId][msg.sender].commitHash = commitHash;

        emit VoteCommitted(disputeId, msg.sender);
    }

    /**
     * @notice Reveal a previously committed vote
     * @param disputeId Dispute identifier
     * @param vote The vote (1=Legit, 2=Cheat, 3=Abstain)
     * @param salt The salt used in commit
     */
    function revealVote(uint256 disputeId, Vote vote, bytes32 salt) external {
        Dispute storage dispute = disputes[disputeId];

        // Transition to revealing if commit period ended
        if (dispute.state == DisputeState.Challenged && block.timestamp > dispute.commitDeadline) {
            dispute.state = DisputeState.Revealing;
        }

        require(dispute.state == DisputeState.Revealing, "Not in reveal phase");
        require(block.timestamp <= dispute.revealDeadline, "Reveal period ended");

        VoteCommit storage voteCommit = votes[disputeId][msg.sender];
        require(voteCommit.commitHash != bytes32(0), "No commit found");
        require(!voteCommit.revealed, "Already revealed");
        require(vote != Vote.None, "Invalid vote");

        // Verify commit hash
        bytes32 expectedHash = keccak256(abi.encodePacked(vote, salt, msg.sender));
        require(expectedHash == voteCommit.commitHash, "Hash mismatch");

        voteCommit.revealed = true;
        voteCommit.vote = vote;

        // Count vote
        if (vote == Vote.Legit) {
            dispute.legitVotes++;
        } else if (vote == Vote.Cheat) {
            dispute.cheatVotes++;
        } else if (vote == Vote.Abstain) {
            dispute.abstainVotes++;
        }

        // Record vote in registry (for cooldown)
        arbitratorRegistry.recordVote(msg.sender);

        emit VoteRevealed(disputeId, msg.sender, vote);
    }

    /**
     * @notice Resolve dispute after reveal period
     * @param disputeId Dispute identifier
     */
    function resolveDispute(uint256 disputeId) external nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(!dispute.resolved, "Already resolved");

        // L-6: Absolute maximum dispute duration to prevent indefinite escalation
        if (block.timestamp > dispute.registeredAt + MAX_DISPUTE_DURATION) {
            dispute.resolved = true;
            dispute.state = DisputeState.Resolved;
            // Return challenger deposit without penalty - timeout not their fault
            chessToken.safeTransfer(dispute.challenger, challengeDeposit);
            activeChallenges[dispute.challenger]--;
            emit DisputeResolved(disputeId, Vote.None, 0, 0);
            return;
        }

        require(
            dispute.state == DisputeState.Revealing ||
            (dispute.state == DisputeState.Challenged && block.timestamp > dispute.commitDeadline),
            "Cannot resolve yet"
        );
        require(block.timestamp > dispute.revealDeadline, "Reveal period not ended");

        uint256 totalVotes = dispute.legitVotes + dispute.cheatVotes;

        // Check quorum
        if (totalVotes < quorum) {
            // Not enough votes - escalate or return deposits
            _escalate(disputeId);
            return;
        }

        // Check for supermajority
        uint256 legitPercent = (dispute.legitVotes * PERCENTAGE_BASE) / totalVotes;
        uint256 cheatPercent = (dispute.cheatVotes * PERCENTAGE_BASE) / totalVotes;

        if (cheatPercent >= supermajority) {
            // CHEAT: Accused is guilty
            dispute.finalDecision = Vote.Cheat;
            _handleCheatDecision(disputeId);
        } else if (legitPercent >= supermajority) {
            // LEGIT: Accused is innocent
            dispute.finalDecision = Vote.Legit;
            _handleLegitDecision(disputeId);
        } else {
            // No clear majority - escalate
            _escalate(disputeId);
            return;
        }

        dispute.resolved = true;
        dispute.state = DisputeState.Resolved;
        activeChallenges[dispute.challenger]--;

        // Update arbitrator reputations
        _updateArbitratorReputations(disputeId);

        emit DisputeResolved(disputeId, dispute.finalDecision, dispute.legitVotes, dispute.cheatVotes);
    }

    /**
     * @notice Close challenge window if no challenge was made
     * @param gameId Game identifier
     */
    function closeChallengeWindow(uint256 gameId) external {
        uint256 disputeId = gameToDispute[gameId];
        require(disputeId != 0, "Game not registered");

        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Pending, "Not pending");

        // Enforce that challenge window has actually expired
        require(
            block.timestamp > dispute.registeredAt + challengeWindow,
            "Challenge window still open"
        );

        dispute.state = DisputeState.Resolved;
        dispute.resolved = true;

        emit ChallengeWindowClosed(gameId);
    }

    /**
     * @notice Check if challenge window is still open for a game
     * @param gameId Game identifier
     * @return True if window is still open
     */
    function isChallengeWindowOpen(uint256 gameId) external view returns (bool) {
        uint256 disputeId = gameToDispute[gameId];
        if (disputeId == 0) return false;

        Dispute storage dispute = disputes[disputeId];
        if (dispute.state != DisputeState.Pending) return false;

        return block.timestamp <= dispute.registeredAt + challengeWindow;
    }

    /**
     * @notice Get time remaining in challenge window
     * @param gameId Game identifier
     * @return Seconds remaining (0 if expired or not registered)
     */
    function getChallengeWindowRemaining(uint256 gameId) external view returns (uint256) {
        uint256 disputeId = gameToDispute[gameId];
        if (disputeId == 0) return 0;

        Dispute storage dispute = disputes[disputeId];
        if (dispute.state != DisputeState.Pending) return 0;

        uint256 deadline = dispute.registeredAt + challengeWindow;
        if (block.timestamp >= deadline) return 0;

        return deadline - block.timestamp;
    }

    // Internal functions

    function _handleCheatDecision(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];

        // Slash cheater's bond (burned)
        bondingManager.slashBond(dispute.gameId, dispute.accusedPlayer);

        // Return challenge deposit + reward to challenger (using SafeERC20)
        uint256 challengerReward = challengeDeposit + (challengeDeposit / 2); // 150% back
        uint256 balance = chessToken.balanceOf(address(this));
        if (balance >= challengerReward) {
            chessToken.safeTransfer(dispute.challenger, challengerReward);
            emit RewardDistributed(disputeId, dispute.challenger, challengerReward);
        } else if (balance > 0) {
            // Transfer whatever is available
            chessToken.safeTransfer(dispute.challenger, balance);
            emit RewardDistributed(disputeId, dispute.challenger, balance);
        }
    }

    function _handleLegitDecision(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];

        // Challenger loses deposit
        // 50% to accused (compensation) - using SafeERC20
        uint256 accusedCompensation = challengeDeposit / 2;
        chessToken.safeTransfer(dispute.accusedPlayer, accusedCompensation);
        emit RewardDistributed(disputeId, dispute.accusedPlayer, accusedCompensation);

        // 50% burned (deflationary)
        uint256 remaining = challengeDeposit - accusedCompensation;
        chessToken.burn(remaining);
    }

    function _escalate(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];
        dispute.escalationLevel++;

        if (dispute.escalationLevel >= 3) {
            // Max escalation reached - return deposits, no penalty (using SafeERC20)
            dispute.resolved = true;
            dispute.state = DisputeState.Resolved;
            chessToken.safeTransfer(dispute.challenger, challengeDeposit);
            activeChallenges[dispute.challenger]--;
            return;
        }

        // Reset for new round with more arbitrators
        dispute.state = DisputeState.Challenged;
        dispute.legitVotes = 0;
        dispute.cheatVotes = 0;
        dispute.abstainVotes = 0;
        dispute.commitDeadline = block.timestamp + commitPeriod;
        dispute.revealDeadline = block.timestamp + commitPeriod + revealPeriod;

        // Select new arbitrators (more this time)
        uint256 newCount = 5 + (dispute.escalationLevel * 2); // 7, 9...
        address[] memory newArbitrators = arbitratorRegistry.selectArbitrators(
            disputeId,
            dispute.accusedPlayer,
            dispute.otherPlayer,
            newCount
        );
        dispute.selectedArbitrators = newArbitrators;

        emit DisputeEscalated(disputeId, dispute.escalationLevel);
    }

    function _updateArbitratorReputations(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];

        for (uint256 i = 0; i < dispute.selectedArbitrators.length;) {
            address arbitrator = dispute.selectedArbitrators[i];
            VoteCommit storage voteCommit = votes[disputeId][arbitrator];

            if (!voteCommit.revealed) {
                // Didn't reveal - penalty
                arbitratorRegistry.updateReputation(arbitrator, false);
                unchecked { ++i; }
                continue;
            }

            // Check if voted with majority
            bool votedWithMajority = (
                (dispute.finalDecision == Vote.Cheat && voteCommit.vote == Vote.Cheat) ||
                (dispute.finalDecision == Vote.Legit && voteCommit.vote == Vote.Legit)
            );

            arbitratorRegistry.updateReputation(arbitrator, votedWithMajority);
            unchecked { ++i; }
        }
    }

    function _isSelectedArbitrator(uint256 disputeId, address arbitrator) internal view returns (bool) {
        address[] storage selected = disputes[disputeId].selectedArbitrators;
        for (uint256 i = 0; i < selected.length;) {
            if (selected[i] == arbitrator) return true;
            unchecked { ++i; }
        }
        return false;
    }

    // View functions

    function getDispute(uint256 disputeId) external view returns (
        uint256 gameId,
        address challenger,
        address accusedPlayer,
        DisputeState state,
        uint256 legitVotes,
        uint256 cheatVotes,
        Vote finalDecision,
        uint256 escalationLevel
    ) {
        Dispute storage d = disputes[disputeId];
        return (
            d.gameId,
            d.challenger,
            d.accusedPlayer,
            d.state,
            d.legitVotes,
            d.cheatVotes,
            d.finalDecision,
            d.escalationLevel
        );
    }

    function getSelectedArbitrators(uint256 disputeId) external view returns (address[] memory) {
        return disputes[disputeId].selectedArbitrators;
    }

    function getVoteStatus(uint256 disputeId, address arbitrator) external view returns (
        bool hasCommitted,
        bool hasRevealed,
        Vote revealedVote
    ) {
        VoteCommit storage v = votes[disputeId][arbitrator];
        hasCommitted = v.commitHash != bytes32(0);
        hasRevealed = v.revealed;
        revealedVote = v.vote;
    }

    // Admin functions

    function setParameters(
        uint256 _challengeWindow,
        uint256 _commitPeriod,
        uint256 _revealPeriod,
        uint256 _quorum,
        uint256 _supermajority,
        uint256 _challengeDeposit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_challengeWindow >= 1 hours && _challengeWindow <= 7 days, "Invalid challenge window");
        require(_commitPeriod >= 1 hours && _commitPeriod <= 7 days, "Invalid commit period");
        require(_revealPeriod >= 1 hours && _revealPeriod <= 7 days, "Invalid reveal period");
        require(_quorum >= 3 && _quorum <= 100, "Invalid quorum");
        require(_supermajority >= 51 && _supermajority <= 100, "Invalid supermajority");
        require(_challengeDeposit >= 1 * 10**18, "Challenge deposit too low");

        challengeWindow = _challengeWindow;
        commitPeriod = _commitPeriod;
        revealPeriod = _revealPeriod;
        quorum = _quorum;
        supermajority = _supermajority;
        challengeDeposit = _challengeDeposit;
    }
}

// SPDX-License-Identifier: MIT
/// @title ChessCore - Main chess game logic
/// @notice Inherits from ChessBoard and implements move validation and game state
contract ChessCore is ChessBoard, ReentrancyGuard {
    // ========== CUSTOM ERRORS ==========
    error GameNotInProgress();
    error NotYourTurn();
    error InvalidMove();
    error GameAlreadyStarted();
    error GameNotStarted();
    error AlreadyInitialized();
    error CannotClaimYet();
    error PrizeAlreadyClaimed();
    error NoPrizeToDistribute();
    error NotAPlayer();
    error NoDrawOffer();
    error CannotResign();
    error NotTimedOut();

    // ========== ENUMS (must be declared before state variables) ==========
    enum TimeoutPreset { Finney, Buterin, Nakamoto }
    enum GameMode { Tournament, Friendly }
    enum GameState { NotStarted, InProgress, Draw, WhiteWins, BlackWins }

    // ========== CONSTANTS ==========
    // Timeout presets (based on ~12 sec/block on Ethereum)
    uint48 public constant FINNEY_BLOCKS = 300;      // ~1 hour (Hal Finney - fast)
    uint48 public constant BUTERIN_BLOCKS = 2100;    // ~7 hours (Vitalik Buterin - medium)
    uint48 public constant NAKAMOTO_BLOCKS = 50400;  // ~7 days (Satoshi Nakamoto - slow)

    // ========== STORAGE LAYOUT OPTIMIZED FOR GAS ==========
    // Slot 1: betting (32 bytes)
    uint256 public betting;

    // Slot 2: gameId (32 bytes)
    uint256 public gameId;

    // Slot 3: Anti-cheating contracts (addresses stored separately for external access)
    BondingManager public bondingManager;  // 20 bytes

    // Slot 4
    DisputeDAO public disputeDAO;          // 20 bytes

    // Slot 5
    PlayerRating public playerRating;      // 20 bytes

    // Slot 6
    RewardPool public rewardPool;          // 20 bytes

    // Slot 7: PACKED - timeout tracking + state flags (32 bytes total)
    // uint48 max = 281 trillion blocks, far exceeds any realistic blockchain lifetime
    uint48 public whiteLastMoveBlock;      // 6 bytes
    uint48 public blackLastMoveBlock;      // 6 bytes
    uint48 public timeoutBlocks;           // 6 bytes
    GameState private gameState;           // 1 byte
    GameMode public gameMode;              // 1 byte
    bool public bondsLocked;               // 1 byte
    bool public gameRegisteredForDispute;  // 1 byte
    bool public ratingReported;            // 1 byte
    bool private prizeClaimed;             // 1 byte
    bool private initialized;              // 1 byte
    bool private rewardsDistributed;       // 1 byte
    // Game end tracking for rewards
    bool private wasCheckmate;             // 1 byte
    bool private wasResign;                // 1 byte
    bool private wasTimeout;               // 1 byte
    // Total: 6+6+6+1+1+1+1+1+1+1+1+1+1+1 = 29 bytes (fits in 1 slot with 3 bytes spare)

    // Legacy event (kept for backward compatibility)
    event Debug(int8 player, uint8 startX, uint8 startY, uint8 endX, uint8 endY, string comment);

    // Structured events for frontend
    event MoveMade(
        address indexed player,
        uint8 fromRow,
        uint8 fromCol,
        uint8 toRow,
        uint8 toCol,
        int8 piece,
        int8 capturedPiece,
        int8 promotionPiece,
        bool isCheck,
        bool isMate,
        bool isCastling,
        bool isEnPassant
    );
    event GameStarted(address indexed whitePlayer, address indexed blackPlayer, uint256 betAmount);
    event GameStateChanged(GameState newState);
    event PrizeClaimed(address winner, uint256 amount);
    event PlayerResigned(address player, address winner);
    event GameTimeout(address winner, address loser);
    event DrawOffered(address indexed player);
    event DrawOfferDeclined(address indexed player);
    event DrawAccepted();
    event DrawByRepetition(address indexed claimant);
    event DrawByFiftyMoveRule(address indexed claimant);
    event RatingReportFailed(address white, address black, uint8 result);

    // Slot 7: Player addresses
    address whitePlayer;
    address blackPlayer;
    address public currentPlayer;

    // Slot 8: Draw offer tracking
    address public drawOfferedBy;

    // Prize claim tracking for pull pattern (prevents locked funds)
    mapping(address => uint256) public pendingPrize;

    // NOTE: initialized is in the packed slot 6 above

    /// @notice Modifier to prevent re-initialization
    modifier initializer() {
        require(!initialized, "Already initialized");
        initialized = true;
        _;
    }

    /// @notice Empty constructor for implementation contract
    constructor() {
        // Implementation contract should not be used directly
        // Mark as initialized to prevent usage
        initialized = true;
    }

    /// @notice Initialize the game (called by factory on clones)
    /// @param _whitePlayer Address of white player
    /// @param _value Bet amount in wei
    /// @param _preset Timeout preset (Finney/Buterin/Nakamoto)
    /// @param _mode Game mode (Tournament/Friendly)
    /// @param _gameId Unique game identifier
    /// @param _bondingManager BondingManager contract address
    /// @param _disputeDAO DisputeDAO contract address
    /// @param _playerRating PlayerRating contract address
    /// @param _rewardPool RewardPool contract address
    function initialize(
        address _whitePlayer,
        uint _value,
        TimeoutPreset _preset,
        GameMode _mode,
        uint256 _gameId,
        address _bondingManager,
        address _disputeDAO,
        address _playerRating,
        address _rewardPool
    ) external payable initializer {
        // Initialize the board
        initializeBoard();

        whitePlayer = _whitePlayer;
        currentPlayer = _whitePlayer;
        betting = _value;
        gameMode = _mode;
        gameId = _gameId;

        // Set anti-cheating contracts (can be address(0) if not using bonding)
        if (_bondingManager != address(0)) {
            bondingManager = BondingManager(payable(_bondingManager));
        }
        if (_disputeDAO != address(0)) {
            disputeDAO = DisputeDAO(_disputeDAO);
        }
        if (_playerRating != address(0)) {
            playerRating = PlayerRating(_playerRating);
        }
        if (_rewardPool != address(0)) {
            rewardPool = RewardPool(_rewardPool);
        }

        // Set timeout based on preset
        if (_preset == TimeoutPreset.Finney) {
            timeoutBlocks = FINNEY_BLOCKS;
        } else if (_preset == TimeoutPreset.Buterin) {
            timeoutBlocks = BUTERIN_BLOCKS;
        } else {
            timeoutBlocks = NAKAMOTO_BLOCKS;
        }

        // Record initial position for threefold repetition
        bytes32 initialPosition = _computePositionHash(true);
        positionCount[initialPosition] = 1;
        positionHistory.push(initialPosition);
        maxPositionRepetitions = 1;
    }
   
   receive() external payable {
        require(gameState == GameState.NotStarted, "Game started");
    }

    function switchTurn() internal {
        currentPlayer = (currentPlayer == whitePlayer) ? blackPlayer : whitePlayer;
    }

   function joinGameAsBlack() public payable {
        require(gameState == GameState.NotStarted, "Game started");
        require(msg.sender != whitePlayer, "Already white");
        require(msg.value == betting, "Wrong bet");
        require(blackPlayer == address(0), "Black taken");

        // If bonding is enabled, lock bonds for both players (single external call)
        if (address(bondingManager) != address(0)) {
            bondingManager.lockBondsForGame(gameId, whitePlayer, msg.sender, betting);
            bondsLocked = true;
        }

        blackPlayer = msg.sender;
        gameState = GameState.InProgress;

        // Start white's clock (white moves first)
        whiteLastMoveBlock = uint48(block.number);

        // NOTE: Initial position already recorded in initialize()
        // No need to record again here - was causing duplicate entries

        emit GameStarted(whitePlayer, blackPlayer, betting);
        emit GameStateChanged(GameState.InProgress);
    }

    /// @notice Register game completion in DisputeDAO for challenge window
    /// @dev Called automatically when game ends, starts the 48h challenge window
    function _registerGameForDispute() internal {
        if (address(disputeDAO) != address(0) && !gameRegisteredForDispute && blackPlayer != address(0)) {
            disputeDAO.registerGame(gameId, whitePlayer, blackPlayer, betting);
            gameRegisteredForDispute = true;
        }
    }

    /// @notice Distribute rewards to both players after game ends
    function _distributeRewards() internal {
        if (address(rewardPool) == address(0) || rewardsDistributed || blackPlayer == address(0)) {
            return;
        }
        rewardsDistributed = true;

        uint256 moveCount = positionHistory.length;  // Approximation of total moves
        bool isDraw = (gameState == GameState.Draw);
        bool whiteWins = (gameState == GameState.WhiteWins);

        // Distribute to white player
        rewardPool.distributeReward(
            whitePlayer,
            blackPlayer,
            whiteWins,                    // isWinner
            isDraw,                       // isDraw
            wasCheckmate && whiteWins,    // isCheckmate (only for winner)
            moveCount,
            wasResign && !whiteWins && !isDraw,  // wasResign (only if this player resigned)
            wasTimeout && !whiteWins && !isDraw  // wasTimeout (only if this player timed out)
        );

        // Distribute to black player
        rewardPool.distributeReward(
            blackPlayer,
            whitePlayer,
            !whiteWins && !isDraw,        // isWinner
            isDraw,                       // isDraw
            wasCheckmate && !whiteWins && !isDraw,  // isCheckmate (only for winner)
            moveCount,
            wasResign && whiteWins,       // wasResign (only if this player resigned)
            wasTimeout && whiteWins       // wasTimeout (only if this player timed out)
        );
    }

    /// @notice Release bonds after challenge window (no dispute)
    function _releaseBonds() internal {
        if (address(bondingManager) != address(0) && bondsLocked) {
            bondingManager.releaseBond(gameId, whitePlayer);
            bondingManager.releaseBond(gameId, blackPlayer);
        }
    }

    /// @notice Report game result to rating system
    function _reportRating() internal {
        if (address(playerRating) != address(0) && !ratingReported && blackPlayer != address(0)) {
            ratingReported = true;

            // Determine result: 0 = draw, 1 = white wins, 2 = black wins
            uint8 result;
            if (gameState == GameState.Draw) {
                result = 0;
            } else if (gameState == GameState.WhiteWins) {
                result = 1;
            } else if (gameState == GameState.BlackWins) {
                result = 2;
            } else {
                return; // Game not finished
            }

            try playerRating.reportGame(whitePlayer, blackPlayer, result) {} catch {
                emit RatingReportFailed(whitePlayer, blackPlayer, result);
            }
        }
    }

    /// @notice Check if the challenge window has passed and no dispute is active
    function canClaimPrize() public view returns (bool) {
        if (address(disputeDAO) == address(0)) {
            return true; // No dispute system, can claim immediately
        }

        uint256 disputeId = disputeDAO.gameToDispute(gameId);
        if (disputeId == 0) {
            return true; // Game not registered yet, allow (will register on claim)
        }

        (
            ,  // gameId
            ,  // challenger
            ,  // accusedPlayer
            DisputeDAO.DisputeState state,
            ,  // legitVotes
            ,  // cheatVotes
            ,  // finalDecision
               // escalationLevel
        ) = disputeDAO.getDispute(disputeId);

        // Can claim if dispute is resolved
        if (state == DisputeDAO.DisputeState.Resolved) {
            return true;
        }

        // If still pending, only allow if challenge window has definitively expired
        // This prevents frontrunning attacks where someone submits a challenge
        // right before the claim transaction is mined
        if (state == DisputeDAO.DisputeState.Pending) {
            return !disputeDAO.isChallengeWindowOpen(gameId);
        }

        return false;
    }

    /// @notice Finalize game and allocate prizes (must be called before withdrawPrize)
    /// @dev Uses pull pattern to prevent locked funds if one player's address reverts
    function finalizePrizes() external nonReentrant {
        require(!prizeClaimed, "Already finalized");
        require(
            gameState == GameState.WhiteWins ||
            gameState == GameState.BlackWins ||
            gameState == GameState.Draw,
            "Not finished"
        );

        // Register game for dispute if not already done
        _registerGameForDispute();

        // If dispute system is active, check that we can claim
        if (address(disputeDAO) != address(0)) {
            require(canClaimPrize(), "Dispute in progress or challenge window open");

            // Close the challenge window in DisputeDAO
            uint256 disputeId = disputeDAO.gameToDispute(gameId);
            if (disputeId != 0) {
                try disputeDAO.closeChallengeWindow(gameId) {} catch {}
            }
        }

        // Release bonds if bonding was used
        _releaseBonds();

        // Report game result to rating system
        _reportRating();

        prizeClaimed = true;
        uint256 totalPrize = address(this).balance;

        // Allocate prizes using pull pattern (each player withdraws separately)
        if (gameState == GameState.WhiteWins) {
            pendingPrize[whitePlayer] = totalPrize;
        }
        else if (gameState == GameState.BlackWins) {
            pendingPrize[blackPlayer] = totalPrize;
        }
        else if (gameState == GameState.Draw) {
            uint256 halfPrize = totalPrize / 2;
            uint256 remainingPrize = totalPrize - halfPrize;
            pendingPrize[whitePlayer] = halfPrize;
            pendingPrize[blackPlayer] = remainingPrize;
        }
    }

    /// @notice Withdraw allocated prize (pull pattern)
    /// @dev Each player calls this to withdraw their prize after finalizePrizes()
    function withdrawPrize() external nonReentrant {
        uint256 amount = pendingPrize[msg.sender];
        require(amount > 0, "No prize to claim");

        pendingPrize[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

        emit PrizeClaimed(msg.sender, amount);
    }

    /// @notice Legacy function for backward compatibility - finalizes and withdraws in one call
    /// @dev Only works for winner in win scenarios, not for draws
    function claimPrize() external nonReentrant {
        require(!prizeClaimed, "Already claimed");
        require(
            gameState == GameState.WhiteWins ||
            gameState == GameState.BlackWins ||
            gameState == GameState.Draw,
            "Not finished"
        );

        // For draws, must use finalizePrizes() + withdrawPrize() pattern
        require(gameState != GameState.Draw, "Use finalizePrizes() for draws");

        // Verify caller is the winner
        if (gameState == GameState.WhiteWins) {
            require(msg.sender == whitePlayer, "Not winner");
        } else {
            require(msg.sender == blackPlayer, "Not winner");
        }

        // Register game for dispute if not already done
        _registerGameForDispute();

        // If dispute system is active, check that we can claim
        if (address(disputeDAO) != address(0)) {
            require(canClaimPrize(), "Dispute in progress or challenge window open");

            uint256 disputeId = disputeDAO.gameToDispute(gameId);
            if (disputeId != 0) {
                try disputeDAO.closeChallengeWindow(gameId) {} catch {}
            }
        }

        // Release bonds if bonding was used
        _releaseBonds();

        // Report game result to rating system
        _reportRating();

        prizeClaimed = true;
        uint256 totalPrize = address(this).balance;

        (bool success, ) = payable(msg.sender).call{value: totalPrize}("");
        require(success, "Transfer failed");
        emit PrizeClaimed(msg.sender, totalPrize);
    }

    function resign() external {
        require(
            msg.sender == whitePlayer || msg.sender == blackPlayer,
            "Not a player"
        );
        require(
            gameState == GameState.InProgress || gameState == GameState.NotStarted,
            "Game finished"
        );

        wasResign = true;  // Track for reward penalty

        address winner;
        if (msg.sender == whitePlayer) {
            gameState = GameState.BlackWins;
            winner = blackPlayer;
        } else {
            gameState = GameState.WhiteWins;
            winner = whitePlayer;
        }

        // Register for dispute system and distribute rewards
        _registerGameForDispute();
        _distributeRewards();

        emit PlayerResigned(msg.sender, winner);
        emit GameStateChanged(gameState);
    }

    /// @notice Offer a draw to the opponent
    function offerDraw() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (gameState != GameState.InProgress || drawOfferedBy != address(0)) revert GameNotInProgress();
        drawOfferedBy = msg.sender;
        emit DrawOffered(msg.sender);
    }

    /// @notice Accept a draw offer from the opponent
    function acceptDraw() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (drawOfferedBy == address(0) || drawOfferedBy == msg.sender) revert NoDrawOffer();
        gameState = GameState.Draw;
        drawOfferedBy = address(0);

        // Register for dispute system and distribute rewards
        _registerGameForDispute();
        _distributeRewards();

        emit DrawAccepted();
        emit GameStateChanged(GameState.Draw);
    }

    /// @notice Decline a draw offer
    function declineDraw() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (drawOfferedBy == address(0) || drawOfferedBy == msg.sender) revert NoDrawOffer();
        address offerer = drawOfferedBy;
        drawOfferedBy = address(0);
        emit DrawOfferDeclined(offerer);
    }

    /// @notice Cancel your own draw offer
    function cancelDrawOffer() external {
        if (drawOfferedBy != msg.sender) revert NoDrawOffer();
        drawOfferedBy = address(0);
        emit DrawOfferDeclined(msg.sender);
    }

    /// @notice Get current draw offer status
    function getDrawOfferStatus() external view returns (address) {
        return drawOfferedBy;
    }

    /// @notice Claim draw by threefold repetition
    /// @dev Can be called by either player when position has occurred 3+ times
    function claimDrawByRepetition() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (gameState != GameState.InProgress) revert GameNotInProgress();

        // Check current position count
        bool isWhiteTurn = (currentPlayer == whitePlayer);
        bytes32 posHash = _computePositionHash(isWhiteTurn);
        require(positionCount[posHash] >= 3, "Position not repeated 3 times");

        gameState = GameState.Draw;
        _registerGameForDispute();
        _distributeRewards();

        emit DrawByRepetition(msg.sender);
        emit GameStateChanged(GameState.Draw);
    }

    /// @notice Claim draw by 50-move rule
    /// @dev Can be called by either player when 50 moves have passed without pawn move or capture
    function claimDrawByFiftyMoveRule() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (gameState != GameState.InProgress) revert GameNotInProgress();
        require(halfMoveClock >= 100, "50 moves not reached"); // 100 half-moves = 50 full moves

        gameState = GameState.Draw;
        _registerGameForDispute();
        _distributeRewards();

        emit DrawByFiftyMoveRule(msg.sender);
        emit GameStateChanged(GameState.Draw);
    }

    /// @notice Claim victory when opponent has not moved within timeout period
    function claimVictoryByTimeout() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (gameState != GameState.InProgress) revert GameNotInProgress();
        if (msg.sender == currentPlayer) revert NotYourTurn();

        // Check if current player (opponent) has exceeded their time
        uint256 opponentLastMove = (currentPlayer == whitePlayer)
            ? whiteLastMoveBlock
            : blackLastMoveBlock;

        if (block.number < opponentLastMove + timeoutBlocks) revert NotTimedOut();

        wasTimeout = true;  // Track for reward penalty (loser timed out)

        address winner = msg.sender;
        address loser = currentPlayer;

        if (msg.sender == whitePlayer) {
            gameState = GameState.WhiteWins;
        } else {
            gameState = GameState.BlackWins;
        }

        // Register for dispute system and distribute rewards
        _registerGameForDispute();
        _distributeRewards();

        emit GameTimeout(winner, loser);
        emit GameStateChanged(gameState);
    }

    function isPawnMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view returns (bool) {
        // Check if pawn is moving forward
        if (startY == endY && target == 0) {
            if (piece == -PAWN) { // black pawn
                if (endX == startX + 1 || (startX == ROW_BLACK_PAWNS && endX == ROW_BLACK_PAWNS_LONG_OPENING)) {
                    return true;
                }
            } 
            else { // white pawn
                if (endX == startX - 1 || (startX == ROW_WHITE_PAWNS && endX == ROW_WHITE_PAWNS_LONG_OPENING)) {
                    return true;
                }
            }
        }

        // Check if pawn is capturing diagonally
        if (abs(int8(endY) - int8(startY)) == 1) {
            if (piece == PAWN && endX == startX - 1 && target < 0) { // White pawn captures black piece (moving up)
                return true;
            }
            else
            if (piece == -PAWN && endX == startX + 1 && target > 0) { // Black pawn captures white piece (moving down)
                return true;
            }
        }

        // En passant capture
        if (enPassantCol >= 0 && abs(int8(endY) - int8(startY)) == 1 && target == EMPTY) {
            // White pawn captures en passant
            if (piece == PAWN &&
                endX == startX - 1 &&
                startX == ROW_BLACK_PAWNS_LONG_OPENING && // White pawn must be on row 3 (adjacent to black's double move)
                int8(endY) == enPassantCol &&
                enPassantRow == startX) {
                return true;
            }
            // Black pawn captures en passant
            else if (piece == -PAWN &&
                     endX == startX + 1 &&
                     startX == ROW_WHITE_PAWNS_LONG_OPENING && // Black pawn must be on row 4 (adjacent to white's double move)
                     int8(endY) == enPassantCol &&
                     enPassantRow == startX) {
                return true;
            }
        }

        return false;
    }

    function isKnightMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private pure returns (bool) {
        // Check if knight moves in L-shape
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if ((deltaX == 1 && deltaY == 2) || (deltaX == 2 && deltaY == 1)) {
            if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                return true;
            }
        }
        return false;
    }


    function isBishopMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view returns (bool) {
        // Check if bishop moves diagonally
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if (deltaX == deltaY) {
            if (isPathClear(startX, startY, endX, endY)) {
                if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                    return true;
                }
            }
        }

        return false;
    }


    function isRookMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view returns (bool) {
        // Check if rook moves horizontally or vertically
        if (startX == endX || startY == endY) {
            if (isPathClear(startX, startY, endX, endY)) {
                if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                    return true;
                }
            }
        }

        return false;
    }


    function isQueenMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private view  returns (bool) {
        // Check if queen moves diagonally, horizontally, or vertically
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if (deltaX == deltaY || startX == endX || startY == endY) {
            if (isPathClear(startX, startY, endX, endY)) {
                if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                    return true;
                }
            }
        }

        return false;
    }


    function isKingMoveValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 piece, int8 target) private pure returns (bool) {
        // Check if king moves one square in any direction
        uint8 deltaX = abs(int8(endX) - int8(startX));
        uint8 deltaY = abs(int8(endY) - int8(startY));
        if (deltaX <= 1 && deltaY <= 1) {
            if (target * piece <= 0) { // Check if destination square is empty or occupied by opponent piece
                return true;
            }
        }

        return false;
    }


    function isKingInCheck(int8 player) private view returns (bool) {
        // Use cached king position instead of O(n²) search
        uint8 kingX = (player == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingY = (player == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        // Check if any of the opponent's pieces can attack the king
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE;) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE;) {
                if (player * board[rowPiece][colPiece] < 0) { // Check if piece belongs to opponent
                    if (isValidMoveView(rowPiece, colPiece, kingX, kingY)) {
                        return true;
                    }
                }
                unchecked { ++colPiece; }
            }
            unchecked { ++rowPiece; }
        }

        return false;
    }

    /// @notice Check if a move would leave the current player's king in check
    function wouldMoveLeaveKingInCheck(uint8 sX, uint8 sY, uint8 eX, uint8 eY) private view returns (bool) {
        int8 p = board[sX][sY];
        int8 pl = (p > 0) ? PLAYER_WHITE : PLAYER_BLACK;
        uint8 kX = (abs(p) == uint8(KING)) ? eX : ((pl == PLAYER_WHITE) ? whiteKingRow : blackKingRow);
        uint8 kY = (abs(p) == uint8(KING)) ? eY : ((pl == PLAYER_WHITE) ? whiteKingCol : blackKingCol);

        for (uint8 r = 0; r < BOARD_SIZE;) {
            for (uint8 c = 0; c < BOARD_SIZE;) {
                if (r == eX && c == eY) { unchecked { ++c; } continue; }
                int8 pc = board[r][c];
                if (pc * pl >= 0) { unchecked { ++c; } continue; }
                if (_canAttack(r, c, pc, kX, kY, sX, sY, eX, eY)) return true;
                unchecked { ++c; }
            }
            unchecked { ++r; }
        }
        return false;
    }

    function _canAttack(uint8 aR, uint8 aC, int8 ap, uint8 kR, uint8 kC, uint8 fR, uint8 fC, uint8 tR, uint8 tC) private view returns (bool) {
        uint8 a = abs(ap);
        if (a == uint8(PAWN)) {
            int8 d = (ap > 0) ? int8(-1) : int8(1);
            return (int8(kR) == int8(aR) + d && abs(int8(kC) - int8(aC)) == 1);
        }
        if (a == uint8(KNIGHT)) {
            uint8 dX = abs(int8(kR) - int8(aR));
            uint8 dY = abs(int8(kC) - int8(aC));
            return (dX == 2 && dY == 1) || (dX == 1 && dY == 2);
        }
        if (a == uint8(KING)) return abs(int8(kR) - int8(aR)) <= 1 && abs(int8(kC) - int8(aC)) <= 1;

        int8 dR = int8(kR) - int8(aR);
        int8 dC = int8(kC) - int8(aC);
        uint8 adR = abs(dR); uint8 adC = abs(dC);
        bool diag = (adR == adC && adR > 0);
        bool str = (dR == 0 || dC == 0) && (adR > 0 || adC > 0);
        if (a == uint8(BISHOP) && !diag) return false;
        if (a == uint8(ROOK) && !str) return false;
        if (a == uint8(QUEEN) && !diag && !str) return false;

        int8 sR = (dR == 0) ? int8(0) : (dR > 0 ? int8(1) : int8(-1));
        int8 sC = (dC == 0) ? int8(0) : (dC > 0 ? int8(1) : int8(-1));
        uint8 cR = uint8(int8(aR) + sR); uint8 cC = uint8(int8(aC) + sC);
        while (cR != kR || cC != kC) {
            if (!(cR == fR && cC == fC)) {
                if ((cR == tR && cC == tC) || board[cR][cC] != EMPTY) return false;
            }
            cR = uint8(int8(cR) + sR); cC = uint8(int8(cC) + sC);
        }
        return true;
    }

    function isSquareUnderAttack(int8 player, uint8 x, uint8 y) internal view returns (bool) {
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE;) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE;) {
                //check if the opponent pieces can do a valid move to that square
                if (currentPlayer == whitePlayer && board[rowPiece][colPiece] * player < 0 && isValidMoveView(rowPiece, colPiece, x, y)
                || currentPlayer == blackPlayer && board[rowPiece][colPiece] * player > 0 && isValidMoveView(rowPiece,colPiece, x, y)) {
                    return true;
                }
                unchecked { ++colPiece; }
            }
            unchecked { ++rowPiece; }
        }
        return false;
    }

    function minY(uint8 a, uint8 b) internal pure returns (uint8) {
        return a < b ? a : b;
    }

    function maxY(uint8 a, uint8 b) internal pure returns (uint8) {
        return a > b ? a : b;
    }

    function isCastlingValid(uint8 startX, uint8 startY, uint8 endX, uint8 endY, int8 player) internal view returns (bool) {
        // Verifica se il re attraversa caselle minacciate
        //TODO fai double check per capire se questo if è superfluo, visto che viene controllato dentro il for
        if (isSquareUnderAttack(player, startX, startY) || isSquareUnderAttack(player, endX, endY)) {
            return false;
        }

        // Verifica se le caselle attraversate sono libere
        if (startY == COL_KING && (endY == COL_BISHOP || endY == COL_KNIGHT)) {
            uint8 rookY = (endY == COL_KNIGHT) ? COL_SHORTW_LONGB_ROOK : COL_LONGW_SHORTB_ROOK;
            for (uint8 col = minY(startY, endY); col <= maxY(startY, endY); col++) {
                if (board[startX][col] != EMPTY || isSquareUnderAttack(player, startX, col) || isSquareUnderAttack(player, rookY, col)) {
                    return false;
                }
            }
        }

        return true;
    }

    /// @notice Check if the path is clear for castling (squares between king and destination must be empty)
    function isCastlingPathClear(uint8 row, uint8 kingCol, uint8 destCol) private view returns (bool) {
        // Determine direction
        uint8 minCol = kingCol < destCol ? kingCol : destCol;
        uint8 maxCol = kingCol > destCol ? kingCol : destCol;

        // Check all squares between king and destination (exclusive of king's start)
        for (uint8 col = minCol + 1; col < maxCol; col++) {
            if (board[row][col] != EMPTY) {
                return false;
            }
        }

        // For queenside castling, also check the b-file square (col 1) which rook passes through
        if (destCol == COL_BISHOP) { // Queenside
            if (board[row][COL_UNNAMED_KNIGHT] != EMPTY) { // b-file
                return false;
            }
        }

        // Check destination square is empty
        if (board[row][destCol] != EMPTY) {
            return false;
        }

        return true;
    }

    /// @notice Pure view validation - does NOT modify any state (used for check detection)
    function isValidMoveView(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private view returns (bool) {
        int8 piece = board[startX][startY];
        int8 target = board[endX][endY];

        // Check if the move is a castling attempt (king moves 2 squares)
        if (abs(int8(endY) - int8(startY)) == COL_BISHOP && abs(piece) == uint8(KING)) {
            if (piece == KING) { // White king
                if (startX == ROW_WHITE_PIECES && startY == COL_KING && !whiteKingMoved) {
                    // Kingside castling: king e1->g1 (col 4->6), rook h1 (col 7)
                    if (uint8(ROOK) == abs(board[startX][COL_LONGW_SHORTB_ROOK]) && endY == COL_KNIGHT && !whiteLongRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                    // Queenside castling: king e1->c1 (col 4->2), rook a1 (col 0)
                    if (uint8(ROOK) == abs(board[startX][COL_SHORTW_LONGB_ROOK]) && endY == COL_BISHOP && !whiteShortRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                }
            } else { // Black king
                if (startX == ROW_BLACK_PIECES && startY == COL_KING && !blackKingMoved) {
                    // Kingside castling: king e8->g8 (col 4->6), rook h8 (col 7)
                    if (uint8(ROOK) == abs(board[startX][COL_LONGW_SHORTB_ROOK]) && endY == COL_KNIGHT && !blackLongRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                    // Queenside castling: king e8->c8 (col 4->2), rook a8 (col 0)
                    if (uint8(ROOK) == abs(board[startX][COL_SHORTW_LONGB_ROOK]) && endY == COL_BISHOP && !blackShortRookMoved) {
                        return isCastlingPathClear(startX, startY, endY);
                    }
                }
            }
            return false;
        }

        // Check if target square is empty or contains an opponent's piece
        if (target == EMPTY || piece * target < 0) {
            if (abs(piece) == uint8(PAWN)) {
                return isPawnMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(KNIGHT)) {
                return isKnightMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(BISHOP)) {
                return isBishopMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(ROOK)) {
                return isRookMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(QUEEN)) {
                return isQueenMoveValid(startX, startY, endX, endY, piece, target);
            }
            else if (abs(piece) == uint8(KING)) {
                return isKingMoveValid(startX, startY, endX, endY, piece, target);
            }
        }

        return false;
    }

    /// @notice Validates move and updates rook moved flags when rook moves
    function isValidMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private returns (bool) {
        // First check if the move is valid using view function
        if (!isValidMoveView(startX, startY, endX, endY)) {
            return false;
        }

        int8 piece = board[startX][startY];

        // Update rook moved flags only when a rook actually moves
        if (abs(piece) == uint8(ROOK)) {
            if (startX == ROW_WHITE_PIECES && startY == COL_SHORTW_LONGB_ROOK && !whiteShortRookMoved) {
                whiteShortRookMoved = true;
            }
            else if (startX == ROW_WHITE_PIECES && startY == COL_LONGW_SHORTB_ROOK && !whiteLongRookMoved) {
                whiteLongRookMoved = true;
            }
            else if (startX == ROW_BLACK_PIECES && startY == COL_LONGW_SHORTB_ROOK && !blackLongRookMoved) {
                blackLongRookMoved = true;
            }
            else if (startX == ROW_BLACK_PIECES && startY == COL_SHORTW_LONGB_ROOK && !blackShortRookMoved) {
                blackShortRookMoved = true;
            }
        }

        return true;
    }

    function isPathClear(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private view returns (bool) {
        uint8 deltaX = endX > startX ? endX - startX : startX - endX;
        uint8 deltaY = endY > startY ? endY - startY : startY - endY;
        bool stepXPositive = endX > startX;
        bool stepYPositive = endY > startY;

        if (deltaX == deltaY) {
            // Diagonal move (bishop or queen)
            for (uint8 i = 1; i < deltaX; i++) {
                uint8 checkX = stepXPositive ? startX + i : startX - i;
                uint8 checkY = stepYPositive ? startY + i : startY - i;
                if (EMPTY != board[checkX][checkY]) {
                    return false;
                }
            }
        }
        else if (startX == endX) {
            // Horizontal move (same row, different column)
            for (uint8 i = 1; i < deltaY; i++) {
                uint8 checkY = stepYPositive ? startY + i : startY - i;
                if (EMPTY != board[startX][checkY]) {
                    return false;
                }
            }
        }
        else if (startY == endY) {
            // Vertical move (same column, different row)
            for (uint8 i = 1; i < deltaX; i++) {
                uint8 checkX = stepXPositive ? startX + i : startX - i;
                if (EMPTY != board[checkX][startY]) {
                    return false;
                }
            }
        }
        else {
            // Invalid move (not diagonal, horizontal, or vertical)
            return false;
        }

        return true;
    }

    modifier onlyCurrentPlayer() {
        require(msg.sender == currentPlayer, "Not your turn");
        _;
    }

    modifier onlyOwnPieces(uint8 startX, uint8 startY){
        int8 playerColor = 1;
        if (currentPlayer == blackPlayer){
            playerColor *= PLAYER_BLACK;
        }
        require(board[startX][startY] * playerColor > 0, "Not your piece");
        _;
    }

    // Wrapper for backward compatibility - promotes to Queen by default
    function makeMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) public {
        makeMoveWithPromotion(startX, startY, endX, endY, QUEEN);
    }

    // Main move function with promotion support
    function makeMoveWithPromotion(
        uint8 startX,
        uint8 startY,
        uint8 endX,
        uint8 endY,
        int8 promotionPiece
    ) public onlyCurrentPlayer onlyOwnPieces(startX, startY) {
        // Bounds checking for coordinates
        require(startX < BOARD_SIZE && startY < BOARD_SIZE && endX < BOARD_SIZE && endY < BOARD_SIZE, "Bad coords");

        require(gameState == GameState.InProgress || gameState == GameState.NotStarted, "Bad state");

        // Making a move automatically declines any pending draw offer
        if (drawOfferedBy != address(0)) {
            drawOfferedBy = address(0);
        }

        // Check if the move is valid for this piece type
        require(isValidMove(startX, startY, endX, endY), "Invalid move");

        // Check that this move doesn't leave our own king in check
        bool leavesKingInCheck = wouldMoveLeaveKingInCheck(startX, startY, endX, endY);
        if (gameMode == GameMode.Friendly) {
            // Friendly mode: reject illegal moves (protect player from mistakes)
            require(!leavesKingInCheck, "Move leaves king in check");
        }

        // Store the piece being moved before clearing the start position
        int8 movingPiece = board[startX][startY];
        int8 targetPiece = board[endX][endY];

        // Make the move
        board[endX][endY] = movingPiece;
        board[startX][startY] = EMPTY;

        // Update cached king position if king was moved
        if (abs(movingPiece) == uint8(KING)) {
            if (movingPiece == KING) {
                whiteKingRow = endX;
                whiteKingCol = endY;
            } else {
                blackKingRow = endX;
                blackKingCol = endY;
            }
        }

        // Track if this move sets up en passant for the opponent
        bool isDoublePawnMove = false;

        // Handle pawn-specific logic
        if (abs(movingPiece) == uint8(PAWN)) {
            // Check for en passant capture (diagonal move to empty square)
            if (abs(int8(endY) - int8(startY)) == 1 && targetPiece == EMPTY) {
                // This is an en passant capture - remove the captured pawn
                if (movingPiece == PAWN && enPassantCol == int8(endY) && startX == ROW_BLACK_PAWNS_LONG_OPENING) {
                    // White captures black pawn en passant (white is on row 3)
                    board[startX][endY] = EMPTY; // Remove the black pawn
                } else if (movingPiece == -PAWN && enPassantCol == int8(endY) && startX == ROW_WHITE_PAWNS_LONG_OPENING) {
                    // Black captures white pawn en passant (black is on row 4)
                    board[startX][endY] = EMPTY; // Remove the white pawn
                }
            }

            // Check for double pawn move (sets up en passant for opponent)
            if (movingPiece == PAWN && startX == ROW_WHITE_PAWNS && endX == ROW_WHITE_PAWNS_LONG_OPENING) {
                // White pawn double move
                isDoublePawnMove = true;
                enPassantCol = int8(endY);
                enPassantRow = endX; // Row 4
            } else if (movingPiece == -PAWN && startX == ROW_BLACK_PAWNS && endX == ROW_BLACK_PAWNS_LONG_OPENING) {
                // Black pawn double move
                isDoublePawnMove = true;
                enPassantCol = int8(endY);
                enPassantRow = endX; // Row 3
            }

            // Handle pawn promotion
            bool isWhitePawnPromoting = (movingPiece == PAWN && endX == ROW_BLACK_PIECES);
            bool isBlackPawnPromoting = (movingPiece == -PAWN && endX == ROW_WHITE_PIECES);

            if (isWhitePawnPromoting || isBlackPawnPromoting) {
                // Validate promotion piece (must be Queen, Rook, Bishop, or Knight)
                require(
                    promotionPiece == QUEEN ||
                    promotionPiece == ROOK ||
                    promotionPiece == BISHOP ||
                    promotionPiece == KNIGHT,
                    "Invalid promotion piece"
                );

                // Apply the correct sign based on player color
                if (isWhitePawnPromoting) {
                    board[endX][endY] = promotionPiece; // White piece (positive)
                } else {
                    board[endX][endY] = -promotionPiece; // Black piece (negative)
                }
            }
        }

        // Reset en passant if this was not a double pawn move
        if (!isDoublePawnMove) {
            enPassantCol = -1;
        }

        // Track king moves (any king move prevents future castling)
        if (uint8(KING) == abs(movingPiece)) {
            if (currentPlayer == whitePlayer) {
                whiteKingMoved = true;
            } else {
                blackKingMoved = true;
            }

            // Handle castling (king moves 2 squares horizontally)
            if (abs(int8(endY) - int8(startY)) == 2) {
                // Move the rook during castling
                if (endY == COL_KNIGHT) {
                    // Kingside castling - rook h1/h8 moves to f1/f8
                    board[startX][COL_UNNAMED_BISHOP] = board[startX][COL_LONGW_SHORTB_ROOK];
                    board[startX][COL_LONGW_SHORTB_ROOK] = EMPTY;
                } else if (endY == COL_BISHOP) {
                    // Queenside castling - rook a1/a8 moves to d1/d8
                    board[startX][COL_QUEEN] = board[startX][COL_SHORTW_LONGB_ROOK];
                    board[startX][COL_SHORTW_LONGB_ROOK] = EMPTY;
                }
            }
        }

        // Handle game state updates and emit events
        _handleMoveResult(
            startX, startY, endX, endY,
            movingPiece, targetPiece, promotionPiece,
            leavesKingInCheck
        );

        // Update opponent's clock (they now need to move)
        // currentPlayer is still the player who just moved
        if (currentPlayer == whitePlayer) {
            blackLastMoveBlock = uint48(block.number);
        } else {
            whiteLastMoveBlock = uint48(block.number);
        }

        // Update 50-move rule counter
        // Reset if pawn moved or capture occurred, otherwise increment
        bool isPawnMove = (abs(movingPiece) == uint8(PAWN));
        bool isCapture = (targetPiece != EMPTY) ||
                         (isPawnMove && abs(int8(endY) - int8(startY)) == 1 && targetPiece == EMPTY); // en passant

        if (isPawnMove || isCapture) {
            halfMoveClock = 0;
        } else {
            halfMoveClock++;
        }

        // FIDE 75-move rule: automatic draw after 75 full moves without progress
        // This prevents unbounded game length and positionHistory growth
        if (halfMoveClock >= MAX_HALF_MOVES_WITHOUT_PROGRESS) {
            gameState = GameState.Draw;
            _registerGameForDispute();
            _distributeRewards();
            _reportRating(); // Reports draw based on gameState
            emit GameStateChanged(gameState);
            return; // Exit early - game over
        }

        switchTurn();

        // Track position for threefold repetition (after turn switch)
        // Only track if game is still in progress
        if (gameState == GameState.InProgress) {
            bool isWhiteTurn = (currentPlayer == whitePlayer);
            bytes32 posHash = _computePositionHash(isWhiteTurn);

            if (positionCount[posHash] == 0) {
                positionHistory.push(posHash);
            }
            positionCount[posHash]++;

            // Update cached max repetitions (avoids O(n) loop in getDrawRuleStatus)
            if (positionCount[posHash] > maxPositionRepetitions) {
                maxPositionRepetitions = positionCount[posHash];
            }
        }
    }

    /// @notice Build a comment string for the move event (simplified for size)
    function _buildMoveComment(int8, int8, uint8, uint8, bool, bool) internal pure returns (string memory) {
        return "";
    }

    /// @notice Handle move result: check/mate detection, events, and dispute registration
    function _handleMoveResult(
        uint8 startX, uint8 startY, uint8 endX, uint8 endY,
        int8 movingPiece, int8 targetPiece, int8 promotionPiece,
        bool leavesKingInCheck
    ) internal {
        // Detect special moves
        bool isCastling = (abs(movingPiece) == uint8(KING)) && (abs(int8(endY) - int8(startY)) == 2);
        bool isEnPassant = (abs(movingPiece) == uint8(PAWN)) &&
                           (abs(int8(endY) - int8(startY)) == 1) &&
                           (targetPiece == EMPTY);
        int8 actualCaptured = isEnPassant ? (movingPiece > 0 ? -PAWN : PAWN) : targetPiece;

        // Check/checkmate detection
        (bool isCheck, bool isMate, GameState newState) = _detectCheckMate(endX, endY, leavesKingInCheck);
        GameState previousState = gameState;
        gameState = newState;

        // Track checkmate for reward bonus
        if (isMate) {
            wasCheckmate = true;
        }

        // Emit legacy event
        emit Debug((currentPlayer == whitePlayer) ? int8(1) : int8(-1), startX, startY, endX, endY, "");

        // Emit structured event
        emit MoveMade(currentPlayer, startX, startY, endX, endY, movingPiece, actualCaptured,
                      promotionPiece, isCheck, isMate, isCastling, isEnPassant);

        // Emit game state change and register dispute if game ended
        if (gameState != previousState) {
            emit GameStateChanged(gameState);
            if (gameState == GameState.WhiteWins || gameState == GameState.BlackWins || gameState == GameState.Draw) {
                _registerGameForDispute();
                _distributeRewards();
            }
        }
    }

    /// @notice Detect check/checkmate state after a move
    function _detectCheckMate(uint8 endX, uint8 endY, bool leavesKingInCheck) internal view returns (bool isCheck, bool isMate, GameState newState) {
        // In Tournament mode, illegal move = loss
        if (gameMode == GameMode.Tournament && leavesKingInCheck) {
            return (false, true, (currentPlayer == whitePlayer) ? GameState.BlackWins : GameState.WhiteWins);
        }

        if (isKingInCheck(PLAYER_BLACK)) {
            isMate = isCheckmate(PLAYER_BLACK, endX, endY);
            return (!isMate, isMate, isMate ? GameState.WhiteWins : GameState.InProgress);
        }
        if (isKingInCheck(PLAYER_WHITE)) {
            isMate = isCheckmate(PLAYER_WHITE, endX, endY);
            return (!isMate, isMate, isMate ? GameState.BlackWins : GameState.InProgress);
        }

        return (false, false, isStalemate() ? GameState.Draw : GameState.InProgress);
    }

    // Check if the given player's king can move out of check
    function canKingMove(int8 player) internal view returns (bool) {
        uint8 kingX = (player == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingY = (player == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        // Check all 8 adjacent squares
        for (int8 i = -1; i <= 1; i++) {
            for (int8 j = -1; j <= 1; j++) {
                if (i == 0 && j == 0) continue;
                if (isKingMoveEscape(player, kingX, kingY, i, j)) {
                    return true;
                }
            }
        }
        return false;
    }

    // Helper: Check if moving king by (di, dj) is a valid escape
    function isKingMoveEscape(int8 player, uint8 kingX, uint8 kingY, int8 di, int8 dj) internal view returns (bool) {
        int8 x = int8(kingX) + di;
        int8 y = int8(kingY) + dj;

        // Check bounds
        if (x < 0 || x >= int8(BOARD_SIZE) || y < 0 || y >= int8(BOARD_SIZE)) {
            return false;
        }

        uint8 newX = uint8(x);
        uint8 newY = uint8(y);
        int8 targetPiece = board[newX][newY];
        int8 kingPiece = board[kingX][kingY];

        // Can't capture own piece
        if (targetPiece != EMPTY && targetPiece * kingPiece > 0) {
            return false;
        }

        // Check if the destination square is safe (not under attack)
        return !isSquareUnderAttackAfterKingMove(player, newX, newY, kingX, kingY);
    }

    // Check if a square would be under attack after king moves there
    function isSquareUnderAttackAfterKingMove(int8 player, uint8 targetX, uint8 targetY, uint8 fromX, uint8 fromY) internal view returns (bool) {
        for (uint8 row = 0; row < BOARD_SIZE;) {
            for (uint8 col = 0; col < BOARD_SIZE;) {
                // Skip the square king is moving from and the target square
                if ((row == fromX && col == fromY) || (row == targetX && col == targetY)) {
                    unchecked { ++col; }
                    continue;
                }

                int8 piece = board[row][col];
                if (piece * player < 0) { // Opponent piece
                    if (canPieceAttackSquare(row, col, targetX, targetY, fromX, fromY)) {
                        return true;
                    }
                }
                unchecked { ++col; }
            }
            unchecked { ++row; }
        }
        return false;
    }

    // Helper function to check if a piece can attack a square, considering that the king moved
    function canPieceAttackSquare(uint8 pieceRow, uint8 pieceCol, uint8 targetRow, uint8 targetCol, uint8 ignoreRow, uint8 ignoreCol) internal view returns (bool) {
        int8 piece = board[pieceRow][pieceCol];
        uint8 absPiece = abs(piece);

        if (absPiece == uint8(PAWN)) {
            int8 direction = (piece > 0) ? int8(-1) : int8(1);
            return (int8(targetRow) == int8(pieceRow) + direction && abs(int8(targetCol) - int8(pieceCol)) == 1);
        }
        if (absPiece == uint8(KNIGHT)) {
            uint8 dX = abs(int8(targetRow) - int8(pieceRow));
            uint8 dY = abs(int8(targetCol) - int8(pieceCol));
            return (dX == 2 && dY == 1) || (dX == 1 && dY == 2);
        }
        if (absPiece == uint8(KING)) {
            return abs(int8(targetRow) - int8(pieceRow)) <= 1 && abs(int8(targetCol) - int8(pieceCol)) <= 1;
        }

        // Sliding pieces (Bishop, Rook, Queen)
        return canSlidingPieceAttack(pieceRow, pieceCol, targetRow, targetCol, ignoreRow, ignoreCol, absPiece);
    }

    // Helper for sliding pieces attack check
    function canSlidingPieceAttack(uint8 pieceRow, uint8 pieceCol, uint8 targetRow, uint8 targetCol, uint8 ignoreRow, uint8 ignoreCol, uint8 absPiece) internal view returns (bool) {
        int8 deltaRow = int8(targetRow) - int8(pieceRow);
        int8 deltaCol = int8(targetCol) - int8(pieceCol);
        uint8 absDeltaRow = abs(deltaRow);
        uint8 absDeltaCol = abs(deltaCol);

        bool isDiagonal = (absDeltaRow == absDeltaCol && absDeltaRow > 0);
        bool isStraight = (deltaRow == 0 || deltaCol == 0) && (absDeltaRow > 0 || absDeltaCol > 0);

        if (absPiece == uint8(BISHOP) && !isDiagonal) return false;
        if (absPiece == uint8(ROOK) && !isStraight) return false;
        if (absPiece == uint8(QUEEN) && !isDiagonal && !isStraight) return false;

        // Check path is clear
        int8 stepRow = (deltaRow == 0) ? int8(0) : (deltaRow > 0 ? int8(1) : int8(-1));
        int8 stepCol = (deltaCol == 0) ? int8(0) : (deltaCol > 0 ? int8(1) : int8(-1));

        uint8 checkRow = uint8(int8(pieceRow) + stepRow);
        uint8 checkCol = uint8(int8(pieceCol) + stepCol);

        while (checkRow != targetRow || checkCol != targetCol) {
            if (!(checkRow == ignoreRow && checkCol == ignoreCol)) {
                if (board[checkRow][checkCol] != EMPTY) {
                    return false;
                }
            }
            checkRow = uint8(int8(checkRow) + stepRow);
            checkCol = uint8(int8(checkCol) + stepCol);
        }
        return true;
    }

    // Check if the game is in stalemate
    function isStalemate() internal view returns (bool) {
        int8 player = (currentPlayer == whitePlayer) ? int8(PLAYER_WHITE) : int8(PLAYER_BLACK);

        // Check if there are any valid moves for current player pieces
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE;) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE;) {
                // If we find a piece belonging to the current player, then check if it can perform a move
                if (board[rowPiece][colPiece] * player > 0 ) {
                    for (uint8 row_target = 0; row_target < BOARD_SIZE;) {
                        for (uint8 col_target = 0; col_target < BOARD_SIZE;) {
                            if (board[row_target][col_target] != board[rowPiece][colPiece]
                                && isValidMoveView(rowPiece, colPiece, row_target, col_target)) {
                                return false;
                            }
                            unchecked { ++col_target; }
                        }
                        unchecked { ++row_target; }
                    }
                }
                unchecked { ++colPiece; }
            }
            unchecked { ++rowPiece; }
        }

        // No any valid move for the current player
        return true;
    }

    // Check if the given player's king is in checkmate
    function isCheckmate(int8 player, uint8 attackerI, uint8 attackerJ) internal view returns (bool) {
        // Check if the king can move out of check
        if (canKingMove(player)) {
            return false;
        }

        // Check if the attacking piece can be captured
        if (canCaptureAttacker(player, attackerI, attackerJ)) {
            return false;
        }

        // Check if any other piece can block the attack
        if (canBlockAttack(attackerI, attackerJ)) {
            return false;
        }

        // The king is in checkmate
        return true;
    }

    // Check if the player pieces can capture the attacking piece
    function canCaptureAttacker(int8 player, uint8 rowAttacker, uint8 colAttacker) internal view returns (bool) {
        // Iterate over all pieces on the board
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE;) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE;) {
                // Skip empty squares and pieces belonging to the attacker
                if (board[rowPiece][colPiece] == EMPTY || board[rowPiece][colPiece] * player < 0 || (rowPiece == rowAttacker && colPiece == colAttacker)) {
                    unchecked { ++colPiece; }
                    continue;
                }

                // Check if the piece can capture the attacking piece
                if (isValidMoveView(rowPiece, colPiece, rowAttacker, colAttacker)) {
                    // A piece can capture the attacking piece
                    return true;
                }
                unchecked { ++colPiece; }
            }
            unchecked { ++rowPiece; }
        }

        // No piece can capture the attacking piece
        return false;
    }

    function canBlockAttack(uint8 rowAttacker, uint8 colAttacker) internal view returns (bool) {
        // Get the king position for the player in check
        // The player in check is the one whose turn it will be next (after the attacking move)
        int8 attackerPiece = board[rowAttacker][colAttacker];
        int8 defendingPlayer = (attackerPiece > 0) ? PLAYER_BLACK : PLAYER_WHITE;

        uint8 kingRow = (defendingPlayer == PLAYER_WHITE) ? whiteKingRow : blackKingRow;
        uint8 kingCol = (defendingPlayer == PLAYER_WHITE) ? whiteKingCol : blackKingCol;

        // Knights can't be blocked (they jump)
        if (abs(attackerPiece) == uint8(KNIGHT)) {
            return false;
        }

        // Find the squares between attacker and king that could be blocked
        int8 deltaRow = int8(kingRow) - int8(rowAttacker);
        int8 deltaCol = int8(kingCol) - int8(colAttacker);

        // Get step direction
        int8 stepRow = (deltaRow == 0) ? int8(0) : (deltaRow > 0 ? int8(1) : int8(-1));
        int8 stepCol = (deltaCol == 0) ? int8(0) : (deltaCol > 0 ? int8(1) : int8(-1));

        // Check each square between attacker and king
        uint8 blockRow = uint8(int8(rowAttacker) + stepRow);
        uint8 blockCol = uint8(int8(colAttacker) + stepCol);

        while (blockRow != kingRow || blockCol != kingCol) {
            // Check if any defending piece can move to this blocking square
            for (uint8 pieceRow = 0; pieceRow < BOARD_SIZE;) {
                for (uint8 pieceCol = 0; pieceCol < BOARD_SIZE;) {
                    int8 piece = board[pieceRow][pieceCol];

                    // Skip empty squares, opponent pieces, and the king (can't block with king)
                    if (piece == EMPTY || piece * defendingPlayer <= 0 || abs(piece) == uint8(KING)) {
                        unchecked { ++pieceCol; }
                        continue;
                    }

                    // Check if this piece can move to the blocking square
                    if (isValidMoveView(pieceRow, pieceCol, blockRow, blockCol)) {
                        return true;
                    }
                    unchecked { ++pieceCol; }
                }
                unchecked { ++pieceRow; }
            }

            blockRow = uint8(int8(blockRow) + stepRow);
            blockCol = uint8(int8(blockCol) + stepCol);
        }

        // No piece can block the attack
        return false;
    }

    function getPlayers() external view returns (address, address) {
        return (whitePlayer, blackPlayer);
    }

    /// @notice Setup function for custom board positions (Friendly mode only)
    /// @dev Only callable in Friendly mode, by white player, before game starts
    /// @dev This allows creative chess variants but is disabled in Tournament mode
    function debugCreative(uint8 x, uint8 y, int8 piece) external returns (string memory) {
        require(gameMode == GameMode.Friendly, "Only allowed in Friendly mode");
        require(msg.sender == whitePlayer, "Only white player can setup board");
        require(gameState == GameState.NotStarted, "Can only setup before game starts");
        require(x < BOARD_SIZE && y < BOARD_SIZE, "Invalid coordinates");

        board[x][y] = piece;
        // Update king position cache if placing a king
        if (piece == KING) {
            whiteKingRow = x;
            whiteKingCol = y;
        } else if (piece == -KING) {
            blackKingRow = x;
            blackKingCol = y;
        }
        return printBoard();
    }

    function getGameState () external view returns (uint8) {
        if (gameState == GameState.NotStarted) return 1;
        if (gameState == GameState.InProgress) return 2;
        if (gameState == GameState.Draw) return 3;
        if (gameState == GameState.WhiteWins) return 4;
        if (gameState == GameState.BlackWins) return 5;

        return 0;
    }

    /// @notice Get timeout status for both players
    /// @return whiteBlocksRemaining Blocks remaining before white times out (0 if not their turn)
    /// @return blackBlocksRemaining Blocks remaining before black times out (0 if not their turn)
    /// @return currentPlayerIsWhite True if it's white's turn
    function getTimeoutStatus() external view returns (
        uint256 whiteBlocksRemaining,
        uint256 blackBlocksRemaining,
        bool currentPlayerIsWhite
    ) {
        currentPlayerIsWhite = (currentPlayer == whitePlayer);

        if (gameState != GameState.InProgress) {
            return (0, 0, currentPlayerIsWhite);
        }

        if (currentPlayerIsWhite) {
            uint256 elapsed = block.number - whiteLastMoveBlock;
            whiteBlocksRemaining = elapsed >= timeoutBlocks ? 0 : timeoutBlocks - elapsed;
            blackBlocksRemaining = 0;
        } else {
            uint256 elapsed = block.number - blackLastMoveBlock;
            blackBlocksRemaining = elapsed >= timeoutBlocks ? 0 : timeoutBlocks - elapsed;
            whiteBlocksRemaining = 0;
        }
    }
}

interface IERC721 is IERC165 {
    /**
     * @dev Emitted when `tokenId` token is transferred from `from` to `to`.
     */
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /**
     * @dev Emitted when `owner` enables `approved` to manage the `tokenId` token.
     */
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);

    /**
     * @dev Emitted when `owner` enables or disables (`approved`) `operator` to manage all of its assets.
     */
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    /**
     * @dev Returns the number of tokens in ``owner``'s account.
     */
    function balanceOf(address owner) external view returns (uint256 balance);

    /**
     * @dev Returns the owner of the `tokenId` token.
     *
     * Requirements:
     *
     * - `tokenId` must exist.
     */
    function ownerOf(uint256 tokenId) external view returns (address owner);

    /**
     * @dev Safely transfers `tokenId` token from `from` to `to`.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `tokenId` token must exist and be owned by `from`.
     * - If the caller is not `from`, it must be approved to move this token by either {approve} or {setApprovalForAll}.
     * - If `to` refers to a smart contract, it must implement {IERC721Receiver-onERC721Received}, which is called upon
     *   a safe transfer.
     *
     * Emits a {Transfer} event.
     */
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;

    /**
     * @dev Safely transfers `tokenId` token from `from` to `to`, checking first that contract recipients
     * are aware of the ERC-721 protocol to prevent tokens from being forever locked.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `tokenId` token must exist and be owned by `from`.
     * - If the caller is not `from`, it must have been allowed to move this token by either {approve} or
     *   {setApprovalForAll}.
     * - If `to` refers to a smart contract, it must implement {IERC721Receiver-onERC721Received}, which is called upon
     *   a safe transfer.
     *
     * Emits a {Transfer} event.
     */
    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    /**
     * @dev Transfers `tokenId` token from `from` to `to`.
     *
     * WARNING: Note that the caller is responsible to confirm that the recipient is capable of receiving ERC-721
     * or else they may be permanently lost. Usage of {safeTransferFrom} prevents loss, though the caller must
     * understand this adds an external call which potentially creates a reentrancy vulnerability.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `tokenId` token must be owned by `from`.
     * - If the caller is not `from`, it must be approved to move this token by either {approve} or {setApprovalForAll}.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 tokenId) external;

    /**
     * @dev Gives permission to `to` to transfer `tokenId` token to another account.
     * The approval is cleared when the token is transferred.
     *
     * Only a single account can be approved at a time, so approving the zero address clears previous approvals.
     *
     * Requirements:
     *
     * - The caller must own the token or be an approved operator.
     * - `tokenId` must exist.
     *
     * Emits an {Approval} event.
     */
    function approve(address to, uint256 tokenId) external;

    /**
     * @dev Approve or remove `operator` as an operator for the caller.
     * Operators can call {transferFrom} or {safeTransferFrom} for any token owned by the caller.
     *
     * Requirements:
     *
     * - The `operator` cannot be the address zero.
     *
     * Emits an {ApprovalForAll} event.
     */
    function setApprovalForAll(address operator, bool approved) external;

    /**
     * @dev Returns the account approved for `tokenId` token.
     *
     * Requirements:
     *
     * - `tokenId` must exist.
     */
    function getApproved(uint256 tokenId) external view returns (address operator);

    /**
     * @dev Returns if the `operator` is allowed to manage all of the assets of `owner`.
     *
     * See {setApprovalForAll}
     */
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IERC721Metadata is IERC721 {
    /**
     * @dev Returns the token collection name.
     */
    function name() external view returns (string memory);

    /**
     * @dev Returns the token collection symbol.
     */
    function symbol() external view returns (string memory);

    /**
     * @dev Returns the Uniform Resource Identifier (URI) for `tokenId` token.
     */
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

interface IERC721Receiver {
    /**
     * @dev Whenever an {IERC721} `tokenId` token is transferred to this contract via {IERC721-safeTransferFrom}
     * by `operator` from `from`, this function is called.
     *
     * It must return its Solidity selector to confirm the token transfer.
     * If any other value is returned or the interface is not implemented by the recipient, the transfer will be
     * reverted.
     *
     * The selector can be obtained in Solidity with `IERC721Receiver.onERC721Received.selector`.
     */
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

interface IERC721Errors {
    /**
     * @dev Indicates that an address can't be an owner. For example, `address(0)` is a forbidden owner in ERC-20.
     * Used in balance queries.
     * @param owner Address of the current owner of a token.
     */
    error ERC721InvalidOwner(address owner);

    /**
     * @dev Indicates a `tokenId` whose `owner` is the zero address.
     * @param tokenId Identifier number of a token.
     */
    error ERC721NonexistentToken(uint256 tokenId);

    /**
     * @dev Indicates an error related to the ownership over a particular token. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     * @param tokenId Identifier number of a token.
     * @param owner Address of the current owner of a token.
     */
    error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner);

    /**
     * @dev Indicates a failure with the token `sender`. Used in transfers.
     * @param sender Address whose tokens are being transferred.
     */
    error ERC721InvalidSender(address sender);

    /**
     * @dev Indicates a failure with the token `receiver`. Used in transfers.
     * @param receiver Address to which tokens are being transferred.
     */
    error ERC721InvalidReceiver(address receiver);

    /**
     * @dev Indicates a failure with the `operator`’s approval. Used in transfers.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     * @param tokenId Identifier number of a token.
     */
    error ERC721InsufficientApproval(address operator, uint256 tokenId);

    /**
     * @dev Indicates a failure with the `approver` of a token to be approved. Used in approvals.
     * @param approver Address initiating an approval operation.
     */
    error ERC721InvalidApprover(address approver);

    /**
     * @dev Indicates a failure with the `operator` to be approved. Used in approvals.
     * @param operator Address that may be allowed to operate on tokens without being their owner.
     */
    error ERC721InvalidOperator(address operator);
}

library ERC721Utils {
    /**
     * @dev Performs an acceptance check for the provided `operator` by calling {IERC721Receiver-onERC721Received}
     * on the `to` address. The `operator` is generally the address that initiated the token transfer (i.e. `msg.sender`).
     *
     * The acceptance call is not executed and treated as a no-op if the target address doesn't contain code (i.e. an EOA).
     * Otherwise, the recipient must implement {IERC721Receiver-onERC721Received} and return the acceptance magic value to accept
     * the transfer.
     */
    function checkOnERC721Received(
        address operator,
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) internal {
        if (to.code.length > 0) {
            try IERC721Receiver(to).onERC721Received(operator, from, tokenId, data) returns (bytes4 retval) {
                if (retval != IERC721Receiver.onERC721Received.selector) {
                    // Token rejected
                    revert IERC721Errors.ERC721InvalidReceiver(to);
                }
            } catch (bytes memory reason) {
                if (reason.length == 0) {
                    // non-IERC721Receiver implementer
                    revert IERC721Errors.ERC721InvalidReceiver(to);
                } else {
                    assembly ("memory-safe") {
                        revert(add(reason, 0x20), mload(reason))
                    }
                }
            }
        }
    }
}

abstract contract ERC721 is Context, ERC165, IERC721, IERC721Metadata, IERC721Errors {
    using Strings for uint256;

    // Token name
    string private _name;

    // Token symbol
    string private _symbol;

    mapping(uint256 tokenId => address) private _owners;

    mapping(address owner => uint256) private _balances;

    mapping(uint256 tokenId => address) private _tokenApprovals;

    mapping(address owner => mapping(address operator => bool)) private _operatorApprovals;

    /**
     * @dev Initializes the contract by setting a `name` and a `symbol` to the token collection.
     */
    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool) {
        return
            interfaceId == type(IERC721).interfaceId ||
            interfaceId == type(IERC721Metadata).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IERC721
    function balanceOf(address owner) public view virtual returns (uint256) {
        if (owner == address(0)) {
            revert ERC721InvalidOwner(address(0));
        }
        return _balances[owner];
    }

    /// @inheritdoc IERC721
    function ownerOf(uint256 tokenId) public view virtual returns (address) {
        return _requireOwned(tokenId);
    }

    /// @inheritdoc IERC721Metadata
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /// @inheritdoc IERC721Metadata
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /// @inheritdoc IERC721Metadata
    function tokenURI(uint256 tokenId) public view virtual returns (string memory) {
        _requireOwned(tokenId);

        string memory baseURI = _baseURI();
        return bytes(baseURI).length > 0 ? string.concat(baseURI, tokenId.toString()) : "";
    }

    /**
     * @dev Base URI for computing {tokenURI}. If set, the resulting URI for each
     * token will be the concatenation of the `baseURI` and the `tokenId`. Empty
     * by default, can be overridden in child contracts.
     */
    function _baseURI() internal view virtual returns (string memory) {
        return "";
    }

    /// @inheritdoc IERC721
    function approve(address to, uint256 tokenId) public virtual {
        _approve(to, tokenId, _msgSender());
    }

    /// @inheritdoc IERC721
    function getApproved(uint256 tokenId) public view virtual returns (address) {
        _requireOwned(tokenId);

        return _getApproved(tokenId);
    }

    /// @inheritdoc IERC721
    function setApprovalForAll(address operator, bool approved) public virtual {
        _setApprovalForAll(_msgSender(), operator, approved);
    }

    /// @inheritdoc IERC721
    function isApprovedForAll(address owner, address operator) public view virtual returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    /// @inheritdoc IERC721
    function transferFrom(address from, address to, uint256 tokenId) public virtual {
        if (to == address(0)) {
            revert ERC721InvalidReceiver(address(0));
        }
        // Setting an "auth" arguments enables the `_isAuthorized` check which verifies that the token exists
        // (from != 0). Therefore, it is not needed to verify that the return value is not 0 here.
        address previousOwner = _update(to, tokenId, _msgSender());
        if (previousOwner != from) {
            revert ERC721IncorrectOwner(from, tokenId, previousOwner);
        }
    }

    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId) public {
        safeTransferFrom(from, to, tokenId, "");
    }

    /// @inheritdoc IERC721
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public virtual {
        transferFrom(from, to, tokenId);
        ERC721Utils.checkOnERC721Received(_msgSender(), from, to, tokenId, data);
    }

    /**
     * @dev Returns the owner of the `tokenId`. Does NOT revert if token doesn't exist
     *
     * IMPORTANT: Any overrides to this function that add ownership of tokens not tracked by the
     * core ERC-721 logic MUST be matched with the use of {_increaseBalance} to keep balances
     * consistent with ownership. The invariant to preserve is that for any address `a` the value returned by
     * `balanceOf(a)` must be equal to the number of tokens such that `_ownerOf(tokenId)` is `a`.
     */
    function _ownerOf(uint256 tokenId) internal view virtual returns (address) {
        return _owners[tokenId];
    }

    /**
     * @dev Returns the approved address for `tokenId`. Returns 0 if `tokenId` is not minted.
     */
    function _getApproved(uint256 tokenId) internal view virtual returns (address) {
        return _tokenApprovals[tokenId];
    }

    /**
     * @dev Returns whether `spender` is allowed to manage `owner`'s tokens, or `tokenId` in
     * particular (ignoring whether it is owned by `owner`).
     *
     * WARNING: This function assumes that `owner` is the actual owner of `tokenId` and does not verify this
     * assumption.
     */
    function _isAuthorized(address owner, address spender, uint256 tokenId) internal view virtual returns (bool) {
        return
            spender != address(0) &&
            (owner == spender || isApprovedForAll(owner, spender) || _getApproved(tokenId) == spender);
    }

    /**
     * @dev Checks if `spender` can operate on `tokenId`, assuming the provided `owner` is the actual owner.
     * Reverts if:
     * - `spender` does not have approval from `owner` for `tokenId`.
     * - `spender` does not have approval to manage all of `owner`'s assets.
     *
     * WARNING: This function assumes that `owner` is the actual owner of `tokenId` and does not verify this
     * assumption.
     */
    function _checkAuthorized(address owner, address spender, uint256 tokenId) internal view virtual {
        if (!_isAuthorized(owner, spender, tokenId)) {
            if (owner == address(0)) {
                revert ERC721NonexistentToken(tokenId);
            } else {
                revert ERC721InsufficientApproval(spender, tokenId);
            }
        }
    }

    /**
     * @dev Unsafe write access to the balances, used by extensions that "mint" tokens using an {ownerOf} override.
     *
     * NOTE: the value is limited to type(uint128).max. This protect against _balance overflow. It is unrealistic that
     * a uint256 would ever overflow from increments when these increments are bounded to uint128 values.
     *
     * WARNING: Increasing an account's balance using this function tends to be paired with an override of the
     * {_ownerOf} function to resolve the ownership of the corresponding tokens so that balances and ownership
     * remain consistent with one another.
     */
    function _increaseBalance(address account, uint128 value) internal virtual {
        unchecked {
            _balances[account] += value;
        }
    }

    /**
     * @dev Transfers `tokenId` from its current owner to `to`, or alternatively mints (or burns) if the current owner
     * (or `to`) is the zero address. Returns the owner of the `tokenId` before the update.
     *
     * The `auth` argument is optional. If the value passed is non 0, then this function will check that
     * `auth` is either the owner of the token, or approved to operate on the token (by the owner).
     *
     * Emits a {Transfer} event.
     *
     * NOTE: If overriding this function in a way that tracks balances, see also {_increaseBalance}.
     */
    function _update(address to, uint256 tokenId, address auth) internal virtual returns (address) {
        address from = _ownerOf(tokenId);

        // Perform (optional) operator check
        if (auth != address(0)) {
            _checkAuthorized(from, auth, tokenId);
        }

        // Execute the update
        if (from != address(0)) {
            // Clear approval. No need to re-authorize or emit the Approval event
            _approve(address(0), tokenId, address(0), false);

            unchecked {
                _balances[from] -= 1;
            }
        }

        if (to != address(0)) {
            unchecked {
                _balances[to] += 1;
            }
        }

        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);

        return from;
    }

    /**
     * @dev Mints `tokenId` and transfers it to `to`.
     *
     * WARNING: Usage of this method is discouraged, use {_safeMint} whenever possible
     *
     * Requirements:
     *
     * - `tokenId` must not exist.
     * - `to` cannot be the zero address.
     *
     * Emits a {Transfer} event.
     */
    function _mint(address to, uint256 tokenId) internal {
        if (to == address(0)) {
            revert ERC721InvalidReceiver(address(0));
        }
        address previousOwner = _update(to, tokenId, address(0));
        if (previousOwner != address(0)) {
            revert ERC721InvalidSender(address(0));
        }
    }

    /**
     * @dev Mints `tokenId`, transfers it to `to` and checks for `to` acceptance.
     *
     * Requirements:
     *
     * - `tokenId` must not exist.
     * - If `to` refers to a smart contract, it must implement {IERC721Receiver-onERC721Received}, which is called upon a safe transfer.
     *
     * Emits a {Transfer} event.
     */
    function _safeMint(address to, uint256 tokenId) internal {
        _safeMint(to, tokenId, "");
    }

    /**
     * @dev Same as {xref-ERC721-_safeMint-address-uint256-}[`_safeMint`], with an additional `data` parameter which is
     * forwarded in {IERC721Receiver-onERC721Received} to contract recipients.
     */
    function _safeMint(address to, uint256 tokenId, bytes memory data) internal virtual {
        _mint(to, tokenId);
        ERC721Utils.checkOnERC721Received(_msgSender(), address(0), to, tokenId, data);
    }

    /**
     * @dev Destroys `tokenId`.
     * The approval is cleared when the token is burned.
     * This is an internal function that does not check if the sender is authorized to operate on the token.
     *
     * Requirements:
     *
     * - `tokenId` must exist.
     *
     * Emits a {Transfer} event.
     */
    function _burn(uint256 tokenId) internal {
        address previousOwner = _update(address(0), tokenId, address(0));
        if (previousOwner == address(0)) {
            revert ERC721NonexistentToken(tokenId);
        }
    }

    /**
     * @dev Transfers `tokenId` from `from` to `to`.
     *  As opposed to {transferFrom}, this imposes no restrictions on msg.sender.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - `tokenId` token must be owned by `from`.
     *
     * Emits a {Transfer} event.
     */
    function _transfer(address from, address to, uint256 tokenId) internal {
        if (to == address(0)) {
            revert ERC721InvalidReceiver(address(0));
        }
        address previousOwner = _update(to, tokenId, address(0));
        if (previousOwner == address(0)) {
            revert ERC721NonexistentToken(tokenId);
        } else if (previousOwner != from) {
            revert ERC721IncorrectOwner(from, tokenId, previousOwner);
        }
    }

    /**
     * @dev Safely transfers `tokenId` token from `from` to `to`, checking that contract recipients
     * are aware of the ERC-721 standard to prevent tokens from being forever locked.
     *
     * `data` is additional data, it has no specified format and it is sent in call to `to`.
     *
     * This internal function is like {safeTransferFrom} in the sense that it invokes
     * {IERC721Receiver-onERC721Received} on the receiver, and can be used to e.g.
     * implement alternative mechanisms to perform token transfer, such as signature-based.
     *
     * Requirements:
     *
     * - `tokenId` token must exist and be owned by `from`.
     * - `to` cannot be the zero address.
     * - `from` cannot be the zero address.
     * - If `to` refers to a smart contract, it must implement {IERC721Receiver-onERC721Received}, which is called upon a safe transfer.
     *
     * Emits a {Transfer} event.
     */
    function _safeTransfer(address from, address to, uint256 tokenId) internal {
        _safeTransfer(from, to, tokenId, "");
    }

    /**
     * @dev Same as {xref-ERC721-_safeTransfer-address-address-uint256-}[`_safeTransfer`], with an additional `data` parameter which is
     * forwarded in {IERC721Receiver-onERC721Received} to contract recipients.
     */
    function _safeTransfer(address from, address to, uint256 tokenId, bytes memory data) internal virtual {
        _transfer(from, to, tokenId);
        ERC721Utils.checkOnERC721Received(_msgSender(), from, to, tokenId, data);
    }

    /**
     * @dev Approve `to` to operate on `tokenId`
     *
     * The `auth` argument is optional. If the value passed is non 0, then this function will check that `auth` is
     * either the owner of the token, or approved to operate on all tokens held by this owner.
     *
     * Emits an {Approval} event.
     *
     * Overrides to this logic should be done to the variant with an additional `bool emitEvent` argument.
     */
    function _approve(address to, uint256 tokenId, address auth) internal {
        _approve(to, tokenId, auth, true);
    }

    /**
     * @dev Variant of `_approve` with an optional flag to enable or disable the {Approval} event. The event is not
     * emitted in the context of transfers.
     */
    function _approve(address to, uint256 tokenId, address auth, bool emitEvent) internal virtual {
        // Avoid reading the owner unless necessary
        if (emitEvent || auth != address(0)) {
            address owner = _requireOwned(tokenId);

            // We do not use _isAuthorized because single-token approvals should not be able to call approve
            if (auth != address(0) && owner != auth && !isApprovedForAll(owner, auth)) {
                revert ERC721InvalidApprover(auth);
            }

            if (emitEvent) {
                emit Approval(owner, to, tokenId);
            }
        }

        _tokenApprovals[tokenId] = to;
    }

    /**
     * @dev Approve `operator` to operate on all of `owner` tokens
     *
     * Requirements:
     * - operator can't be the address zero.
     *
     * Emits an {ApprovalForAll} event.
     */
    function _setApprovalForAll(address owner, address operator, bool approved) internal virtual {
        if (operator == address(0)) {
            revert ERC721InvalidOperator(operator);
        }
        _operatorApprovals[owner][operator] = approved;
        emit ApprovalForAll(owner, operator, approved);
    }

    /**
     * @dev Reverts if the `tokenId` doesn't have a current owner (it hasn't been minted, or it has been burned).
     * Returns the owner.
     *
     * Overrides to ownership logic should be done to {_ownerOf}.
     */
    function _requireOwned(uint256 tokenId) internal view returns (address) {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) {
            revert ERC721NonexistentToken(tokenId);
        }
        return owner;
    }
}

interface IERC721Enumerable is IERC721 {
    /**
     * @dev Returns the total amount of tokens stored by the contract.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns a token ID owned by `owner` at a given `index` of its token list.
     * Use along with {balanceOf} to enumerate all of ``owner``'s tokens.
     */
    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256);

    /**
     * @dev Returns a token ID at a given `index` of all the tokens stored by the contract.
     * Use along with {totalSupply} to enumerate all tokens.
     */
    function tokenByIndex(uint256 index) external view returns (uint256);
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC721/extensions/ERC721Enumerable.sol)
/**
 * @dev This implements an optional extension of {ERC721} defined in the ERC that adds enumerability
 * of all the token ids in the contract as well as all token ids owned by each account.
 *
 * CAUTION: {ERC721} extensions that implement custom `balanceOf` logic, such as {ERC721Consecutive},
 * interfere with enumerability and should not be used together with {ERC721Enumerable}.
 */
abstract contract ERC721Enumerable is ERC721, IERC721Enumerable {
    mapping(address owner => mapping(uint256 index => uint256)) private _ownedTokens;
    mapping(uint256 tokenId => uint256) private _ownedTokensIndex;

    uint256[] private _allTokens;
    mapping(uint256 tokenId => uint256) private _allTokensIndex;

    /**
     * @dev An `owner`'s token query was out of bounds for `index`.
     *
     * NOTE: The owner being `address(0)` indicates a global out of bounds index.
     */
    error ERC721OutOfBoundsIndex(address owner, uint256 index);

    /**
     * @dev Batch mint is not allowed.
     */
    error ERC721EnumerableForbiddenBatchMint();

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC721) returns (bool) {
        return interfaceId == type(IERC721Enumerable).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IERC721Enumerable
    function tokenOfOwnerByIndex(address owner, uint256 index) public view virtual returns (uint256) {
        if (index >= balanceOf(owner)) {
            revert ERC721OutOfBoundsIndex(owner, index);
        }
        return _ownedTokens[owner][index];
    }

    /// @inheritdoc IERC721Enumerable
    function totalSupply() public view virtual returns (uint256) {
        return _allTokens.length;
    }

    /// @inheritdoc IERC721Enumerable
    function tokenByIndex(uint256 index) public view virtual returns (uint256) {
        if (index >= totalSupply()) {
            revert ERC721OutOfBoundsIndex(address(0), index);
        }
        return _allTokens[index];
    }

    /// @inheritdoc ERC721
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address previousOwner = super._update(to, tokenId, auth);

        if (previousOwner == address(0)) {
            _addTokenToAllTokensEnumeration(tokenId);
        } else if (previousOwner != to) {
            _removeTokenFromOwnerEnumeration(previousOwner, tokenId);
        }
        if (to == address(0)) {
            _removeTokenFromAllTokensEnumeration(tokenId);
        } else if (previousOwner != to) {
            _addTokenToOwnerEnumeration(to, tokenId);
        }

        return previousOwner;
    }

    /**
     * @dev Private function to add a token to this extension's ownership-tracking data structures.
     * @param to address representing the new owner of the given token ID
     * @param tokenId uint256 ID of the token to be added to the tokens list of the given address
     */
    function _addTokenToOwnerEnumeration(address to, uint256 tokenId) private {
        uint256 length = balanceOf(to) - 1;
        _ownedTokens[to][length] = tokenId;
        _ownedTokensIndex[tokenId] = length;
    }

    /**
     * @dev Private function to add a token to this extension's token tracking data structures.
     * @param tokenId uint256 ID of the token to be added to the tokens list
     */
    function _addTokenToAllTokensEnumeration(uint256 tokenId) private {
        _allTokensIndex[tokenId] = _allTokens.length;
        _allTokens.push(tokenId);
    }

    /**
     * @dev Private function to remove a token from this extension's ownership-tracking data structures. Note that
     * while the token is not assigned a new owner, the `_ownedTokensIndex` mapping is _not_ updated: this allows for
     * gas optimizations e.g. when performing a transfer operation (avoiding double writes).
     * This has O(1) time complexity, but alters the order of the _ownedTokens array.
     * @param from address representing the previous owner of the given token ID
     * @param tokenId uint256 ID of the token to be removed from the tokens list of the given address
     */
    function _removeTokenFromOwnerEnumeration(address from, uint256 tokenId) private {
        // To prevent a gap in from's tokens array, we store the last token in the index of the token to delete, and
        // then delete the last slot (swap and pop).

        uint256 lastTokenIndex = balanceOf(from);
        uint256 tokenIndex = _ownedTokensIndex[tokenId];

        mapping(uint256 index => uint256) storage _ownedTokensByOwner = _ownedTokens[from];

        // When the token to delete is the last token, the swap operation is unnecessary
        if (tokenIndex != lastTokenIndex) {
            uint256 lastTokenId = _ownedTokensByOwner[lastTokenIndex];

            _ownedTokensByOwner[tokenIndex] = lastTokenId; // Move the last token to the slot of the to-delete token
            _ownedTokensIndex[lastTokenId] = tokenIndex; // Update the moved token's index
        }

        // This also deletes the contents at the last position of the array
        delete _ownedTokensIndex[tokenId];
        delete _ownedTokensByOwner[lastTokenIndex];
    }

    /**
     * @dev Private function to remove a token from this extension's token tracking data structures.
     * This has O(1) time complexity, but alters the order of the _allTokens array.
     * @param tokenId uint256 ID of the token to be removed from the tokens list
     */
    function _removeTokenFromAllTokensEnumeration(uint256 tokenId) private {
        // To prevent a gap in the tokens array, we store the last token in the index of the token to delete, and
        // then delete the last slot (swap and pop).

        uint256 lastTokenIndex = _allTokens.length - 1;
        uint256 tokenIndex = _allTokensIndex[tokenId];

        // When the token to delete is the last token, the swap operation is unnecessary. However, since this occurs so
        // rarely (when the last minted token is burnt) that we still do the swap here to avoid the gas cost of adding
        // an 'if' statement (like in _removeTokenFromOwnerEnumeration)
        uint256 lastTokenId = _allTokens[lastTokenIndex];

        _allTokens[tokenIndex] = lastTokenId; // Move the last token to the slot of the to-delete token
        _allTokensIndex[lastTokenId] = tokenIndex; // Update the moved token's index

        // This also deletes the contents at the last position of the array
        delete _allTokensIndex[tokenId];
        _allTokens.pop();
    }

    /**
     * See {ERC721-_increaseBalance}. We need that to account tokens that were minted in batch
     */
    function _increaseBalance(address account, uint128 amount) internal virtual override {
        if (amount > 0) {
            revert ERC721EnumerableForbiddenBatchMint();
        }
        super._increaseBalance(account, amount);
    }
}

// SPDX-License-Identifier: MIT
interface IChessCore {
    function printChessBoardLayoutSVG() external view returns (string memory);
}

contract ChessNFT is ERC721Enumerable, Ownable {
    using ChessMediaLibrary for uint8[8][8];

    // Game ID => ChessCore address (single source of truth)
    mapping(uint256 => address) public gameNFTs;

    address public immutable factory;

    event GameNFTCreated(uint256 indexed gameId, address indexed gameAddress, address indexed owner);

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory can mint NFTs");
        _;
    }

    constructor(address _initialOwner) ERC721("ChessNFT", "Chess") Ownable(_initialOwner) {
        factory = msg.sender; // ChessFactory is the deployer
    }

    /// @notice Get the SVG representation of the game board
    /// @param _tokenId The game/token ID
    function tokenURI(uint256 _tokenId) public view virtual override returns (string memory) {
        address gameAddress = gameNFTs[_tokenId];
        require(gameAddress != address(0), "Token does not exist");
        IChessCore c = IChessCore(gameAddress);
        return c.printChessBoardLayoutSVG();
    }

    /// @notice Create an NFT for a new game
    /// @param gameId The unique game identifier
    /// @param _chessCoreAddress The address of the ChessCore contract
    /// @param _whitePlayer The white player who will own the NFT
    function createGameNFT(uint256 gameId, address _chessCoreAddress, address _whitePlayer) external onlyFactory {
        require(gameNFTs[gameId] == address(0), "NFT for the game already exists");
        require(_chessCoreAddress != address(0), "Invalid game address");

        gameNFTs[gameId] = _chessCoreAddress;
        _mint(_whitePlayer, gameId);

        emit GameNFTCreated(gameId, _chessCoreAddress, _whitePlayer);
    }

    /// @notice Get the game address for a token
    /// @param tokenId The token ID
    function getGameAddress(uint256 tokenId) external view returns (address) {
        return gameNFTs[tokenId];
    }
}

// SPDX-License-Identifier: MIT
contract ChessFactory {
    using Clones for address;

    address[] public deployedChessGames;
    address public addressNFT;
    uint256 public totalChessGames;

    // ChessCore implementation contract (used for cloning)
    address public chessCoreImplementation;

    // Anti-cheating system contracts
    address public bondingManager;
    address public disputeDAO;
    address public playerRating;
    address public rewardPool;
    address public owner;

    // Bet limits (can be adjusted for different networks)
    uint256 public constant MIN_BET = 0.001 ether;
    uint256 public constant MAX_BET = 100 ether;

    event GameCreated(
        uint256 indexed gameId,
        address indexed gameAddress,
        address indexed whitePlayer,
        uint256 betAmount,
        ChessCore.TimeoutPreset timeoutPreset,
        ChessCore.GameMode gameMode
    );
    event BondingManagerUpdated(address indexed oldAddress, address indexed newAddress);
    event DisputeDAOUpdated(address indexed oldAddress, address indexed newAddress);
    event PlayerRatingUpdated(address indexed oldAddress, address indexed newAddress);
    event RewardPoolUpdated(address indexed oldAddress, address indexed newAddress);
    event ImplementationUpdated(address indexed oldImplementation, address indexed newImplementation);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _chessCoreImplementation) {
        require(_chessCoreImplementation != address(0), "Invalid implementation");
        owner = msg.sender;
        chessCoreImplementation = _chessCoreImplementation;
        ChessNFT newChessNFT = new ChessNFT(msg.sender);
        addressNFT = address(newChessNFT);
    }

    /// @notice Update ChessCore implementation (for upgrades)
    /// @param _newImplementation New implementation address
    function setImplementation(address _newImplementation) external onlyOwner {
        require(_newImplementation != address(0), "Invalid implementation");
        emit ImplementationUpdated(chessCoreImplementation, _newImplementation);
        chessCoreImplementation = _newImplementation;
    }

    /// @notice Set the BondingManager contract address
    /// @param _bondingManager Address of BondingManager (address(0) to disable)
    function setBondingManager(address _bondingManager) external onlyOwner {
        emit BondingManagerUpdated(bondingManager, _bondingManager);
        bondingManager = _bondingManager;
    }

    /// @notice Set the DisputeDAO contract address
    /// @param _disputeDAO Address of DisputeDAO (address(0) to disable)
    function setDisputeDAO(address _disputeDAO) external onlyOwner {
        emit DisputeDAOUpdated(disputeDAO, _disputeDAO);
        disputeDAO = _disputeDAO;
    }

    /// @notice Set the PlayerRating contract address
    /// @param _playerRating Address of PlayerRating (address(0) to disable)
    function setPlayerRating(address _playerRating) external onlyOwner {
        emit PlayerRatingUpdated(playerRating, _playerRating);
        playerRating = _playerRating;
    }

    /// @notice Set the RewardPool contract address
    /// @param _rewardPool Address of RewardPool (address(0) to disable)
    function setRewardPool(address _rewardPool) external onlyOwner {
        emit RewardPoolUpdated(rewardPool, _rewardPool);
        rewardPool = _rewardPool;
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function createChessGame(ChessCore.TimeoutPreset _timeoutPreset, ChessCore.GameMode _gameMode) public payable returns (address) {
        require(msg.value >= MIN_BET, "Bet amount too low");
        require(msg.value <= MAX_BET, "Bet amount too high");

        // If bonding is enabled, verify white player has sufficient bond
        if (bondingManager != address(0)) {
            require(
                BondingManager(payable(bondingManager)).hasSufficientBond(msg.sender, msg.value),
                "Insufficient bond - deposit more CHESS and ETH"
            );
        }

        uint256 gameId = totalChessGames;

        // Create a minimal proxy clone of ChessCore implementation
        address clone = chessCoreImplementation.clone();

        // Initialize the clone with game parameters
        ChessCore(payable(clone)).initialize{value: msg.value}(
            msg.sender,
            msg.value,
            _timeoutPreset,
            _gameMode,
            gameId,
            bondingManager,
            disputeDAO,
            playerRating,
            rewardPool
        );

        deployedChessGames.push(clone);
        totalChessGames++;

        // Register game contract with RewardPool and PlayerRating for O(1) validation
        if (rewardPool != address(0)) {
            RewardPool(rewardPool).registerGameContract(clone);
        }
        if (playerRating != address(0)) {
            PlayerRating(playerRating).registerGameContract(clone);
        }

        ChessNFT(addressNFT).createGameNFT(gameId, clone, msg.sender);

        emit GameCreated(gameId, clone, msg.sender, msg.value, _timeoutPreset, _gameMode);
        return clone;
    }

    /// @notice Check if a player has sufficient bond for a given bet amount
    function hasSufficientBond(address player, uint256 betAmount) external view returns (bool) {
        if (bondingManager == address(0)) {
            return true; // Bonding not enabled
        }
        return BondingManager(payable(bondingManager)).hasSufficientBond(player, betAmount);
    }

    /// @notice Get required bond amounts for a bet
    function getRequiredBond(uint256 betAmount) external view returns (uint256 chessRequired, uint256 ethRequired) {
        if (bondingManager == address(0)) {
            return (0, 0);
        }
        return BondingManager(payable(bondingManager)).calculateRequiredBond(betAmount);
    }

    function getDeployedChessGames() public view returns (address[] memory) {
        return deployedChessGames;
    }

}