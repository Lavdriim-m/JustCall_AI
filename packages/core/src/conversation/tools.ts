import type { ToolSpec } from "../llm/types";

/**
 * Tools exposed to the language model. All business logic (pricing, validation, opening hours,
 * order persistence) lives behind these tools – the model only decides *what* to do.
 */
export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "add_items",
    description:
      "Fügt einen oder mehrere Artikel zum Warenkorb hinzu. Verwende die Kennung aus der Speisekarte (z. B. I3) oder den genannten Namen. Optionen als Kennung (O5) oder Name (z. B. 'gross', 'extra Käse').",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              item: { type: "string", description: "Artikel-Kennung (I3) oder Name wie genannt" },
              quantity: { type: "integer", minimum: 1, description: "Menge, Standard 1" },
              options: {
                type: "array",
                items: { type: "string" },
                description: "Gewählte Optionen (Kennung oder Name)",
              },
              notes: {
                type: "string",
                description: "Sonderwunsch ohne passende Option, z. B. 'ohne Zwiebeln'",
              },
            },
            required: ["item"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
  },
  {
    name: "update_line",
    description:
      "Ändert eine bestehende Warenkorb-Position (Kennung L1, L2 …): Menge (0 = entfernen), Optionen oder Sonderwunsch.",
    parameters: {
      type: "object",
      properties: {
        line: { type: "string", description: "Positions-Kennung, z. B. L2" },
        quantity: { type: "integer", minimum: 0 },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Neue Optionen für die genannten Gruppen",
        },
        notes: { type: "string" },
      },
      required: ["line"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_line",
    description: "Entfernt eine Position komplett aus dem Warenkorb.",
    parameters: {
      type: "object",
      properties: { line: { type: "string", description: "Positions-Kennung, z. B. L2" } },
      required: ["line"],
      additionalProperties: false,
    },
  },
  {
    name: "search_menu",
    description:
      "Sucht in der Speisekarte (z. B. 'vegetarisch', 'scharf', 'Getränke', 'Dessert'). Nur für Fragen des Kunden, nicht zum Hinzufügen.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "record_allergy_answer",
    description:
      "Erfasst die Antwort auf die Allergiefrage. has_allergy=true, sobald irgendeine Allergie oder Unverträglichkeit erwähnt wird (führt zur Weiterleitung an das Personal).",
    parameters: {
      type: "object",
      properties: {
        has_allergy: { type: "boolean" },
        details: { type: "string" },
      },
      required: ["has_allergy"],
      additionalProperties: false,
    },
  },
  {
    name: "set_fulfillment",
    description:
      "Legt Abholung oder Lieferung und die Zeit fest. time = 'asap' (so schnell wie möglich) oder 'HH:MM' (24h, heute).",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["pickup", "delivery"] },
        time: { type: "string", description: "'asap' oder 'HH:MM'" },
        address: {
          type: "object",
          properties: {
            street: { type: "string", description: "Strasse und Hausnummer" },
            postal_code: { type: "string" },
            city: { type: "string" },
            notes: { type: "string", description: "z. B. Stockwerk, Klingel" },
          },
          required: ["street"],
          additionalProperties: false,
        },
      },
      required: ["type", "time"],
      additionalProperties: false,
    },
  },
  {
    name: "set_customer",
    description:
      "Erfasst den Namen für die Bestellung und optional eine Handynummer für die SMS-Bestätigung.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string", description: "Nur falls der Kunde eine andere Nummer nennt" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "set_payment_method",
    description: "Erfasst die gewünschte Zahlungsart.",
    parameters: {
      type: "object",
      properties: { method: { type: "string", enum: ["cash", "card", "twint"] } },
      required: ["method"],
      additionalProperties: false,
    },
  },
  {
    name: "set_order_note",
    description: "Allgemeine Bemerkung zur ganzen Bestellung (z. B. 'bitte Besteck dazu').",
    parameters: {
      type: "object",
      properties: { note: { type: "string" } },
      required: ["note"],
      additionalProperties: false,
    },
  },
  {
    name: "review_order",
    description:
      "Liefert die vollständige Zusammenfassung mit Totalbetrag zum Vorlesen. Muss vor confirm_order aufgerufen und vorgelesen werden.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "confirm_order",
    description:
      "Bestätigt und übermittelt die Bestellung an das Restaurant. Nur nach review_order und ausdrücklicher Zustimmung des Kunden.",
    parameters: {
      type: "object",
      properties: {
        customer_confirmed: {
          type: "boolean",
          description: "true, wenn der Kunde die Zusammenfassung ausdrücklich bestätigt hat",
        },
      },
      required: ["customer_confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "transfer_to_staff",
    description:
      "Verbindet den Anruf mit dem Restaurant-Personal bzw. Inhaber. Pflicht bei Allergien/Unverträglichkeiten und wenn jemand mit einem Menschen oder dem Chef sprechen will.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["allergy", "owner_request", "complaint", "large_order", "other"],
        },
        note: { type: "string", description: "Kurze Notiz für das Personal" },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  {
    name: "end_call",
    description:
      "Beendet das Gespräch nach der Verabschiedung, wenn keine Bestellung aufgegeben wird.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["no_order", "wrong_number", "caller_request", "information_only"],
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];
