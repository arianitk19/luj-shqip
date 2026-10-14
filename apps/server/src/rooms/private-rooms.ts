import { randomBytes, randomInt } from "node:crypto";
import { matchMaker } from "@colyseus/core";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../http/app.ts";
import { HttpError, parse } from "../http/errors.ts";
import { roomCodeBody } from "../http/schemas.ts";
import { getRoomContext } from "./context.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
export const ROOM_NAME = "pishpirik";

export function generateRoomCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** REST endpoints for invitation-code rooms. Private rooms can only be created here. */
export function registerPrivateRoomRoutes(app: FastifyInstance, _deps: AppDeps): void {
  app.post(
    "/api/rooms/private",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, preHandler: app.requireProfile },
    async (request) => {
      const ctx = getRoomContext();
      const userId = request.user!.userId;
      if (ctx.activeUsers.has(userId)) {
        throw new HttpError(409, "already_in_match", "Je tashmë në një lojë ose dhomë.");
      }
      let code = generateRoomCode();
      for (let i = 0; i < 20 && ctx.privateRooms.has(code); i++) code = generateRoomCode();
      if (ctx.privateRooms.has(code)) throw new HttpError(503, "busy", "Provo përsëri pas pak.");

      const room = await matchMaker.createRoom(ROOM_NAME, {
        mode: "private",
        code,
        createToken: ctx.creationSecret,
      });
      ctx.privateRooms.set(code, room.roomId);
      return { code, roomId: room.roomId };
    },
  );

  app.post(
    "/api/rooms/resolve",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, preHandler: app.requireProfile },
    async (request) => {
      const { code } = parse(roomCodeBody, request.body);
      const roomId = getRoomContext().privateRooms.get(code);
      if (!roomId) throw new HttpError(404, "room_not_found", "Dhoma nuk u gjet ose ka skaduar.");
      return { roomId };
    },
  );
}

export function newCreationSecret(): string {
  return randomBytes(32).toString("hex");
}
