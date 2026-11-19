import { lookup } from 'node:dns'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { HttpError } from './http'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 4
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
const blockedV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blockedV4.addSubnet(network, prefix, 'ipv4')

const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const blockedV6 = new BlockList()
blockedV6.addSubnet('2001::', 23, 'ipv6') // Special-purpose ranges, including Teredo.
blockedV6.addSubnet('2001:db8::', 32, 'ipv6')
blockedV6.addSubnet('2002::', 16, 'ipv6') // 6to4 embeds an IPv4 destination.
blockedV6.addSubnet('3fff::', 20, 'ipv6')

export function isPublicImageAddress(address: string): boolean {
  if (isIP(address) === 4) return !blockedV4.check(address, 'ipv4')
  // Only native global unicast; excludes mapped IPv4, NAT64, local and multicast addresses.
  return isIP(address) === 6 && globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6')
}

export function assertAllowedImageUrl(target: URL): void {
  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    (target.port && target.port !== '80' && target.port !== '443') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    (isIP(host) !== 0 && !isPublicImageAddress(host))
  ) {
    throw new HttpError(400, 'This image URL is not allowed.')
  }
}

/** Validate DNS inside the socket lookup: the connection uses the checked address,
 * without a second resolution that could allow DNS rebinding. */
export function createImageLookup(resolve: typeof lookup = lookup): LookupFunction {
  return (hostname, _options, callback) => {
    resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error, '', 4)
      if (!addresses.length || addresses.some(({ address }) => !isPublicImageAddress(address))) {
        return callback(new HttpError(400, 'This image host is not allowed.'), '', 4)
      }
      const { address, family } = addresses[0]
      callback(null, address, family)
    })
  }
}

function imageType(response: IncomingMessage): string {
  const type = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!IMAGE_TYPES.has(type)) {
    throw new HttpError(415, 'Only PNG, JPEG, GIF, WebP and AVIF images are supported.')
  }
  return type
}

function matchesImageType(body: Buffer, type: string): boolean {
  switch (type) {
    case 'image/png':
      return body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    case 'image/jpeg':
      return body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].includes(body.toString('ascii', 0, 6))
    case 'image/webp':
      return body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP'
    case 'image/avif': {
      if (body.toString('ascii', 4, 8) !== 'ftyp') return false
      const size = body.readUInt32BE(0)
      if (size < 16 || size > body.length || size % 4 !== 0) return false
      for (let i = 8; i < size; i += 4) {
        if (i !== 12 && ['avif', 'avis'].includes(body.toString('ascii', i, i + 4))) return true
      }
      return false
    }
    default:
      return false
  }
}

type ImageHop = { location: string } | { body: Buffer; contentType: string }

function requestImage(target: URL, signal: AbortSignal): Promise<ImageHop> {
  assertAllowedImageUrl(target)
  return new Promise((resolve, reject) => {
    const request = target.protocol === 'https:' ? https.request : http.request
    const options = {
      method: 'GET',
      agent: false,
      // Keep hostname for Host/TLS verification; pin only the socket's destination.
      lookup: createImageLookup(),
      autoSelectFamily: false,
      signal,
      headers: { Accept: [...IMAGE_TYPES].join(', '), 'Accept-Encoding': 'identity' },
    }
    const req = request(target, options, response => {
      void (async () => {
        try {
          const status = response.statusCode ?? 502
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location
            if (!location) throw new HttpError(502, 'Image redirect was missing a location.')
            resolve({ location })
            return
          }
          if (status < 200 || status >= 300) {
            throw new HttpError(502, `Image fetch failed (${status}).`)
          }
          const contentType = imageType(response)
          const encoding = response.headers['content-encoding']
          if (encoding && encoding.toLowerCase() !== 'identity') {
            throw new HttpError(415, 'Compressed image responses are not supported.')
          }
          if (Number(response.headers['content-length']) > MAX_IMAGE_BYTES) {
            throw new HttpError(413, 'Image exceeds the 10 MiB limit.')
          }
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of response) {
            size += chunk.length
            if (size > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image exceeds the 10 MiB limit.')
            chunks.push(chunk)
          }
          const body = Buffer.concat(chunks)
          if (!matchesImageType(body, contentType)) {
            throw new HttpError(415, 'Image contents do not match the declared format.')
          }
          resolve({ body, contentType })
        } catch (error) {
          reject(error)
        } finally {
          response.destroy()
        }
      })()
    })
    req.on('error', reject)
    req.end()
  })
}

export async function proxyImage(rawUrl: string): Promise<Response> {
  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    throw new HttpError(400, 'Invalid image URL.')
  }
  // One deadline covers DNS, connections, redirects and the streamed response body.
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const result = await requestImage(target, signal)
      if ('location' in result) {
        try {
          target = new URL(result.location, target)
        } catch {
          throw new HttpError(502, 'Image redirect was invalid.')
        }
        continue
      }
      return new Response(new Uint8Array(result.body), {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-type': result.contentType,
          'x-content-type-options': 'nosniff',
          // Defense in depth if a decoder ever accepts active content as an image.
          'content-security-policy': "sandbox; default-src 'none'",
        },
      })
    }
    throw new HttpError(502, 'Too many image redirects.')
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(signal.aborted ? 504 : 502, 'Could not fetch image.')
  }
}
