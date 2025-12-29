import React, { Component } from 'react';
import Layout from '../components/Layout.js';
import Presentation from '../components/IndexSections/Presentation.js';
import Claim from '../components/IndexSections/Claim.js';
import Team from '../components/IndexSections/Team.js';
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
                    explorer: "https://sepolia.etherscan.io",
                    options: { id: 1 }
                },
                {
                    name: "Holesky",
                    id: 17000,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_HOLESKY || "",
                    explorer: "https://holesky.etherscan.io",
                    options: { id: 1 }
                },
                {
                    name: "Localhost",
                    id: 1337,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_LOCAL || "",
                    explorer: "",
                    options: { id: 1 }
                },
                {
                    name: "Ganache",
                    id: 5777,
                    contractAddressOverrided: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS_LOCAL || "",
                    explorer: "",
                    options: { id: 1 }
                }
            ]
        }
    };

    constructor(props) {
        super(props);
    }

    async componentDidMount() {
        var web3Settings = this.state.web3Settings;
        web3Settings.contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
        this.setState({ web3Settings: web3Settings });
        this.connect();
    }

    update = async (nextState) => {
        this.setState(nextState);
    }

    disconnect = (event) => {
        var web3Settings = this.state.web3Settings;
        web3Settings.isWeb3Connected = false;
        web3Settings.account = null;
        this.setState({ web3Settings: web3Settings });
    }

    connect = async (event) => {
        var providerOptions = {
            injected: {
                display: {
                    name: "MetaMask",
                    description: "Connect with MetaMask or browser wallet"
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

        provider.on('accountsChanged', function (accounts) {
            window.location.reload();
        });

        provider.on('chainChanged', function (networkId) {
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

        // Get network name
        const chain = web3Settings.chains.find(c => c.id === networkId);
        web3Settings.networkName = chain ? chain.name : `Unknown (${networkId})`;
        web3Settings.isSupported = !!chain;

        // Override contract address if specified for this network
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
                <div id="connectWallet" className="fixed top-4 right-4 z-50">
                    {web3Settings.isWeb3Connected ? (
                        <div className="flex items-center gap-2">
                            <span className={`px-3 py-1 rounded text-sm ${web3Settings.isSupported ? 'bg-green-600' : 'bg-yellow-600'} text-white`}>
                                {web3Settings.networkName}
                            </span>
                            <button
                                className="btn btn__wallet bg-trips-1 text-white px-4 py-2 rounded hover:bg-trips-2"
                                onClick={this.disconnect}
                            >
                                {this.truncateAddress(web3Settings.account)}
                            </button>
                        </div>
                    ) : (
                        <button
                            className="btn btn__wallet bg-trips-3 text-white px-4 py-2 rounded hover:bg-orange-600"
                            onClick={this.connect}
                        >
                            Connect Wallet
                        </button>
                    )}
                </div>

                <Presentation state={this.state} />
                <Menu state={this.state} />

                <div id="Claim" className="bg-trips-5">
                    <Claim
                        disconnect={this.disconnect}
                        connect={this.connect}
                        state={this.state}
                        web3={this.state.web3}
                    />
                </div>

                <div id="Team">
                    <Team />
                </div>
            </Layout>
        );
    }
}

export default MyDapp;
