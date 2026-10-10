/**
 * JustCall database schema (PostgreSQL, Drizzle ORM).
 *
 * Conventions
 * - All money values are stored as integer cents (CHF Rappen).
 * - Percentages are stored as basis points (1% = 100 bps).
 * - All timestamps are `timestamptz`; restaurant-local logic uses `restaurants.timezone`.
 * - Every table has row level security enabled with no policies. The app talks to the
 *   database with a privileged role (bypasses RLS), while Supabase's public REST API
 *   (anon/authenticated keys) can never read or write anything.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/*                                   Enums                                    */
/* -------------------------------------------------------------------------- */

export const platformRoleEnum = pgEnum("platform_role", ["admin", "member"]);
export const membershipRoleEnum = pgEnum("membership_role", ["owner", "staff"]);
export const restaurantStatusEnum = pgEnum("restaurant_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);
export const speechStyleEnum = pgEnum("speech_style", ["swiss_standard", "swiss_dialect"]);
export const callStatusEnum = pgEnum("call_status", [
  "ringing",
  "in_progress",
  "completed",
  "transferred",
  "failed",
]);
export const callOutcomeEnum = pgEnum("call_outcome", [
  "order_placed",
  "transferred_allergy",
  "transferred_owner",
  "transferred_other",
  "no_order",
  "closed",
  "paused",
  "error",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "new",
  "accepted",
  "ready",
  "completed",
  "cancelled",
]);
export const fulfillmentEnum = pgEnum("fulfillment_type", ["pickup", "delivery"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "sent", "paid", "void"]);

/* -------------------------------------------------------------------------- */
/*                         Authentication (better-auth)                       */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: platformRoleEnum("role").notNull().default("member"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS();

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
).enableRLS();

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
).enableRLS();

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                Restaurants                                 */
/* -------------------------------------------------------------------------- */

/** A single opening time range in restaurant-local time, e.g. { open: "11:00", close: "14:00" }.
 *  `close` may be smaller than `open` for ranges that run past midnight. */
export type TimeRange = { open: string; close: string };
/** Weekly schedule keyed by ISO weekday name. Missing/empty day = closed. */
export type WeeklyHours = Partial<Record<Weekday, TimeRange[]>>;
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
/** Exceptions such as public holidays or vacation. `ranges` empty = closed all day. */
export type HoursException = { date: string; ranges: TimeRange[]; note?: string };

export type PaymentMethod = "cash" | "card" | "twint";

export const restaurants = pgTable(
  "restaurants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: restaurantStatusEnum("status").notNull().default("draft"),

    // Contact & address
    legalName: text("legal_name"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    country: text("country").notNull().default("CH"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    /** The restaurant's own public phone number (the one customers dial and that is forwarded to us). */
    publicPhone: text("public_phone"),
    timezone: text("timezone").notNull().default("Europe/Zurich"),

    // Voice bot
    botName: text("bot_name").notNull().default("Lea"),
    speechStyle: speechStyleEnum("speech_style").notNull().default("swiss_standard"),
    greeting: text("greeting"),
    customInstructions: text("custom_instructions"),
    ttsProvider: text("tts_provider"),
    ttsVoice: text("tts_voice"),
    sttProvider: text("stt_provider"),
    llmModel: text("llm_model"),

    // Ordering
    acceptingOrders: boolean("accepting_orders").notNull().default(true),
    pickupEnabled: boolean("pickup_enabled").notNull().default(true),
    deliveryEnabled: boolean("delivery_enabled").notNull().default(false),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    deliveryMinOrderCents: integer("delivery_min_order_cents").notNull().default(0),
    deliveryPostalCodes: text("delivery_postal_codes").array().notNull().default(sql`'{}'::text[]`),
    prepTimeMinutes: integer("prep_time_minutes").notNull().default(20),
    deliveryTimeMinutes: integer("delivery_time_minutes").notNull().default(45),
    extraWaitMinutes: integer("extra_wait_minutes").notNull().default(0),
    allowPreorders: boolean("allow_preorders").notNull().default(true),
    maxItemQuantity: integer("max_item_quantity").notNull().default(20),
    openingHours: jsonb("opening_hours").$type<WeeklyHours>().notNull().default({}),
    hoursExceptions: jsonb("hours_exceptions").$type<HoursException[]>().notNull().default([]),

    // Payment
    paymentMethods: text("payment_methods")
      .array()
      .$type<PaymentMethod[]>()
      .notNull()
      .default(sql`'{cash,twint}'::text[]`),
    twintPaymentUrl: text("twint_payment_url"),
    paymentNote: text("payment_note"),

    // Safety & transfers
    allergyQuestionEnabled: boolean("allergy_question_enabled").notNull().default(true),
    transferPhone: text("transfer_phone"),
    transferOnAllergy: boolean("transfer_on_allergy").notNull().default(true),
    transferOnOwnerRequest: boolean("transfer_on_owner_request").notNull().default(true),

    // Notifications
    smsEnabled: boolean("sms_enabled").notNull().default(true),
    smsSenderName: text("sms_sender_name"),
    orderNotificationEmails: text("order_notification_emails")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // Billing
    commissionBps: integer("commission_bps").notNull().default(500),
    monthlyFeeCents: integer("monthly_fee_cents").notNull().default(0),
    perOrderFeeCents: integer("per_order_fee_cents").notNull().default(0),
    billingName: text("billing_name"),
    billingEmail: text("billing_email"),
    billingStreet: text("billing_street"),
    billingPostalCode: text("billing_postal_code"),
    billingCity: text("billing_city"),
    billingCountry: text("billing_country").notNull().default("CH"),
    billingStartsOn: date("billing_starts_on"),

    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("restaurants_status_idx").on(t.status)],
).enableRLS();

export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("staff"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.restaurantId] }),
    index("memberships_restaurant_idx").on(t.restaurantId),
  ],
).enableRLS();

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    platformRole: platformRoleEnum("platform_role").notNull().default("member"),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "cascade" }),
    membershipRole: membershipRoleEnum("membership_role"),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_email_idx").on(t.email)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                 Telephony                                  */
