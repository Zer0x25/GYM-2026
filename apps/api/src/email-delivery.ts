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
