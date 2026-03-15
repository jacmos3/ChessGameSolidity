// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ChessBoard.sol";
import "./ChessRulesEngine.sol";
import "../Token/BondingManager.sol";
import "../Token/RewardPool.sol";
import "../DAO/DisputeDAO.sol";
import "../Rating/PlayerRating.sol";

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
    error CancelledGame();
    error AlreadyWhitePlayer();
    error WrongBetAmount();
    error BlackPlayerTaken();
    error GameNotFinished();
    error TransferFailed();
    error NotPrizeRecipient();
    error PositionNotRepeated();
    error FiftyMoveRuleNotReached();
    error InvalidCoordinates();
    error OnlyWhitePlayer();
    error FriendlyOnly();
    error CancelTimeoutNotReached();
    error InvalidPromotionPiece();

    // ========== ENUMS (must be declared before state variables) ==========
    enum TimeoutPreset { Finney, Buterin, Nakamoto }
    enum GameMode { Tournament, Friendly }
    enum GameState { NotStarted, InProgress, Draw, WhiteWins, BlackWins }

    // ========== CONSTANTS ==========
    // Timeout presets (based on ~12 sec/block on Ethereum)
    uint48 public constant FINNEY_BLOCKS = 300;      // ~1 hour (Hal Finney - fast)
    uint48 public constant BUTERIN_BLOCKS = 2100;    // ~7 hours (Vitalik Buterin - medium)
    uint48 public constant NAKAMOTO_BLOCKS = 50400;  // ~7 days (Satoshi Nakamoto - slow)
    uint48 public constant CANCEL_UNJOINED_TIMEOUT = 1 days;

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
    ChessRulesEngine private immutable rulesEngine;

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
    bool public cancelled;                 // 1 byte
    uint16 public plyCount;                // 2 bytes
    // Total: 32 bytes (fits exactly in 1 slot)

    // Slot 8: creation metadata
    uint48 public createdAt;

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
    event GameCancelled(address indexed player, uint256 refundAmount);
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
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        _;
    }

    /// @notice Empty constructor for implementation contract
    constructor() {
        rulesEngine = new ChessRulesEngine();
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
        createdAt = uint48(block.timestamp);

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
        if (cancelled) revert CancelledGame();
        if (gameState != GameState.NotStarted) revert GameAlreadyStarted();
    }

    function switchTurn() internal {
        currentPlayer = (currentPlayer == whitePlayer) ? blackPlayer : whitePlayer;
    }

   function joinGameAsBlack() public payable {
        if (cancelled) revert CancelledGame();
        if (gameState != GameState.NotStarted) revert GameAlreadyStarted();
        if (msg.sender == whitePlayer) revert AlreadyWhitePlayer();
        if (msg.value != betting) revert WrongBetAmount();
        if (blackPlayer != address(0)) revert BlackPlayerTaken();

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

        GameState settledState = _getSettledOutcome();
        if (
            settledState != GameState.Draw &&
            settledState != GameState.WhiteWins &&
            settledState != GameState.BlackWins
        ) {
            return;
        }
        rewardsDistributed = true;

        uint256 moveCount = plyCount;
        bool isDraw = (settledState == GameState.Draw);
        bool whiteWins = (settledState == GameState.WhiteWins);
        bool clearBehaviorPenalties = _getResolvedDisputeCheater() != address(0);
        bool whiteWasResign = !clearBehaviorPenalties && wasResign && !whiteWins && !isDraw;
        bool blackWasResign = !clearBehaviorPenalties && wasResign && whiteWins;
        bool whiteWasTimeout = !clearBehaviorPenalties && wasTimeout && !whiteWins && !isDraw;
        bool blackWasTimeout = !clearBehaviorPenalties && wasTimeout && whiteWins;

        // Distribute to white player
        rewardPool.distributeReward(
            whitePlayer,
            blackPlayer,
            whiteWins,                    // isWinner
            isDraw,                       // isDraw
            wasCheckmate && whiteWins,    // isCheckmate (only for winner)
            moveCount,
            whiteWasResign,
            whiteWasTimeout
        );

        // Distribute to black player
        rewardPool.distributeReward(
            blackPlayer,
            whitePlayer,
            !whiteWins && !isDraw,        // isWinner
            isDraw,                       // isDraw
            wasCheckmate && !whiteWins && !isDraw,  // isCheckmate (only for winner)
            moveCount,
            blackWasResign,
            blackWasTimeout
        );
    }

    /// @notice Release bonds after challenge window (no dispute)
    function _releaseBonds() internal {
        if (address(bondingManager) != address(0) && bondsLocked) {
            if (whitePlayer != address(0)) {
                try bondingManager.releaseBond(gameId, whitePlayer) {} catch {}
            }
            if (blackPlayer != address(0)) {
                try bondingManager.releaseBond(gameId, blackPlayer) {} catch {}
            }
            bondsLocked = false;
        }
    }

    function _getResolvedDisputeCheater() internal view returns (address) {
        if (address(disputeDAO) == address(0)) {
            return address(0);
        }

        uint256 disputeId = disputeDAO.gameToDispute(gameId);
        if (disputeId == 0) {
            return address(0);
        }

        (
            ,
            ,
            address accusedPlayer,
            DisputeDAO.DisputeState state,
            ,
            ,
            DisputeDAO.Vote finalDecision,
            uint256 _ignoredEscalationLevel
        ) = disputeDAO.getDispute(disputeId);
        _ignoredEscalationLevel;

        if (state == DisputeDAO.DisputeState.Resolved && finalDecision == DisputeDAO.Vote.Cheat) {
            return accusedPlayer;
        }

        return address(0);
    }

    function _getSettledOutcome() internal view returns (GameState) {
        address cheater = _getResolvedDisputeCheater();

        if (cheater == whitePlayer && blackPlayer != address(0)) {
            return GameState.BlackWins;
        }

        if (cheater == blackPlayer) {
            return GameState.WhiteWins;
        }

        return gameState;
    }

    function _allocatePrizes(uint256 totalPrize) internal {
        GameState settledState = _getSettledOutcome();

        if (settledState == GameState.WhiteWins) {
            pendingPrize[whitePlayer] = totalPrize;
        }
        else if (settledState == GameState.BlackWins) {
            pendingPrize[blackPlayer] = totalPrize;
        }
        else if (settledState == GameState.Draw) {
            uint256 halfPrize = totalPrize / 2;
            uint256 remainingPrize = totalPrize - halfPrize;
            pendingPrize[whitePlayer] = halfPrize;
            pendingPrize[blackPlayer] = remainingPrize;
        }
    }

    /// @notice Report game result to rating system
    function _reportRating() internal {
        if (address(playerRating) != address(0) && !ratingReported && blackPlayer != address(0)) {
            // Determine result: 0 = draw, 1 = white wins, 2 = black wins
            uint8 result;
            GameState settledState = _getSettledOutcome();
            if (settledState == GameState.Draw) {
                result = 0;
            } else if (settledState == GameState.WhiteWins) {
                result = 1;
            } else if (settledState == GameState.BlackWins) {
                result = 2;
            } else {
                return; // Game not finished
            }

            ratingReported = true;
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
        if (prizeClaimed) revert PrizeAlreadyClaimed();
        if (
            gameState != GameState.WhiteWins &&
            gameState != GameState.BlackWins &&
            gameState != GameState.Draw
        ) revert GameNotFinished();

        // Register game for dispute if not already done
        _registerGameForDispute();

        // If dispute system is active, check that we can claim
        if (address(disputeDAO) != address(0)) {
            if (!canClaimPrize()) revert CannotClaimYet();

            // Close the challenge window in DisputeDAO
            uint256 disputeId = disputeDAO.gameToDispute(gameId);
            if (disputeId != 0) {
                try disputeDAO.closeChallengeWindow(gameId) {} catch {}
            }
        }

        // Release bonds if bonding was used
        _releaseBonds();

        // Keep reward calculation based on pre-update ratings.
        _distributeRewards();
        _reportRating();

        prizeClaimed = true;
        uint256 totalPrize = address(this).balance;

        _allocatePrizes(totalPrize);
    }

    /// @notice Withdraw allocated prize (pull pattern)
    /// @dev Each player calls this to withdraw their prize after finalizePrizes()
    function withdrawPrize() external nonReentrant {
        uint256 amount = pendingPrize[msg.sender];
        if (amount == 0) revert NoPrizeToDistribute();

        pendingPrize[msg.sender] = 0;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PrizeClaimed(msg.sender, amount);
    }

    /// @notice Legacy function for backward compatibility - finalizes and withdraws in one call
    /// @dev Only works for winner in win scenarios, not for draws
    function claimPrize() external nonReentrant {
        if (prizeClaimed) revert PrizeAlreadyClaimed();
        if (
            gameState != GameState.WhiteWins &&
            gameState != GameState.BlackWins &&
            gameState != GameState.Draw
        ) revert GameNotFinished();

        address cheater = _getResolvedDisputeCheater();
        bool cheatResolved = (cheater == whitePlayer || cheater == blackPlayer);

        // For normal draws, must use finalizePrizes() + withdrawPrize() pattern
        if (gameState == GameState.Draw && !cheatResolved) revert CannotClaimYet();

        // Verify caller is the rightful recipient
        address recipient;
        if (cheater == whitePlayer && blackPlayer != address(0)) {
            recipient = blackPlayer;
        } else if (cheater == blackPlayer) {
            recipient = whitePlayer;
        } else if (gameState == GameState.WhiteWins) {
            recipient = whitePlayer;
        } else {
            recipient = blackPlayer;
        }
        if (msg.sender != recipient) revert NotPrizeRecipient();

        // Register game for dispute if not already done
        _registerGameForDispute();

        // If dispute system is active, check that we can claim
        if (address(disputeDAO) != address(0)) {
            if (!canClaimPrize()) revert CannotClaimYet();

            uint256 disputeId = disputeDAO.gameToDispute(gameId);
            if (disputeId != 0) {
                try disputeDAO.closeChallengeWindow(gameId) {} catch {}
            }
        }

        // Release bonds if bonding was used
        _releaseBonds();

        // Keep reward calculation based on pre-update ratings.
        _distributeRewards();
        _reportRating();

        prizeClaimed = true;
        uint256 totalPrize = address(this).balance;

        (bool success, ) = payable(msg.sender).call{value: totalPrize}("");
        if (!success) revert TransferFailed();
        emit PrizeClaimed(msg.sender, totalPrize);
    }

    function resign() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (gameState != GameState.InProgress) revert GameNotInProgress();

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
        if (positionCount[posHash] < 3) revert PositionNotRepeated();

        gameState = GameState.Draw;
        _registerGameForDispute();

        emit DrawByRepetition(msg.sender);
        emit GameStateChanged(GameState.Draw);
    }

    /// @notice Claim draw by 50-move rule
    /// @dev Can be called by either player when 50 moves have passed without pawn move or capture
    function claimDrawByFiftyMoveRule() external {
        if (msg.sender != whitePlayer && msg.sender != blackPlayer) revert NotAPlayer();
        if (gameState != GameState.InProgress) revert GameNotInProgress();
        if (halfMoveClock < 100) revert FiftyMoveRuleNotReached(); // 100 half-moves = 50 full moves

        gameState = GameState.Draw;
        _registerGameForDispute();

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

        emit GameTimeout(winner, loser);
        emit GameStateChanged(gameState);
    }

    function _getCastlingFlags() private view returns (uint8 flags) {
        if (whiteKingMoved) flags |= 1 << 0;
        if (whiteShortRookMoved) flags |= 1 << 1;
        if (whiteLongRookMoved) flags |= 1 << 2;
        if (blackKingMoved) flags |= 1 << 3;
        if (blackLongRookMoved) flags |= 1 << 4;
        if (blackShortRookMoved) flags |= 1 << 5;
    }

    /// @notice Validates move and updates rook moved flags when rook moves
    function isValidMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) private returns (bool) {
        if (!rulesEngine.isValidMoveView(board, enPassantCol, enPassantRow, _getCastlingFlags(), startX, startY, endX, endY)) {
            return false;
        }

        int8 piece = board[startX][startY];
        if (abs(piece) == uint8(ROOK)) {
            if (startX == ROW_WHITE_PIECES && startY == COL_SHORTW_LONGB_ROOK && !whiteShortRookMoved) {
                whiteShortRookMoved = true;
            } else if (startX == ROW_WHITE_PIECES && startY == COL_LONGW_SHORTB_ROOK && !whiteLongRookMoved) {
                whiteLongRookMoved = true;
            } else if (startX == ROW_BLACK_PIECES && startY == COL_LONGW_SHORTB_ROOK && !blackLongRookMoved) {
                blackLongRookMoved = true;
            } else if (startX == ROW_BLACK_PIECES && startY == COL_SHORTW_LONGB_ROOK && !blackShortRookMoved) {
                blackShortRookMoved = true;
            }
        }

        return true;
    }

    modifier onlyCurrentPlayer() {
        if (msg.sender != currentPlayer) revert NotYourTurn();
        _;
    }

    modifier onlyOwnPieces(uint8 startX, uint8 startY){
        int8 playerColor = 1;
        if (currentPlayer == blackPlayer){
            playerColor *= PLAYER_BLACK;
        }
        if (board[startX][startY] * playerColor <= 0) revert InvalidMove();
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
        if (startX >= BOARD_SIZE || startY >= BOARD_SIZE || endX >= BOARD_SIZE || endY >= BOARD_SIZE) {
            revert InvalidCoordinates();
        }

        if (gameState != GameState.InProgress) revert GameNotInProgress();

        // Making a move automatically declines any pending draw offer
        if (drawOfferedBy != address(0)) {
            drawOfferedBy = address(0);
        }

        // Check if the move is valid for this piece type
        if (!isValidMove(startX, startY, endX, endY)) revert InvalidMove();

        // Check that this move doesn't leave our own king in check
        bool leavesKingInCheck = rulesEngine.wouldMoveLeaveKingInCheck(
            board,
            whiteKingRow,
            whiteKingCol,
            blackKingRow,
            blackKingCol,
            startX,
            startY,
            endX,
            endY
        );
        if (gameMode == GameMode.Friendly) {
            // Friendly mode: reject illegal moves (protect player from mistakes)
            if (leavesKingInCheck) revert InvalidMove();
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
                if (
                    promotionPiece != QUEEN &&
                    promotionPiece != ROOK &&
                    promotionPiece != BISHOP &&
                    promotionPiece != KNIGHT
                ) revert InvalidPromotionPiece();

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
        plyCount++;

        // FIDE 75-move rule: automatic draw after 75 full moves without progress
        // This prevents unbounded game length and positionHistory growth
        if (halfMoveClock >= MAX_HALF_MOVES_WITHOUT_PROGRESS) {
            gameState = GameState.Draw;
            _registerGameForDispute();
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

        // Emit structured event
        emit MoveMade(currentPlayer, startX, startY, endX, endY, movingPiece, actualCaptured,
                      promotionPiece, isCheck, isMate, isCastling, isEnPassant);

        // Emit game state change and register dispute if game ended
        if (gameState != previousState) {
            emit GameStateChanged(gameState);
            if (gameState == GameState.WhiteWins || gameState == GameState.BlackWins || gameState == GameState.Draw) {
                _registerGameForDispute();
            }
        }
    }

    /// @notice Detect check/checkmate state after a move
    function _detectCheckMate(uint8 endX, uint8 endY, bool leavesKingInCheck) internal view returns (bool isCheck, bool isMate, GameState newState) {
        uint8 stateValue;
        (isCheck, isMate, stateValue) = rulesEngine.detectCheckState(
            board,
            currentPlayer == whitePlayer,
            gameMode == GameMode.Tournament,
            leavesKingInCheck,
            whiteKingRow,
            whiteKingCol,
            blackKingRow,
            blackKingCol,
            enPassantCol,
            enPassantRow,
            _getCastlingFlags(),
            endX,
            endY
        );
        newState = GameState(stateValue);
    }

    function getPlayers() external view returns (address, address) {
        return (whitePlayer, blackPlayer);
    }

    /// @notice Setup function for custom board positions (Friendly mode only)
    /// @dev Only callable in Friendly mode, by white player, before game starts
    /// @dev This allows creative chess variants but is disabled in Tournament mode
    function debugCreative(uint8 x, uint8 y, int8 piece) external returns (string memory) {
        if (gameMode != GameMode.Friendly) revert FriendlyOnly();
        if (msg.sender != whitePlayer) revert OnlyWhitePlayer();
        if (gameState != GameState.NotStarted) revert GameAlreadyStarted();
        if (x >= BOARD_SIZE || y >= BOARD_SIZE) revert InvalidCoordinates();

        board[x][y] = piece;
        // Update king position cache if placing a king
        if (piece == KING) {
            whiteKingRow = x;
            whiteKingCol = y;
        } else if (piece == -KING) {
            blackKingRow = x;
            blackKingCol = y;
        }
        return "";
    }

    function canCancelUnjoinedGame(address caller) external view returns (bool) {
        return (
            caller == whitePlayer &&
            !cancelled &&
            blackPlayer == address(0) &&
            gameState == GameState.NotStarted &&
            block.timestamp >= createdAt + CANCEL_UNJOINED_TIMEOUT
        );
    }

    function getCancelUnjoinedRemaining() external view returns (uint256) {
        if (cancelled || blackPlayer != address(0) || gameState != GameState.NotStarted) {
            return 0;
        }

        uint256 deadline = createdAt + CANCEL_UNJOINED_TIMEOUT;
        if (block.timestamp >= deadline) {
            return 0;
        }

        return deadline - block.timestamp;
    }

    function cancelUnjoinedGame() external nonReentrant {
        if (msg.sender != whitePlayer) revert OnlyWhitePlayer();
        if (cancelled) revert CancelledGame();
        if (blackPlayer != address(0) || gameState != GameState.NotStarted) revert GameAlreadyStarted();
        if (block.timestamp < createdAt + CANCEL_UNJOINED_TIMEOUT) revert CancelTimeoutNotReached();

        cancelled = true;
        prizeClaimed = true;
        currentPlayer = address(0);
        drawOfferedBy = address(0);

        uint256 refundAmount = address(this).balance;
        if (refundAmount > 0) {
            (bool success, ) = payable(whitePlayer).call{value: refundAmount}("");
            if (!success) {
                pendingPrize[whitePlayer] = refundAmount;
            }
        }

        emit GameCancelled(msg.sender, refundAmount);
    }

    function getGameState () external view returns (uint8) {
        if (cancelled) return 6;
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
