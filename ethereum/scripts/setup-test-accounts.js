const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");

module.exports = async function(callback) {
    try {
        const accounts = await web3.eth.getAccounts();
        const account1 = accounts[0];
        const account2 = accounts[1];

        console.log("\n=== Setting up test accounts ===");
        console.log("Account 1:", account1);
        console.log("Account 2:", account2);

        // Get contract instances
        const token = await ChessToken.deployed();
        const bonding = await BondingManager.deployed();

        console.log("\nChessToken:", token.address);
        console.log("BondingManager:", bonding.address);

        // Mint 10000 CHESS to both accounts
        const amount = web3.utils.toWei("10000", "ether");

        console.log("\nMinting 10000 CHESS to Account 1...");
        await token.mintPlayToEarn(account1, amount);

        console.log("Minting 10000 CHESS to Account 2...");
        await token.mintPlayToEarn(account2, amount);

        // Check balances
        const bal1 = await token.balanceOf(account1);
        const bal2 = await token.balanceOf(account2);
        console.log("\nAccount 1 CHESS balance:", web3.utils.fromWei(bal1), "CHESS");
        console.log("Account 2 CHESS balance:", web3.utils.fromWei(bal2), "CHESS");

        // Approve BondingManager to spend tokens
        console.log("\nApproving BondingManager...");
        await token.approve(bonding.address, amount, {from: account1});
        await token.approve(bonding.address, amount, {from: account2});

        // Deposit bonds for both players
        const bondChess = web3.utils.toWei("1000", "ether");
        const bondEth = web3.utils.toWei("1", "ether");

        console.log("\nDepositing bond for Account 1 (1000 CHESS + 1 ETH)...");
        await bonding.depositBond(bondChess, {from: account1, value: bondEth});

        console.log("Depositing bond for Account 2 (1000 CHESS + 1 ETH)...");
        await bonding.depositBond(bondChess, {from: account2, value: bondEth});

        // Check bond status
        const bond1 = await bonding.bonds(account1);
        const bond2 = await bonding.bonds(account2);

        console.log("\n=== Bond Status ===");
        console.log("Account 1 - CHESS:", web3.utils.fromWei(bond1.chessAmount), "ETH:", web3.utils.fromWei(bond1.ethAmount));
        console.log("Account 2 - CHESS:", web3.utils.fromWei(bond2.chessAmount), "ETH:", web3.utils.fromWei(bond2.ethAmount));

        // Check if accounts have sufficient bond for a 0.1 ETH game
        const stake = web3.utils.toWei("0.1", "ether");
        const hasBond1 = await bonding.hasSufficientBond(account1, stake);
        const hasBond2 = await bonding.hasSufficientBond(account2, stake);

        console.log("\n=== Ready to Play (0.1 ETH stake) ===");
        console.log("Account 1 has sufficient bond:", hasBond1);
        console.log("Account 2 has sufficient bond:", hasBond2);

        console.log("\n✅ Setup complete! Both accounts can now create and join games.");

        callback();
    } catch (error) {
        console.error("Error:", error);
        callback(error);
    }
};
