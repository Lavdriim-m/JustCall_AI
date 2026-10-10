import type { Database } from "@justcall/db";
import type { Config } from "./config";
import type { Logger } from "./logger";
import type { CallSession } from "./call/session";
import type { RestaurantCache } from "./call/restaurant-cache";

/** Keeps track of live calls (metrics, graceful shutdown). */
export class CallRegistry {
  private readonly sessions = new Map<string, CallSession>();
  /** Calls answered with stream TwiML whose media stream has not started yet (id -> expiry). */
  private readonly pending = new Map<string, number>();
  /** A call was accepted; its media stream should connect within a few seconds. */
  expect(id: string, ttlMs = 15_000) {
    this.pending.set(id, Date.now() + ttlMs);
  }
  /** The accepted call will not get a session (stream rejected or failed to start). */
  settle(id: string) {
    this.pending.delete(id);
  }
  add(id: string, s: CallSession) {
    this.pending.delete(id);
    this.sessions.set(id, s);
  }
  remove(id: string) {
    this.sessions.delete(id);
  }
  get size() {
    return this.sessions.size;
  }
  /** Live calls plus accepted calls still connecting – what a graceful shutdown waits for. */
  get busy() {
    const now = Date.now();
    for (const [id, expires] of this.pending) if (expires < now) this.pending.delete(id);
    return this.sessions.size + this.pending.size;
  }
  ids() {
    return [...this.sessions.keys()];
  }
  async stopAll(reason: string) {
    await Promise.allSettled([...this.sessions.values()].map((s) => s.onStop(reason)));
    this.sessions.clear();
    this.pending.clear();
  }
}

export type AppContext = {
  config: Config;
  db: Database;
  logger: Logger;
  restaurants: RestaurantCache;
  registry: CallRegistry;
  /** Set on SIGTERM: new calls are handed to the restaurant while running calls finish. */
  draining: boolean;
};
