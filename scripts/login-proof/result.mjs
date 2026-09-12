export function summarizeFailure(code, stdout) {
  let receipt;
  try {
    receipt = JSON.parse(stdout);
  } catch {
    return { code, reason: "no_auth_receipt" };
  }
  const guidance = String(receipt.next_action ?? "");
  const reason = guidance.includes("Another Fonte login operation")
    ? "login_busy"
    : guidance.includes("secure credential storage")
      ? "secure_storage_unavailable"
      : receipt.state === "signed_out"
        ? "signed_out"
        : "auth_unavailable";
  return { code, reason };
}
