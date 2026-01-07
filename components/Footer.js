import React, { Component } from 'react';
import styles from "../styles/components/Footer.module.scss";

class Footer extends Component {
    render() {
        return (
            <div className={styles.section__footer}>
                <div className={styles.footer__content}>
                    <div className={styles.footer__title}>
                        Solidity Chess
                    </div>
                    <div className={styles.footer__text}>
                        Built by
                        <a
                            href="https://github.com/jacmos3"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.link}
                        >
                            jacmos3
                        </a>
                        <br />
                        Code is
                        <a
                            href="https://github.com/jacmos3/ChessGameSolidity"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.link}
                        >
                            open-source
                        </a>
                        and licensed under MIT.
                    </div>
                    <div className={styles.footer__license}>
                        <img
                            src="https://i.creativecommons.org/p/zero/1.0/88x31.png"
                            alt="CC0"
                        />
                    </div>
                </div>
            </div>
        );
    }
}

export default Footer;
