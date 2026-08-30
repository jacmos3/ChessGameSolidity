const EXPECTED_DISPUTE_SECURITY_POLICY = Object.freeze({
  minimumPanelSize: 3n,
  minimumPanelCollateral: 3_000n * 10n ** 18n,
  arbitrationCoverageBps: 10_000n,
  quorumPercentage: 66n,
  supermajority: 66n,
});

function asUint(value, label) {
  let normalized;
  try {
    normalized = BigInt(value?.toString());
  } catch {
    throw new Error(`DisputeDAO ${label}: invalid unsigned integer ${value}`);
  }
  if (normalized < 0n) {
    throw new Error(`DisputeDAO ${label}: invalid unsigned integer ${value}`);
  }
  return normalized;
}

function assertDisputeSecurityPolicy(
  actual,
  expected = EXPECTED_DISPUTE_SECURITY_POLICY
) {
  const fields = [
    ["minimumPanelSize", "minimum panel size"],
    ["minimumPanelCollateral", "minimum panel active-stake floor"],
    ["arbitrationCoverageBps", "arbitration coverage bps"],
    ["quorumPercentage", "voting-power quorum percentage"],
    ["supermajority", "decision supermajority percentage"],
  ];

  for (const [field, label] of fields) {
    const actualValue = asUint(actual?.[field], label);
    const expectedValue = asUint(expected?.[field], `expected ${label}`);
    if (actualValue !== expectedValue) {
      throw new Error(
        `DisputeDAO ${label}: expected ${expectedValue}, got ${actualValue}`
      );
    }
  }
}

module.exports = {
  EXPECTED_DISPUTE_SECURITY_POLICY,
  assertDisputeSecurityPolicy,
};
