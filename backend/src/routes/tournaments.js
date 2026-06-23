// routes/tournaments.js — REST surface for the live tournament subsystem.
// Mounted at /api/tournaments. Each handler resolves the singleton DB and
// delegates to the (db-injected, unit-tested) service. TournamentError carries
// an HTTP status.
const express = require('express');
const { getDb } = require('../db/schema');
const S = require('../tournament/service');
const { broadcastTournament } = require('../tournament/realtime');

const router = express.Router();

function handle(fn) {
  return async (req, res) => {
    try {
      const db = await getDb();
      const out = await fn(db, req);
      res.json(out);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[tournaments]', e);
      res.status(status).json({ error: e.message });
    }
  };
}

// Like handle(), but after a successful mutation it notifies all subscribers of
// the affected tournament (by route :code, or the created code) to refetch.
function mut(fn) {
  return async (req, res) => {
    try {
      const db = await getDb();
      const out = await fn(db, req);
      res.json(out);
      const code = req.params.code ? req.params.code.toUpperCase() : out?.code;
      broadcastTournament(code);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[tournaments]', e);
      res.status(status).json({ error: e.message });
    }
  };
}

// Create
router.post('/', mut((db, req) => {
  const { name, regId, format, config, clientId, masterName, masterPlays } = req.body || {};
  return S.createTournament(db, {
    name, regId, format, config,
    masterClientId: clientId, masterName, masterPlays: !!masterPlays,
  });
}));

// Archive (must come before /:code so "results" isn't read as a code)
router.get('/results', handle((db) => S.listResults(db)));
router.get('/results/:code', handle((db, req) => S.getResultDetail(db, req.params.code.toUpperCase())));

// Join / reconnect
router.post('/:code/join', mut((db, req) =>
  S.joinTournament(db, req.params.code.toUpperCase(), req.body?.clientId, req.body?.name)));

// Scoped state (clientId optional → spectator view)
router.get('/:code', handle((db, req) =>
  S.getStateFor(db, req.params.code.toUpperCase(), req.query.clientId || null)));

// Team submit / reject
router.post('/:code/team', mut((db, req) =>
  S.submitTeam(db, req.params.code.toUpperCase(), req.body?.clientId, req.body?.team)));
router.post('/:code/team/reject', mut((db, req) =>
  S.rejectTeam(db, req.params.code.toUpperCase(), req.body?.clientId, req.body?.targetClientId, req.body?.comment)));

// Match flow
router.post('/:code/matches/:id/report', mut((db, req) =>
  S.reportScore(db, req.params.code.toUpperCase(), Number(req.params.id),
    req.body?.clientId, req.body?.p1Score, req.body?.p2Score)));
router.post('/:code/matches/:id/present', mut((db, req) =>
  S.markPresent(db, req.params.code.toUpperCase(), Number(req.params.id), req.body?.clientId)));
router.post('/:code/matches/:id/no-show', mut((db, req) =>
  S.reportNoShow(db, req.params.code.toUpperCase(), Number(req.params.id), req.body?.clientId)));
router.post('/:code/matches/:id/resolve', mut((db, req) =>
  S.resolveMatch(db, req.params.code.toUpperCase(), req.body?.clientId, Number(req.params.id), {
    p1Score: req.body?.p1Score, p2Score: req.body?.p2Score, dismiss: req.body?.dismiss,
  })));

// Master controls
router.post('/:code/launch', mut((db, req) =>
  S.launch(db, req.params.code.toUpperCase(), req.body?.clientId)));
router.post('/:code/advance', mut((db, req) =>
  S.advance(db, req.params.code.toUpperCase(), req.body?.clientId)));
router.post('/:code/participants/:cid/drop', mut((db, req) =>
  S.dropParticipant(db, req.params.code.toUpperCase(), req.body?.clientId, req.params.cid)));
router.post('/:code/complete', mut((db, req) =>
  S.completeTournament(db, req.params.code.toUpperCase(), req.body?.clientId)));
router.post('/:code/close', mut((db, req) =>
  S.closeTournament(db, req.params.code.toUpperCase(), req.body?.clientId)));
router.post('/:code/destroy', mut((db, req) =>
  S.destroyTournament(db, req.params.code.toUpperCase(), req.body?.clientId)));

module.exports = router;
