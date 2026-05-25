/** Stub keytar on CI/Linux runners without libsecret (workflow + email tests). */
const keytarMock = {
  getPassword: jest.fn(async (): Promise<string | null> => null),
  setPassword: jest.fn(async (): Promise<void> => undefined),
  deletePassword: jest.fn(async (): Promise<boolean> => true),
};

export default keytarMock;
