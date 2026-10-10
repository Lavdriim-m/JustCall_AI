import type { CartLine } from "../cart";
import type { HoursException, WeeklyHours } from "../hours";
import type { MenuSnapshot } from "../menu/types";

export type PaymentMethod = "cash" | "card" | "twint";
export type SpeechStyle = "swiss_standard" | "swiss_dialect";
export type FulfillmentType = "pickup" | "delivery";
export type TransferReason =
  "allergy" | "owner_request" | "complaint" | "large_order" | "technical" | "other";

/** Everything the conversation engine needs to know about a restaurant. */
export type RestaurantProfile = {
  id: string;
  name: string;
  botName: string;
  speechStyle: SpeechStyle;
  greeting?: string | null;
  customInstructions?: string | null;
  timezone: string;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  publicPhone?: string | null;

  acceptingOrders: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  deliveryMinOrderCents: number;
  deliveryPostalCodes: string[];
  prepTimeMinutes: number;
  deliveryTimeMinutes: number;
  extraWaitMinutes: number;
  allowPreorders: boolean;
  maxItemQuantity: number;
  openingHours: WeeklyHours;
  hoursExceptions: HoursException[];

  paymentMethods: PaymentMethod[];
  twintPaymentUrl?: string | null;
  paymentNote?: string | null;

  allergyQuestionEnabled: boolean;
  transferPhone?: string | null;
  transferOnAllergy: boolean;
  transferOnOwnerRequest: boolean;
  smsEnabled: boolean;
};

export type DeliveryAddressInput = {
  street: string;
  postalCode?: string;
  city?: string;
  notes?: string;
};

/** Order as handed to the persistence layer when the caller confirmed it. */
export type OrderDraft = {
  restaurantId: string;
  lines: (CartLine & { unitPriceCents: number; lineTotalCents: number })[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  fulfillment: FulfillmentType;
  requestedFor: Date | null;
  estimatedReadyAt: Date;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: DeliveryAddressInput | null;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
};

export type PlacedOrder = {
  orderId: string;
  orderNumber: number;
  smsStatus: "sent" | "skipped" | "failed";
};

/** Side effects the engine needs from its host (voice server, simulator, tests). */
export interface ConversationHooks {
  placeOrder(draft: OrderDraft): Promise<PlacedOrder>;
  now?(): Date;
}

export type EngineEvent =
  | { type: "say"; text: string }
  | { type: "transfer"; reason: TransferReason; target: string | null; note?: string }
  | { type: "hangup"; reason: string }
  | { type: "order_placed"; order: PlacedOrder; draft: OrderDraft }
  | { type: "tool"; name: string; arguments: Record<string, unknown>; result: unknown }
  | { type: "error"; message: string };

export type ConversationPhase = "active" | "transferring" | "ending" | "ended";

export type CallerInfo = {
  /** Caller ID in E.164, null when withheld. */
  phone: string | null;
};
