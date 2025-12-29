import React, { Component } from 'react';
import styles from "../../styles/components/Presentation.module.scss";

class Presentation extends Component {
    render() {
        return (
            <div className={styles.presentation__section}>
                <div className={styles.presentation__content}>
                    <div className={styles.chess__icon}>
                        &#9816;
                    </div>
                    <h1 className={styles.title}>
                        Solidity <span>Chess</span>
                    </h1>
                    <div className={styles.subtitle}>
                        100% On-Chain Chess Game
                    </div>
                    <div className={styles.text__description}>
                        Play chess on the blockchain. Every move is recorded on-chain.
                        Bet ETH, challenge opponents, and claim victory in a fully
                        decentralized chess experience.
                    </div>
                    <div className={styles.features}>
                        <div className={styles.feature}>
                            <span className={styles.icon}>&#9823;</span>
                            <span className={styles.label}>On-Chain Moves</span>
                        </div>
                        <div className={styles.feature}>
                            <span className={styles.icon}>&#9830;</span>
                            <span className={styles.label}>ETH Betting</span>
                        </div>
                        <div className={styles.feature}>
                            <span className={styles.icon}>&#127942;</span>
                            <span className={styles.label}>NFT Games</span>
                        </div>
                    </div>
                    <div className={styles.button__component}>
                        <a href="#Claim">
                            <button className="btn btn__primary">
                                Play Now
                            </button>
                        </a>
                        <a href="https://github.com/jacmos3/ChessGameSolidity" target="_blank" rel="noopener noreferrer">
                            <button className="btn btn__secondary">
                                View Code
                            </button>
                        </a>
                    </div>
                </div>
                <div className={styles.scroll__indicator}>
                    <span>Scroll to play</span>
                    <span>&#8595;</span>
                </div>
            </div>
        );
    }
}

export default Presentation;