/* -------------------------------------------------------------------------- */

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** E.164 number that callers reach (the Twilio number). */
    e164: text("e164").notNull().unique(),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "set null" }),
    provider: text("provider").notNull().default("twilio"),
    providerSid: text("provider_sid"),
    label: text("label"),
    /** The restaurant's original number that is forwarded to this number (informational). */
    forwardedFrom: text("forwarded_from"),
    isActive: boolean("is_active").notNull().default(true),
    webhookConfiguredAt: timestamp("webhook_configured_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("phone_numbers_restaurant_idx").on(t.restaurantId)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                    Menu                                    */
/* -------------------------------------------------------------------------- */

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("menu_categories_restaurant_idx").on(t.restaurantId)],
).enableRLS();

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => menuCategories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Short menu code customers may use, e.g. "3" or "M3". */
    code: text("code"),
    /** Alternative names that refer to the same item, e.g. ["Combo 3", "Napoli", "Menü 3"]. */
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    priceCents: integer("price_cents").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Informational only. The bot never gives allergy advice; it transfers to staff. */
    allergens: text("allergens").array().notNull().default(sql`'{}'::text[]`),
    /** Temporarily sold out (staff toggle). */
    isAvailable: boolean("is_available").notNull().default(true),
    /** Soft delete / hidden from the bot. */
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("menu_items_restaurant_idx").on(t.restaurantId),
    index("menu_items_category_idx").on(t.categoryId),
  ],
).enableRLS();

export const optionGroups = pgTable(
  "option_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    /** e.g. "Grösse", "Extras", "Getränk", "Sauce" */
    name: text("name").notNull(),
    description: text("description"),
    /** min 1 = the caller must choose. */
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("option_groups_restaurant_idx").on(t.restaurantId)],
).enableRLS();

export const options = pgTable(
  "options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => optionGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    priceDeltaCents: integer("price_delta_cents").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("options_group_idx").on(t.groupId)],
).enableRLS();

export const menuItemOptionGroups = pgTable(
  "menu_item_option_groups",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => optionGroups.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.groupId] }),
    index("menu_item_option_groups_group_idx").on(t.groupId),
  ],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                   Calls                                    */
/* -------------------------------------------------------------------------- */

export type CallUsage = {
  llmInputTokens?: number;
  llmOutputTokens?: number;
  llmCachedTokens?: number;
  sttSeconds?: number;
  ttsCharacters?: number;
  turns?: number;
};

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "set null" }),
    phoneNumberId: uuid("phone_number_id").references(() => phoneNumbers.id, {
      onDelete: "set null",
    }),
    providerCallSid: text("provider_call_sid").unique(),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    status: callStatusEnum("status").notNull().default("ringing"),
    outcome: callOutcomeEnum("outcome"),
    transferReason: text("transfer_reason"),
    transferTarget: text("transfer_target"),
    isSimulation: boolean("is_simulation").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    llmProvider: text("llm_provider"),
    sttProvider: text("stt_provider"),
    ttsProvider: text("tts_provider"),
    usage: jsonb("usage").$type<CallUsage>().notNull().default({}),
    costEstimateCents: integer("cost_estimate_cents"),
    summary: text("summary"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("calls_restaurant_started_idx").on(t.restaurantId, t.startedAt),
    index("calls_status_idx").on(t.status),
  ],
).enableRLS();

