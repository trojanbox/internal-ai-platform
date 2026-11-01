import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 3
const KEY_LENGTH = 64
const MAX_MEMORY = 128 * 1024 * 1024
const DUMMY_SALT = Buffer.from('8ec8b7df7856dc7d06ee808a1db331fa', 'hex')

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    )
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derivePassword(password, salt)
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltValue, hashValue] = encoded.split('$')
  if (!algorithm || !n || !r || !p || !saltValue || !hashValue || algorithm !== 'scrypt')
    return false
  if (Number(n) !== SCRYPT_N || Number(r) !== SCRYPT_R || Number(p) !== SCRYPT_P) return false

  const expected = Buffer.from(hashValue, 'base64url')
  const actual = await derivePassword(password, Buffer.from(saltValue, 'base64url'))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function runDummyPasswordDerivation(password: string): Promise<void> {
  await derivePassword(password, DUMMY_SALT)
}

export function randomOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
