import crypto from 'crypto';

/**
 * Hashes a plaintext password using a cryptographically random 16-byte salt and scrypt.
 * Format returned: `${salt}:${hashHex}`
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored `salt:hash` string using constant-time comparison.
 */
export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!password || !storedHash || !storedHash.includes(':')) {
    return false;
  }
  try {
    const [salt, originalHash] = storedHash.split(':');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const originalBuf = Buffer.from(originalHash, 'hex');
    if (hashBuf.length !== originalBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(hashBuf, originalBuf);
  } catch (e) {
    return false;
  }
}
