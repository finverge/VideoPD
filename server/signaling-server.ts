import { WebSocketServer, WebSocket } from "ws";

/**
 * Standalone signaling server for real, self-hosted (no vendor account, no
 * Daily/Twilio/Agora/etc.) live video calling between a borrower and an
 * underwriter — see the "Plain live video call" scope decision over the
 * Pipecat question. This process only relays join/offer/answer/ICE-candidate
 * messages between peers in the same room; it never sees or touches the
 * actual audio/video, which flows peer-to-peer once WebRTC negotiation
 * completes (see src/lib/webrtc/useCallRoom.ts for the client side).
 *
 * Honest limitation: peers connect via STUN only (Google's public STUN
 * server), which resolves NAT for most home/mobile networks but not all —
 * symmetric NATs and some corporate firewalls need a TURN relay this
 * prototype doesn't run. Confirmed acceptable for demo purposes; a
 * production build should add a TURN relay (self-hosted coturn, or a
 * managed video SDK) if call reliability on arbitrary networks matters.
 *
 * Runs as a separate process from `next dev`/`next start` — see
 * package.json's `dev:signaling` script. Room membership and all peer state
 * here is in-memory only, same "local prototype" tier as the rest of this
 * app (SQLite, on-disk uploads) — restarting this process drops any live
 * calls, same as restarting `next dev` would lose in-flight requests.
 */

const PORT = Number(process.env.SIGNALING_PORT ?? 4001);
// Mesh WebRTC (every peer connects directly to every other peer) costs
// O(n^2) connections — fine for borrower + underwriter, and comfortably
// covers an occasional third participant (e.g. a co-applicant/witness),
// but this isn't an SFU and shouldn't be pushed much past that.
const MAX_PEERS_PER_ROOM = 6;

interface Peer {
  id: string;
  name: string;
  ws: WebSocket;
}

const rooms = new Map<string, Map<string, Peer>>();
const peerLocation = new Map<WebSocket, { roomId: string; peerId: string }>();

function send(ws: WebSocket, msg: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(roomId: string, msg: Record<string, unknown>, exceptPeerId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const peer of room.values()) {
    if (peer.id !== exceptPeerId) send(peer.ws, msg);
  }
}

function removePeer(ws: WebSocket) {
  const loc = peerLocation.get(ws);
  if (!loc) return;
  peerLocation.delete(ws);
  const room = rooms.get(loc.roomId);
  if (!room) return;
  room.delete(loc.peerId);
  if (room.size === 0) {
    rooms.delete(loc.roomId);
  } else {
    broadcast(loc.roomId, { type: "peer-left", peerId: loc.peerId });
  }
}

export function startSignalingServer(port = PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", message: "Malformed message." });
        return;
      }

      if (msg?.type === "join") {
        const roomId = String(msg.room ?? "");
        const peerId = String(msg.peerId ?? "");
        const name = String(msg.name ?? "Participant").slice(0, 60);
        if (!roomId || !peerId) {
          send(ws, { type: "error", message: "room and peerId are required to join." });
          return;
        }
        if (peerLocation.has(ws)) {
          send(ws, { type: "error", message: "This connection already joined a room." });
          return;
        }

        let room = rooms.get(roomId);
        if (!room) {
          room = new Map();
          rooms.set(roomId, room);
        }
        if (room.has(peerId)) {
          send(ws, { type: "error", message: "That peer id is already in this room." });
          return;
        }
        if (room.size >= MAX_PEERS_PER_ROOM) {
          send(ws, { type: "room-full" });
          return;
        }

        const existingPeers = Array.from(room.values()).map((p) => ({ peerId: p.id, name: p.name }));
        room.set(peerId, { id: peerId, name, ws });
        peerLocation.set(ws, { roomId, peerId });

        send(ws, { type: "joined", peerId, peers: existingPeers });
        broadcast(roomId, { type: "peer-joined", peerId, name }, peerId);
        return;
      }

      const loc = peerLocation.get(ws);
      if (!loc) {
        send(ws, { type: "error", message: "Join a room before sending signaling messages." });
        return;
      }

      if (msg?.type === "offer" || msg?.type === "answer" || msg?.type === "ice-candidate") {
        const room = rooms.get(loc.roomId);
        const target = room?.get(String(msg.to ?? ""));
        if (!target) return; // target already left — the caller's own peer-left handling covers this, nothing to relay to
        send(target.ws, { type: msg.type, from: loc.peerId, payload: msg.payload });
        return;
      }

      // Room-wide broadcast, not addressed to one peer — used for the live
      // liveness/attention signal during a call (see useCallRoom.ts). Same
      // "this process only relays, never touches media" boundary: payload
      // is just small JSON numbers/booleans, never audio/video.
      if (msg?.type === "signal") {
        broadcast(loc.roomId, { type: "signal", from: loc.peerId, payload: msg.payload }, loc.peerId);
        return;
      }

      if (msg?.type === "leave") {
        removePeer(ws);
        return;
      }
    });

    ws.on("close", () => removePeer(ws));
    ws.on("error", () => removePeer(ws));
  });

  return wss;
}

// Only auto-start when run directly (`tsx server/signaling-server.ts`), not
// when imported by a test harness.
if (require.main === module) {
  startSignalingServer();
  // eslint-disable-next-line no-console
  console.log(`[signaling] listening on ws://localhost:${PORT}`);
}
