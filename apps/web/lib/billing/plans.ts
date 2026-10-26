/**
 * Hosted plan model + entitlements.
 *
 * Self-host is never crippled: billing is OFF by default
 * (HOSTED_BILLING_ENABLED unset) — no metering, every feature unlocked. We
 * monetize hosting and heavy usage, not the open core.
 */

export type PlanTier = "free" | "cloud" | "enterprise";

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  blurb: string;
  /** Included monthly SMS before metered overage. null = unlimited/custom. */
  includedSmsPerMonth: number | null;
  /** Included monthly AI agent runs before metered overage. null = unlimited/custom. */
  includedAiRunsPerMonth: number | null;
  /** Whether this tier is self-serve purchasable (vs. contact sales). */
  selfServe: boolean;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  free: {
    // Self-host gets the ungated app via billingEnforced() === false, NOT via
    // this definition. On hosted, `free` is also the lapsed/unpaid fallback
    // tier — so its allowances must be empty to gate non-payers.
    tier: "free",
    name: "Free（自托管）",
    blurb: "在自己的基础设施上自托管 OpenVPM，永久免费，没有锁定。",
    includedSmsPerMonth: 0,
    includedAiRunsPerMonth: 0,
    selfServe: true,
  },
  cloud: {
    tier: "cloud",
    name: "Cloud",
    blurb:
      "托管版：AI 助手、短信、报表、API 与 Webhook。每月含 1000 条短信与 1000 次 AI 运行，超出按量计费。",
    includedSmsPerMonth: 1000,
    includedAiRunsPerMonth: 1000,
    selfServe: true,
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    blurb: "专属或区域内实例、合规支持、协助迁移与优先支持，联系销售。",
    includedSmsPerMonth: null,
    includedAiRunsPerMonth: null,
    selfServe: false,
  },
};

export const PLAN_ORDER: PlanTier[] = ["free", "cloud", "enterprise"];

export function getPlan(tier?: string | null): PlanDefinition {
  const t = tier ?? "free";
  return PLANS[t as PlanTier] ?? PLANS.free;
}

/** Whether hosted billing is enforced (i.e. we're the managed service). */
export function billingEnforced(): boolean {
  return process.env.HOSTED_BILLING_ENABLED?.trim().toLowerCase() === "true";
}

/** Whether a practice is in an unexpired trial window. */
export function isTrialActive(
  billingStatus: string | null | undefined,
  trialEndsAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (billingStatus !== "trialing" || !trialEndsAt) return false;
  return new Date(trialEndsAt).getTime() > now.getTime();
}

/**
 * Hosted write access: active trial, or a paid/custom subscription that is
 * active (or in the retrying past_due state). Self-host always passes.
 * `enforced` is injectable for testing.
 */
export function hasHostedFullAccess(
  tier: string | null | undefined,
  billingStatus: string | null | undefined,
  trialEndsAt: Date | string | null | undefined,
  now: Date = new Date(),
  enforced: boolean = billingEnforced(),
): boolean {
  if (!enforced) return true;
  if (isTrialActive(billingStatus, trialEndsAt, now)) return true;
  if (billingStatus !== "active" && billingStatus !== "past_due") return false;
  return getPlan(tier).tier !== "free";
}
