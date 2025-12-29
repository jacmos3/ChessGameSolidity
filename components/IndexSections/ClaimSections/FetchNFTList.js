import React, { Component } from 'react';
import { Container, Message, Modal, Input, Button } from 'semantic-ui-react';
import ChessFactoryABI from '../../../ethereum/build/contracts/ChessFactory.json';
import ChessCoreABI from '../../../ethereum/build/contracts/ChessCore.json';
import styles from "../../../styles/components/claimSections/FetchNFTList.module.scss";

class FetchNFTList extends Component {
    constructor(props) {
        super(props);
    }

    state = {
        all: [],
        loading: 0,
        errorMessage: "",
        successMessage: "",
        totalChessGames: 0,
        chainName: "",
        // Create game modal
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
            case 1: return { text: "Waiting for opponent", color: "blue", canJoin: true };
            case 2: return { text: "In Progress", color: "green", canJoin: false };
            case 3: return { text: "Draw", color: "gray", canJoin: false };
            case 4: return { text: "White Wins", color: "gold", canJoin: false };
            case 5: return { text: "Black Wins", color: "purple", canJoin: false };
            default: return { text: "Unknown", color: "gray", canJoin: false };
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
                <div style={{ display: 'flex', flexFlow: 'column' }}>
                    <h2 className="text-center text-2xl font-bold mb-4">
                        {totalChessGames} Games on {chainName}
                    </h2>

                    {errorMessage && (
                        <Message negative>
                            <Message.Header>Error</Message.Header>
                            <p>{errorMessage}</p>
                        </Message>
                    )}

                    {successMessage && (
                        <Message positive>
                            <Message.Header>Success</Message.Header>
                            <p>{successMessage}</p>
                        </Message>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-center gap-4 mb-6">
                        <button
                            className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 disabled:opacity-50"
                            onClick={this.openCreateModal}
                            disabled={loading > 0}
                        >
                            + Create New Game
                        </button>
                        <button
                            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
                            onClick={this.fetchNFTList}
                            disabled={loading > 0}
                        >
                            {loading > 0 ? 'Loading...' : 'Refresh List'}
                        </button>
                    </div>

                    {/* Games Grid */}
                    {loading > 0 ? (
                        <div className={`${styles.image__container}`}>
                            {[...Array(totalChessGames || 3)].map((_, index) => (
                                <div key={index} className={`${styles.image}`}>
                                    <div className="animate-pulse bg-gray-300 w-24 h-24 rounded"></div>
                                    <h3 className="text-gray-400">Loading...</h3>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={`${styles.image__container}`}>
                            {all.length === 0 ? (
                                <div className="text-center py-8">
                                    <p className="text-gray-500 text-lg">No games found. Create one to get started!</p>
                                </div>
                            ) : (
                                all.map(el => (
                                    <div key={el.key} className={`${styles.image} cursor-pointer hover:scale-105 transition-transform`}>
                                        <div onClick={() => this.props.goToFetch(el.key)}>
                                            <img src={el.image} width="120px" alt={el.header} />
                                        </div>
                                        <h3 className="font-bold">#{el.header}</h3>
                                        <p className="text-sm" style={{ color: el.statusColor }}>
                                            {el.gameStatus}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            Bet: {el.betting} ETH
                                        </p>
                                        {el.canJoin && el.whitePlayer !== web3Settings.account && (
                                            <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded mt-1 inline-block">
                                                Click to Join!
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
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-2">
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
                                <p className="text-sm text-gray-500 mt-1">
                                    Your opponent will need to match this bet to join.
                                    Set to 0 for a friendly game.
                                </p>
                            </div>
                            {this.state.errorMessage && (
                                <Message negative size="small">
                                    {this.state.errorMessage}
                                </Message>
                            )}
                        </div>
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
