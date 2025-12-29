import React, { Component } from 'react';
import { Container, Message, Button, Modal } from 'semantic-ui-react';
import { Chessboard } from 'react-chessboard';
import ChessCoreABI from '../../../ethereum/build/contracts/ChessCore.json';

class GameSection extends Component {
    state = {
        game: { key: "", header: "" },
        loading: false,
        actionLoading: false,
        errorMessage: "",
        successMessage: "",
        // Game info
        playerRole: null,
        isMyTurn: false,
        gameState: 0,
        betting: "0",
        whitePlayer: "",
        blackPlayer: "",
        currentPlayer: "",
        // Board state
        position: "start",
        boardOrientation: "white",
        showResignModal: false
    }

    async componentDidMount() {
        await this.fetchGame();
    }

    getGameStateInfo = (state) => {
        switch (parseInt(state)) {
            case 1: return { text: "Waiting for opponent", color: "#3b82f6", isActive: false, canJoin: true };
            case 2: return { text: "In Progress", color: "#22c55e", isActive: true, canJoin: false };
            case 3: return { text: "Draw", color: "#6b7280", isActive: false, canJoin: false };
            case 4: return { text: "White Wins!", color: "#eab308", isActive: false, canJoin: false };
            case 5: return { text: "Black Wins!", color: "#a855f7", isActive: false, canJoin: false };
            default: return { text: "Unknown", color: "#6b7280", isActive: false, canJoin: false };
        }
    }

    // Convert contract piece value to FEN piece character
    pieceToFen = (piece) => {
        const pieceMap = {
            1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K',
            '-1': 'p', '-2': 'n', '-3': 'b', '-4': 'r', '-5': 'q', '-6': 'k'
        };
        return pieceMap[piece.toString()] || null;
    }

