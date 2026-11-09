export type MembershipCardStatus = 'IN_STOCK' | 'ACTIVE' | 'BLOCKED';
/** A card's status for display: ACTIVE past its date reads EXPIRED. */
export type MembershipCardState = MembershipCardStatus | 'EXPIRED';
export type MembershipRuleKind = 'EXCLUDE' | 'SPECIAL';

export interface MembershipPlanRule {
  id: string;
  menuItemId: string | null;
  categoryId: string | null;
  kind: MembershipRuleKind;
  type: 'FLAT' | 'PERCENTAGE' | null;
  /** Paisa per unit for FLAT, percentage for PERCENTAGE. */
  value: number | null;
  menuItem?: { id: string; name: string } | null;
  category?: { id: string; name: string } | null;
}

export interface MembershipPlan {
  id: string;
  name: string;
  discountPercent: number;
  validityMonths: number;
  isActive: boolean;
  rules: MembershipPlanRule[];
}

export interface MembershipPlanRuleInput {
  menuItemId?: string | null;
  categoryId?: string | null;
  kind: MembershipRuleKind;
  type?: 'FLAT' | 'PERCENTAGE' | null;
  value?: number | null;
}

export interface MembershipCard {
  id: string;
  serial: number;
  /** 16 digits, no spaces. */
  number: string;
  /** "3287 0001 4829 1736" */
  formattedNumber: string;
  status: MembershipCardStatus;
  state: MembershipCardState;
  batchLabel: string | null;
  planName: string;
  customer: { id: string; name: string; phone: string } | null;
  activatedAt: string | null;
  activatedByName: string | null;
  expiresAt: string | null;
  blockedReason: string | null;
  visits: number;
  /** Paisa. */
  totalDiscount: number;
}

/** Shown to the cashier so they can check the card is the guest's own. */
export interface MembershipMemberInfo {
  name: string;
  maskedPhone: string;
  maskedNumber: string;
  planName: string;
  expiresAt: string;
}
