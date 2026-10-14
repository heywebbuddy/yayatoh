import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import { expoAppleProvider, expoGoogleProvider } from '../src/session/providers';

jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  formatFullName: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('expo-auth-session', () => {
  const state = {
    promptResult: { type: 'success', params: { code: 'auth-code' } } as {
      type: string;
      params?: { code?: string };
    },
  };
  class AuthRequest {
    static last: AuthRequest | null = null;
    codeVerifier = 'verifier-123';
    config: Record<string, unknown>;
    constructor(cfg: Record<string, unknown>) {
      this.config = cfg;
      AuthRequest.last = this;
    }
    promptAsync = jest.fn(async () => state.promptResult);
  }
  return {
    __state: state,
    AuthRequest,
    ResponseType: { Code: 'code' },
    fetchDiscoveryAsync: jest.fn(async () => ({
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
    })),
    exchangeCodeAsync: jest.fn(async () => ({ idToken: 'google.id.token' })),
  };
});

const apple = AppleAuthentication as unknown as {
  isAvailableAsync: jest.Mock;
  signInAsync: jest.Mock;
  formatFullName: jest.Mock;
};
const session = AuthSession as unknown as {
  __state: { promptResult: { type: string; params?: { code?: string } } };
  AuthRequest: { last: { config: Record<string, unknown> } | null };
  exchangeCodeAsync: jest.Mock;
};

describe('Apple adapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for the name and email with the hashed nonce, and returns the identity token and name', async () => {
    apple.signInAsync.mockResolvedValue({ identityToken: 'apple.jwt', fullName: { givenName: 'Ada' } });
    apple.formatFullName.mockReturnValue(' Ada Lovelace ');
    const out = await expoAppleProvider().signIn('hashed-nonce');
    expect(apple.signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce: 'hashed-nonce' });
    expect(out).toEqual({ idToken: 'apple.jwt', name: 'Ada Lovelace' });
  });

  it('has no name after the first sign-in', async () => {
    apple.signInAsync.mockResolvedValue({ identityToken: 'apple.jwt', fullName: null });
    expect(await expoAppleProvider().signIn('n')).toEqual({ idToken: 'apple.jwt' });
  });

  it('a cancelled sheet is null; another failure is thrown', async () => {
    apple.signInAsync.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    expect(await expoAppleProvider().signIn('n')).toBeNull();
    apple.signInAsync.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'ERR_REQUEST_FAILED' }));
    await expect(expoAppleProvider().signIn('n')).rejects.toThrow('boom');
  });

  it('no identity token is no sign-in', async () => {
    apple.signInAsync.mockResolvedValue({ identityToken: null });
    expect(await expoAppleProvider().signIn('n')).toBeNull();
  });

  it('reports availability from the system', async () => {
    apple.isAvailableAsync.mockResolvedValue(false);
    expect(await expoAppleProvider().isAvailable()).toBe(false);
  });
});

describe('Google adapter', () => {
  const options = {
    clientId: 'client.apps.googleusercontent.com',
    redirectUri: 'com.googleusercontent.apps.client:/oauthredirect',
  };
  beforeEach(() => {
    jest.clearAllMocks();
    session.__state.promptResult = { type: 'success', params: { code: 'auth-code' } };
  });

  it('puts the nonce in the authorization request, uses PKCE and returns the id_token', async () => {
    const out = await expoGoogleProvider(options).signIn('raw-nonce-0123456789');
    expect(out).toEqual({ idToken: 'google.id.token' });
    expect(session.AuthRequest.last?.config).toMatchObject({
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      usePKCE: true,
      scopes: ['openid', 'email', 'profile'],
      extraParams: { nonce: 'raw-nonce-0123456789' },
    });
    expect(session.exchangeCodeAsync.mock.calls[0]?.[0]).toMatchObject({
      code: 'auth-code',
      extraParams: { code_verifier: 'verifier-123' },
    });
  });

  it.each(['cancel', 'dismiss', 'error'])('a %s result is no sign-in and exchanges nothing', async (type) => {
    session.__state.promptResult = { type };
    expect(await expoGoogleProvider(options).signIn('n')).toBeNull();
    expect(session.exchangeCodeAsync).not.toHaveBeenCalled();
  });

  it('a response without an id_token is no sign-in', async () => {
    session.exchangeCodeAsync.mockResolvedValueOnce({ idToken: undefined });
    expect(await expoGoogleProvider(options).signIn('n')).toBeNull();
  });
});
