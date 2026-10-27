import { betterAuth } from "better-auth";
import type { Pool } from "pg";

export interface AuthConfiguration {
  secret: string;
  apiBaseUrl: string;
  appBaseUrl: string;
  production: boolean;
}

export function createAuth(pool: Pool, configuration: AuthConfiguration) {
  return betterAuth({
    appName: "SignalForge",
    database: pool,
    secret: configuration.secret,
    baseURL: configuration.apiBaseUrl,
    trustedOrigins: [configuration.appBaseUrl],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-signalforge-client-ip"] },
      useSecureCookies: configuration.production,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: configuration.production,
        sameSite: "lax",
        path: "/",
      },
    },
    rateLimit: { enabled: true, window: 60, max: 30 },
  });
}

export type SignalForgeAuth = ReturnType<typeof createAuth>;
