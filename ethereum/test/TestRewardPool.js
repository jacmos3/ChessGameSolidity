const ChessToken = artifacts.require("ChessToken");
const PlayerRating = artifacts.require("PlayerRating");
const RewardPool = artifacts.require("RewardPool");
const MockERC1271Signer = artifacts.require("MockERC1271Signer");

contract("RewardPool", (accounts) => {
  const admin = accounts[0];
  const teamWallet = accounts[1];
  const treasury = accounts[2];
  const claimant = accounts[3];
  const unauthorizedSigner = accounts[4];

  let chessToken;
  let playerRating;
  let rewardPool;

  beforeEach(async () => {
    chessToken = await ChessToken.new(teamWallet, treasury, { from: admin });
    playerRating = await PlayerRating.new({ from: admin });
    rewardPool = await RewardPool.new(chessToken.address, playerRating.address, { from: admin });

    const funding = web3.utils.toWei("100", "ether");
    await chessToken.mintPlayToEarn(admin, funding, { from: admin });
    await chessToken.approve(rewardPool.address, funding, { from: admin });
    await rewardPool.depositFaucetPool(funding, { from: admin });
  });

  async function signFaucetAuthorization(beneficiary, signer = admin) {
    const chainId = await web3.eth.getChainId();
    const digest = web3.utils.soliditySha3(
      { type: "address", value: rewardPool.address },
      { type: "uint256", value: chainId },
      { type: "address", value: beneficiary }
    );
    return web3.eth.sign(digest, signer);
  }

  it("allows one faucet claim with a signer authorization", async () => {
    const signature = await signFaucetAuthorization(claimant);

    await rewardPool.claimFaucet(signature, { from: claimant });

    const balance = await chessToken.balanceOf(claimant);
    assert.equal(balance.toString(), web3.utils.toWei("5", "ether"));
    assert.isTrue(await rewardPool.hasClaimedFaucet(claimant));
  });

  it("rejects an authorization produced by an untrusted signer", async () => {
    const signature = await signFaucetAuthorization(claimant, unauthorizedSigner);

    try {
      await rewardPool.claimFaucet(signature, { from: claimant });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("accepts an authorization from an ERC-1271 contract wallet", async () => {
    const contractSigner = await MockERC1271Signer.new(admin, { from: admin });
    await rewardPool.setFaucetSigner(contractSigner.address, { from: admin });
    const signature = await signFaucetAuthorization(claimant, admin);

    await rewardPool.claimFaucet(signature, { from: claimant });

    const balance = await chessToken.balanceOf(claimant);
    assert.equal(balance.toString(), web3.utils.toWei("5", "ether"));
  });

  it("rejects an invalid ERC-1271 contract-wallet authorization", async () => {
    const contractSigner = await MockERC1271Signer.new(admin, { from: admin });
    await rewardPool.setFaucetSigner(contractSigner.address, { from: admin });
    const signature = await signFaucetAuthorization(claimant, unauthorizedSigner);

    try {
      await rewardPool.claimFaucet(signature, { from: claimant });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("binds the authorization to the intended beneficiary", async () => {
    const signature = await signFaucetAuthorization(claimant);

    try {
      await rewardPool.claimFaucet(signature, { from: accounts[5] });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });
});
