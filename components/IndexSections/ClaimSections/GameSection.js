import React, { Component } from 'react';
import { Container, Message, Button, Modal } from 'semantic-ui-react';
import ChessFactory from '../../../ethereum/build/ChessFactory_flattened.sol.json';
import styles from "../../../styles/components/claimSections/FetchNFTList.module.scss";

class GameSection extends Component {
    constructor(props) {
        super(props);
    }

    state = {
        game: { key: "", header: "", image: "", gameStatus: "" },
        loading: false,
        actionLoading: false,
        errorMessage: "",
        successMessage: "",
        // Move tracking
        startRow: null,
        startCol: null,
        endRow: null,
        endCol: null,
        // Game info
        playerRole: null, // 'white', 'black', or 'spectator'
        isMyTurn: false,
        gameState: 0,
        betting: "0",
        whitePlayer: "",
        blackPlayer: "",
        currentPlayer: "",
        // UI state
        previousSelection: {
            piece: { id: null, style: null },
            highlight: false,
            square: { id: null, style: null }
        },
        showResignModal: false
    }

    async componentDidMount() {
        await this.fetchGame();
    }

    getGameStateInfo = (state) => {
        switch (parseInt(state)) {
            case 1: return { text: "Waiting for opponent", color: "blue", isActive: false, canJoin: true };
            case 2: return { text: "In Progress", color: "green", isActive: true, canJoin: false };
            case 3: return { text: "Draw", color: "gray", isActive: false, canJoin: false };
            case 4: return { text: "White Wins!", color: "gold", isActive: false, canJoin: false };
            case 5: return { text: "Black Wins!", color: "purple", isActive: false, canJoin: false };
            default: return { text: "Unknown", color: "gray", isActive: false, canJoin: false };
        }
    }

    fetchGame = async () => {
        this.setState({ loading: true, errorMessage: '', successMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const chessCoreInstance = new web3.eth.Contract(
                ChessFactory.ChessCore.abi,
                this.props.addressGame
            );

            // Fetch all game data
            const [players, currentPlayer, gameState, betting, chessboardData] = await Promise.all([
                chessCoreInstance.methods.getPlayers().call(),
                chessCoreInstance.methods.getCurrentPlayer().call(),
                chessCoreInstance.methods.getGameState().call(),
                chessCoreInstance.methods.betting().call(),
                chessCoreInstance.methods.printChessBoardLayoutSVG().call()
            ]);

            const chessboard = JSON.parse(window.atob(chessboardData.split(',')[1]));

            // Determine player role
            let playerRole = 'spectator';
            if (players[0].toLowerCase() === web3Settings.account.toLowerCase()) {
                playerRole = 'white';
            } else if (players[1].toLowerCase() === web3Settings.account.toLowerCase()) {
                playerRole = 'black';
            }

            const isMyTurn = currentPlayer.toLowerCase() === web3Settings.account.toLowerCase();

            this.setState({
                game: {
                    key: this.props.addressGame,
                    header: chessboard.name,
                    image: chessboard.image
                },
                playerRole,
                isMyTurn,
                gameState: parseInt(gameState),
                betting: web3.utils.fromWei(betting, 'ether'),
                whitePlayer: players[0],
                blackPlayer: players[1],
                currentPlayer
            });

            // Render the SVG board
            this.renderBoard(chessboard, playerRole, isMyTurn, parseInt(gameState));

        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ loading: false });
    }

