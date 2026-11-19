import { Elysia, t } from 'elysia'
import { proxyImage } from '../lib/image-proxy'

export const mediaRoutes = new Elysia({ prefix: '/media' }).get(
  '/proxy',
  ({ query }) => proxyImage(query.url),
  {
    query: t.Object({
      url: t.String({ minLength: 1, maxLength: 8192 }),
    }),
  },
)
