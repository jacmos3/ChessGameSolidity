const ChessToken = artifacts.require("ChessToken");

contract("ChessToken", (accounts) => {
  const admin = accounts[0];
  const teamWallet = accounts[1];
  const treasury = accounts[2];
  const user1 = accounts[3];
  const user2 = accounts[4];

  let chessToken;

  beforeEach(async () => {
    chessToken = await ChessToken.new(teamWallet, treasury, { from: admin });
  });

  describe("Deployment", () => {
    it("should set correct name and symbol", async () => {
      const name = await chessToken.name();
      const symbol = await chessToken.symbol();
      assert.equal(name, "Chess Token");
      assert.equal(symbol, "CHESS");
    });

    it("should set correct max supply", async () => {
      const maxSupply = await chessToken.MAX_SUPPLY();
      assert.equal(maxSupply.toString(), web3.utils.toWei("100000000", "ether"));
    });

    it("should mint liquidity and community tokens to treasury on deploy", async () => {
      const treasuryBalance = await chessToken.balanceOf(treasury);
      const expectedBalance = web3.utils.toWei("20000000", "ether"); // 10M + 10M
      assert.equal(treasuryBalance.toString(), expectedBalance);
    });

    it("should set team wallet correctly", async () => {
      const wallet = await chessToken.teamWallet();
      assert.equal(wallet, teamWallet);
    });

    it("should grant admin role to deployer", async () => {
      const DEFAULT_ADMIN_ROLE = await chessToken.DEFAULT_ADMIN_ROLE();
      const hasRole = await chessToken.hasRole(DEFAULT_ADMIN_ROLE, admin);
      assert.isTrue(hasRole);
    });
  });

  describe("Play-to-Earn Minting", () => {
    it("should allow minter to mint play-to-earn tokens", async () => {
      const amount = web3.utils.toWei("1000", "ether");
      await chessToken.mintPlayToEarn(user1, amount, { from: admin });

      const balance = await chessToken.balanceOf(user1);
      assert.equal(balance.toString(), amount);
    });

    it("should track play-to-earn minted amount", async () => {
      const amount = web3.utils.toWei("1000", "ether");
      await chessToken.mintPlayToEarn(user1, amount, { from: admin });

      const minted = await chessToken.playToEarnMinted();
      assert.equal(minted.toString(), amount);
    });

    it("should reject minting beyond play-to-earn cap", async () => {
      const cap = await chessToken.PLAY_TO_EARN_CAP();
      const overCap = web3.utils.toBN(cap).add(web3.utils.toBN("1"));

      try {
        await chessToken.mintPlayToEarn(user1, overCap.toString(), { from: admin });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject minting from non-minter", async () => {
      const amount = web3.utils.toWei("1000", "ether");
      try {
        await chessToken.mintPlayToEarn(user1, amount, { from: user2 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Treasury Minting", () => {
    it("should allow admin to mint treasury tokens", async () => {
      const amount = web3.utils.toWei("5000000", "ether");
      await chessToken.mintTreasury(treasury, amount, { from: admin });

      const minted = await chessToken.treasuryMinted();
      assert.equal(minted.toString(), amount);
    });

    it("should reject treasury minting beyond cap", async () => {
      const cap = await chessToken.TREASURY_CAP();
      const overCap = web3.utils.toBN(cap).add(web3.utils.toBN("1"));

      try {
        await chessToken.mintTreasury(treasury, overCap.toString(), { from: admin });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Team Vesting", () => {
    it("should return 0 claimable immediately after deploy", async () => {
      const claimable = await chessToken.getClaimableTeamVesting();
      // Should be very small (just a few seconds worth)
      assert.isTrue(web3.utils.toBN(claimable).lt(web3.utils.toBN(web3.utils.toWei("100", "ether"))));
    });

    it("should only allow team wallet to claim", async () => {
      try {
        await chessToken.claimTeamVesting({ from: user1 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should allow team wallet to propose and accept new address after timelock", async () => {
      // Propose new team wallet
      await chessToken.proposeTeamWallet(user1, { from: teamWallet });

      // Verify pending wallet is set
      const pending = await chessToken.pendingTeamWallet();
      assert.equal(pending, user1);

      // Fast forward 48 hours
      await new Promise(resolve => setTimeout(resolve, 100));
      await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_increaseTime", params: [48 * 60 * 60 + 1], id: Date.now() }, () => {});
      await web3.currentProvider.send({ jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() }, () => {});

      // Accept the change
      await chessToken.acceptTeamWalletChange({ from: teamWallet });

      const newWallet = await chessToken.teamWallet();
      assert.equal(newWallet, user1);
    });

    it("should reject team wallet proposal from non-team address", async () => {
      try {
        await chessToken.proposeTeamWallet(user1, { from: admin });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Minter Role Management", () => {
    it("should allow admin to add minter", async () => {
      await chessToken.addMinter(user1, { from: admin });

      const MINTER_ROLE = await chessToken.MINTER_ROLE();
      const hasRole = await chessToken.hasRole(MINTER_ROLE, user1);
      assert.isTrue(hasRole);
    });

    it("should allow admin to remove minter", async () => {
      await chessToken.addMinter(user1, { from: admin });
      await chessToken.removeMinter(user1, { from: admin });

      const MINTER_ROLE = await chessToken.MINTER_ROLE();
      const hasRole = await chessToken.hasRole(MINTER_ROLE, user1);
      assert.isFalse(hasRole);
    });

    it("should allow new minter to mint", async () => {
      await chessToken.addMinter(user1, { from: admin });

      const amount = web3.utils.toWei("500", "ether");
      await chessToken.mintPlayToEarn(user2, amount, { from: user1 });

      const balance = await chessToken.balanceOf(user2);
      assert.equal(balance.toString(), amount);
    });
  });

  describe("Burning", () => {
    it("should allow users to burn their tokens", async () => {
      const mintAmount = web3.utils.toWei("1000", "ether");
      await chessToken.mintPlayToEarn(user1, mintAmount, { from: admin });

      const burnAmount = web3.utils.toWei("500", "ether");
      await chessToken.burn(burnAmount, { from: user1 });

      const balance = await chessToken.balanceOf(user1);
      assert.equal(balance.toString(), web3.utils.toWei("500", "ether"));
    });
  });

  describe("Remaining Mintable", () => {
    it("should return correct remaining mintable amounts", async () => {
      const remaining = await chessToken.remainingMintable();

      assert.equal(remaining.playToEarn.toString(), web3.utils.toWei("40000000", "ether"));
      assert.equal(remaining.treasury.toString(), web3.utils.toWei("25000000", "ether"));
      assert.equal(remaining.team.toString(), web3.utils.toWei("15000000", "ether"));
      assert.equal(remaining.liquidity.toString(), "0"); // Already minted
      assert.equal(remaining.community.toString(), "0"); // Already minted
    });

    it("should update remaining after minting", async () => {
      const amount = web3.utils.toWei("1000000", "ether");
      await chessToken.mintPlayToEarn(user1, amount, { from: admin });

      const remaining = await chessToken.remainingMintable();
      assert.equal(remaining.playToEarn.toString(), web3.utils.toWei("39000000", "ether"));
    });
  });

  describe("Total Minted", () => {
    it("should track total minted correctly", async () => {
      const initialMinted = await chessToken.totalMinted();
      // 20M (liquidity + community) already minted
      assert.equal(initialMinted.toString(), web3.utils.toWei("20000000", "ether"));

      const amount = web3.utils.toWei("1000000", "ether");
      await chessToken.mintPlayToEarn(user1, amount, { from: admin });
      await chessToken.mintTreasury(treasury, amount, { from: admin });

      const newTotal = await chessToken.totalMinted();
      assert.equal(newTotal.toString(), web3.utils.toWei("22000000", "ether"));
    });
  });
});
