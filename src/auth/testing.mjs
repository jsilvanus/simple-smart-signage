import { generateKeyPairSync, sign as cryptoSign, createHmac } from 'node:crypto';

function b64url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/**
 * Creates a fake Canva key pair, JWKS fetcher, and JWT signer for tests.
 */
export function createFakeCanva({ initialKid = 'canva-key-1', now = () => Date.now() } = {}) {
  const keys = new Map();
  let activeKid = null;
  let fetchCount = 0;

  function addKey(kid) {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    keys.set(kid, {
      kid,
      publicKey,
      privateKey,
      publicKeyPem,
      jwk: { ...jwk, kid, use: 'sig', alg: 'RS256' },
    });
    activeKid = kid;
    return { kid, publicKeyPem };
  }

  addKey(initialKid);

  function rotateKey(newKid = `canva-key-${keys.size + 1}`, { keepOld = true } = {}) {
    if (!keepOld) keys.clear();
    return addKey(newKid);
  }

  async function jwksFetch() {
    fetchCount += 1;
    const jwks = { keys: Array.from(keys.values(), (k) => k.jwk) };
    return {
      ok: true,
      status: 200,
      async json() {
        return jwks;
      },
    };
  }

  function signToken({
    brandId,
    aud,
    exp,
    nbf,
    kid = activeKid,
    alg = 'RS256',
    userId = 'user-test',
    secret,
  } = {}) {
    const header = { alg, typ: 'JWT' };
    if (kid !== null && kid !== undefined) {
      header.kid = kid;
    }

    const payload = {};
    if (userId !== null && userId !== undefined) payload.userId = userId;
    if (brandId !== undefined) payload.brandId = brandId;
    if (aud !== undefined) payload.aud = aud;
    if (exp === undefined) {
      payload.exp = Math.floor(now() / 1000) + 300;
    } else if (exp !== null) {
      payload.exp = exp;
    }
    if (nbf !== undefined) payload.nbf = nbf;

    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

    if (alg === 'none') {
      return `${signingInput}.`;
    }

    const entry = keys.get(kid) ?? keys.get(activeKid);

    if (alg === 'HS256') {
      const hmacKey = secret ?? entry.publicKeyPem;
      const sig = createHmac('sha256', hmacKey).update(signingInput).digest();
      return `${signingInput}.${b64url(sig)}`;
    }

    if (alg === 'RS256') {
      const sig = cryptoSign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), entry.privateKey);
      return `${signingInput}.${b64url(sig)}`;
    }

    throw new Error(`Unsupported test alg: ${alg}`);
  }

  return {
    jwksFetch,
    signToken,
    rotateKey,
    get fetchCount() {
      return fetchCount;
    },
    get activeKid() {
      return activeKid;
    },
    get publicKeyPem() {
      return keys.get(activeKid).publicKeyPem;
    },
  };
}
