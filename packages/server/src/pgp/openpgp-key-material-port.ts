import type { PgpKeyMaterialPort } from '../api';

type OpenPgpModule = typeof import('openpgp', { with: { 'resolution-mode': 'import' } });

const importOpenPgp = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<OpenPgpModule>;

export type OpenPgpKeyMaterialPortOptions = {
  importOpenPgp?: () => Promise<OpenPgpModule>;
};

export function createOpenPgpKeyMaterialPort(options: OpenPgpKeyMaterialPortOptions = {}): PgpKeyMaterialPort {
  const loadOpenPgp = options.importOpenPgp ?? (() => importOpenPgp('openpgp'));
  return {
    async generateIdentity(input) {
      const openpgp = await loadOpenPgp();
      const generated = await openpgp.generateKey({
        type: 'rsa',
        rsaBits: 4096,
        userIDs: [{ name: input.email, email: input.email }],
        passphrase: input.passphrase,
      });
      const publicKeyArmor = String(generated.publicKey);
      const privateKeyArmored = String(generated.privateKey);
      const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmor });
      return {
        fingerprint: publicKey.getFingerprint().toLowerCase(),
        publicKeyArmor,
        privateKeyArmored,
      };
    },
    async readPublicKey(input) {
      const openpgp = await loadOpenPgp();
      const key = await openpgp.readKey({ armoredKey: input.armored });
      const email = await peerKeyEmail(key);
      if (!email) throw new Error('Der Schlüssel enthält keine E-Mail-Adresse in der User-ID.');
      return {
        fingerprint: key.getFingerprint().toLowerCase(),
        email,
      };
    },
  };
}

/**
 * E-mail of the key's primary user id (fallback: first user id with an e-mail).
 * `user.userID` is a UserIDPacket object, not a string (same as electron/pgp/pgp-service.ts).
 */
async function peerKeyEmail(key: Awaited<ReturnType<OpenPgpModule['readKey']>>): Promise<string | null> {
  const normalize = (value: string | undefined) => value?.trim().toLowerCase() || null;
  try {
    const { user } = await key.getPrimaryUser();
    const email = normalize(user.userID?.email);
    if (email) return email;
  } catch {
    // No valid primary user self-signature: fall back to the raw user ids.
  }
  for (const user of key.users) {
    const email = normalize(user.userID?.email);
    if (email) return email;
  }
  return null;
}
