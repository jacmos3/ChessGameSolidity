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
  }));
});

test("deployment verifier rejects drift in every dispute security parameter", () => {
  const unsafeValues = {
    minimumPanelSize: 2n,
    minimumPanelCollateral: 2_999n * 10n ** 18n,
    arbitrationCoverageBps: 9_999n,
    quorumPercentage: 65n,
    supermajority: 65n,
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
