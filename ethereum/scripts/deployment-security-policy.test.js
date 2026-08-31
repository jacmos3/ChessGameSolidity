const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EXPECTED_DISPUTE_SECURITY_POLICY,
  assertDisputeSecurityPolicy,
} = require("./deployment-security-policy");

test("deployment verifier accepts the canonical dispute security policy", () => {
  assert.doesNotThrow(() => assertDisputeSecurityPolicy({
    minimumPanelSize: "3",
    minimumPanelCollateral: "3000000000000000000000",
    arbitrationCoverageBps: 10_000,
    quorumPercentage: { toString: () => "66" },
    supermajority: 66n,
    challengeDeposit: "50000000000000000000",
    challengeDepositBps: 500,
    challengeWindow: 48 * 60 * 60,
    commitPeriod: 24 * 60 * 60,
    revealPeriod: 24 * 60 * 60,
  }));
});

test("deployment verifier rejects drift in every dispute security parameter", () => {
  const unsafeValues = {
    minimumPanelSize: 2n,
    minimumPanelCollateral: 2_999n * 10n ** 18n,
    arbitrationCoverageBps: 9_999n,
    quorumPercentage: 65n,
    supermajority: 65n,
    challengeDeposit: 49n * 10n ** 18n,
    challengeDepositBps: 499n,
    challengeWindow: 60n * 60n,
    commitPeriod: 60n * 60n,
    revealPeriod: 60n * 60n,
  };

  for (const [field, unsafeValue] of Object.entries(unsafeValues)) {
    assert.throws(
      () => assertDisputeSecurityPolicy({
        ...EXPECTED_DISPUTE_SECURITY_POLICY,
        [field]: unsafeValue,
      }),
      new RegExp(`DisputeDAO .*expected .* got ${unsafeValue}`),
      field
    );
  }
});

test("deployment verifier rejects malformed dispute security output", () => {
  assert.throws(
    () => assertDisputeSecurityPolicy({
      ...EXPECTED_DISPUTE_SECURITY_POLICY,
      quorumPercentage: undefined,
    }),
    /voting-power quorum percentage: invalid unsigned integer/
  );
});