    // Convert board array to position object for react-chessboard
    boardToPosition = (boardArray) => {
        const position = {};
        const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = boardArray[row][col];
                if (piece !== 0) {
                    const fenPiece = this.pieceToFen(piece);
                    if (fenPiece) {
                        const square = files[col] + (8 - row);
                        const color = piece > 0 ? 'w' : 'b';
                        position[square] = color + fenPiece.toUpperCase();
                    }
                }
            }
        }
        return position;
    }

    fetchGame = async () => {
        this.setState({ loading: true, errorMessage: '', successMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const chessCoreInstance = new web3.eth.Contract(
                ChessCoreABI.abi,
                this.props.addressGame
            );

            const [players, currentPlayer, gameState, betting] = await Promise.all([
                chessCoreInstance.methods.getPlayers().call(),
                chessCoreInstance.methods.currentPlayer().call(),
                chessCoreInstance.methods.getGameState().call(),
                chessCoreInstance.methods.betting().call()
            ]);

            // Fetch board state
            const boardArray = [];
            for (let row = 0; row < 8; row++) {
                const rowArray = [];
                for (let col = 0; col < 8; col++) {
                    const piece = await chessCoreInstance.methods.board(row, col).call();
                    rowArray.push(parseInt(piece));
                }
                boardArray.push(rowArray);
            }

            const position = this.boardToPosition(boardArray);

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
                    header: this.props.addressGame.slice(0, 8)
                },
                position,
                boardOrientation: playerRole === 'black' ? 'black' : 'white',
                playerRole,
                isMyTurn,
                gameState: parseInt(gameState),
                betting: web3.utils.fromWei(betting, 'ether'),
                whitePlayer: players[0],
                blackPlayer: players[1],
                currentPlayer
            });

        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ loading: false });
    }

    // Convert square notation to row/col
    squareToCoords = (square) => {
        const files = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
        const col = files[square[0]];
        const row = 8 - parseInt(square[1]);
        return { row, col };
    }

    onDrop = async (sourceSquare, targetSquare) => {
        const { isMyTurn, playerRole, gameState } = this.state;

        // Check if move is allowed
        if (gameState !== 2 || !isMyTurn || playerRole === 'spectator') {
            return false;
        }

        const source = this.squareToCoords(sourceSquare);
        const target = this.squareToCoords(targetSquare);

        this.setState({ actionLoading: true, errorMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const chessCoreInstance = new web3.eth.Contract(
                ChessCoreABI.abi,
                this.props.addressGame
            );

            await chessCoreInstance.methods.makeMove(
                source.row, source.col, target.row, target.col
            ).send({ from: web3Settings.account });

            this.setState({ successMessage: "Move executed!" });
            await this.fetchGame();
            return true;

        } catch (err) {
            this.setState({ errorMessage: err.message });
            return false;
        } finally {
            this.setState({ actionLoading: false });
        }
    }

    joinGame = async () => {
        this.setState({ actionLoading: true, errorMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const betAmountWei = web3.utils.toWei(this.state.betting, 'ether');

            const chessCoreInstance = new web3.eth.Contract(
                ChessCoreABI.abi,
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
                ChessCoreABI.abi,
                this.props.addressGame
            );

            await chessCoreInstance.methods.resign().send({
                from: web3Settings.account
            });

            this.setState({ successMessage: "You resigned." });
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
                ChessCoreABI.abi,
                this.props.addressGame
            );

            await chessCoreInstance.methods.claimPrize().send({
                from: web3Settings.account
            });

            this.setState({ successMessage: "Prize claimed!" });
            await this.fetchGame();

        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ actionLoading: false });
    }

    canClaimPrize = () => {
        const { gameState, playerRole } = this.state;
        if (gameState === 3) return true;
        if (gameState === 4 && playerRole === 'white') return true;
        if (gameState === 5 && playerRole === 'black') return true;
        return false;
    }

    truncate = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

    render() {
        const {
            game, loading, actionLoading, errorMessage, successMessage,
            playerRole, isMyTurn, gameState, betting, position, boardOrientation,
            whitePlayer, blackPlayer, showResignModal
        } = this.state;

        const { web3Settings } = this.props.state;
        const stateInfo = this.getGameStateInfo(gameState);
        const canMove = stateInfo.isActive && isMyTurn && playerRole !== 'spectator';

        return (
            <Container>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <button
                        style={{ background: '#6b7280', color: 'white', padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                        onClick={() => this.props.resetActiveGame()}
                    >
                        ← Back
                    </button>
                    <button
                        style={{ background: '#3b82f6', color: 'white', padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
                        onClick={this.fetchGame}
                        disabled={loading}
                    >
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>

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

                <div style={{ background: '#1f2937', color: 'white', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '18px' }}>Game #{game.header}</span>
                        <span style={{ background: stateInfo.color, padding: '4px 12px', borderRadius: '4px', fontWeight: 'bold' }}>
                            {stateInfo.text}
                        </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '14px' }}>
                        <div>
                            <span style={{ color: '#9ca3af' }}>White: </span>
                            <span style={{ color: whitePlayer === web3Settings?.account ? '#fbbf24' : 'white' }}>
                                {this.truncate(whitePlayer)} {whitePlayer === web3Settings?.account && '(You)'}
                            </span>
                        </div>
                        <div>
                            <span style={{ color: '#9ca3af' }}>Black: </span>
                            <span style={{ color: blackPlayer === web3Settings?.account ? '#fbbf24' : 'white' }}>
                                {blackPlayer === '0x0000000000000000000000000000000000000000' ? 'Waiting...' : this.truncate(blackPlayer)}
                                {blackPlayer === web3Settings?.account && ' (You)'}
                            </span>
                        </div>
                        <div>
                            <span style={{ color: '#9ca3af' }}>Bet: </span>
                            <span>{betting} ETH</span>
                        </div>
                        <div>
                            <span style={{ color: '#9ca3af' }}>Role: </span>
                            <span style={{ textTransform: 'capitalize' }}>{playerRole}</span>
                        </div>
                    </div>

                    {stateInfo.isActive && (
                        <div style={{
                            marginTop: '12px',
                            padding: '8px',
                            borderRadius: '4px',
                            textAlign: 'center',
                            fontWeight: 'bold',
                            background: isMyTurn ? '#22c55e' : '#4b5563'
                        }}>
                            {isMyTurn ? "Your Turn - Drag a piece to move!" : "Opponent's Turn"}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                    <div style={{ width: '400px' }}>
                        <Chessboard
                            position={position}
                            onPieceDrop={this.onDrop}
                            boardOrientation={boardOrientation}
                            arePiecesDraggable={canMove}
                            customBoardStyle={{
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
                            }}
                        />
                    </div>
                </div>

                {actionLoading && (
                    <div style={{ textAlign: 'center', marginBottom: '16px', color: '#6b7280' }}>
                        Processing transaction...
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    {stateInfo.canJoin && playerRole === 'spectator' && (
                        <Button
                            positive
                            size="large"
                            onClick={this.joinGame}
                            loading={actionLoading}
                        >
                            Join as Black ({betting} ETH)
                        </Button>
                    )}

                    {stateInfo.isActive && playerRole !== 'spectator' && (
                        <Button
                            negative
                            onClick={() => this.setState({ showResignModal: true })}
                        >
                            Resign
                        </Button>
                    )}

                    {this.canClaimPrize() && (
                        <Button
                            color="yellow"
                            onClick={this.claimPrize}
                            loading={actionLoading}
                        >
                            Claim Prize ({parseFloat(betting) * 2} ETH)
                        </Button>
                    )}
                </div>

                <Modal
                    open={showResignModal}
                    onClose={() => this.setState({ showResignModal: false })}
                    size="small"
                >
                    <Modal.Header>Confirm Resignation</Modal.Header>
                    <Modal.Content>
                        <p>Are you sure? You will lose {betting} ETH.</p>
                    </Modal.Content>
                    <Modal.Actions>
                        <Button onClick={() => this.setState({ showResignModal: false })}>Cancel</Button>
                        <Button negative onClick={this.resign} loading={actionLoading}>Resign</Button>
                    </Modal.Actions>
                </Modal>
            </Container>
        );
    }
}

export default GameSection;
