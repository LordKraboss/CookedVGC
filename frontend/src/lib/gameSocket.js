// lib/gameSocket.js
// Thin singleton wrapper around socket.io-client for the game-room relay.
import { io } from 'socket.io-client';

// In dev, VITE_API_URL is unset and we talk to the backend directly on :3001.
// In prod, VITE_API_URL = https://yourdomain.com/api, so the socket path lives
// under /api/socket.io (which nginx already proxies with WS upgrade headers).
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';
const ORIGIN  = API_URL.replace(/\/api\/?$/, '');

let _socket = null;

export function getSocket() {
  if (_socket) return _socket;
  _socket = io(ORIGIN, {
    path: '/api/socket.io',
    autoConnect: true,
    transports: ['websocket', 'polling'],
  });
  return _socket;
}

// Promise-wrapped emit for request/response handshakes (create/join).
export function emitAck(event, payload, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    const timer = setTimeout(() => reject(new Error('Request timed out')), timeout);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}
