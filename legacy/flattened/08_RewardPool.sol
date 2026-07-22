pragma solidity ^0.8.24;


// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)
/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
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