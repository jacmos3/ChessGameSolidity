import React, { Component } from 'react';
import Layout from '../components/Layout.js';
import Presentation from '../components/IndexSections/Presentation.js';
import Claim from '../components/IndexSections/Claim.js';
import Menu from '../components/IndexSections/Menu.js';

import Web3 from "web3";
import Web3Modal from "web3modal";

class MyDapp extends Component {
    state = {
        web3Settings: {
            infuraId: process.env.NEXT_PUBLIC_INFURA_ID || "",
            isWeb3Connected: false,
            chains: [
                {
                    name: "Sepolia",
                    id: 11155111,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_SEPOLIA || "",
                    explorer: "https://sepolia.etherscan.io"
                },
                {
                    name: "Holesky",
                    id: 17000,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_HOLESKY || "",
                    explorer: "https://holesky.etherscan.io"
                },
                {
                    name: "Ganache",
                    id: 1337,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_LOCAL || "",
                    explorer: ""
                },
                {
                    name: "Ganache",
                    id: 5777,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_LOCAL || "",
                    explorer: ""
                },
                {
                    name: "Linea Sepolia",
                    id: 59141,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_LINEA || "",
                    explorer: "https://sepolia.lineascan.build"
                }
            ]
        }
    };

    async componentDidMount() {
        var web3Settings = this.state.web3Settings;
        web3Settings.contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
        this.setState({ web3Settings: web3Settings });
        this.connect();
    }

    disconnect = () => {
        var web3Settings = this.state.web3Settings;
        web3Settings.isWeb3Connected = false;
        web3Settings.account = null;
        this.setState({ web3Settings: web3Settings });
    }

    connect = async () => {
        var providerOptions = {
            injected: {
                display: {
                    name: "MetaMask",
                    description: "Connect with MetaMask"
                },
                package: null
            }
        };

        var web3Modal = new Web3Modal({
            cacheProvider: false,
            providerOptions
        });

        var provider;
        web3Modal.clearCachedProvider();

        try {
            provider = await web3Modal.connect();
        } catch (e) {
            console.log("Could not get a wallet connection", e);
            return;
        }

        var web3 = new Web3(provider);

        provider.on('accountsChanged', function () {
            window.location.reload();
        });

        provider.on('chainChanged', function () {
            window.location.reload();
        });

        provider.on("disconnect", function () {
            provider.disconnect();
            web3Modal.clearCachedProvider();
            provider = null;
        });

        this.setState({ web3: web3 });

        const networkId = await web3.eth.net.getId();
        const accounts = await web3.eth.getAccounts();
        const ethBalance = await web3.eth.getBalance(accounts[0]) / 10 ** 18;

        var web3Settings = this.state.web3Settings;
        web3Settings.account = accounts[0];
        web3Settings.networkId = networkId;
        web3Settings.ethBalance = ethBalance;
        web3Settings.isWeb3Connected = accounts.length > 0;

        const chain = web3Settings.chains.find(c => c.id === networkId);
        web3Settings.networkName = chain ? chain.name : `Unknown (${networkId})`;
        web3Settings.isSupported = !!chain;

        if (chain && chain.contractAddressOverrided) {
            web3Settings.contractAddress = chain.contractAddressOverrided;
        }

        this.setState({ web3Settings: web3Settings });
    }

    truncateAddress(address) {
        if (!address) return "";
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    }

    render() {
        const { web3Settings } = this.state;

        return (
            <Layout state={this.state}>
                <div id="connectWallet" style={{
                    position: 'fixed',
                    top: '16px',
                    right: '16px',
                    zIndex: 50,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    {web3Settings.isWeb3Connected ? (
                        <>
                            <span style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '0.85rem',
                                fontWeight: 500,
                                background: web3Settings.isSupported ? '#22c55e' : '#eab308',
                                color: web3Settings.isSupported ? 'white' : '#1a1a2e'
                            }}>
                                {web3Settings.networkName}
                            </span>
                            <button
                                onClick={this.disconnect}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    background: '#e4a853',
                                    color: '#1a1a2e',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                    fontSize: '0.85rem'
                                }}
                            >
                                {this.truncateAddress(web3Settings.account)}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={this.connect}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '6px',
                                background: '#e4a853',
                                color: '#1a1a2e',
                                border: 'none',
                                cursor: 'pointer',
                                fontWeight: 500,
                                fontSize: '0.85rem'
                            }}
                        >
                            Connect Wallet
                        </button>
                    )}
                </div>

                <Presentation />
                <Menu />

                <div id="Claim" style={{ background: '#1a1a2e', minHeight: '100vh' }}>
                    <Claim
                        disconnect={this.disconnect}
                        connect={this.connect}
                        state={this.state}
                        web3={this.state.web3}
                    />
                </div>
            </Layout>
        );
    }
}

export default MyDapp;
