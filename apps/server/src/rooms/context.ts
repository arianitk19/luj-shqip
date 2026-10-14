import type { TokenVerifier } from "../auth/verifier.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/pool.ts";

/**
 * Colyseus instantiates room classes itself, so shared services are provided through a
 * process-wide context that the game server sets once at startup.
 */
export interface RoomContext {
  db: Db;
  verifier: TokenVerifier;
  config: Config;
  /** Proves a private-room creation request came from our own REST endpoint, not a crafted client call. */
  creationSecret: string;
  /** userId -> roomId for users currently seated in a lobby or match (one active room per user). */
  activeUsers: Map<string, string>;
  /** Private invitation code -> roomId. In-memory: single-process only (see docs/ARCHITECTURE.md). */
  privateRooms: Map<string, string>;
}

let current: RoomContext | null = null;

export function setRoomContext(context: RoomContext | null): void {
  current = context;
}

export function getRoomContext(): RoomContext {
  if (!current) throw new Error("room context is not initialised");
  return current;
}
