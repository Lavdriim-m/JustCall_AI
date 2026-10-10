# Conversation design – rules and prompts

This document describes how the phone assistant behaves and _why_. The source of truth for the
wording is [`packages/core/src/conversation/prompts.ts`](../packages/core/src/conversation/prompts.ts)
(prompts) and [`engine.ts`](../packages/core/src/conversation/engine.ts) (rules enforced in code).

## Principle: the AI talks, the server decides

The language model is good at understanding messy Swiss German speech and at sounding natural. It is
**not** trusted with anything that costs money or safety. Therefore:

| Concern                                                  | Who decides                 | How                                                                                           |
| -------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| Which menu item was meant ("Combo 3" = "Pizza Napoli")   | Server                      | Alias/code/fuzzy matcher (`menu-index.ts`); ambiguous → the AI must ask                       |
| Prices, option surcharges, totals, delivery fee          | Server                      | `cart.ts`; the AI only reads results                                                          |
| Required choices (size, sauce, drink)                    | Server                      | `add_items` returns `needs_choice` until answered                                             |
| Sold-out items                                           | Server                      | Staff toggle; the item cannot be added                                                        |
| Opening hours, earliest pickup/delivery time, pre-orders | Server                      | `hours.ts`, `set_fulfillment` validates                                                       |
| Delivery area and minimum order                          | Server                      | `set_fulfillment`, `review_order`, `confirm_order`                                            |
| Allergy → transfer                                       | **Server first**, AI second | Deterministic detector on every utterance _before_ the AI (`safety.ts`)                       |
| Explicit "I want the owner" → transfer                   | Server first, AI second     | Deterministic detector + `transfer_to_staff` tool                                             |
| Order only after read-back and explicit "yes"            | Server                      | `confirm_order` refuses unless `review_order` ran after the last change and the caller agreed |
| Order number, SMS, persistence                           | Server                      | `placeOrder` hook (daily sequence 101, 102, …)                                                |

## Call flow

1. **Greeting** (fixed text, no AI → instant, cacheable audio):
   "Grüezi und herzlich willkommen bei _{Restaurant}_. Sie sprechen mit _Lea_, der digitalen
   Bestellassistentin. Was darf ich für Sie notieren?" – customisable per restaurant. When closed:
   announces the next opening and offers a pre-order (if enabled). When paused: the call is forwarded to
   the transfer number directly.
2. **Ordering**: every mentioned item is added immediately (`add_items`) and **read back** without prices,
   followed by "Darf es sonst noch etwas sein?".
3. **Allergy question** – asked once, right after the first item: "Kurze Frage vorab: Hat jemand eine
   Lebensmittelallergie oder eine Unverträglichkeit?" Any allergy → transfer (see below).
4. **Required options** are asked for when missing ("Welche Sauce möchten Sie: Knoblauch, Cocktail …?").
   Defaults (e.g. size _Normal_) are applied silently.
5. **When the caller is done**: pickup or delivery (if both offered), time (_as soon as possible_ or a
   requested time – validated against opening hours and preparation time incl. rush-hour extra time),
   delivery address.
6. **Name** (spelling requested if unclear) and, if the caller ID is withheld, optionally a mobile
   number for the SMS.
7. **Payment method** if the restaurant offers several (cash / card / TWINT).
8. **Summary** (`review_order`): all items, total, time and name – "Stimmt das so?"
9. **Confirmation** only after an explicit yes → order is stored, appears on the restaurant's board,
   SMS is sent ("Bestellung Nr. 104 bestätigt … Total CHF 41.50 … Bezahlung: mit TWINT … TWINT: <link>").
10. **Goodbye** with order number, time and payment; the assistant hangs up.

## Safety rules (non-negotiable)

- **Allergies / intolerances**: if a caller _even remotely_ mentions allergies, intolerances, coeliac
  disease, "glutenfrei", "laktosefrei", "ohne Nüsse" or similar, the call is transferred to the
  restaurant's transfer number with "Bei Allergien und Unverträglichkeiten verbinde ich Sie aus
  Sicherheitsgründen direkt mit unserem Team." The assistant never gives allergen information and never
  says something is safe. Negative answers ("Nei, kei Allergie", "Niemer isch allergisch") do not trigger.
  Detection is deterministic (regular expressions in `safety.ts`, tested in `safety.test.ts`) and the AI
  is additionally instructed to call `transfer_to_staff(reason: "allergy")`. If no transfer number is
  configured, the assistant politely declines the order and refers the caller to the staff.
