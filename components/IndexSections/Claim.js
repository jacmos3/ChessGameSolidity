import React, { Component } from 'react';
import { Container } from 'semantic-ui-react';
import styles from "../../styles/components/Claim.module.scss";
import FetchNFTList from "./ClaimSections/FetchNFTList";
import GameSection from "./ClaimSections/GameSection";
import CourtesySection from "./ClaimSections/CourtesySection";

class Claim extends Component {
    state = {
        activeGame: null
    }

    constructor(props) {
        super(props);
        this.goToFetch = this.goToFetch.bind(this);
    }

    resetActiveGame = () => this.setState({ activeGame: null });

    goToFetch(gameAddress) {
        this.setState({ activeGame: gameAddress });
    }

    render() {
        const { web3Settings } = this.props.state;
        const isConnected = web3Settings.isWeb3Connected;
        const isSupported = web3Settings.isSupported;
        const hasContract = !!web3Settings.contractAddress;

        return (
            <div className={`${styles.claim__container} py-10 text-trips-1`}>
                <div className="flex justify-around">
                    <div className={`${styles.container} rounded`}>
                        <h2 className={`${styles.title} text-center mt-4 capitalize text-2xl font-bold`}>
                            Chess Arena
                        </h2>
                        <br />

                        {!isConnected ? (
                            // Not connected
                            <CourtesySection
                                state={this.props.state}
                                message="Connect your wallet to play"
                                showConnectButton={true}
                                connect={this.props.connect}
                            />
                        ) : !isSupported ? (
                            // Connected but wrong network
                            <CourtesySection
                                state={this.props.state}
                                message={`Network not supported. Please switch to Sepolia, Holesky, or Localhost.`}
                                showConnectButton={false}
                            />
                        ) : !hasContract ? (
                            // No contract configured
                            <CourtesySection
                                state={this.props.state}
                                message="No contract configured for this network. Check .env file."
                                showConnectButton={false}
                            />
                        ) : this.state.activeGame ? (
                            // Show active game
                            <GameSection
                                state={this.props.state}
                                goToFetch={this.goToFetch}
                                addressGame={this.state.activeGame}
                                resetActiveGame={this.resetActiveGame}
                            />
                        ) : (
                            // Show games list
                            <FetchNFTList
                                state={this.props.state}
                                goToFetch={this.goToFetch}
                            />
                        )}
                    </div>
                </div>
            </div>
        );
    }
}

export default Claim;
