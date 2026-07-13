import type { PgpKeyMaterialPort } from '../api';

type OpenPgpModule = typeof import('openpgp', { with: { 'resolution-mode': 'import' } });

const importOpenPgp = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<OpenPgpModule>;

export function createOpenPgpKeyMaterialPort(): PgpKeyMaterialPort {
  return {
    async generateIdentity(input) {
      const openpgp = await importOpenPgp('openpgp');
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
      const openpgp = await importOpenPgp('openpgp');
      const key = await openpgp.readKey({ armoredKey: input.armored });
      return {
        fingerprint: key.getFingerprint().toLowerCase(),
        email: String(key.users[0]?.userID ?? 'unknown'),
      };
    },
  };
}
