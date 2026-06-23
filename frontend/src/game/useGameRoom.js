// game/useGameRoom.js
// One hook, two transports — the board component never knows which it's using.
//
//   transport: 'local'  → pass-and-play. The reducer runs here; dispatch applies
//                         immediately. "My turn" is always the current turn.
//   transport: 'room'   → networked. Exactly one client (the HOST) runs the
//                         reducer and is authoritative; peers send moves to the
//                         host and render the state the host broadcasts.
//
// Returns the same surface in every case:
//   { state, dispatch, restart, players, myIndex, myTurn, isHost, status }
//
// `dispatch(action)` auto-stamps the acting player, so the board can just call
// dispatch({ type: 'pick', name }) without knowing player indices.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/gameSocket';
import { getClientId } from '../lib/clientId';

// ── Local: pass-and-play on one device ─────────────────────────────────────────
function useLocalGame(mode, config, source) {
  const [state, setState] = useState(() => (source?.length ? mode.init(config, source) : null));

  // Re-init if the source arrives after mount (usage list still loading).
  const seeded = useRef(!!state);
  useEffect(() => {
    if (!seeded.current && source?.length) {
      seeded.current = true;
      setState(mode.init(config, source));
    }
  }, [mode, config, source]);

  const dispatch = useCallback((action) => {
    setState(s => (s ? mode.reducer(s, { ...action, by: action.by ?? s.turn }) : s));
  }, [mode]);

  const restart = useCallback(() => {
    if (source?.length) setState(mode.init(config, source));
  }, [mode, config, source]);

  const players = state
    ? Array.from({ length: state.config.players }, (_, i) => ({ index: i, name: `Player ${i + 1}` }))
    : [];

  return {
    state, dispatch, restart, start: restart, players, members: players,
    myIndex: state?.turn ?? 0,   // local: the active seat is always "you"
    myTurn: true,
    isHost: true,
    status: 'connected',
  };
}

// ── Room: networked, host-authoritative ────────────────────────────────────────
function useRoomGame(mode, config, source, room) {
  // room = { code, youId, hostClientId, members:[{id,name,index,isHost,connected}],
  //          state } + live updates. Identity is the stable per-browser clientId,
  // NOT socket.id, so a reconnecting player is recognized and reclaims their seat.
  const clientId = getClientId();
  // Seed from the cached blob the server handed us on (re)join, so a reconnecting
  // client (including the host) lands on the board instead of a blank lobby.
  const [state, setState]   = useState(room?.state ?? null);
  const [members, setMembers] = useState(room?.members ?? []);
  const [status, setStatus] = useState('connected');

  const youId  = clientId;
  const isHost = room?.hostClientId === youId;
  const me     = members.find(m => m.id === youId);
  const myIndex = me?.index ?? 0;

  // Keep an authoritative state ref for the host's move handler.
  const stateRef = useRef(room?.state ?? null);
  useEffect(() => { stateRef.current = state; }, [state]);

  const socket = getSocket();

  // Host seeds the initial state once the source is available, and re-broadcasts.
  const broadcast = useCallback((next) => {
    setState(next);
    stateRef.current = next;
    socket.emit('state', next);
  }, [socket]);

  // HOST: start the game explicitly (from the room lobby) using the ACTUAL
  // number of players currently in the room, not the max-player cap.
  const start = useCallback(() => {
    if (isHost && source?.length) {
      broadcast(mode.init({ ...config, players: members.length }, source));
    }
  }, [isHost, source, mode, config, members.length, broadcast]);

  // Wire socket listeners.
  useEffect(() => {
    function onRoomUpdate(r) {
      setMembers(r.members);
      // Re-send current state to newcomers so they aren't stuck on a blank board.
      if (room?.hostClientId === youId && stateRef.current) socket.emit('state', stateRef.current);
    }
    function onState(s) { if (room?.hostClientId !== youId) setState(s); }
    function onMove({ action, index }) {
      // Only the host applies relayed peer moves.
      if (room?.hostClientId !== youId) return;
      const cur = stateRef.current;
      if (!cur) return;
      broadcast(mode.reducer(cur, { ...action, by: index }));
    }
    function onClosed() { setStatus('closed'); }

    socket.on('room:update', onRoomUpdate);
    socket.on('state', onState);
    socket.on('move', onMove);
    socket.on('room:closed', onClosed);
    return () => {
      socket.off('room:update', onRoomUpdate);
      socket.off('state', onState);
      socket.off('move', onMove);
      socket.off('room:closed', onClosed);
    };
  }, [socket, room, youId, mode, broadcast]);

  const dispatch = useCallback((action) => {
    const stamped = { ...action, by: myIndex };
    if (isHost) {
      const cur = stateRef.current;
      if (cur) broadcast(mode.reducer(cur, stamped));
    } else {
      socket.emit('move', action); // server tags it with our index; host applies
    }
  }, [isHost, myIndex, mode, broadcast, socket]);

  const restart = useCallback(() => {
    if (isHost && source?.length) broadcast(mode.init(config, source));
  }, [isHost, source, mode, config, broadcast]);

  const players = members.map(m => ({ index: m.index, name: m.name, isHost: m.isHost }));
  const myTurn = state ? state.turn === myIndex : false;

  return { state, dispatch, restart, start, players, members, myIndex, myTurn, isHost, status };
}

export function useGameRoom({ mode, transport, config, source, room }) {
  const local = useLocalGame(mode, config, transport === 'local' ? source : null);
  const net   = useRoomGame(mode, config, source, transport === 'room' ? room : null);
  return transport === 'room' ? net : local;
}
