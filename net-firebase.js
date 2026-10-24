/* Grammar Castle: shared multiplayer through Firebase Realtime Database.
 *
 * The game was first built as a claude.ai page, where the page asks for `claude.use("db")`,
 * `claude.use("room")` and `claude.use("user")`. This file provides those same three things
 * on any website, backed by Firebase, so the game code does not need to know where it runs.
 *
 *   db    shared documents: castle state, floors, the ready vote, the scoreboard
 *   room  who is here right now (presence) and short live messages (Sweetlillac's heal)
 *   user  a stable id for this browser, and teacher mode (open the page with #teacher)
 *
 * If firebase-config.js has no config, nothing is provided and the game runs solo.
 */
(function () {
  'use strict';
  const CFG = window.FIREBASE_CONFIG;
  if (!CFG || !CFG.databaseURL || !window.firebase) return;

  const app = firebase.initializeApp(CFG);
  const fdb = firebase.database(app);
  const ROOT = 'gc';
  const TS = firebase.database.ServerValue.TIMESTAMP;

  // ---------- keys: Firebase forbids . # $ [ ] / in keys; grammar topics use "/" ----------
  const enc = k => String(k).replace(/[%.#$\[\]\/]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  const dec = k => String(k).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  function encode(v) {
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(encode);
    const o = {}; for (const k in v) { const e = encode(v[k]); if (e !== null && e !== undefined) o[enc(k)] = e } return o;
  }
  function decode(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(decode);
    const o = {}; for (const k in v) o[dec(k)] = decode(v[k]); return o;
  }
  const pathOf = p => ROOT + '/' + String(p).split('/').map(enc).join('/');
  // nested patch -> { "a/b/c": leaf } so an update merges like the claude.ai store does
  function flatten(obj, pre, out) {
    out = out || {};
    for (const k in obj) {
      const v = obj[k], key = (pre ? pre + '/' : '') + enc(k);
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, key, out);
      else out[key] = v === undefined ? null : encode(v);
    }
    return out;
  }
  const snapOf = (id, val) => ({ id, exists: val !== null && val !== undefined, data: () => (val === null || val === undefined) ? undefined : decode(val), metadata: { fromCache: false, hasPendingWrites: false } });

  // ---------- db ----------
  const db = {
    doc(path) {
      const ref = fdb.ref(pathOf(path)), id = String(path).split('/').pop();
      return {
        id, path,
        get: () => ref.once('value').then(s => snapOf(id, s.val())),
        set: data => ref.set(encode(data)),
        update: patch => ref.update(flatten(patch)),
        delete: () => ref.remove(),
        onSnapshot(next, error) {
          const h = s => next(snapOf(id, s.val()));
          ref.on('value', h, e => error && error({ code: 'unavailable', message: String(e) }));
          return () => ref.off('value', h);
        },
      };
    },
    collection(path) {
      const ref = fdb.ref(pathOf(path));
      return {
        path,
        doc: id => db.doc(path + '/' + id),
        onSnapshot(next, error) {
          const h = s => {
            const v = s.val() || {};
            const docs = Object.keys(v).map(k => snapOf(dec(k), v[k]));
            next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
          };
          ref.on('value', h, e => error && error({ code: 'unavailable', message: String(e) }));
          return () => ref.off('value', h);
        },
      };
    },
  };

  // ---------- user ----------
  let uid = null;
  try { uid = localStorage.getItem('gc-uid') } catch { }
  if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4); try { localStorage.setItem('gc-uid', uid) } catch { } }
  // Teacher mode: open the game with #<your teacher word> on the end of the link.
  // Set the word in firebase-config.js (TEACHER_WORD). It is only a light lock: keep it to yourself.
  const word = String(window.TEACHER_WORD || '').trim();
  const teacher = !!word && decodeURIComponent(location.hash.slice(1)) === word;
  const user = {
    id: async () => uid,
    can: async () => true,
    canEdit: async () => teacher,
    isOwner: () => teacher,
  };

  // ---------- room ----------
  // Two channels keep classroom traffic small:
  //   presence/<peer>                 who is here and what they are doing (changes rarely)
  //   pos/<run>/<floor>/<room>/<peer> where they stand (frequent, only read by people in that room)
  const peer = 'p' + Math.random().toString(36).slice(2, 10);
  let me = {}, connected = false, posKey = '', posRef = null, posUnsub = null;
  const presRef = fdb.ref(ROOT + '/presence/' + peer);
  const lobby = {}, positions = {};
  const peerCbs = new Set(), connCbs = new Set();
  let peersCache = Object.freeze([]), peersDirty = true, lastSent = 0, posTimer = 0, pendingPos = null;

  const POS = ['x', 'y', 'd', 'm'];
  function buildPeers() {
    if (!peersDirty) return peersCache;
    const out = [];
    for (const id in lobby) {
      const p = lobby[id] || {}, pres = Object.assign({}, decode(p.p || {}), positions[id] || {});
      if (id === peer) Object.assign(pres, me);
      out.push(Object.freeze({ peer: id, by: null, isMe: id === peer || pres.u === uid, sameTab: id === peer, kind: 'viewer', guest: false, presence: Object.freeze(pres), updatedAt: Date.now() }));
    }
    if (!lobby[peer]) out.push(Object.freeze({ peer, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze(Object.assign({}, me)), updatedAt: Date.now() }));
    peersCache = Object.freeze(out); peersDirty = false; return peersCache;
  }
  let notifyQueued = false;
  function notify() {
    peersDirty = true;
    if (notifyQueued) return; notifyQueued = true;
    requestAnimationFrame(() => { notifyQueued = false; const peers = buildPeers(); for (const cb of peerCbs) try { cb({ peers, joined: [], left: [], updated: [] }) } catch (e) { console.error(e) } });
  }

  fdb.ref(ROOT + '/presence').on('value', s => {
    const v = s.val() || {};
    for (const k in lobby) if (!(k in v)) delete lobby[k];
    Object.assign(lobby, v); notify();
  });

  function watchRoom() {
    const key = me.run && me.f && me.r !== undefined && me.r !== null ? `${me.run}/${me.f}/${me.r}` : '';
    if (key === posKey) return;
    if (posUnsub) { posUnsub(); posUnsub = null }
    if (posRef) { posRef.remove().catch(() => { }); posRef.onDisconnect().cancel(); posRef = null }
    for (const k in positions) delete positions[k];
    posKey = key;
    if (!key) { notify(); return }
    const roomRef = fdb.ref(`${ROOT}/pos/${key.split('/').map(enc).join('/')}`);
    const h = s => { const v = s.val() || {}; for (const k in positions) if (!(k in v)) delete positions[k]; for (const k in v) positions[k] = v[k]; notify() };
    roomRef.on('value', h); posUnsub = () => roomRef.off('value', h);
    posRef = roomRef.child(peer); posRef.onDisconnect().remove();
    sendPos(true);
  }
  function sendPos(force) {
    if (!posRef) return;
    const p = {}; for (const k of POS) if (me[k] !== undefined) p[k] = me[k];
    const now = Date.now();
    if (!force && now - lastSent < 160) { pendingPos = p; if (!posTimer) posTimer = setTimeout(() => { posTimer = 0; if (pendingPos) { lastSent = Date.now(); posRef && posRef.set(pendingPos).catch(() => { }); pendingPos = null } }, 170 - (now - lastSent)); return }
    lastSent = now; pendingPos = null; posRef.set(p).catch(() => { });
  }
  let lobbyKey = '';
  function sendLobby() {
    const l = {}; for (const k in me) if (!POS.includes(k)) l[k] = me[k];
    const key = JSON.stringify(l); if (key === lobbyKey) return;
    lobbyKey = key; presRef.set({ p: encode(l), t: TS }).catch(() => { });
  }

  fdb.ref('.info/connected').on('value', s => {
    connected = !!s.val();
    if (connected) { presRef.onDisconnect().remove(); lobbyKey = ''; sendLobby(); if (posRef) { posRef.onDisconnect().remove(); sendPos(true) } }
    for (const cb of connCbs) try { cb(connected) } catch { }
  });
  window.addEventListener('pagehide', () => { presRef.remove(); if (posRef) posRef.remove() });

  let offset = 0; fdb.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0 });
  const joinedAt = () => Date.now() + offset - 3000;

  const room = {
    presence(patch) {
      for (const k in patch) { if (patch[k] === null) delete me[k]; else me[k] = patch[k] }
      watchRoom(); sendLobby(); sendPos(false); notify();
      return Promise.resolve();
    },
    peers: () => buildPeers(),
    onPeers(cb) { peerCbs.add(cb); setTimeout(() => cb({ peers: buildPeers(), joined: buildPeers(), left: [], updated: [] }), 0); return () => peerCbs.delete(cb) },
    connected: () => connected,
    onConnection(cb) { connCbs.add(cb); setTimeout(() => cb(connected), 0); return () => connCbs.delete(cb) },
    emit(topic, data) {
      const ref = fdb.ref(`${ROOT}/events/${enc(topic)}`);
      // keep each topic short: drop messages older than a minute
      ref.orderByChild('t').endAt(Date.now() + offset - 60000).once('value', s => s.forEach(c => { c.ref.remove() })).catch(() => { });
      return ref.push({ d: encode(data === undefined ? null : data), from: peer, t: TS }).then(() => { });
    },
    on(topic, handler) {
      const q = fdb.ref(`${ROOT}/events/${enc(topic)}`).orderByChild('t').startAt(joinedAt());
      const h = s => { const v = s.val() || {}; try { handler({ topic, data: decode(v.d), peer: v.from, by: null, isMe: v.from === peer, sameTab: v.from === peer, kind: 'viewer', guest: false }) } catch (e) { console.error(e) } };
      q.on('child_added', h); return () => q.off('child_added', h);
    },
    sendToClaudeSession: () => Promise.reject({ code: 'claude_unavailable' }),
    canSendToClaudeSession: () => Promise.resolve('off'),
  };

  const caps = { db, room, user };
  window.claude = Object.assign(window.claude || {}, { use: name => Promise.resolve(caps[name] || null) });
})();
