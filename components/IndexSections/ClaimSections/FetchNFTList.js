import React, { Component } from 'react';
import { Container, Message, Modal, Input, Button } from 'semantic-ui-react';
import ChessFactoryABI from '../../../ethereum/build/contracts/ChessFactory.json';
import ChessCoreABI from '../../../ethereum/build/contracts/ChessCore.json';
import styles from "../../../styles/components/claimSections/FetchNFTList.module.scss";

class FetchNFTList extends Component {
    state = {
        all: [],
        loading: 0,
        errorMessage: "",
        successMessage: "",
        totalChessGames: 0,
        chainName: "",
        showCreateModal: false,
        betAmount: "0.01",
        creatingGame: false
    };

    async componentDidMount() {
        var chain = this.props.state.web3Settings.chains
            .find(chain => chain.id === this.props.state.web3Settings.networkId);

        if (chain) {
            this.setState({
                chainName: chain.name,
                explorer: chain.explorer
            });
        }
        await this.fetchNFTList();
    }

    getGameStatusLabel = (status) => {
        switch (parseInt(status)) {
            case 1: return { text: "Waiting", color: "#3b82f6", canJoin: true };
            case 2: return { text: "In Progress", color: "#22c55e", canJoin: false };
            case 3: return { text: "Draw", color: "#6b7280", canJoin: false };
            case 4: return { text: "White Wins", color: "#e4a853", canJoin: false };
            case 5: return { text: "Black Wins", color: "#a855f7", canJoin: false };
            default: return { text: "Unknown", color: "#6b7280", canJoin: false };
        }
    }

    fetchNFTList = async () => {
        this.setState({ loading: this.state.loading + 1, errorMessage: '', successMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;

            if (!web3Settings.contractAddress) {
                throw new Error("Contract address not configured for this network");
            }

            const chessFactoryInstance = new web3.eth.Contract(
                ChessFactoryABI.abi,
                web3Settings.contractAddress
            );

            const deployedChessGames = await chessFactoryInstance.methods.getDeployedChessGames().call();
            this.setState({ totalChessGames: deployedChessGames.length });

            var all = [];
            for (var i = 0; i < deployedChessGames.length; i++) {
                try {
                    const chessCoreInstance = new web3.eth.Contract(
                        ChessCoreABI.abi,
                        deployedChessGames[i]
                    );

                    const chessboard = await chessCoreInstance.methods.printChessBoardLayoutSVG().call()
                        .then((result) => JSON.parse(window.atob(result.split(',')[1])))
                        .catch(() => null);

                    const gameStatus = await chessCoreInstance.methods.getGameState().call();
                    const betting = await chessCoreInstance.methods.betting().call();
                    const players = await chessCoreInstance.methods.getPlayers().call();

                    const statusInfo = this.getGameStatusLabel(gameStatus);

                    all.push({
                        key: deployedChessGames[i],
                        header: chessboard?.name || `Game ${i + 1}`,
                        image: chessboard?.image || "",
                        gameStatus: statusInfo.text,
                        statusColor: statusInfo.color,
                        canJoin: statusInfo.canJoin,
                        betting: web3.utils.fromWei(betting, 'ether'),
                        whitePlayer: players[0],
                        blackPlayer: players[1]
                    });
                } catch (err) {
                    console.error(`Error loading game ${i}:`, err);
                }
            }

            this.setState({ all: all });
        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ loading: this.state.loading - 1 });
    }

    openCreateModal = () => {
        this.setState({ showCreateModal: true, errorMessage: '', successMessage: '' });
    }

    closeCreateModal = () => {
        this.setState({ showCreateModal: false });
    }

    createGame = async () => {
        this.setState({ creatingGame: true, errorMessage: '' });

        try {
            const { web3, web3Settings } = this.props.state;
            const betAmountWei = web3.utils.toWei(this.state.betAmount, 'ether');

            const chessFactoryInstance = new web3.eth.Contract(
                ChessFactoryABI.abi,
                web3Settings.contractAddress
            );

            await chessFactoryInstance.methods.createChessGame().send({
                from: web3Settings.account,
                value: betAmountWei
            });

            this.setState({
                successMessage: "Game created successfully!",
                showCreateModal: false
            });

            await this.fetchNFTList();
        } catch (err) {
            this.setState({ errorMessage: err.message });
        }

        this.setState({ creatingGame: false });
    }

