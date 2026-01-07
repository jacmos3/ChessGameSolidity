// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ChessBoard.sol";
import "../Token/BondingManager.sol";
import "../Token/RewardPool.sol";
import "../DAO/DisputeDAO.sol";
import "../Rating/PlayerRating.sol";

/// @title ChessCore - Main chess game logic
/// @notice Inherits from ChessBoard and implements move validation and game state
contract ChessCore is ChessBoard, ReentrancyGuard {
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

    // Slot 7: Player addresses
    address whitePlayer;
    address blackPlayer;
    address public currentPlayer;

    // Slot 8: Draw offer tracking
    address public drawOfferedBy;

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

        // Record initial position for threefold repetition
        bytes32 posHash = _computePositionHash(true); // White to move
        positionHistory.push(posHash);
        positionCount[posHash] = 1;

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

            try playerRating.reportGame(whitePlayer, blackPlayer, result) {} catch {}
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

        // Can claim if dispute is resolved or still pending (no challenge made)
        return state == DisputeDAO.DisputeState.Resolved ||
               state == DisputeDAO.DisputeState.Pending;
    }

    function claimPrize() external nonReentrant {
        require(!prizeClaimed, "Already claimed");
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

        if (gameState == GameState.WhiteWins) {
            require(msg.sender == whitePlayer, "Not winner");
            (bool success, ) = payable(whitePlayer).call{value: totalPrize}("");
            require(success, "Transfer failed");
            emit PrizeClaimed(whitePlayer, totalPrize);
        }
        else if (gameState == GameState.BlackWins) {
            require(msg.sender == blackPlayer, "Not winner");
            (bool success, ) = payable(blackPlayer).call{value: totalPrize}("");
            require(success, "Transfer failed");
            emit PrizeClaimed(blackPlayer, totalPrize);
        }
        else if (gameState == GameState.Draw) {
            uint256 halfPrize = totalPrize / 2;
            uint256 remainingPrize = totalPrize - halfPrize;

            (bool successWhite, ) = payable(whitePlayer).call{value: halfPrize}("");
            require(successWhite, "Transfer failed");
            emit PrizeClaimed(whitePlayer, halfPrize);

            (bool successBlack, ) = payable(blackPlayer).call{value: remainingPrize}("");
            require(successBlack, "Transfer failed");
            emit PrizeClaimed(blackPlayer, remainingPrize);
        }
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
        require(msg.sender == whitePlayer || msg.sender == blackPlayer, "Not player");
        require(gameState == GameState.InProgress && drawOfferedBy == address(0), "Bad state");
        drawOfferedBy = msg.sender;
        emit DrawOffered(msg.sender);
    }

    /// @notice Accept a draw offer from the opponent
    function acceptDraw() external {
        require(msg.sender == whitePlayer || msg.sender == blackPlayer, "Not player");
        require(drawOfferedBy != address(0) && drawOfferedBy != msg.sender, "Bad offer");
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
        require(msg.sender == whitePlayer || msg.sender == blackPlayer, "Not player");
        require(drawOfferedBy != address(0) && drawOfferedBy != msg.sender, "Bad offer");
        address offerer = drawOfferedBy;
        drawOfferedBy = address(0);
        emit DrawOfferDeclined(offerer);
    }

    /// @notice Cancel your own draw offer
    function cancelDrawOffer() external {
        require(drawOfferedBy == msg.sender, "Not yours");
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
        require(msg.sender == whitePlayer || msg.sender == blackPlayer, "Not player");
        require(gameState == GameState.InProgress, "Not in progress");

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
        require(msg.sender == whitePlayer || msg.sender == blackPlayer, "Not player");
        require(gameState == GameState.InProgress, "Not in progress");
        require(halfMoveClock >= 100, "50 moves not reached"); // 100 half-moves = 50 full moves

        gameState = GameState.Draw;
        _registerGameForDispute();
        _distributeRewards();

        emit DrawByFiftyMoveRule(msg.sender);
        emit GameStateChanged(GameState.Draw);
    }

    /// @notice Claim victory when opponent has not moved within timeout period
    function claimVictoryByTimeout() external {
        require(
            msg.sender == whitePlayer || msg.sender == blackPlayer,
            "Not a player"
        );
        require(gameState == GameState.InProgress, "Not in progress");
        require(msg.sender != currentPlayer, "Your turn");

        // Check if current player (opponent) has exceeded their time
        uint256 opponentLastMove = (currentPlayer == whitePlayer)
            ? whiteLastMoveBlock
            : blackLastMoveBlock;

        require(block.number >= opponentLastMove + timeoutBlocks, "Not timed out");

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
                if (endX == startX - 1 || (startX == ROW_WHITE_PAWNS && endX == COL_KING)) {
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
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                if (player * board[rowPiece][colPiece] < 0) { // Check if piece belongs to opponent
                    if (isValidMoveView(rowPiece, colPiece, kingX, kingY)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /// @notice Check if a move would leave the current player's king in check
    function wouldMoveLeaveKingInCheck(uint8 sX, uint8 sY, uint8 eX, uint8 eY) private view returns (bool) {
        int8 p = board[sX][sY];
        int8 pl = (p > 0) ? PLAYER_WHITE : PLAYER_BLACK;
        uint8 kX = (abs(p) == uint8(KING)) ? eX : ((pl == PLAYER_WHITE) ? whiteKingRow : blackKingRow);
        uint8 kY = (abs(p) == uint8(KING)) ? eY : ((pl == PLAYER_WHITE) ? whiteKingCol : blackKingCol);

        for (uint8 r = 0; r < BOARD_SIZE; r++) {
            for (uint8 c = 0; c < BOARD_SIZE; c++) {
                if (r == eX && c == eY) continue;
                int8 pc = board[r][c];
                if (pc * pl >= 0) continue;
                if (_canAttack(r, c, pc, kX, kY, sX, sY, eX, eY)) return true;
            }
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
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                //check if the opponent pieces can do a valid move to that square
                if (currentPlayer == whitePlayer && board[rowPiece][colPiece] * player < 0 && isValidMoveView(rowPiece, colPiece, x, y)
                || currentPlayer == blackPlayer && board[rowPiece][colPiece] * player > 0 && isValidMoveView(rowPiece,colPiece, x, y)) {
                    return true;
                }
            }
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
        for (uint8 row = 0; row < BOARD_SIZE; row++) {
            for (uint8 col = 0; col < BOARD_SIZE; col++) {
                // Skip the square king is moving from and the target square
                if ((row == fromX && col == fromY) || (row == targetX && col == targetY)) continue;

                int8 piece = board[row][col];
                if (piece * player < 0) { // Opponent piece
                    if (canPieceAttackSquare(row, col, targetX, targetY, fromX, fromY)) {
                        return true;
                    }
                }
            }
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
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                // If we find a piece belonging to the current player, then check if it can perform a move
                if (board[rowPiece][colPiece] * player > 0 ) {
                    for (uint8 row_target = 0; row_target < BOARD_SIZE; row_target++) {
                        for (uint8 col_target = 0; col_target < BOARD_SIZE; col_target++) {
                            if (board[row_target][col_target] != board[rowPiece][colPiece]
                                && isValidMoveView(rowPiece, colPiece, row_target, col_target)) {
                                return false;
                            }
                        }
                    }
                }
            }
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
        for (uint8 rowPiece = 0; rowPiece < BOARD_SIZE; rowPiece++) {
            for (uint8 colPiece = 0; colPiece < BOARD_SIZE; colPiece++) {
                // Skip empty squares and pieces belonging to the attacker
                if (board[rowPiece][colPiece] == EMPTY || board[rowPiece][colPiece] * player < 0 || (rowPiece == rowAttacker && colPiece == colAttacker)) {
                    continue;
                }

                // Check if the piece can capture the attacking piece
                if (isValidMoveView(rowPiece, colPiece, rowAttacker, colAttacker)) {
                    // A piece can capture the attacking piece
                    return true;
                }
            }
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
            for (uint8 pieceRow = 0; pieceRow < BOARD_SIZE; pieceRow++) {
                for (uint8 pieceCol = 0; pieceCol < BOARD_SIZE; pieceCol++) {
                    int8 piece = board[pieceRow][pieceCol];

                    // Skip empty squares, opponent pieces, and the king (can't block with king)
                    if (piece == EMPTY || piece * defendingPlayer <= 0 || abs(piece) == uint8(KING)) {
                        continue;
                    }

                    // Check if this piece can move to the blocking square
                    if (isValidMoveView(pieceRow, pieceCol, blockRow, blockCol)) {
                        return true;
                    }
                }
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

    /// @notice Setup function for testing - place a piece on the board
    /// @dev Only callable by white player before game starts (before black joins)
    function debugCreative(uint8 x, uint8 y, int8 piece) external returns (string memory) {
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





