// lib/clientId.js
// A stable per-browser identity that survives reloads and reconnects.
// Used so a player who drops can reclaim their original seat in a room.
const KEY = 'vgc_client_id';

export function getClientId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem(KEY, id);
  }
  return id;
}
