/** No runtime adapter is wired. Tests inject an in-memory fictional inbox. */
export type EmailDelivery = (message: {
  to: string;
  purpose: "password-reset" | "contact-verification";
  url: string;
}) => Promise<void>;

export function accountLink(origin: string, path: string, token: string): string {
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("Invalid account application origin");
  }
  return `${base.origin}${path}#${encodeURIComponent(token)}`;
}

export function createEmailDeliveryFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmailDelivery | undefined {
  const mode = env.EMAIL_DELIVERY_MODE?.toLowerCase().trim();
  if (!mode || mode === "disabled") return undefined;
  if (mode !== "http" && mode !== "webhook") return undefined;
  const transportUrl = env.EMAIL_TRANSPORT_URL?.trim() || env.EMAIL_WEBHOOK_URL?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!transportUrl || !from) return undefined;

  return async (message) => {
    try {
      const res = await fetch(transportUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to: message.to,
          purpose: message.purpose,
          url: message.url,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new Error("Email delivery failed");
      }
    } catch {
      // Never expose token or full URL in error or logs
      throw new Error("Email delivery failed");
    }
  };
}

