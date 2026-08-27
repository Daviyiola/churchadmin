export type SmsProviderEvent = { providerEventId: string; type: string; occurredAt: string; phoneE164?: string };

export interface SmsProvider {
  readonly key: string;
  createAccount(input: unknown): Promise<unknown>;
  getRegistrationStatus(accountId: string): Promise<unknown>;
  listNumbers(accountId: string): Promise<unknown[]>;
  send(input: unknown): Promise<unknown>;
  schedule(input: unknown): Promise<unknown>;
  getBalance(accountId: string): Promise<unknown>;
  verifyWebhook(request: Request): Promise<boolean>;
  normalizeEvent(payload: unknown): SmsProviderEvent;
}

class LocalMockSmsProvider implements SmsProvider {
  readonly key = "local_mock";
  async createAccount() { return { status: "mock" }; }
  async getRegistrationStatus() { return { status: "mock" }; }
  async listNumbers() { return []; }
  async send() { throw new Error("SMS sending is disabled in the provider-neutral foundation."); }
  async schedule() { throw new Error("SMS scheduling is disabled in the provider-neutral foundation."); }
  async getBalance() { return { balance: null }; }
  async verifyWebhook() { return false; }
  normalizeEvent(): never { throw new Error("Mock provider events are not supported."); }
}

export function getSmsProvider(): SmsProvider {
  if (process.env.NODE_ENV === "production") {
    throw new Error("No production SMS provider is connected.");
  }
  return new LocalMockSmsProvider();
}

export function assertSmsSendingDisabled() {
  throw new Error("Provider connection pending. No text message was sent.");
}
