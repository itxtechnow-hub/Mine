'use strict';

const crypto = require('crypto');

const HASH_ITERATIONS = 100000;
const HASH_KEYLEN = 64;
const HASH_DIGEST = 'sha512';

const BACKUP_ITERATIONS = 100000;
const BACKUP_DIGEST = 'sha256';

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto
    .pbkdf2Sync(password, s, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
    .toString('hex');
  return { hash: h, salt: s };
}

function verifyPassword(password, storedHash, salt) {
  if (!password || !storedHash || !salt) return false;
  try {
    const h = crypto
      .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEYLEN, HASH_DIGEST)
      .toString('hex');
    const a = Buffer.from(storedHash, 'hex');
    const b = Buffer.from(h, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

/**
 * Encrypt a secret with the machine-local vault key.
 * AES-256-GCM: 12-byte random IV, 16-byte auth tag.
 */
function createCrypter(vaultKey) {
  function encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plaintext), 'utf8'),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: encrypted.toString('hex'),
    };
  }

  function decrypt(bundle) {
    if (!bundle || !bundle.iv || !bundle.tag || !bundle.data) {
      throw new Error('Malformed ciphertext bundle');
    }
    const iv = Buffer.from(bundle.iv, 'hex');
    const tag = Buffer.from(bundle.tag, 'hex');
    const data = Buffer.from(bundle.data, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  return { encrypt, decrypt };
}

/**
 * Encrypt a backup with a user-supplied password.
 * PBKDF2-SHA256, 100k iterations, 32-byte derived key, AES-256-GCM.
 */
function encryptBackup(text, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, BACKUP_ITERATIONS, 32, BACKUP_DIGEST);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);

  return {
    mineEncrypted: true,
    version: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: encrypted.toString('hex'),
    exportedAt: new Date().toISOString(),
  };
}

function decryptBackup(bundle, password) {
  try {
    const salt = Buffer.from(bundle.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, BACKUP_ITERATIONS, 32, BACKUP_DIGEST);
    const iv = Buffer.from(bundle.iv, 'hex');
    const tag = Buffer.from(bundle.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(bundle.data, 'hex')),
      decipher.final(),
    ]);
    return { success: true, text: decrypted.toString('utf8') };
  } catch (_) {
    // Deliberately identical message for a wrong password and a corrupt file,
    // so the caller cannot use the error as a password oracle.
    return { success: false, error: 'Incorrect password or corrupted backup file' };
  }
}

module.exports = {
  HASH_ITERATIONS,
  hashPassword,
  verifyPassword,
  createCrypter,
  encryptBackup,
  decryptBackup,
};
