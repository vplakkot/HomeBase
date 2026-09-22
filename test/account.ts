import type { Account } from "../lib/account";

// A signed-in account for tests that draw the frame or sidebar. Fake, as
// all test data is.
export const TEST_ACCOUNT: Account = {
  email: "sam@example.com",
  name: "Sam Example",
  publicKey: "public-push-key",
  knownDevice: null,
  build: "dev · local",
};