export const callEvents = pgTable(
  "call_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** user | assistant | tool | system | event */
    kind: text("kind").notNull(),
    content: text("content"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("call_events_call_idx").on(t.callId, t.seq)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                   Orders                                   */
/* -------------------------------------------------------------------------- */

export type DeliveryAddress = {
  street: string;
  postalCode?: string;
  city?: string;
  notes?: string;
};

export type OrderItemOption = {
  groupName: string;
  optionName: string;
  optionId?: string;
  priceDeltaCents: number;
};

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    /** Restaurant-local business date the order number belongs to. */
    orderDate: date("order_date").notNull(),
    /** Sequential per restaurant and day, starting at 101. Spoken to the caller. */
    orderNumber: integer("order_number").notNull(),
    status: orderStatusEnum("status").notNull().default("new"),
    fulfillment: fulfillmentEnum("fulfillment").notNull().default("pickup"),
    /** null = as soon as possible */
    requestedFor: timestamp("requested_for", { withTimezone: true }),
    estimatedReadyAt: timestamp("estimated_ready_at", { withTimezone: true }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    deliveryAddress: jsonb("delivery_address").$type<DeliveryAddress>(),
    paymentMethod: text("payment_method"),
    notes: text("notes"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("CHF"),
    /** Counts towards the monthly commission. False for test/simulated or voided orders. */
    isBillable: boolean("is_billable").notNull().default(true),
    isTest: boolean("is_test").notNull().default(false),
    cancelledReason: text("cancelled_reason"),
    smsStatus: text("sms_status"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_restaurant_date_number_uq").on(t.restaurantId, t.orderDate, t.orderNumber),
    index("orders_restaurant_created_idx").on(t.restaurantId, t.createdAt),
    index("orders_status_idx").on(t.status),
  ],
).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    menuItemId: uuid("menu_item_id").references(() => menuItems.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    options: jsonb("options").$type<OrderItemOption[]>().notNull().default([]),
    notes: text("notes"),
    lineTotalCents: integer("line_total_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
).enableRLS();

export const orderCounters = pgTable(
  "order_counters",
  {
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    orderDate: date("order_date").notNull(),
    lastNumber: integer("last_number").notNull(),
  },
  (t) => [primaryKey({ columns: [t.restaurantId, t.orderDate] })],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                  Billing                                   */
/* -------------------------------------------------------------------------- */

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    number: text("number").notNull().unique(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    currency: text("currency").notNull().default("CHF"),
    orderCount: integer("order_count").notNull().default(0),
    orderVolumeCents: integer("order_volume_cents").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull(),
    vatRateBps: integer("vat_rate_bps").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    /** Snapshot of the bill-to address at issue time. */
    billTo: jsonb("bill_to")
      .$type<{
        name: string;
        street?: string | null;
        postalCode?: string | null;
        city?: string | null;
        country?: string | null;
        email?: string | null;
      }>()
      .notNull(),
    /** Structured payment reference (SCOR / RF creditor reference). */
    paymentReference: text("payment_reference"),
    notes: text("notes"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invoices_restaurant_idx").on(t.restaurantId, t.periodStart),
    uniqueIndex("invoices_restaurant_period_active_uq")
      .on(t.restaurantId, t.periodStart)
      .where(sql`status <> 'void'`),
  ],
).enableRLS();

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId)],
).enableRLS();

export const invoiceCounters = pgTable("invoice_counters", {
  year: integer("year").primaryKey(),
  lastNumber: integer("last_number").notNull(),
}).enableRLS();

/** Single-row table (id = 1) with the operator's company details used on invoices. */
export const platformSettings = pgTable("platform_settings", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name").notNull().default("JustCall"),
  street: text("street"),
  postalCode: text("postal_code"),
  city: text("city"),
  country: text("country").notNull().default("CH"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  vatNumber: text("vat_number"),
  /** 0 when not VAT registered. Swiss standard rate: 810 bps (8.1 %). */
  vatRateBps: integer("vat_rate_bps").notNull().default(0),
  iban: text("iban"),
  invoicePrefix: text("invoice_prefix").notNull().default("JC"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  invoiceFooter: text("invoice_footer"),
  defaultCommissionBps: integer("default_commission_bps").notNull().default(500),
  defaultMonthlyFeeCents: integer("default_monthly_fee_cents").notNull().default(0),
  updatedAt: updatedAt(),
}).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                   Audit                                    */
/* -------------------------------------------------------------------------- */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)],
).enableRLS();

/** Used to make background jobs idempotent across multiple server instances. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    runKey: text("run_key").notNull(),
    status: text("status").notNull().default("running"),
    result: jsonb("result"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("job_runs_job_key_uq").on(t.job, t.runKey)],
).enableRLS();

/* -------------------------------------------------------------------------- */
/*                                Inferred types                              */
/* -------------------------------------------------------------------------- */

export type User = typeof user.$inferSelect;
export type Restaurant = typeof restaurants.$inferSelect;
export type NewRestaurant = typeof restaurants.$inferInsert;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type MenuCategory = typeof menuCategories.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type OptionGroup = typeof optionGroups.$inferSelect;
export type Option = typeof options.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type CallEvent = typeof callEvents.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
