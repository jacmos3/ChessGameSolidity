/**
 * Use this file to configure your truffle project. It's seeded with some
 * common settings for different networks and features like migrations,
 * compilation and testing. Uncomment the ones you need or modify
 * them to suit your project as necessary.
 *
 * More information about configuration can be found at:
 *
 * https://trufflesuite.com/docs/truffle/reference/configuration
 *
 * To deploy via Infura you'll need a wallet provider (like @truffle/hdwallet-provider)
 * to sign your transactions before they're sent to a remote public node. Infura accounts
 * are available for free at: infura.io/register.
 *
 * You'll also need a mnemonic - the twelve word phrase the wallet uses to generate
 * public/private key pairs. If you're publishing your code to GitHub make sure you load this
 * phrase from a file you've .gitignored so it doesn't accidentally become public.
 *
 */

 require('dotenv').config();
 const mnemonic = process.env["MNEMONIC"];
 const infuraProjectId = process.env["INFURA_PROJECT_ID"];
 
 const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  /**
   * Networks define how you connect to your ethereum client and let you set the
   * defaults web3 uses to send transactions. If you don't specify one truffle
   * will spin up a development blockchain for you on port 9545 when you
   * run `develop` or `test`. You can ask a truffle command to use a specific
   * network from the command line, e.g
   *
   * $ truffle test --network <network-name>
   */

  networks: {
    // Local development with Ganache
    development: {
      host: "127.0.0.1",
      port: 7545,
      network_id: "*",
    },

    // Base Sepolia Testnet
    base_sepolia: {
      provider: () => new HDWalletProvider(
        mnemonic,
        process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'
      ),
      network_id: 84532,
      chain_id: 84532,
      gas: 8000000,
      gasPrice: 1000000, // 0.001 gwei
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true
    },

    // Base Mainnet
    base: {
      provider: () => new HDWalletProvider(
        mnemonic,
        process.env.BASE_MAINNET_RPC || 'https://mainnet.base.org'
      ),
      network_id: 8453,
      chain_id: 8453,
      gas: 8000000,
      gasPrice: 1000000, // 0.001 gwei
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true
    }
  },

  // Set default mocha options here, use special reporters etc.
  // To enable gas reporting, set REPORT_GAS=true environment variable
  mocha: {
    timeout: 120000,
    ...(process.env.REPORT_GAS && {
      reporter: 'eth-gas-reporter',
      reporterOptions: {
        currency: 'USD',
        gasPrice: 20,
        showTimeSpent: true,
        excludeContracts: ['Migrations']
      }
    })
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: "0.8.24",
      settings: {
        evmVersion: "cancun",  // Required for mcopy opcode in OZ 5.x
        viaIR: true,  // Required for complex contracts
        optimizer: {
          enabled: true,
          runs: 1,  // Lowest runs = smallest contract size
        },
        debug: {
          revertStrings: "strip"  // Remove revert strings to reduce size
        }
      },
    }
  }
};