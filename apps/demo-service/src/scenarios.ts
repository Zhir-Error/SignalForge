export interface CheckoutOutcome {
  status: 200 | 503;
  code:
    | "CHECKOUT_READY"
    | "DATABASE_CONFIGURATION_MISSING"
    | "DATABASE_CONNECTION_FAILED";
  message: string;
}

export function evaluateCheckoutConfiguration(
  databaseUrl: string | undefined,
): CheckoutOutcome {
  if (!databaseUrl || databaseUrl.length > 2048) {
    return {
      status: 503,
      code: "DATABASE_CONFIGURATION_MISSING",
      message: "Database connection is not configured.",
    };
  }

  try {
    const url = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.pathname ||
      url.pathname === "/"
    ) {
      throw new Error("Invalid database URL");
    }
  } catch {
    return {
      status: 503,
      code: "DATABASE_CONFIGURATION_MISSING",
      message: "Database connection is not configured.",
    };
  }

  return {
    status: 200,
    code: "CHECKOUT_READY",
    message: "Database connection settings are available.",
  };
}
