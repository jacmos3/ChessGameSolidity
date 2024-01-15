import React, {Component} from 'react';
import {Button, Container} from 'semantic-ui-react';
import styles from "../../../styles/components/claimSections/FetchNFTList.module.scss";

class CourtesySection extends Component {
    constructor(props) {
        super(props);   
    }

    render() {
        return (
            <Container style={{color: "white"}}>
                {
                    this.props.buttons ? (
                        this.props.state.web3Settings.isWeb3Connected
                            ? (
                                <div style={{padding: "5px"}}>
                                    <Button onClick={this.props.disconnect}>
                                        {this.props.state.web3Settingsaccount}
                                    </Button>
                                </div>
                            )
                            : (
                                <div style={{padding: "5px"}}>
                                    <div className="text-center">
                                        <button className={`btn btn__primary`} onClick={this.props.connect}>
                                            Connect Wallet
                                        </button>
                                    </div>
                                </div>
                            )
                    ) 
                    : (
                        <div style={{padding: "5px"}}>
                            <div className="text-center">
                                <div className={`${styles.modal}`}>
                                    <p className={`${styles.modal_error_title}`}>Wrong network!</p>
                                    <p>You are connected to
                                    netword {this.props.state.web3Settings.networkId} - {this.props.state.web3Settings.networkName}</p>
                                    <p className={`${styles.modal_error_second_description}`}>Please connect to
                                    networks:<br/></p>
                                        {
                                            this.props.state.web3Settings.chains.map(chain =>
                                                <div key={chain.id}>
                                                    <div>{`${chain.id} - ${chain.name}`}</div>
                                                </div>
                                            )
                                        }
                                </div>
                            </div>
                        </div>
                    )
                }
            </Container>
        )
    };
}
export default CourtesySection;
