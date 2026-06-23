// tournament/realtime.js
// Socket.IO bridge for live tournament updates. The server is authoritative and
// state is per-requester scoped (teamsheet/team visibility), so we do NOT push
// full state over the socket. Instead we push a lightweight "changed" signal to
// everyone subscribed to a tournament code; each client then refetches its own
// scoped view via REST. Instant updates, zero scoping leaks.
//
// Reuses the same Socket.IO server as the game-room relay (path /api/socket.io).

let _io = null;
const ROOM = code => 'tourney:' + String(code).toUpperCase();

function attachTournamentRealtime(io) {
  _io = io;
  io.on('connection', (socket) => {
    socket.on('tourney:subscribe', ({ code } = {}) => { if (code) socket.join(ROOM(code)); });
    socket.on('tourney:unsubscribe', ({ code } = {}) => { if (code) socket.leave(ROOM(code)); });
  });
  console.log('[tourney] realtime bridge attached');
  return io;
}

// Notify all subscribers of a tournament that something changed → they refetch.
function broadcastTournament(code) {
  if (!_io || !code) return;
  _io.to(ROOM(code)).emit('tournament:changed', { code: String(code).toUpperCase() });
}

module.exports = { attachTournamentRealtime, broadcastTournament };
