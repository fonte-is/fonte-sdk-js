// The authorized child verifies its bearer without printing or saving it.
const response = await fetch(
  `${process.env.FONTE_LOGIN_PROOF_ORIGIN}/consumer`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.FONTE_HUMAN_BEARER}` },
    body: JSON.stringify(process.argv),
  },
);
if (!response.ok) process.exitCode = 1;
