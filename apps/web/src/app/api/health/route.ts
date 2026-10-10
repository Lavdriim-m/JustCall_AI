import { sql } from "@justcall/db";
import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, service: "justcall-web" });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 503 });
  }
}
