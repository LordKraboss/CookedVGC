// game/modes/index.js
// Registry of all playable modes. To add a new game type later:
//   1. create game/modes/<mode>.js exporting { meta, init, reducer }
//   2. add it here
//   3. write a <Mode>Board.jsx presentational component
// No server changes are ever needed — the relay is mode-agnostic.

import * as draft from './draft';
import * as auction from './auction';

export const MODES = {
  [draft.meta.id]: draft,
  [auction.meta.id]: auction,
};

export const MODE_LIST = Object.values(MODES);

export function getMode(id) {
  return MODES[id] ?? null;
}
