import "server-only";
import {
  and,
  eq,
  memberships,
  restaurants,
  user as userTable,
  type Restaurant,
} from "@justcall/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";
import { db } from "./db";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
};

/** The signed-in user (cached per request) or null. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result?.user) return null;
  // Read the role from the database (authoritative, not from the cookie cache).
  const [row] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, result.user.id))
    .limit(1);
  if (!row) return null;
  return { id: result.user.id, name: result.user.name, email: result.user.email, role: row.role };
});

export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/");
  return u;
}

export type RestaurantAccess = {
  user: CurrentUser;
  restaurant: Restaurant;
  role: "admin" | "owner" | "staff";
};

/** Restaurant portal access: platform admins or members of the restaurant. */
export const getRestaurantAccess = cache(
  async (slugOrId: string): Promise<RestaurantAccess | null> => {
    const u = await getCurrentUser();
    if (!u) return null;
    const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
    const [restaurant] = await db
      .select()
      .from(restaurants)
      .where(isUuid ? eq(restaurants.id, slugOrId) : eq(restaurants.slug, slugOrId))
      .limit(1);
    if (!restaurant) return null;
    if (u.role === "admin") return { user: u, restaurant, role: "admin" };
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, u.id), eq(memberships.restaurantId, restaurant.id)))
      .limit(1);
    if (!m) return null;
    return { user: u, restaurant, role: m.role };
  },
);

export async function requireRestaurantAccess(
  slugOrId: string,
  minRole: "staff" | "owner" = "staff",
): Promise<RestaurantAccess> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const access = await getRestaurantAccess(slugOrId);
  if (!access) notFound();
  if (minRole === "owner" && access.role === "staff") notFound();
  return access;
}

/** Restaurants the user can open in the portal. */
export async function listAccessibleRestaurants(u: CurrentUser) {
  if (u.role === "admin") {
    return db
      .select({ id: restaurants.id, slug: restaurants.slug, name: restaurants.name })
      .from(restaurants)
      .orderBy(restaurants.name);
  }
  return db
    .select({ id: restaurants.id, slug: restaurants.slug, name: restaurants.name })
    .from(memberships)
    .innerJoin(restaurants, eq(restaurants.id, memberships.restaurantId))
    .where(eq(memberships.userId, u.id))
    .orderBy(restaurants.name);
}
