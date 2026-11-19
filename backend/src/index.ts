import './load-env'

import { cors } from '@elysiajs/cors'
import { node } from '@elysiajs/node'
import { Elysia } from 'elysia'
import { auth, ensureAdmin } from './auth'
import { corsOrigins, env } from './config/env'
import { migrate, sql } from './db'
import { HttpError } from './lib/http'
import { authPlugin } from './plugins/auth'
import { documentsRoutes } from './routes/documents'
import { keysRoutes } from './routes/keys'
import { mediaRoutes } from './routes/media'
import { sponsorRoutes } from './routes/sponsor'
import { unsplashRoutes } from './routes/unsplash'

await migrate()
await ensureAdmin()

const app = new Elysia({ adapter: node() })
  .use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  )
  .use(authPlugin)
  .onError(({ code, error, set }) => {
    if (error instanceof HttpError) {
      set.status = error.status
      return {
        error: error.message,
        details: error.details ?? null,
      }
    }

    if (code === 'VALIDATION') {
      set.status = 400
      return {
        error: 'Invalid request payload',
        details: error.message,
      }
    }

    console.error(error)
    set.status = 500
    return {
      error: 'Internal server error',
    }
  })
  .get('/', () => ({
    name: 'avnac-backend',
    status: 'ok',
  }))
  .get('/health', async () => {
    await sql`select 1`
    return {
      status: 'ok',
      database: 'reachable',
    }
  })
  .get('/session', async ({ request }) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    return {
      data: session,
    }
  })
  .use(documentsRoutes)
  .use(keysRoutes)
  .use(mediaRoutes)
  .use(sponsorRoutes)
  .use(unsplashRoutes)
  .listen({ port: env.PORT, hostname: env.LISTEN_HOST })

console.log(`Avnac backend running at ${app.server?.hostname}:${app.server?.port}`)
