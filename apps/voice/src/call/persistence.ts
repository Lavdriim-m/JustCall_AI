import {
  canReceiveSms,
  type OrderDraft,
  type PlacedOrder,
  type RestaurantProfile,
} from "@justcall/core";
import {
  appendCallEvents,
  createOrder,
  eq,
  orders,
  updateCall,
  type CallEventInput,
  type Database,
  type Restaurant,
} from "@justcall/db";
import {
  composeOrderSms,
  isTwilioConfigured,
  notifyRestaurantByEmail,
  sendSms,
} from "@justcall/services";
import type { Logger } from "../logger";

export type PersistenceOptions = {
  db: Database;
  logger: Logger;
  callId: string;
  restaurant: Restaurant;
  profile: RestaurantProfile;
  isSimulation: boolean;
  appUrl: string;
  /** Called with the SMS text (simulator shows it instead of sending). */
  onSmsPreview?: (text: string) => void;
};

/** Writes the transcript in small batches and handles order side effects (DB, SMS, email). */
export class CallPersistence {
  private buffer: CallEventInput[] = [];
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();
  orderId: string | null = null;

  constructor(private readonly opts: PersistenceOptions) {}

  event(kind: CallEventInput["kind"], content: string | null, data?: unknown) {
    this.buffer.push({ kind, content, data, at: new Date() });
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 1500);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.buffer;
    this.buffer = [];
    if (!batch.length) return this.flushing;
    const start = this.seq;
    this.seq += batch.length;
    this.flushing = this.flushing
      .then(() => appendCallEvents(this.opts.db, this.opts.callId, batch, start))
      .catch((err) => this.opts.logger.error({ err }, "failed to persist call events"));
    return this.flushing;
  }

  async placeOrder(draft: OrderDraft): Promise<PlacedOrder> {
    const { db, restaurant, profile, isSimulation, logger } = this.opts;
    const order = await createOrder(db, {
      draft,
      timezone: profile.timezone,
      callId: this.opts.callId,
      isTest: isSimulation,
    });
    this.orderId = order.id;
    await updateCall(db, this.opts.callId, { outcome: "order_placed" });

    // Confirmation SMS to the caller
    let smsStatus: PlacedOrder["smsStatus"] = "skipped";
    const smsText = composeOrderSms({
      restaurantName: restaurant.name,
      restaurantAddress: [restaurant.street, restaurant.city].filter(Boolean).join(", ") || null,
      orderNumber: order.orderNumber,
      customerName: draft.customerName,
      fulfillment: draft.fulfillment,
      estimatedReadyAt: draft.estimatedReadyAt,
      timezone: profile.timezone,
      totalCents: draft.totalCents,
      lines: draft.lines,
      paymentMethod: draft.paymentMethod,
      paymentMethods: profile.paymentMethods,
      twintPaymentUrl: restaurant.twintPaymentUrl,
      paymentNote: restaurant.paymentNote,
    });
    if (isSimulation) {
      this.opts.onSmsPreview?.(smsText);
    } else if (
      profile.smsEnabled &&
      draft.customerPhone &&
      canReceiveSms(draft.customerPhone) &&
      isTwilioConfigured()
    ) {
      try {
        await sendSms(draft.customerPhone, smsText, restaurant.smsSenderName);
        smsStatus = "sent";
      } catch (err) {
        smsStatus = "failed";
        logger.warn({ err }, "order SMS failed");
      }
    }
    await db.update(orders).set({ smsStatus }).where(eq(orders.id, order.id));

    // Optional email notification to the restaurant (best effort, not awaited by the caller)
    if (!isSimulation && restaurant.orderNotificationEmails.length) {
      void notifyRestaurantByEmail(restaurant, order, draft.lines, this.opts.appUrl).catch((err) =>
        logger.warn({ err }, "order email notification failed"),
      );
    }
    this.event("event", `Bestellung Nr. ${order.orderNumber} erstellt`, {
      orderId: order.id,
      smsStatus,
      sms: smsText,
    });
    return { orderId: order.id, orderNumber: order.orderNumber, smsStatus };
  }
}
