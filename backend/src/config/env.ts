import { z } from 'zod'

import { getRuntimeEnv } from './runtime-env'

const optionalNonEmptyString = z.preprocess(
  value => (typeof value === 'string' && !value.trim() ? undefined : value),
  z.string().min(1).optional(),
)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  BETTER_AUTH_SECRET: z.string().min(1, 'BETTER_AUTH_SECRET is required'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3001'),
  CORS_ORIGIN: z.string().default('http://localhost:3300'),
  /** Account promoted to admin on boot; created with ADMIN_PASSWORD if it doesn't exist. */
  ADMIN_EMAIL: z.preprocess(
    value => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value),
    z.email().optional(),
  ),
  ADMIN_PASSWORD: z.preprocess(
    value => (typeof value === 'string' && !value.trim() ? undefined : value),
    z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').optional(),
  ),
  UNSPLASH_ACCESS_KEY: optionalNonEmptyString,
  PAYSTACK_SECRET_KEY: optionalNonEmptyString,
  PAYSTACK_CURRENCY: z
    .string()
    .trim()
    .length(3, 'PAYSTACK_CURRENCY must be a 3-letter code')
    .transform(value => value.toUpperCase())
    .default('NGN'),
  PAYSTACK_ALLOWED_CURRENCIES: z
    .string()
    .trim()
    .default('')
    .transform(value =>
      Array.from(
        new Set(
          value
            .split(',')
            .map(currency => currency.trim().toUpperCase())
            .filter(currency => /^[A-Z]{3}$/.test(currency)),
        ),
      ),
    )
    .transform(currencies => (currencies.length > 0 ? currencies : ['NGN'])),
})

export const env = envSchema.parse(getRuntimeEnv())

export type Env = typeof env

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map(s => s.trim())
  .filter(Boolean)
