import "server-only";
import { auditLogs } from "@justcall/db";
import { db } from "./db";

export async function audit(
  actorUserId: string | null,
  action: string,
  details: {
    restaurantId?: string | null;
    entity?: string;
    entityId?: string;
    data?: unknown;
  } = {},
) {
  await db
    .insert(auditLogs)
    .values({
      actorUserId,
      action,
      restaurantId: details.restaurantId ?? null,
      entity: details.entity ?? null,
      entityId: details.entityId ?? null,
      data:
        details.data === undefined ? null : (JSON.parse(JSON.stringify(details.data)) as unknown),
    })
    .catch((err) => console.error("audit log failed", err));
}
