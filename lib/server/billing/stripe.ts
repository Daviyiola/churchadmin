import Stripe from "stripe";

let instance: Stripe | null = null;
export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Stripe billing is not configured.");
  instance ??= new Stripe(key, { apiVersion: "2025-08-27.basil", appInfo: { name: "Church Admin" } });
  return instance;
}

export function stripeTaxEnabled() {
  return process.env.STRIPE_TAX_ENABLED?.trim().toLowerCase() === "true";
}
