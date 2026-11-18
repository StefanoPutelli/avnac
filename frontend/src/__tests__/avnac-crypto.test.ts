import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  createPasswordSlot,
  createSecretSlot,
  decryptJson,
  encryptJson,
  exportPublicKey,
  generateAdminKeyPair,
  generateDek,
  importPublicKey,
  openPasswordSlot,
  openSecretSlot,
  toNonExtractable,
  unwrapDekAsAdmin,
  unwrapPrivateKey,
  wrapDekForAdmin,
  wrapPrivateKey,
} from '../lib/avnac-crypto'

// Low iteration count keeps the test fast; production uses the default.
const ITER = 1000
const doc = { name: 'Poster', document: { v: 2, objects: [{ text: 'ciao' }] } }

async function roundTrips(dek: CryptoKey, other: CryptoKey) {
  const blob = await encryptJson(other, 'doc-1', doc)
  return JSON.stringify(await decryptJson(dek, 'doc-1', blob)) === JSON.stringify(doc)
}

describe('envelope encryption', () => {
  it('base64 handles large payloads', () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('opens the data key with the right password only', async () => {
    const dek = await generateDek()
    const slot = await createPasswordSlot(dek, 'correct horse', ITER)
    expect(await roundTrips(await openPasswordSlot(slot, 'correct horse'), dek)).toBe(true)
    await expect(openPasswordSlot(slot, 'wrong horse')).rejects.toThrow()
  })

  it('re-locking with a new password keeps the same data key', async () => {
    const dek = await generateDek()
    const blob = await encryptJson(dek, 'doc-1', doc)
    const opened = await openPasswordSlot(
      await createPasswordSlot(dek, 'old-pass', ITER),
      'old-pass',
    )
    const newSlot = await createPasswordSlot(opened, 'new-pass', ITER)
    const reopened = await openPasswordSlot(newSlot, 'new-pass')
    expect(await decryptJson(reopened, 'doc-1', blob)).toEqual(doc)
  })

  it('admin can recover a user data key; private key is locked by the admin data key', async () => {
    const adminDek = await generateDek()
    const pair = await generateAdminKeyPair()
    const lockedPrivate = await wrapPrivateKey(pair.privateKey, adminDek)
    const publicKey = await importPublicKey(await exportPublicKey(pair.publicKey))

    const userDek = await generateDek()
    const adminWrapped = await wrapDekForAdmin(userDek, publicKey)

    const adminPrivate = await unwrapPrivateKey(lockedPrivate, adminDek)
    expect(await roundTrips(await unwrapDekAsAdmin(adminWrapped, adminPrivate), userDek)).toBe(true)
    await expect(unwrapPrivateKey(lockedPrivate, await generateDek())).rejects.toThrow()
  })

  it('reset link secret opens the data key only with the right secret', async () => {
    const dek = await generateDek()
    const { secret, wrapped } = await createSecretSlot(dek)
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await roundTrips(await openSecretSlot(secret, wrapped), dek)).toBe(true)
    const other = await createSecretSlot(dek)
    await expect(openSecretSlot(other.secret, wrapped)).rejects.toThrow()
  })

  it('ciphertext is bound to its document id and key', async () => {
    const dek = await generateDek()
    const blob = await encryptJson(dek, 'doc-1', doc)
    expect(blob).not.toContain('ciao')
    await expect(decryptJson(dek, 'doc-2', blob)).rejects.toThrow()
    await expect(decryptJson(await generateDek(), 'doc-1', blob)).rejects.toThrow()
  })

  it('stored copy of the data key still decrypts but cannot be exported', async () => {
    const dek = await generateDek()
    const stored = await toNonExtractable(dek)
    expect(await roundTrips(stored, dek)).toBe(true)
    await expect(crypto.subtle.exportKey('raw', stored)).rejects.toThrow()
  })
})
