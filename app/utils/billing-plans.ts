export const WHISPER_PLAN = "Whisper";
export const SIGNAL_PLAN = "Signal";
export const BILLING_PLAN_NAMES = [WHISPER_PLAN, SIGNAL_PLAN] as const;

export type BillingPlanCode =
  | "FREE"
  | "WHISPER"
  | "SIGNAL"
  | "STARTER"
  | "GROWTH"
  | "PRO";

export type BillingLimits = {
  storeSnapshots: number;
  normalSnapshots: number;
  maxSnapshotTargetVisitors: number;
  abTests: number;
};

export const PLAN_LIMITS: Record<BillingPlanCode, BillingLimits> = {
  FREE: {
    storeSnapshots: 1,
    normalSnapshots: 3,
    maxSnapshotTargetVisitors: 1000,
    abTests: 0,
  },
  WHISPER: {
    storeSnapshots: 5,
    normalSnapshots: 50,
    maxSnapshotTargetVisitors: 5000,
    abTests: 5,
  },
  SIGNAL: {
    storeSnapshots: 20,
    normalSnapshots: 250,
    maxSnapshotTargetVisitors: 25000,
    abTests: 25,
  },
  STARTER: {
    storeSnapshots: 10,
    normalSnapshots: 100,
    maxSnapshotTargetVisitors: 10000,
    abTests: 25,
  },
  GROWTH: {
    storeSnapshots: 50,
    normalSnapshots: 500,
    maxSnapshotTargetVisitors: 50000,
    abTests: 100,
  },
  PRO: {
    storeSnapshots: 1000000,
    normalSnapshots: 1000000,
    maxSnapshotTargetVisitors: 1000000,
    abTests: 1000000,
  },
};

export const PLAN_DISPLAY_NAMES: Record<BillingPlanCode, string> = {
  FREE: "Free",
  WHISPER: "Whisper",
  SIGNAL: "Signal",
  STARTER: "Starter",
  GROWTH: "Growth",
  PRO: "Pro",
};

export const SHOPIFY_PLAN_TO_BILLING_PLAN: Record<string, BillingPlanCode> = {
  [WHISPER_PLAN]: "WHISPER",
  [SIGNAL_PLAN]: "SIGNAL",
  whisper: "WHISPER",
  signal: "SIGNAL",
};