- **Owner / human requested**: "Chan ich de Chef ha?", "Ich möcht mit emne Mensch rede" → transfer.
- **Complaints, reservations, catering, very large orders** → transfer (`complaint`, `large_order`,
  `other`).
- **No inventions**: only items, options and facts from the menu and restaurant profile.
- **Honesty**: the assistant says it is an AI when asked.
- **Prompt injection**: callers cannot change rules or prices ("Ignorier alli Regle …") – prices come from
  the server anyway.
- **Silence**: after 10 s "Sind Sie noch da?" (twice), then a polite goodbye.
- **Technical failure** (model, speech recognition or voice unavailable): apology and transfer to the
  restaurant; if no transfer number: "bitte rufen Sie in ein paar Minuten nochmals an".
- **Maximum call length**: 15 minutes (`CALL_MAX_DURATION_SECONDS`), then transfer.

## Language

- Default: **Schweizer Hochdeutsch** (Swiss Standard German) with Swiss spelling (always "ss", never
  "ß") and helvetisms ("Grüezi", "Merci vielmal", "en Guete"). Every Swiss caller understands it and the
  available `de-CH` voices sound most natural with it.
- Experimental per restaurant: **Swiss German dialect** output (Zürichdeutsch). Works best with an
  ElevenLabs voice cloned from a Swiss speaker.
- Callers speak dialect; recognition (`de-CH`) returns Standard German text. The prompt tells the model
  to expect transcription errors ("Margarita" → Margherita, "drü" → 3) and the matcher tolerates them.
- French, Italian or English callers get answers in their language.

## Phone style

Short answers (1–2 sentences), one question at a time, no lists or abbreviations, prices spoken as
"18 Franken 50", times as "18 Uhr 30". The server additionally normalises text for speech
(`speech.ts`: "CHF 18.50" → "18 Franken 50", "2x" → "2 mal", removes internal IDs and markdown).

## Prompt structure

1. **System prompt** (static per restaurant & menu → cached by the provider): identity, style, phone
   rules, call flow, safety rules, ground rules, restaurant facts (address, hours, pickup/delivery,
   payment), restaurant-specific instructions, the menu (items with short IDs `I1…`, aliases, codes,
   option groups `G1…` with options `O1…`).
2. **Conversation** so far.
3. **State context** (dynamic, appended every turn): current time, open/closed, earliest pickup and
   delivery time, allergy status, cart with prices, collected details, and a **NEXT STEP** hint computed by
   the server (e.g. "stelle JETZT die Allergiefrage"). This keeps a fast model on track without long
   instructions.

## Tools

`add_items`, `update_line`, `remove_line`, `search_menu`, `record_allergy_answer`, `set_fulfillment`,
`set_customer`, `set_payment_method`, `set_order_note`, `review_order`, `confirm_order`,
`transfer_to_staff`, `end_call` – definitions in
[`tools.ts`](../packages/core/src/conversation/tools.ts). Tool results are German, compact JSON with a
`hinweis` (hint) telling the model what to say next.

## Customising per restaurant

- **Greeting** with `{restaurant}` and `{bot}` placeholders.
- **Restaurant-specific instructions**: facts and preferences ("Family-Pizzen haben 40 cm", "Empfiehl den
  Tagesteller"). They cannot override safety rules.
- **Assistant name**, **voice**, **speech recognition provider** and **language model**.
- **Aliases** for every item and option – the most effective lever for recognition quality. Use the
  _Test what callers might say_ box in the menu editor.

## Testing changes

- Unit tests: `pnpm --filter @justcall/core test` (matcher, cart, hours, safety, engine flows).
- Conversation evals with the real model: `pnpm eval` (`--verbose` prints transcripts and tool calls).
- Browser test call: Restaurant → _Test call_ (text or microphone) – same pipeline as phone calls.
- Terminal chat: `pnpm --filter @justcall/voice chat -- <restaurant-slug> --tools`.