    renderBoard = (chessboard, playerRole, isMyTurn, gameState) => {
        const svgString = atob(chessboard.image.split(',')[1]);
        const imageContainer = document.getElementById('image-container');
        if (!imageContainer) return;

        imageContainer.innerHTML = svgString;

        const blackSquaresGroup = document.getElementById('s');
        if (!blackSquaresGroup) return;

        // Remove existing squares
        const existingRects = blackSquaresGroup.getElementsByTagName('rect');
        while (existingRects.length > 0) {
            blackSquaresGroup.removeChild(existingRects[0]);
        }

        // Recreate squares with IDs
        const blackSquare = "#808080";
        const whiteSquare = "#D8D8D8";
        let isWhite = true;
        const size = 50;

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const newGroup = document.createElementNS("http://www.w3.org/2000/svg", 'g');
                newGroup.setAttribute('font-family', 'arial unicode ms,Helvetica,Arial,sans-serif');
                newGroup.setAttribute('font-size', '40');

                const newRect = document.createElementNS("http://www.w3.org/2000/svg", 'rect');
                newRect.setAttribute('id', String(col) + ',' + String(row));
                newRect.setAttribute('class', 's');
                newRect.setAttribute('x', String(size * row));
                newRect.setAttribute('y', String(size * col));
                newRect.setAttribute('width', String(size));
                newRect.setAttribute('height', String(size));
                newRect.setAttribute('fill', isWhite ? whiteSquare : blackSquare);

                if (col !== 7) isWhite = !isWhite;

                newGroup.appendChild(newRect);
                blackSquaresGroup.appendChild(newGroup);
            }
        }

        // Set up piece interactions (only if game is active and it's player's turn)
        const canMove = gameState === 2 && isMyTurn && playerRole !== 'spectator';
        const turnPrefix = playerRole === 'white' ? 'w' : 'b';

        const chessPieces = document.querySelectorAll('.p');
        chessPieces.forEach(piece => {
            if (canMove && piece.id[0] === turnPrefix) {
                piece.setAttribute('style', 'cursor:pointer;');
                piece.addEventListener('click', this.handlePieceClick);
            } else {
                piece.setAttribute('style', 'cursor:not-allowed;');
                if (canMove) {
                    piece.addEventListener('click', this.handleOpponentPieceClick);
                }
            }
        });

        const squares = document.querySelectorAll('.s');
        squares.forEach(square => {
            square.addEventListener('click', this.handleSquareClick);
        });
    }

    isNullOrUndefined = (value) => value === undefined || value === null;

    handlePieceClick = (event) => {
        event.preventDefault();

        // Restore previous piece style
        if (this.state.previousSelection?.piece?.id) {
            const previousPiece = document.getElementById(this.state.previousSelection.piece.id);
            if (previousPiece) {
                previousPiece.setAttribute('style', "cursor:pointer");
            }
        }

        // Restore previous square
        this.restoreSquare(this.state.previousSelection.square);

        // If clicking same piece, deselect
        if (event.target.id === this.state.previousSelection?.piece?.id) {
            this.setState({
                previousSelection: { piece: { id: null }, highlight: false, square: { id: null } },
                startRow: null,
                startCol: null
            });
            return;
        }

        // Select new piece
        const x = parseInt(event.target.attributes.x.value);
        const y = parseInt(event.target.attributes.y.value);
        const row = (y - 25) / 50;
        const col = (x - 25) / 50;

        this.setState({
            previousSelection: {
                piece: { id: event.target.id, style: event.target.getAttribute('style') },
                highlight: true,
                square: { id: null }
            },
            startRow: row,
            startCol: col
        });

        event.target.setAttribute('style', 'cursor:pointer; fill:yellow; stroke:yellow; stroke-width:1px');
    }

    handleOpponentPieceClick = (event) => {
        event.preventDefault();

        if (!this.state.previousSelection?.piece?.id) return;

        // Get target square coordinates
        const x = parseInt(event.target.attributes.x.value) - 25;
        const y = parseInt(event.target.attributes.y.value) - 25;
        const row = y / 50;
        const col = x / 50;

        // Restore previous square highlight
        this.restoreSquare(this.state.previousSelection.square);

        // Highlight this square
        const square = document.getElementById(`${row},${col}`);
        if (square) {
            this.setState({
                previousSelection: {
                    ...this.state.previousSelection,
                    square: {
                        id: square.id,
                        width: square.getAttribute('width'),
                        height: square.getAttribute('height'),
                        x: square.getAttribute('x'),
                        y: square.getAttribute('y'),
                        fill: square.getAttribute('fill')
                    }
                },
                endRow: row,
                endCol: col
            });

            square.setAttribute('style', 'stroke:yellow;stroke-width:2;stroke-opacity:0.9');
            this.generateConfirmButton(square, x, y);
        }
    }

    handleSquareClick = (event) => {
        event.preventDefault();

        if (!this.state.previousSelection?.highlight) return;

        const [row, col] = event.target.id.split(',').map(Number);

        // Check if clicking on same square as selected piece
        if (col === this.state.startCol && row === this.state.startRow) return;

        // Restore previous square
        this.restoreSquare(this.state.previousSelection.square);

        // Highlight new target square
        this.setState({
            previousSelection: {
                ...this.state.previousSelection,
                square: {
                    id: event.target.id,
                    width: event.target.getAttribute('width'),
                    height: event.target.getAttribute('height'),
                    x: event.target.getAttribute('x'),
                    y: event.target.getAttribute('y'),
                    fill: event.target.getAttribute('fill')
                }
            },
            endRow: row,
            endCol: col
        });

        const x = parseInt(event.target.x.baseVal.value);
        const y = parseInt(event.target.y.baseVal.value);

        event.target.setAttribute('style', 'stroke:yellow;stroke-width:2;stroke-opacity:0.9');
        event.target.setAttribute('width', '48');
        event.target.setAttribute('height', '48');
        event.target.setAttribute('x', String(x + 1));
        event.target.setAttribute('y', String(y + 1));

        this.generateConfirmButton(event.target, x, y);
    }

    restoreSquare = (prevSquare) => {
        // Remove confirm button
        const confirmButton = document.getElementById('confirmButton');
        if (confirmButton) confirmButton.remove();

        if (!prevSquare?.id) return;

        const square = document.getElementById(prevSquare.id);
        if (square && prevSquare.width) {
            square.setAttribute('style', '');
            square.setAttribute('width', prevSquare.width);
            square.setAttribute('height', prevSquare.height);
            square.setAttribute('x', prevSquare.x);
            square.setAttribute('y', prevSquare.y);
            square.setAttribute('fill', prevSquare.fill);
        }
    }

    generateConfirmButton = (target, x, y) => {
        // Remove existing button
        const existing = document.getElementById('confirmButton');
        if (existing) existing.remove();

        const svg = document.querySelector('#image-container svg');
        if (!svg) return;

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute('id', 'confirmButton');
        text.setAttribute('x', String(x + 25));
        text.setAttribute('y', String(y + 35));
        text.setAttribute('fill', 'yellow');
        text.setAttribute('font-size', '24');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('style', 'cursor:pointer');
        text.innerHTML = "OK";
        text.addEventListener('click', this.handleConfirmClick);

        svg.appendChild(text);
    }

    handleConfirmClick = async (event) => {
        event.preventDefault();

        const { startRow, startCol, endRow, endCol } = this.state;
        if (startRow === null || startCol === null || endRow === null || endCol === null) return;

        await this.makeMove(startRow, startCol, endRow, endCol);
    }

    makeMove = async (startRow, startCol, endRow, endCol) => {
        this.setState({ actionLoading: true, errorMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const chessCoreInstance = new web3.eth.Contract(
                ChessFactory.ChessCore.abi,
                this.props.addressGame
            );

            await chessCoreInstance.methods.makeMove(startRow, startCol, endRow, endCol).send({
                from: web3Settings.account
            });

            this.setState({ successMessage: "Move executed!" });
            await this.fetchGame();

        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ actionLoading: false });
    }

    joinGame = async () => {
        this.setState({ actionLoading: true, errorMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const betAmountWei = web3.utils.toWei(this.state.betting, 'ether');

            const chessCoreInstance = new web3.eth.Contract(
                ChessFactory.ChessCore.abi,
                this.props.addressGame
            );

            await chessCoreInstance.methods.joinGameAsBlack().send({
                from: web3Settings.account,
                value: betAmountWei
            });

            this.setState({ successMessage: "Joined game as Black!" });
            await this.fetchGame();

        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ actionLoading: false });
    }

    resign = async () => {
        this.setState({ actionLoading: true, errorMessage: '', showResignModal: false });

        try {
            const { web3, web3Settings } = this.props.state;
            const chessCoreInstance = new web3.eth.Contract(
                ChessFactory.ChessCore.abi,
                this.props.addressGame
            );

            await chessCoreInstance.methods.resign().send({
                from: web3Settings.account
            });

            this.setState({ successMessage: "You resigned. Game over." });
            await this.fetchGame();

        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ actionLoading: false });
    }

    claimPrize = async () => {
        this.setState({ actionLoading: true, errorMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const chessCoreInstance = new web3.eth.Contract(
                ChessFactory.ChessCore.abi,
                this.props.addressGame
            );

            await chessCoreInstance.methods.claimPrize().send({
                from: web3Settings.account
            });

            this.setState({ successMessage: "Prize claimed successfully!" });
            await this.fetchGame();

        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ actionLoading: false });
    }

    canClaimPrize = () => {
        const { gameState, playerRole } = this.state;
        if (gameState === 3) return true; // Draw - both can claim
        if (gameState === 4 && playerRole === 'white') return true;
        if (gameState === 5 && playerRole === 'black') return true;
        return false;
    }

    render() {
        const {
            game, loading, actionLoading, errorMessage, successMessage,
            playerRole, isMyTurn, gameState, betting,
            whitePlayer, blackPlayer, currentPlayer, showResignModal
        } = this.state;

        const { web3Settings } = this.props.state;
        const stateInfo = this.getGameStateInfo(gameState);

        const truncate = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

        return (
            <Container>
                {/* Header */}
                <div className="flex justify-between items-center mb-4">
                    <button
                        className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
                        onClick={() => this.props.resetActiveGame()}
                    >
                        Back to Games
                    </button>
                    <button
                        className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                        onClick={this.fetchGame}
                        disabled={loading}
                    >
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>

                {/* Messages */}
                {errorMessage && (
                    <Message negative onDismiss={() => this.setState({ errorMessage: '' })}>
                        <Message.Header>Error</Message.Header>
                        <p>{errorMessage}</p>
                    </Message>
                )}
                {successMessage && (
                    <Message positive onDismiss={() => this.setState({ successMessage: '' })}>
                        <p>{successMessage}</p>
                    </Message>
                )}

                {/* Game Info Panel */}
                <div className="bg-gray-800 text-white p-4 rounded-lg mb-4">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-lg font-bold">Game #{game.header}</span>
                        <span
                            className="px-3 py-1 rounded font-bold"
                            style={{ backgroundColor: stateInfo.color }}
                        >
                            {stateInfo.text}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-gray-400">White: </span>
                            <span className={whitePlayer === web3Settings.account ? 'text-yellow-400 font-bold' : ''}>
                                {truncate(whitePlayer)} {whitePlayer === web3Settings.account && '(You)'}
                            </span>
                        </div>
                        <div>
                            <span className="text-gray-400">Black: </span>
                            <span className={blackPlayer === web3Settings.account ? 'text-yellow-400 font-bold' : ''}>
                                {blackPlayer === '0x0000000000000000000000000000000000000000' ? 'Waiting...' : truncate(blackPlayer)}
                                {blackPlayer === web3Settings.account && ' (You)'}
                            </span>
                        </div>
                        <div>
                            <span className="text-gray-400">Bet: </span>
                            <span>{betting} ETH</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Your Role: </span>
                            <span className="capitalize">{playerRole}</span>
                        </div>
                    </div>

                    {/* Turn Indicator */}
                    {stateInfo.isActive && (
                        <div className={`mt-3 p-2 rounded text-center font-bold ${isMyTurn ? 'bg-green-600' : 'bg-gray-600'}`}>
                            {isMyTurn ? "Your Turn - Make a Move!" : "Waiting for opponent..."}
                        </div>
                    )}
                </div>

                {/* Chess Board */}
                <div className="flex justify-center mb-4">
                    <div id="image-container" className="border-4 border-gray-700 rounded">
                        {loading && <div className="w-96 h-96 flex items-center justify-center bg-gray-200">Loading...</div>}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-center gap-4 flex-wrap">
                    {/* Join Game Button */}
                    {stateInfo.canJoin && playerRole === 'spectator' && (
                        <button
                            className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50"
                            onClick={this.joinGame}
                            disabled={actionLoading}
                        >
                            {actionLoading ? 'Joining...' : `Join as Black (${betting} ETH)`}
                        </button>
                    )}

                    {/* Resign Button */}
                    {stateInfo.isActive && playerRole !== 'spectator' && (
                        <button
                            className="bg-red-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50"
                            onClick={() => this.setState({ showResignModal: true })}
                            disabled={actionLoading}
                        >
                            Resign
                        </button>
                    )}

                    {/* Claim Prize Button */}
                    {this.canClaimPrize() && (
                        <button
                            className="bg-yellow-500 text-black px-6 py-3 rounded-lg font-bold hover:bg-yellow-400 disabled:opacity-50"
                            onClick={this.claimPrize}
                            disabled={actionLoading}
                        >
                            {actionLoading ? 'Claiming...' : `Claim Prize (${parseFloat(betting) * 2} ETH)`}
                        </button>
                    )}
                </div>

                {/* Resign Confirmation Modal */}
                <Modal
                    open={showResignModal}
                    onClose={() => this.setState({ showResignModal: false })}
                    size="small"
                >
                    <Modal.Header>Confirm Resignation</Modal.Header>
                    <Modal.Content>
                        <p>Are you sure you want to resign? You will lose the game and your bet of {betting} ETH.</p>
                    </Modal.Content>
                    <Modal.Actions>
                        <Button onClick={() => this.setState({ showResignModal: false })}>
                            Cancel
                        </Button>
                        <Button negative onClick={this.resign} loading={actionLoading}>
                            Yes, Resign
                        </Button>
                    </Modal.Actions>
                </Modal>
            </Container>
        );
    }
}

export default GameSection;
