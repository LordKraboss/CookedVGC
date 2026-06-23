// realtime/roomServer.js
// Generic, mode-agnostic multiplayer relay over Socket.IO.
//
// The server knows NOTHING about any game's rules. It only:
//   • creates rooms with a short join code
//   • tracks membership (by a stable per-browser clientId) and a max-player cap
//   • caches the latest authoritative state blob (opaque) so (re)joiners land on
//     the board instead of a blank lobby
//   • relays two message kinds:
//       - 'move'  : peer  → host   (a player's requested action)
//       - 'state' : host  → peers  (the authoritative game state)
//
// One member per room is the HOST (the room creator). The host's client runs
// the game reducer and is the single source of truth. The server stays reusable
// for every future game mode with zero changes here.
//
// Reconnection model: members are keyed by `clientId` (stable across reloads /
// reconnects), NOT by socket.id (which changes every connection). A disconnect
// marks the seat `connected = false` but KEEPS it, so the same browser can
// reclaim its index/name by rejoining. Rooms are torn down only after every
// member has been gone for a grace period.

const { Server } = require('socket.io');

// code -> {
//   code, mode, maxPlayers,
//   hostClientId,
//   members: [{ clientId, socketId, name, index, connected }],
//   state,            // latest opaque state blob from the host (or null)
//   cleanupTimer,     // pending teardown timer (or null)
// }
const rooms = new Map();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
function genCode(len = 4) {
  let code;
  do {
    code = Array.from({ length: len }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// How long a fully-empty room (everyone disconnected) is kept before teardown.
const EMPTY_ROOM_GRACE_MS = 2 * 60 * 1000;

function roomPublic(room) {
  return {
    code:         room.code,
    mode:         room.mode,
    maxPlayers:   room.maxPlayers,
    hostClientId: room.hostClientId,
    members:      room.members.map(m => ({
      id:        m.clientId,
      name:      m.name,
      index:     m.index,
      isHost:    m.clientId === room.hostClientId,
      connected: m.connected,
    })),
  };
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.members.some(m => m.socketId === socketId)) return room;
  }
  return null;
}

function memberBySocket(room, socketId) {
  return room.members.find(m => m.socketId === socketId) || null;
}

function hostSocketId(room) {
  const host = room.members.find(m => m.clientId === room.hostClientId);
  return host ? host.socketId : null;
}

function clearCleanup(room) {
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}

function scheduleCleanupIfEmpty(room) {
  const anyConnected = room.members.some(m => m.connected);
  if (anyConnected) return;
  clearCleanup(room);
  room.cleanupTimer = setTimeout(() => {
    // Re-check: someone may have reconnected during the grace window.
    if (!room.members.some(m => m.connected)) {
      rooms.delete(room.code);
      console.log(`[room] reclaimed ${room.code} (empty for grace period)`);
    }
  }, EMPTY_ROOM_GRACE_MS);
}

function attachRoomServer(httpServer, { path = '/api/socket.io', origins } = {}) {
  const io = new Server(httpServer, {
    path,
    cors: origins ? { origin: origins } : undefined,
  });

  io.on('connection', (socket) => {

    // ── Create a room ────────────────────────────────────────────────────────
    socket.on('room:create', ({ mode, maxPlayers, name, clientId }, cb) => {
      if (!clientId) return cb?.({ ok: false, error: 'Missing clientId' });
      // The per-mode cap is enforced client-side; the relay is mode-agnostic and
      // only guards a sane lower bound (a huge value just means a roomier room).
      const cap = Math.max(2, Number(maxPlayers) || 2);
      const code = genCode();
      const room = {
        code,
        mode: mode || 'draft',
        maxPlayers: cap,
        hostClientId: clientId,
        members: [{
          clientId,
          socketId: socket.id,
          name: (name || 'Host').slice(0, 24),
          index: 0,
          connected: true,
        }],
        state: null,
        cleanupTimer: null,
      };
      rooms.set(code, room);
      socket.join(code);
      socket.data.code = code;
      socket.data.clientId = clientId;
      cb?.({ ok: true, room: roomPublic(room), youId: clientId, state: room.state });
      io.to(code).emit('room:update', roomPublic(room));
      console.log(`[room] created ${code} (mode=${room.mode}, max=${cap})`);
    });

    // ── Join a room by code (also handles RECONNECTION) ──────────────────────
    socket.on('room:join', ({ code, name, clientId }, cb) => {
      if (!clientId) return cb?.({ ok: false, error: 'Missing clientId' });
      const room = rooms.get((code || '').toUpperCase());
      if (!room) return cb?.({ ok: false, error: 'Room not found' });

      socket.join(room.code);
      socket.data.code = room.code;
      socket.data.clientId = clientId;

      // Reconnection: this browser already has a seat → reclaim it (keep index
      // and name, just update the live socket and mark it connected again).
      const existing = room.members.find(m => m.clientId === clientId);
      if (existing) {
        existing.socketId = socket.id;
        existing.connected = true;
        clearCleanup(room);
        cb?.({ ok: true, room: roomPublic(room), youId: clientId, state: room.state });
        io.to(room.code).emit('room:update', roomPublic(room));
        console.log(`[room] ${clientId} reclaimed seat in ${room.code} (index ${existing.index})`);
        return;
      }

      // New member: enforce the cap (count seats, regardless of connection).
      if (room.members.length >= room.maxPlayers) {
        return cb?.({ ok: false, error: 'Room is full' });
      }
      const index = room.members.length;
      room.members.push({
        clientId,
        socketId: socket.id,
        name: (name || 'Player').slice(0, 24),
        index,
        connected: true,
      });
      clearCleanup(room);
      cb?.({ ok: true, room: roomPublic(room), youId: clientId, state: room.state });
      io.to(room.code).emit('room:update', roomPublic(room));
      console.log(`[room] ${clientId} joined ${room.code} (${room.members.length}/${room.maxPlayers})`);
    });

    // ── Relay: peer → host ─────────────────────────────────────────────────────
    socket.on('move', (action) => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const me = memberBySocket(room, socket.id);
      if (!me) return;
      const hostSock = hostSocketId(room);
      if (!hostSock) return; // host currently disconnected; move is dropped
      io.to(hostSock).emit('move', { action, from: me.clientId, index: me.index });
    });

    // ── Relay: host → everyone else (and cache the latest state) ───────────────
    socket.on('state', (state) => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const me = memberBySocket(room, socket.id);
      if (!me || me.clientId !== room.hostClientId) return; // only the host is authoritative
      room.state = state; // cache opaque blob for (re)joiners
      socket.to(room.code).emit('state', state);
    });

    // ── Leave / disconnect ─────────────────────────────────────────────────────
    // Explicit leave = intentional, free the seat. Disconnect = transient, keep it.
    function leaveExplicit() {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const me = memberBySocket(room, socket.id);
      if (!me) return;

      room.members = room.members.filter(m => m.clientId !== me.clientId);

      if (me.clientId === room.hostClientId) {
        // Host intentionally left → tear the room down.
        io.to(room.code).emit('room:closed', { reason: 'Host left the room' });
        clearCleanup(room);
        rooms.delete(room.code);
        console.log(`[room] closed ${room.code} (host left)`);
      } else {
        io.to(room.code).emit('room:update', roomPublic(room));
        console.log(`[room] ${me.clientId} left ${room.code}`);
        scheduleCleanupIfEmpty(room);
      }
    }

    function onDisconnect() {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const me = memberBySocket(room, socket.id);
      if (!me) return;
      // Keep the seat; just mark it offline so the same browser can reclaim it.
      me.connected = false;
      io.to(room.code).emit('room:update', roomPublic(room));
      console.log(`[room] ${me.clientId} disconnected from ${room.code} (seat held)`);
      scheduleCleanupIfEmpty(room);
    }

    socket.on('room:leave', () => { leaveExplicit(); socket.leave(socket.data.code); });
    socket.on('disconnect', onDisconnect);
  });

  console.log(`[room] Socket.IO relay attached at ${path}`);
  return io;
}

module.exports = { attachRoomServer };
