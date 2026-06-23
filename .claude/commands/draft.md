We're working on the Game Room / Draft feature. Read CLAUDE.md first.

Key files for this session:
- `frontend/src/pages/Draft.jsx` — page shell: create/join room UI, wires transport to DraftBoard
- `frontend/src/game/DraftBoard.jsx` — the actual draft board UI (picks, timer, order)
- `frontend/src/game/useGameRoom.js` — transport abstraction: 'local' (pass-and-play) or 'room' (networked)
- `frontend/src/game/modes/draft.js` — draft mode: init(), reducer(), pure game logic
- `frontend/src/game/modes/auction.js` — auction mode (same surface as draft)
- `frontend/src/game/modes/index.js` — mode registry
- `frontend/src/lib/gameSocket.js` — singleton Socket.IO client
- `backend/src/realtime/roomServer.js` — Socket.IO server: room create/join/leave, state relay

Architecture — host-authoritative:
- Host runs the reducer locally and broadcasts `state` to all peers via socket
- Peers send `move` events to the server; server tags with player index and relays to host
- Host applies the move and re-broadcasts the new state
- Identity: stable `clientId` (localStorage), NOT socket.id — reconnecting players reclaim their seat
- Socket events: `room:update`, `state`, `move`, `room:closed`
- `useGameRoom({ mode, transport, config, source, room })` returns same surface for both transports

Distinct from the tournament system: this is the real-time game room (Socket.IO state relay), NOT the REST-based tournament bracket system. Different socket namespace, different backend file.

What needs doing?
