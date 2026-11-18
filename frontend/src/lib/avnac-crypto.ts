// Envelope encryption for files stored on the server. Everything runs in the browser:
// - each user has a random data key (DEK) that encrypts their documents;
// - the DEK is stored on the server only wrapped ("locked") by:
//   1. a key derived from the user's password (PBKDF2),
//   2. the admin's RSA public key, so an admin password reset doesn't lose data,
//   3. temporarily, a one-time secret carried in a reset link's #fragment.

const PBKDF2_ITERATIONS = 600_000
const DEK_USAGES: KeyUsage[] = ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 3072,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

export type PasswordSlot = { salt: string; iterations: number; passwordWrapped: string }

// --- encoding ---

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const toBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n))

/** iv (12 bytes) ‖ payload, base64. */
function pack(iv: Uint8Array, payload: ArrayBuffer): string {
  const out = new Uint8Array(iv.length + payload.byteLength)
  out.set(iv)
  out.set(new Uint8Array(payload), iv.length)
  return bytesToBase64(out)
}

function unpack(b64: string): { iv: Uint8Array<ArrayBuffer>; payload: Uint8Array<ArrayBuffer> } {
  const bytes = base64ToBytes(b64)
  return { iv: bytes.slice(0, 12), payload: bytes.slice(12) }
}

// --- data key ---

/** Extractable, so it can be wrapped into each slot. */
export function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, DEK_USAGES)
}

/** Copy for storage in the browser: usable, but its bytes can't be read back out. */
export async function toNonExtractable(dek: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.exportKey('raw', dek)
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, DEK_USAGES)
}

async function wrapWithAes(dek: CryptoKey, kek: CryptoKey): Promise<string> {
  const iv = randomBytes(12)
  return pack(iv, await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv }))
}

async function unwrapWithAes(blob: string, kek: CryptoKey): Promise<CryptoKey> {
  const { iv, payload } = unpack(blob)
  return crypto.subtle.unwrapKey(
    'raw',
    payload,
    kek,
    { name: 'AES-GCM', iv },
    'AES-GCM',
    true,
    DEK_USAGES,
  )
}

// --- slot 1: password ---

async function deriveKek(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

export async function createPasswordSlot(
  dek: CryptoKey,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<PasswordSlot> {
  const salt = randomBytes(16)
  const kek = await deriveKek(password, salt, iterations)
  return { salt: bytesToBase64(salt), iterations, passwordWrapped: await wrapWithAes(dek, kek) }
}

/** Throws if the password is wrong. */
export async function openPasswordSlot(slot: PasswordSlot, password: string): Promise<CryptoKey> {
  const kek = await deriveKek(password, base64ToBytes(slot.salt), slot.iterations)
  return unwrapWithAes(slot.passwordWrapped, kek)
}

// --- slot 2: admin ---

export function generateAdminKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(RSA_PARAMS, true, ['wrapKey', 'unwrapKey'])
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('spki', key)))
}

export function importPublicKey(spki: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64ToBytes(spki), RSA_PARAMS, false, ['wrapKey'])
}

/** The admin's private key, locked with the admin's own data key. */
export async function wrapPrivateKey(privateKey: CryptoKey, adminDek: CryptoKey): Promise<string> {
  const iv = randomBytes(12)
  return pack(
    iv,
    await crypto.subtle.wrapKey('pkcs8', privateKey, adminDek, { name: 'AES-GCM', iv }),
  )
}

export function unwrapPrivateKey(blob: string, adminDek: CryptoKey): Promise<CryptoKey> {
  const { iv, payload } = unpack(blob)
  return crypto.subtle.unwrapKey(
    'pkcs8',
    payload,
    adminDek,
    { name: 'AES-GCM', iv },
    RSA_PARAMS,
    false,
    ['unwrapKey'],
  )
}

export async function wrapDekForAdmin(dek: CryptoKey, adminPublic: CryptoKey): Promise<string> {
  return bytesToBase64(
    new Uint8Array(await crypto.subtle.wrapKey('raw', dek, adminPublic, { name: 'RSA-OAEP' })),
  )
}

export function unwrapDekAsAdmin(blob: string, adminPrivate: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    base64ToBytes(blob),
    adminPrivate,
    { name: 'RSA-OAEP' },
    'AES-GCM',
    true,
    DEK_USAGES,
  )
}

// --- slot 3: one-time secret in a reset link ---

export async function createSecretSlot(
  dek: CryptoKey,
): Promise<{ secret: string; wrapped: string }> {
  const raw = randomBytes(32)
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['wrapKey'])
  return { secret: toBase64Url(raw), wrapped: await wrapWithAes(dek, key) }
}

/** Throws if the secret doesn't match. */
export async function openSecretSlot(secret: string, wrapped: string): Promise<CryptoKey> {
  const key = await crypto.subtle.importKey('raw', base64ToBytes(secret), 'AES-GCM', false, [
    'unwrapKey',
  ])
  return unwrapWithAes(wrapped, key)
}

// --- documents ---

/** `aad` binds the ciphertext to its document id, so the server can't swap documents. */
export async function encryptJson(dek: CryptoKey, aad: string, value: unknown): Promise<string> {
  const iv = randomBytes(12)
  const data = new TextEncoder().encode(JSON.stringify(value))
  const additionalData = new TextEncoder().encode(aad)
  return pack(iv, await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, dek, data))
}

export async function decryptJson<T>(dek: CryptoKey, aad: string, blob: string): Promise<T> {
  const { iv, payload } = unpack(blob)
  const additionalData = new TextEncoder().encode(aad)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, dek, payload)
  return JSON.parse(new TextDecoder().decode(plain)) as T
}

// --- unlocked keys, kept in this browser between page loads ---

export type StoredKeys = { userId: string; dek: CryptoKey; adminPrivate?: CryptoKey }

const KEYS_DB = 'avnac-keys'
let keysCache: Promise<StoredKeys | null> | null = null

function keysStore<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const open = indexedDB.open(KEYS_DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('keys')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const req = op(db.transaction('keys', mode).objectStore('keys'))
      req.onsuccess = () => {
        db.close()
        resolve(req.result)
      }
      req.onerror = () => {
        db.close()
        reject(req.error)
      }
    }
  })
}

export function loadKeys(): Promise<StoredKeys | null> {
  keysCache ??= keysStore<StoredKeys | undefined>('readonly', s => s.get('current'))
    .then(k => k ?? null)
    .catch(() => null)
  return keysCache
}

export async function saveKeys(keys: StoredKeys): Promise<void> {
  await keysStore('readwrite', s => s.put(keys, 'current'))
  keysCache = Promise.resolve(keys)
}

export async function clearKeys(): Promise<void> {
  keysCache = Promise.resolve(null)
  await keysStore('readwrite', s => s.delete('current')).catch(() => {})
}