    render() {
        const { all, loading, errorMessage, successMessage, totalChessGames, chainName } = this.state;
        const { web3Settings } = this.props.state;

        return (
            <Container>
                <div style={{ display: 'flex', flexFlow: 'column', padding: '20px 0' }}>
                    <h2 style={{
                        textAlign: 'center',
                        color: '#f5f5f5',
                        fontSize: '1.3rem',
                        marginBottom: '24px'
                    }}>
                        {totalChessGames} Games on <span style={{ color: '#e4a853' }}>{chainName}</span>
                    </h2>

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

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '24px' }}>
                        <button
                            onClick={this.openCreateModal}
                            disabled={loading > 0}
                            style={{
                                background: '#e4a853',
                                color: '#1a1a2e',
                                padding: '12px 24px',
                                borderRadius: '8px',
                                border: 'none',
                                fontWeight: 600,
                                cursor: loading > 0 ? 'not-allowed' : 'pointer',
                                opacity: loading > 0 ? 0.5 : 1,
                                transition: 'all 0.2s'
                            }}
                        >
                            + Create New Game
                        </button>
                        <button
                            onClick={this.fetchNFTList}
                            disabled={loading > 0}
                            style={{
                                background: 'transparent',
                                color: '#e4a853',
                                padding: '12px 24px',
                                borderRadius: '8px',
                                border: '2px solid #e4a853',
                                fontWeight: 600,
                                cursor: loading > 0 ? 'not-allowed' : 'pointer',
                                opacity: loading > 0 ? 0.5 : 1,
                                transition: 'all 0.2s'
                            }}
                        >
                            {loading > 0 ? 'Loading...' : 'Refresh'}
                        </button>
                    </div>

                    {/* Games Grid */}
                    {loading > 0 ? (
                        <div className={styles.image__container}>
                            {[...Array(totalChessGames || 3)].map((_, index) => (
                                <div key={index} className={styles.image}>
                                    <div style={{
                                        width: '100px',
                                        height: '100px',
                                        background: 'rgba(255,255,255,0.05)',
                                        borderRadius: '8px',
                                        animation: 'pulse 2s infinite'
                                    }}></div>
                                    <h3 style={{ color: '#6b7280' }}>Loading...</h3>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={styles.image__container}>
                            {all.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px' }}>
                                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>♟</div>
                                    <p style={{ color: '#6b7280', fontSize: '1.1rem' }}>
                                        No games found. Create one to get started!
                                    </p>
                                </div>
                            ) : (
                                all.map(el => (
                                    <div
                                        key={el.key}
                                        className={styles.image}
                                        onClick={() => this.props.goToFetch(el.key)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <img src={el.image} width="120px" alt={el.header} />
                                        <h3>#{el.header}</h3>
                                        <p style={{ color: el.statusColor, fontWeight: 500 }}>
                                            {el.gameStatus}
                                        </p>
                                        <p>{el.betting} ETH</p>
                                        {el.canJoin && el.whitePlayer !== web3Settings.account && (
                                            <span style={{
                                                background: 'rgba(59, 130, 246, 0.2)',
                                                color: '#3b82f6',
                                                padding: '4px 10px',
                                                borderRadius: '4px',
                                                fontSize: '0.75rem',
                                                marginTop: '8px',
                                                fontWeight: 500
                                            }}>
                                                Join Game
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* Create Game Modal */}
                <Modal
                    open={this.state.showCreateModal}
                    onClose={this.closeCreateModal}
                    size="small"
                >
                    <Modal.Header>Create New Chess Game</Modal.Header>
                    <Modal.Content>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                                Bet Amount (ETH)
                            </label>
                            <Input
                                type="number"
                                step="0.001"
                                min="0"
                                value={this.state.betAmount}
                                onChange={(e) => this.setState({ betAmount: e.target.value })}
                                placeholder="0.01"
                                fluid
                            />
                            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: '8px' }}>
                                Your opponent will need to match this bet to join.
                                Set to 0 for a friendly game.
                            </p>
                        </div>
                        {this.state.errorMessage && (
                            <Message negative size="small">
                                {this.state.errorMessage}
                            </Message>
                        )}
                    </Modal.Content>
                    <Modal.Actions>
                        <Button onClick={this.closeCreateModal}>
                            Cancel
                        </Button>
                        <Button
                            positive
                            onClick={this.createGame}
                            loading={this.state.creatingGame}
                            disabled={this.state.creatingGame}
                        >
                            Create Game ({this.state.betAmount} ETH)
                        </Button>
                    </Modal.Actions>
                </Modal>
            </Container>
        );
    }
}

export default FetchNFTList;
