export class HostedTestBlockedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "HostedTestBlockedError";
  }
}
