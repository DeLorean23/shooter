import * as THREE from './three.module.js';

/* GTA DDR – Shooter VR: Spiellogik (Waffen, Item-Boxen, NPC-Kämpfer, Passanten, Deathmatch, Menü, Anzeige, Töne)
   Maße: 1 Weltpixel des Originals = 0,125 m, 1 Kachel = 2 m. */
const PX = 0.125, PI = Math.PI, TAU = PI * 2;
const DM_SEC = 300, MAXBOTS = 12;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const NAMES = ['KURT', 'HEIKE', 'DIETER', 'UTE', 'FRANK', 'SABINE', 'LOTHAR', 'GISELA', 'HORST', 'RENATE', 'ERICH', 'INGE'];

/* ---------- Sprite-Stapel: viele Aufsteller in einem einzigen Zeichenaufruf ---------- */
class Batch {
  constructor(tex, max, scene) {
    this.max = max; this.n = 0; this.pos = new Float32Array(max * 12); this.uv = new Float32Array(max * 8);
    const idx = new Uint32Array(max * 6); for (let k = 0; k < max; k++) { const b = k * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], k * 6); }
    this.geo = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage); this.ua = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pa); this.geo.setAttribute('uv', this.ua); this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5, fog: true }));
    this.mesh.frustumCulled = false; scene.add(this.mesh); this.tw = tex.image.width; this.th = tex.image.height;
  }
  begin() { this.n = 0; }
  /* Mittelpunkt (px,py,pz), Blickrichtung nach rechts (rx,rz), Ausdehnung x0..x1 (rechts) und y0..y1 (oben), Bildausschnitt r = [x,y,w,h] in Pixeln */
  add(px, py, pz, rx, rz, x0, x1, y0, y1, r, flip) {
    if (this.n >= this.max) return; const i = this.n * 12, j = this.n * 8, p = this.pos, u = this.uv;
    p[i] = px + rx * x0; p[i + 1] = py + y0; p[i + 2] = pz + rz * x0;
    p[i + 3] = px + rx * x1; p[i + 4] = py + y0; p[i + 5] = pz + rz * x1;
    p[i + 6] = px + rx * x1; p[i + 7] = py + y1; p[i + 8] = pz + rz * x1;
    p[i + 9] = px + rx * x0; p[i + 10] = py + y1; p[i + 11] = pz + rz * x0;
    let ua = r[0] / this.tw, ub = (r[0] + r[2]) / this.tw; const vt = 1 - r[1] / this.th, vb = 1 - (r[1] + r[3]) / this.th;
    if (flip) { const t = ua; ua = ub; ub = t; }
    u[j] = ua; u[j + 1] = vb; u[j + 2] = ub; u[j + 3] = vb; u[j + 4] = ub; u[j + 5] = vt; u[j + 6] = ua; u[j + 7] = vt; this.n++;
  }
  end() { this.geo.setDrawRange(0, this.n * 6); this.pa.needsUpdate = true; this.ua.needsUpdate = true; }
}

const loadTex = (url, o) => new Promise((ok, no) => new THREE.TextureLoader().load(url, t => { Object.assign(t, o); t.needsUpdate = true; ok(t); }, undefined, no));

/* ---------- Töne (selbst erzeugt, keine Dateien) ---------- */
const Snd = {
  ctx: null,
  init() { if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; } try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.nb = this.noise(1.2); } catch (e) { } },
  noise(sec) { const c = this.ctx, b = c.createBuffer(1, Math.floor(c.sampleRate * sec), c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; },
  burst(vol, dur, f0, f1, type, pan) {
    const c = this.ctx; if (!c) return; const t = c.currentTime, s = c.createBufferSource(); s.buffer = this.nb; const f = c.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(c.destination); s.start(t, Math.random() * 0.5, dur + 0.05);
  },
  tone(f0, f1, dur, vol, type) {
    const c = this.ctx; if (!c) return; const t = c.currentTime, o = c.createOscillator(); o.type = type || 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  shot(w, far) { const v = far ? 0.12 : 0.5; if (w.expl) { this.burst(v, 0.35, 900, 200, 'lowpass'); return; } if (w.pellets > 1) { this.burst(v * 1.2, 0.28, 1400, 250, 'lowpass'); return; }
    if (w.range >= 600) { this.burst(v * 1.2, 0.35, 2600, 300, 'lowpass'); return; } if (w.auto) { this.burst(v * 0.8, 0.07, 2600, 900); return; } this.burst(v, 0.12, w.dmg >= 5 ? 1500 : 2200, 500); },
  boom() { this.burst(0.9, 0.9, 700, 60, 'lowpass'); this.tone(120, 35, 0.6, 0.5, 'sawtooth'); },
  hit() { this.tone(900, 500, 0.06, 0.18); }, hurt() { this.tone(220, 90, 0.18, 0.3, 'sawtooth'); },
  pick() { this.tone(880, 880, 0.07, 0.2); setTimeout(() => this.tone(1320, 1320, 0.1, 0.2), 70); },
  heal() { this.tone(520, 780, 0.2, 0.22, 'triangle'); }, empty() { this.tone(300, 260, 0.05, 0.15); }, sel() { this.tone(660, 600, 0.04, 0.12); },
  kill() { this.tone(500, 900, 0.12, 0.2, 'triangle'); },
};

export async function initGame(C) {
  const { scene, camera, rig, renderer, world, TS, isBlocked, moveBy, Q } = C;
  const G = await (await fetch('data/game.json')).json();
  const charTex = await loadTex('data/chars.png', { colorSpace: THREE.SRGBColorSpace, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
  const fxTex = await loadTex('data/fx.png', { colorSpace: THREE.SRGBColorSpace, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
  const WP = G.weapons, WBY = {}; for (const w of WP) WBY[w.id] = w;
  const NP = G.npcs, MW = world.mw;
  const gt = new Uint8Array(MW * MW); for (let i = 0; i < MW * MW; i++) gt[i] = parseInt(world.g[i], 12);
  const WALKG = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const groundAt = (x, z) => { const cx = Math.floor(x / TS), cz = Math.floor(z / TS); return cx < 0 || cz < 0 || cx >= MW || cz >= MW ? 0 : gt[cz * MW + cx]; };
  const freeR = (x, z, r) => !(isBlocked(x - r, z - r) || isBlocked(x + r, z - r) || isBlocked(x - r, z + r) || isBlocked(x + r, z + r));
  const walkable = (x, z) => WALKG.has(groundAt(x, z)) && freeR(x, z, 0.45);

  const chars = new Batch(charTex, 420, scene), fx = new Batch(fxTex, 1100, scene);
  const START = { x: world.start[0], z: world.start[1] };

  /* ---------- Zustand ---------- */
  const S = {
    state: 'menu', mode: 'dm', screen: 'main', paused: false, botN: 5, pedN: 34, hp: 100, inv: 0, dead: false, t: 0, time: DM_SEC, over: false,
    have: {}, ammo: {}, cur: null, cd: 0, flash: 0, wd: [], rk: [], gfx: [], tr: [], feed: [], toast: null, hurtT: 0,
    score: { 0: [0, 0] }, bots: [], peds: [], boxT: new Float32Array(G.boxes.length), healT: new Float32Array(G.heals.length), fireHeld: false, nameT: 0,
  };
  try { const b = parseInt(localStorage.getItem('vr_botN')), p = parseInt(localStorage.getItem('vr_pedN')); if (b >= 0 && b <= MAXBOTS) S.botN = b; if (p >= 0 && p <= 200) S.pedN = p; } catch (e) { }
  const own = () => WP.filter(w => S.have[w.id]);
  function resetLoadout() { S.have = {}; S.ammo = {}; for (const w of WP) if (w.start > 0) { S.have[w.id] = 1; S.ammo[w.id] = Math.min(w.max, w.start); } S.cur = own()[0] ? own()[0].id : null; S.cd = 0; }

  /* ---------- Spielerposition ---------- */
  const hv = new THREE.Vector3(), hq = new THREE.Quaternion();
  const xrOn = () => S._fx || renderer.xr.isPresenting;
  function head() { camera.getWorldPosition(hv); return hv; }
  const ppos = () => { const h = head(); return { x: h.x, z: h.z }; };
  function teleport(x, z) { const h = ppos(); rig.position.x += x - h.x; rig.position.z += z - h.z; }

  /* ---------- Steuerung: Controller ---------- */
  const ctl = { left: null, right: null }, conn = [];
  for (let i = 0; i < 2; i++) { const c = renderer.xr.getController(i); rig.add(c); conn.push(c);
    c.addEventListener('connected', e => { c.userData.hand = e.data.handedness; c.userData.gp = e.data.gamepad; if (e.data.handedness === 'right') ctl.right = c; if (e.data.handedness === 'left') ctl.left = c; });
    c.addEventListener('disconnected', () => { if (ctl.right === c) ctl.right = null; if (ctl.left === c) ctl.left = null; }); }

  /* ---------- Hand-Waffe (VR) ---------- */
  const handGrp = new THREE.Group(); handGrp.visible = false;
  const gunMat = new THREE.MeshBasicMaterial({ map: fxTex, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
  const gunGeo = new THREE.PlaneGeometry(1, 1), gun = new THREE.Mesh(gunGeo, gunMat); gun.rotation.y = PI / 2; const gp = new THREE.Group(); gp.add(gun); handGrp.add(gp);
  const flashMat = new THREE.MeshBasicMaterial({ map: fxTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, fog: false, depthWrite: false });
  const flashM = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat); flashM.visible = false; flashM.rotation.y = PI / 2; gp.add(flashM);
  const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6)]), new THREE.LineBasicMaterial({ color: 0xffe070 }));
  laser.visible = false; handGrp.add(laser);
  function uvSet(mesh, r) { const u0 = r[0] / fxTex.image.width, u1 = (r[0] + r[2]) / fxTex.image.width, vt = 1 - r[1] / fxTex.image.height, vb = 1 - (r[1] + r[3]) / fxTex.image.height, uv = mesh.geometry.attributes.uv;
    uv.setXY(0, u0, vt); uv.setXY(1, u1, vt); uv.setXY(2, u0, vb); uv.setXY(3, u1, vb); uv.needsUpdate = true; }
  gun.geometry = gunGeo.clone(); flashM.geometry = flashM.geometry.clone();
  let handFor = null;
  const egoTex = {}, egoMat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, fog: false }), egoP = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), egoMat); egoP.visible = false; egoP.frustumCulled = false; scene.add(egoP);
  function egoGet(src) { let t = egoTex[src]; if (!t) { t = egoTex[src] = new THREE.TextureLoader().load(src, tt => { tt.colorSpace = THREE.SRGBColorSpace; tt.magFilter = THREE.NearestFilter; tt.minFilter = THREE.NearestFilter; tt.needsUpdate = true; }); } return t; }
  const aimV = new THREE.Vector3(), cpV = new THREE.Vector3();
  function setHandWeapon() {
    const w = WBY[S.cur]; if (!w) { gun.visible = false; return; } gun.visible = true; handFor = w.id; uvSet(gun, w.r.seite);
    const L = w.r.seite[2] * (w.szHand / 100) * 0.012; gun.scale.set(L, L * w.r.seite[3] / w.r.seite[2], 1); gun.position.set(0, 0, -L * 0.35);
    uvSet(flashM, w.r.feuer); const FL = 0.16; flashM.scale.set(FL, FL * w.r.feuer[3] / w.r.feuer[2], 1); flashM.position.set(0, 0, -L * 0.85 - 0.05);
  }

  /* ---------- Bildschirm-Anzeige (Desktop) ---------- */
  const dom = document.createElement('div'); dom.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;font-family:monospace';
  const hudC = document.createElement('canvas'); hudC.width = 640; hudC.height = 360; hudC.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;display:none';
  const egoI = document.createElement('img'); egoI.style.cssText = 'position:absolute;right:0;bottom:0;height:62vh;image-rendering:pixelated;display:none';
  const cross = document.createElement('div'); cross.style.cssText = 'position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px #000;display:none';
  const flashD = document.createElement('div'); flashD.style.cssText = 'position:absolute;inset:0;background:#f00;opacity:0';
  const menuC = document.createElement('canvas'); menuC.width = 640; menuC.height = 460; menuC.style.cssText = 'position:absolute;left:50%;top:50%;width:min(92vw,128vh*0.78);transform:translate(-50%,-50%);image-rendering:pixelated;pointer-events:auto;display:none;cursor:pointer';
  const flashX = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false })); flashX.renderOrder = 1000; flashX.position.z = -0.3; flashX.frustumCulled = false; camera.add(flashX);
  dom.append(hudC, egoI, cross, flashD, menuC); document.body.appendChild(dom);

  /* ---------- HUD / Menü als Leinwand (auch als Fläche in VR) ---------- */
  function lockPtr() { try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
  const font = (g, s) => { g.font = 'bold ' + s + 'px monospace'; };
  function txt(g, s, x, y, col, size, al) { font(g, size || 18); g.textAlign = al || 'left'; g.fillStyle = '#000'; g.fillText(s, x + 2, y + 2); g.fillStyle = col || '#fff'; g.fillText(s, x, y); }
  function panel(g, x, y, w, h, col) { g.fillStyle = col || 'rgba(8,12,40,.82)'; g.fillRect(x, y, w, h); g.strokeStyle = '#7f8ff0'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); }
  const wImg = new Image(); wImg.src = 'data:,'; const fxImg = fxTex.image;
  const nameOf = id => id === 0 ? 'DU' : (S.bots.find(b => b.id === id) || { name: '?' }).name;
  function sortedScore() { const L = [{ id: 0, n: 'DU' }].concat(S.bots.map(b => ({ id: b.id, n: b.name }))); L.sort((a, b) => S.score[b.id][0] - S.score[a.id][0] || S.score[a.id][1] - S.score[b.id][1]); return L; }
  function drawHud(g, W, H) {
    g.clearRect(0, 0, W, H);
    // Herzen
    panel(g, 4, 4, 250, 46); const hh = Math.ceil(S.hp / 20);
    for (let i = 0; i < 5; i++) { g.fillStyle = i < hh ? '#ff4060' : '#402030'; const x = 16 + i * 36; g.beginPath(); g.moveTo(x + 14, 40); g.bezierCurveTo(x - 6, 24, x + 2, 10, x + 14, 22); g.bezierCurveTo(x + 26, 10, x + 34, 24, x + 14, 40); g.fill(); }
    // Waffe / Munition
    const w = WBY[S.cur]; panel(g, 4, 56, 250, 62);
    if (w) { const r = w.r.symbol; g.imageSmoothingEnabled = false; g.drawImage(fxImg, r[0], r[1], r[2], r[3], 12, 62, 96, 48); txt(g, w.name.slice(0, 11), 112, 80, '#f8e070', 15); txt(g, 'MUNITION ' + (S.ammo[w.id] | 0), 112, 104, '#fff', 15); }
    else txt(g, 'KEINE WAFFE', 14, 94, '#f88', 16);
    // Deathmatch-Tafel
    if (S.mode === 'dm') { const L = sortedScore().slice(0, 6), bw = 200, bh = 36 + L.length * 22; panel(g, W - bw - 4, 4, bw, bh);
      const m = Math.floor(S.time / 60), s = Math.floor(S.time % 60); txt(g, 'DEATHMATCH', W - bw + 6, 28, '#f8e070', 16); txt(g, m + ':' + String(s).padStart(2, '0'), W - 10, 28, '#fff', 16, 'right');
      L.forEach((q, i) => { const sc = S.score[q.id]; txt(g, q.n.slice(0, 9), W - bw + 6, 52 + i * 22, q.id === 0 ? '#fff' : '#c0c8f0', 15); txt(g, sc[0] + '/' + sc[1], W - 10, 52 + i * 22, '#a0f0a0', 15, 'right'); }); }
    // Meldungen
    let y = 150; for (const f of S.feed.slice(-4)) { txt(g, f.t, 6, y, f.c || '#ffe08a', 14); y += 18; }
    if (S.toast && S.toast.t > 0) txt(g, S.toast.s, W / 2, H - 14, '#ffe65a', 18, 'center');
  }
  const hudTex = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 320; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData = { c }; return t; })();
  const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.1875), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, depthTest: false, fog: false })); hudMesh.renderOrder = 998; hudMesh.visible = false; scene.add(hudMesh);

  /* ---------- Menü ---------- */
  const mTex = (() => { const t = new THREE.CanvasTexture(menuC); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const menuMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7 * 460 / 640), new THREE.MeshBasicMaterial({ map: mTex, transparent: true, depthTest: false, fog: false, side: THREE.DoubleSide })); menuMesh.renderOrder = 997; menuMesh.visible = false; scene.add(menuMesh);
  let regions = [], sel = -1;
  function drawMenu() {
    const g = menuC.getContext('2d'), W = 640, H = 460; g.clearRect(0, 0, W, H); regions = [];
    panel(g, 0, 0, W, H, 'rgba(10,14,50,.93)');
    const btn = (label, y, act, x, w, h) => { x = x == null ? 120 : x; w = w || 400; h = h || 44; const i = regions.length; regions.push({ x, y, w, h, act }); g.fillStyle = sel === i ? '#3c56d8' : '#243080'; g.fillRect(x, y, w, h); g.strokeStyle = sel === i ? '#fff' : '#7f8ff0'; g.lineWidth = 3; g.strokeRect(x + 1, y + 1, w - 2, h - 2); txt(g, label, x + w / 2, y + h / 2 + 7, '#fff', 20, 'center'); };
    if (S.screen === 'over') {
      txt(g, 'RUNDE VORBEI', W / 2, 54, '#f8e070', 32, 'center'); const L = sortedScore(); txt(g, (L[0].id === 0 ? 'DU HAST GEWONNEN!' : L[0].n + ' HAT GEWONNEN'), W / 2, 92, '#a0f0a0', 20, 'center');
      L.slice(0, 8).forEach((q, i) => { txt(g, (i + 1) + '. ' + q.n, 170, 134 + i * 26, q.id === 0 ? '#fff' : '#c0c8f0', 18); txt(g, S.score[q.id][0] + ' FRAGS / ' + S.score[q.id][1], 470, 134 + i * 26, '#a0f0a0', 18, 'right'); });
      btn('NOCH EINE RUNDE', 350, () => startGame('dm')); btn('MENÜ', 402, () => { S.screen = 'main'; drawMenu(); mTex.needsUpdate = true; }, 120, 400, 40); return;
    }
    txt(g, 'GTA DDR – SHOOTER', W / 2, 52, '#f8e070', 32, 'center'); txt(g, 'AUF DEINER STADT', W / 2, 78, '#a0a8d0', 15, 'center');
    btn('DEATHMATCH  (5 MINUTEN)', 94, () => startGame('dm')); btn('FREIES SPIEL', 146, () => startGame('free'));
    const row = (label, val, y, dec, inc) => { txt(g, label, 20, y + 29, '#c0c8f0', 18); btn('−', y, dec, 270, 60, 40); txt(g, String(val), 380, y + 29, '#fff', 22, 'center'); btn('+', y, inc, 430, 60, 40); };
    row('NPC-KÄMPFER', S.botN, 206, () => { S.botN = clamp(S.botN - 1, 0, MAXBOTS); save(); }, () => { S.botN = clamp(S.botN + 1, 0, MAXBOTS); save(); });
    row('PASSANTEN', S.pedN, 254, () => { S.pedN = clamp(S.pedN - 10, 0, 200); save(); }, () => { S.pedN = clamp(S.pedN + 10, 0, 200); save(); });
    if (S.paused) btn('WEITERSPIELEN', 306, () => closeMenu());
    const hint = xrOn() ? ['LINKER STICK: LAUFEN    RECHTER STICK: DREHEN', 'TRIGGER: SCHIESSEN    A: SPRINGEN    GRIFF RECHTS: ZOOM', 'B ODER RECHTER STICK HOCH/RUNTER: WAFFE WECHSELN    Y: MENÜ'] : ['W A S D: LAUFEN    MAUS: ZIELEN    LINKE MAUSTASTE: SCHIESSEN', 'RECHTE MAUSTASTE: SPRINGEN    LEERTASTE: ZOOM', 'MAUSRAD ODER ZIFFERN 1-8: WAFFE WECHSELN    ESC: MENÜ'];
    hint.forEach((s, i) => txt(g, s, W / 2, 376 + i * 24, '#a0a8d0', 14, 'center'));
    mTex.needsUpdate = true;
  }
  function save() { try { localStorage.setItem('vr_botN', S.botN); localStorage.setItem('vr_pedN', S.pedN); } catch (e) { } drawMenu(); }
  function click(i) { if (i >= 0 && regions[i]) { Snd.sel(); regions[i].act(); drawMenu(); } }
  function openMenu(paused) {
    S.paused = !!paused; S.state = 'menu'; if (!paused) S.screen = S.over ? 'over' : 'main'; else S.screen = 'main';
    drawMenu(); menuC.style.display = xrOn() ? 'none' : 'block'; cross.style.display = 'none'; try { document.exitPointerLock(); } catch (e) { }
    placeMenu(); S.place = xrOn() ? 20 : 0; menuMesh.visible = xrOn(); laser.visible = xrOn();
  }
  function placeMenu() { // Fläche vor den Kopf setzen
    const h = head().clone(); const cam = camera; const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(hq)); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
    menuMesh.position.set(h.x + f.x * 1.8, h.y - 0.05, h.z + f.z * 1.8); menuMesh.lookAt(h.x, h.y - 0.05, h.z);
  }
  function closeMenu() { S.state = 'play'; S.paused = false; menuC.style.display = 'none'; menuMesh.visible = false; laser.visible = false; cross.style.display = xrOn() ? 'none' : 'block'; if (!xrOn()) lockPtr(); }

  /* ---------- Spielstart ---------- */
  function startGame(mode) {
    Snd.init(); S.mode = mode; S.over = false; S.screen = 'main'; S.dead = false; S.hp = 100; S.inv = 1.5; S.time = DM_SEC; S.feed = []; S.toast = null;
    resetLoadout(); S.wd = []; S.rk = []; S.gfx = []; S.tr = []; S.peds = []; S.bots = []; S.boxT.fill(0); S.healT.fill(0); S.score = { 0: [0, 0] };
    if (mode === 'dm') mkBots();
    if (Q.has('x') && !S._q) { S._q = 1; teleport(+Q.get('x'), +Q.get('z')); } else teleport(START.x, START.z); closeMenu(); handFor = null;
  }
  function mkBots() {
    const pool = NP.map((n, i) => i).sort(() => Math.random() - 0.5), nm = NAMES.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < S.botN; i++) { const id = 101 + i; S.bots.push({ id, name: nm[i % nm.length], npc: pool[i % pool.length], x: 0, z: 0, face: 0, anim: 0, moving: false, alive: false, hp: 0, aim: 0, respT: 1.5 + i * 0.6, cd: 0, burst: 1, gx: null, gz: 0, stuck: 0, w: null, dead: false, deadT: 0, kind: 'bot' }); S.score[id] = [0, 0]; }
  }

  /* ---------- Hilfen ---------- */
  function sight(x0, z0, x1, z1) { const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.5); for (let i = 1; i < n; i++) { const t = i / n; if (isBlocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false; } return true; }
  function stepTo(e, tx, tz, sp, dt) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz); if (d < 0.05) { e.moving = false; return; }
    const sx = dx / d * sp * dt, sz = dz / d * sp * dt; let moved = false;
    if (freeR(e.x + sx, e.z + sz, 0.4)) { e.x += sx; e.z += sz; moved = true; }
    else if (freeR(e.x + sx, e.z, 0.4)) { e.x += sx; moved = true; } else if (freeR(e.x, e.z + sz, 0.4)) { e.z += sz; moved = true; }
    e.moving = moved; e.stuck = moved ? Math.max(0, e.stuck - dt) : e.stuck + dt; e.face = Math.atan2(dz, dx); e.anim += dt * sp * 2.2;
  }
  function addFeed(t, c) { S.feed.push({ t, c, life: 6 }); if (S.feed.length > 6) S.feed.shift(); }
  function toast(s) { S.toast = { s, t: 2.2 }; }

  /* ---------- Waffen ---------- */
  function giveAmmo(w, n) { const b = S.ammo[w.id] | 0; S.have[w.id] = 1; S.ammo[w.id] = Math.min(w.max, b + n); if (!S.cur) S.cur = w.id; return S.ammo[w.id] - b; }
  function nextWeapon(d) { const o = own(); if (o.length < 2) return; const i = o.findIndex(w => w.id === S.cur); S.cur = o[(i + d + o.length) % o.length].id; S.nameT = 1.5; Snd.sel(); toast(WBY[S.cur].name); }
  function selectNum(n) { const w = WP[n]; if (w && S.have[w.id]) { S.cur = w.id; S.nameT = 1.5; Snd.sel(); toast(w.name); } }
  const aimO = new THREE.Vector3(), aimD = new THREE.Vector3();
  function aimRay() {
    if (xrOn() && ctl.right) { ctl.right.updateMatrixWorld(true); ctl.right.getWorldPosition(aimO); aimD.set(0, 0, -1).transformDirection(ctl.right.matrixWorld); aimO.addScaledVector(aimD, 0.18); }
    else { camera.updateMatrixWorld(true); camera.getWorldPosition(aimO); aimD.set(0, 0, -1).transformDirection(camera.matrixWorld); aimO.addScaledVector(aimD, 0.3); aimO.y -= 0.12; }
    return [aimO, aimD];
  }
  /* Strahl gegen senkrechte Zylinder + Gelände */
  function wallT(o, d, maxD) { for (let t = 0.3; t <= maxD; t += 0.25) { const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; if (y < 0) return t; if (y < 25 && isBlocked(x, z)) return t; } return maxD; }
  function rayEnts(o, dx, dy, dz, maxT, list, r) {
    const out = []; const a = dx * dx + dz * dz; if (a < 1e-6) return out;
    for (const e of list) { if (e.dead || (e.kind === 'bot' && !e.alive)) continue; const fx = o.x - e.x, fz = o.z - e.z, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r, disc = b * b - 4 * a * c; if (disc < 0) continue;
      let t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0) { if (c < 0) t = 0; else continue; } if (t > maxT) continue; const y = o.y + dy * t, H = e.h || 1.8; if (y < -0.1 || y > H) continue; out.push({ e, t }); }
    out.sort((p, q) => p.t - q.t); return out;
  }
  function tracer(a, b, col) { S.tr.push({ a: a.clone(), b: b.clone(), life: 0.07, col: col || 0xfff0a0 }); }
  function fireWeapon() {
    const w = WBY[S.cur]; if (!w || S.cd > 0 || S.dead) return; if ((S.ammo[w.id] | 0) <= 0) { S.cd = 0.3; Snd.empty(); toast('KEINE MUNITION'); return; }
    S.ammo[w.id]--; S.cd = w.tempo / 60; S.flash = 0.07; Snd.shot(w);
    const [o, d] = aimRay(); const O = o.clone(), D0 = d.clone(); panicNear(O.x, O.z, 9);
    if (w.expl) { S.rk.push({ x: O.x, y: O.y, z: O.z, dx: D0.x, dy: D0.y, dz: D0.z, life: w.range * PX / 45, w, own: 0 }); }
    else for (let n = 0; n < w.pellets; n++) {
      const D = D0.clone(); if (w.spread) { D.x += (Math.random() - 0.5) * 2 * w.spread; D.y += (Math.random() - 0.5) * 2 * w.spread; D.z += (Math.random() - 0.5) * 2 * w.spread; D.normalize(); }
      const R = w.range * PX, wt = wallT(O, D, R), hits = rayEnts(O, D.x, D.y, D.z, wt, S.bots.concat(S.peds), 0.55); let end = wt, pierce = w.pierce;
      for (const h of hits) { hitEnt(h.e, w, 0); if (--pierce <= 0) { end = h.t; break; } }
      tracer(O.clone().addScaledVector(D, 0.4), O.clone().addScaledVector(D, Math.min(end, R)));
    }
  }
  function hitEnt(e, w, from) {
    Snd.hit();
    if (e.kind === 'bot') botHurt(e, (w.pellets > 1 ? 4 : 5) * w.dmg * (from >= 100 ? 0.7 : 1), from);
    else { e.hp -= w.dmg; if (e.hp <= 0) pedKill(e, from); else panic(e); }
  }
  function panic(e) { if (e.dead) return; e.flee = 3.2; const p = ppos(); e.fa = Math.atan2(e.z - p.z, e.x - p.x) + rnd(-0.5, 0.5); }
  function panicNear(x, z, r) { for (const e of S.peds) if (!e.dead && Math.hypot(e.x - x, e.z - z) < r && Math.random() < 0.8) { e.flee = 3.2; e.fa = Math.atan2(e.z - z, e.x - x) + rnd(-0.6, 0.6); } }
  function pedKill(e, from) {
    e.dead = true; e.deadT = 4; e.moving = false; if (S.mode === 'dm' && from === 0) { S.score[0][0]++; Snd.kill(); }
    if (Math.random() < 0.2) { const L = []; let tot = 0; for (const w of WP) { const wt = w.drop.passant || 0; if (wt > 0) { L.push([w, wt]); tot += wt; } } if (L.length && S.wd.length < 14) { let r = Math.random() * tot, pick = L[0][0]; for (const [w, wt] of L) { r -= wt; if (r <= 0) { pick = w; break; } } S.wd.push({ x: e.x, z: e.z, id: pick.id, t: 0 }); } }
  }
  function botHurt(b, dmg, from) {
    if (!b.alive || S.over) return; b.hp -= dmg;
    if (b.hp <= 0) { b.alive = false; b.dead = true; b.deadT = 3; b.hp = 0; b.moving = false; b.respT = 3.3; kill(from, b.id); }
  }
  function kill(killer, victim) {
    const s = S.score; s[victim][1]++; if (killer != null && killer !== victim) s[killer][0]++;
    const k = killer == null || killer === victim; addFeed(k ? nameOf(victim) + ' IST GESTORBEN' : nameOf(killer) + ' HAT ' + nameOf(victim) + ' ERLEDIGT', '#ffdc78'); if (killer === 0 && victim !== 0) Snd.kill();
  }
  function explode(x, y, z, w, owner) {
    Snd.boom(); S.gfx.push({ t: 'boom', x, y: Math.max(0.5, y), z, life: 0.6, max: 0.6 }); const R = 60 * PX;
    for (const b of S.bots) if (b.alive) { const d = Math.hypot(b.x - x, b.z - z); if (d < R) botHurt(b, Math.round(100 * (1 - d / R)), owner); }
    for (const p of S.peds) if (!p.dead && Math.hypot(p.x - x, p.z - z) < R) pedKill(p, owner);
    const p = ppos(), d = Math.hypot(p.x - x, p.z - z); if (d < R) hurt(Math.round(60 * (1 - d / R)), owner);
  }
  function hurt(d, from) {
    if (S.dead || S.inv > 0 || S.state !== 'play') return; S.hp -= d; S.hurtT = 0.35; Snd.hurt(); if (S.hp <= 0) { S.hp = 0; die(from); }
  }
  function die(from) {
    S.dead = true; kill(from, 0); toast('DU BIST TOT'); setTimeout(() => respawn(), 1400);
  }
  function respawn() {
    if (S.state === 'menu' && S.screen === 'over') return; let sx = START.x, sz = START.z;
    for (let i = 0; i < 14; i++) { const a = Math.random() * TAU, d = 1.75 + Math.random() * 7.5, x = START.x + Math.cos(a) * d, z = START.z + Math.sin(a) * d; if (walkable(x, z)) { sx = x; sz = z; break; } }
    S.hp = 100; S.dead = false; S.inv = 1.5; teleport(sx, sz);
  }

  /* ---------- Passanten ---------- */
  function spawnPed(p) {
    for (let t = 0; t < 12; t++) { const a = Math.random() * TAU, d = rnd(18, 85), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (!walkable(x, z)) continue;
      const i = (Math.random() * NP.length) | 0, N = NP[i]; S.peds.push({ kind: 'ped', npc: i, x, z, face: Math.random() * TAU, anim: 0, moving: false, hp: N.beh === 'polizist' ? 4 : 3, gx: null, gz: 0, stuck: 0, flee: 0, dead: false, deadT: 0, h: 1.8 * N.groesse,
        sp: 1.5 * N.tempo * (N.beh === 'jogger' ? 2.2 : N.beh === 'arbeiter' ? 0.65 : N.beh === 'polizist' ? 0.9 : 1) }); return; }
  }
  function tickPeds(dt, p) {
    let spawned = 0; while (S.peds.filter(e => !e.dead).length < S.pedN && spawned++ < 2) { const n0 = S.peds.length; spawnPed(p); if (S.peds.length === n0) break; }
    for (let i = S.peds.length - 1; i >= 0; i--) {
      const e = S.peds[i]; if (e.dead) { e.deadT -= dt; if (e.deadT <= 0) S.peds.splice(i, 1); continue; }
      const far = Math.hypot(e.x - p.x, e.z - p.z); if (far > 110) { S.peds.splice(i, 1); continue; } if (far > 130 * 2) continue;
      if (e.flee > 0) { e.flee -= dt; stepTo(e, e.x + Math.cos(e.fa) * 5, e.z + Math.sin(e.fa) * 5, 3.2, dt); if (e.stuck > 0.4) { e.fa += rnd(1.5, 3); e.stuck = 0; } continue; }
      if (e.gx == null || Math.hypot(e.gx - e.x, e.gz - e.z) < 0.6 || e.stuck > 1) { e.stuck = 0; e.gx = null; for (let t = 0; t < 10; t++) { const a = e.face + rnd(-1.4, 1.4), d = rnd(8, 22), x = e.x + Math.cos(a) * d, z = e.z + Math.sin(a) * d; if (walkable(x, z)) { e.gx = x; e.gz = z; break; } } }
      if (e.gx != null) stepTo(e, e.gx, e.gz, e.sp, dt); else { e.moving = false; e.face += dt; }
    }
  }

  /* ---------- NPC-Kämpfer ---------- */
  function pickW() { const pool = WP.filter(w => !w.expl && w.range >= 120); return pool[(Math.random() * pool.length) | 0] || WP[0]; }
  function spawnBot(b, p) {
    const unseen = (x, z, far) => { const d = Math.hypot(p.x - x, p.z - z); return d > 20 && (d > far || !sight(p.x, p.z, x, z)); };
    for (let k = 0; k < 2; k++) for (let t = 0; t < 70; t++) { const a = Math.random() * TAU, d = k ? rnd(25, 45) : rnd(35, 75), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d; if (!walkable(x, z) || !unseen(x, z, k ? 40 : 80)) continue;
      b.x = x; b.z = z; b.alive = true; b.dead = false; b.hp = 100; b.w = pickW(); b.cd = rnd(1.2, 2.4); b.burst = 1; b.gx = null; b.moving = false; b.stuck = 0; return; }
    b.respT = 1;
  }
  function botFire(b, a) {
    const w = b.w, ox = b.x + Math.cos(a) * 0.9, oz = b.z + Math.sin(a) * 0.9; Snd.shot(w, Math.hypot(b.x - ppos().x, b.z - ppos().z) > 12); const p = ppos();
    for (let n = 0; n < w.pellets; n++) { const ang = a + (Math.random() - 0.5) * 2 * w.spread, dx = Math.cos(ang), dz = Math.sin(ang), R = Math.min(w.range, 330) * PX;
      let end = R; for (let d = 0.5; d <= R; d += 0.5) { const x = ox + dx * d, z = oz + dz * d; if (isBlocked(x, z)) { end = d; break; } }
      // Spieler
      const px = p.x - ox, pz = p.z - oz, t = px * dx + pz * dz; if (!S.dead && t > 0 && t < end && Math.hypot(px - dx * t, pz - dz * t) < 0.9) { hurt((w.pellets > 1 ? 4 : 5) * w.dmg * 0.5, b.id); end = t; }
      else for (const o of S.bots) { if (o === b || !o.alive) continue; const qx = o.x - ox, qz = o.z - oz, tt = qx * dx + qz * dz; if (tt > 0 && tt < end && Math.hypot(qx - dx * tt, qz - dz * tt) < 0.9) { botHurt(o, (w.pellets > 1 ? 4 : 5) * w.dmg * 0.7, b.id); end = tt; break; } }
      tracer(new THREE.Vector3(ox, 1.3, oz), new THREE.Vector3(ox + dx * end, 1.3, oz + dz * end), 0xffb070); }
  }
  function tickBots(dt, p) {
    for (const b of S.bots) {
      if (!b.alive) { b.moving = false; if (b.dead) { b.deadT -= dt; if (b.deadT <= 0) b.dead = false; } b.respT -= dt; if (b.respT <= 0 && !b.dead) spawnBot(b, p); continue; }
      let tg = null, td = 1e9; const cand = []; if (!S.dead) cand.push({ x: p.x, z: p.z }); for (const o of S.bots) if (o !== b && o.alive) cand.push(o);
      for (const q of cand) { const d = Math.hypot(q.x - b.x, q.z - b.z); if (d < td) { td = d; tg = q; } }
      b.seeT = (b.seeT || 0) - dt; if (b.seeT <= 0) { b.seeT = 0.25; b.see = !!tg && td < 260 * PX && sight(b.x, b.z, tg.x, tg.z); } const see = b.see, sp = 3.5;
      if (see) { b.aim = Math.atan2(tg.z - b.z, tg.x - b.x);
        if (td > 120 * PX) stepTo(b, tg.x, tg.z, sp, dt); else if (td < 55 * PX) stepTo(b, b.x - Math.cos(b.aim) * 5, b.z - Math.sin(b.aim) * 5, sp * 0.8, dt); else b.moving = false;
        b.face = b.aim; b.cd -= dt;
        if (b.w && b.cd <= 0 && td < Math.min(b.w.range, 250) * PX * 0.95) { botFire(b, b.aim + (Math.random() - 0.5) * 0.16); if (--b.burst > 0) b.cd = Math.max(0.1, b.w.tempo / 60); else { b.burst = b.w.auto ? 3 + ((Math.random() * 4) | 0) : 1; b.cd = rnd(0.65, 1.5); } } }
      else if (tg && td < 480 * PX) { b.aim = Math.atan2(tg.z - b.z, tg.x - b.x); stepTo(b, tg.x, tg.z, sp, dt); b.cd = Math.max(b.cd, 0.35); }
      else { if (b.gx == null || Math.hypot(b.gx - b.x, b.gz - b.z) < 1.2 || b.stuck > 0.4) { b.stuck = 0; b.gx = null; for (let t = 0; t < 14; t++) { const a = Math.random() * TAU, d = rnd(15, 40), x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d; if (walkable(x, z)) { b.gx = x; b.gz = z; break; } } }
        if (b.gx != null) stepTo(b, b.gx, b.gz, sp * 0.8, dt); else b.moving = false; }
    }
  }

  /* ---------- Geschosse, Funde, Boxen, Heilung ---------- */
  function tickRockets(dt) {
    for (let i = S.rk.length - 1; i >= 0; i--) { const r = S.rk[i]; let boom = false; const steps = Math.ceil(45 * dt / 0.5);
      for (let k = 0; k < steps && !boom; k++) { const st = 45 * dt / steps; r.x += r.dx * st; r.y += r.dy * st; r.z += r.dz * st;
        if (r.y < 0 || (r.y < 25 && isBlocked(r.x, r.z))) boom = true; else for (const e of S.bots.concat(S.peds)) { if (e.dead || (e.kind === 'bot' && !e.alive)) continue; if (Math.hypot(e.x - r.x, e.z - r.z) < 0.7 && r.y < 1.9) { boom = true; break; } } }
      r.life -= dt; if (boom || r.life <= 0) { explode(r.x, r.y, r.z, r.w, r.own); S.rk.splice(i, 1); } }
  }
  function tickPickups(dt, p) {
    for (let i = 0; i < G.boxes.length; i++) { if (S.boxT[i] > 0) { S.boxT[i] -= dt; continue; } const b = G.boxes[i]; if (Math.abs(b[0] - p.x) < 1 && Math.abs(b[1] - p.z) < 1 && !S.dead) {
      S.boxT[i] = 6; const w = WP[(Math.random() * WP.length) | 0], n = giveAmmo(w, Math.max(1, w.fund)); Snd.pick(); toast(w.name + ' +' + n); S.gfx.push({ t: 'burst', x: b[0], y: 0.8, z: b[1], life: 0.35, max: 0.35 }); } }
    for (let i = S.wd.length - 1; i >= 0; i--) { const d = S.wd[i]; d.t += dt; if (d.t > 50) { S.wd.splice(i, 1); continue; } if (Math.hypot(d.x - p.x, d.z - p.z) < 1.1 && !S.dead) { const w = WBY[d.id]; const n = giveAmmo(w, w.fund); Snd.pick(); toast(w.name + ' +' + n); S.wd.splice(i, 1); } }
    for (let i = 0; i < G.heals.length; i++) { if (S.healT[i] > 0) { S.healT[i] -= dt; continue; } const h = G.heals[i]; if (Math.abs(h[0] - p.x) < 1 && Math.abs(h[1] - p.z) < 1 && !S.dead && S.hp < 100) { const D = G.healDef[h[2]]; S.hp = Math.min(100, S.hp + D.heal * 20); S.healT[i] = 90; Snd.heal(); toast('+ ' + D.hn); } }
  }

  /* ---------- Zeichnen der Figuren, Dinge, Effekte ---------- */
  const cp = new THREE.Vector3();
  function drawChar(e) {
    const N = NP[e.npc], bear = Math.atan2(e.z - cp.z, e.x - cp.x), row = ((Math.round((e.face - bear - PI / 2) / (PI / 4)) % 8) + 8) % 8;
    const frame = e.dead ? 4 : e.moving ? [1, 2, 3, 2][Math.floor(e.anim) % 4] : 0, sc = 1.75 * N.groesse / (N.bot - N.top), dx = cp.x - e.x, dz = cp.z - e.z, L = Math.hypot(dx, dz) || 1;
    if (e.dead && e.deadT < 0.8) return; chars.add(e.x, 0, e.z, dz / L, -dx / L, -N.cw * sc / 2, N.cw * sc / 2, -(N.ch - N.bot) * sc, N.bot * sc, [N.x + frame * N.cw, N.y + row * N.ch, N.cw, N.ch]);
  }
  function sprite(r, x, y, z, hM, anchorBottom) { const dx = cp.x - x, dz = cp.z - z, L = Math.hypot(dx, dz) || 1, w = hM * r[2] / r[3]; fx.add(x, y, z, dz / L, -dx / L, -w / 2, w / 2, anchorBottom ? 0 : -hM / 2, anchorBottom ? hM : hM / 2, r); }
  function render(dt) {
    cp.copy(head()); chars.begin(); fx.begin();
    for (const e of S.bots) if (e.alive || e.dead) { if (Math.hypot(e.x - cp.x, e.z - cp.z) < 150) drawChar(e); }
    for (const e of S.peds) if (Math.hypot(e.x - cp.x, e.z - cp.z) < 120) drawChar(e);
    chars.end();
    const tt = S.t;
    for (let i = 0; i < G.boxes.length; i++) { const b = G.boxes[i]; if (S.boxT[i] > 0 || Math.abs(b[0] - cp.x) > 90 || Math.abs(b[1] - cp.z) > 90) continue; const f = G.box[Math.floor(tt * 7.5) % G.box.length]; sprite(f.r, b[0], 0.75 + Math.sin(tt * 3 + b[0]) * 0.06, b[1], 0.9, false); }
    for (let i = 0; i < G.heals.length; i++) { const h = G.heals[i]; if (S.healT[i] > 0 || Math.abs(h[0] - cp.x) > 90 || Math.abs(h[1] - cp.z) > 90) continue; const r = G.healR[h[2]]; sprite(r, h[0], 0.1 + Math.sin(tt * 2.2 + h[0]) * 0.05, h[1], 0.5, true); }
    for (const d of S.wd) { const w = WBY[d.id]; sprite(w.r.fund, d.x, 0.1 + Math.sin(tt * 3 + d.x) * 0.05, d.z, 0.5 * w.szFund / 60, true); }
    for (const r of S.rk) sprite(G.fx.rakete.slice(0, 2).concat([24, 10]), r.x, r.y, r.z, 0.35, false);
    for (const g of S.gfx) { const k = 1 - g.life / g.max; if (g.t === 'boom') { const fr = Math.min(7, Math.floor(k * 8)), R = G.fx.explosion; sprite([R[0] + fr * 32, R[1], 32, 32], g.x, g.y + 1.5, g.z, 9, false); } else if (g.t === 'burst') { const R = G.fx.funken, fr = Math.min(3, Math.floor(k * 4)); sprite([R[0] + fr * 12, R[1], 12, 12], g.x, g.y, g.z, 1.6, false); } else if (g.t === 'flash') { sprite(g.r, g.x, g.y, g.z, 1.2, false); } }
    fx.end();
    // Leuchtspuren
    for (const l of laserPool) l.visible = false; let li = 0;
    for (const t of S.tr) { const m = laserPool[li++] || addLaser(); m.visible = true; const a = m.geometry.attributes.position; a.setXYZ(0, t.a.x, t.a.y, t.a.z); a.setXYZ(1, t.b.x, t.b.y, t.b.z); a.needsUpdate = true; m.material.color.setHex(t.col); }
    // Waffe in der Hand / Bildschirm
    if (xrOn()) { handGrp.visible = false; gun.visible = false; flashM.visible = false; const w = WBY[S.cur];
      if (ctl.right && w && !S.dead && S.state === 'play') { ctl.right.updateMatrixWorld(true); ctl.right.getWorldPosition(cpV); aimV.set(0, 0, -1).transformDirection(ctl.right.matrixWorld);
        const k = clamp((w.szEgo || 100) / 100, 0.3, 1.5), hh = 0.42 * k, src = 'data/ego/' + w.id + (S.flash > 0 ? '_ego_schuss' : '_ego') + '.png'; egoMat.map = egoGet(src); egoMat.needsUpdate = true;
        egoP.scale.set(hh, hh, 1); egoP.position.copy(cpV).addScaledVector(aimV, 0.12); egoP.position.y += hh * 0.5 - 0.1;
        const hp = head(); egoP.rotation.set(0, Math.atan2(hp.x - egoP.position.x, hp.z - egoP.position.z), 0); egoP.visible = true; } else egoP.visible = false;
      if (false) { handGrp.visible = !S.dead; if (ctl.right && handGrp.parent !== ctl.right) ctl.right.add(handGrp); if (handFor !== S.cur) setHandWeapon(); flashM.visible = S.flash > 0; if (ctl.right) { ctl.right.updateMatrixWorld(true); const v = head().clone().applyMatrix4(new THREE.Matrix4().copy(ctl.right.matrixWorld).invert()); if (Math.hypot(v.x, v.y) > 1e-3) gp.rotation.z = Math.atan2(v.y, v.x); } } }
  }
  const laserPool = []; function addLaser() { const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]), new THREE.LineBasicMaterial({ color: 0xfff0a0 })); m.frustumCulled = false; scene.add(m); laserPool.push(m); return m; }

  /* ---------- Eingaben ---------- */
  const keys = {}; let mouseDown = false, locked = false, wheelAcc = 0;
  const gpPrev = {};
  addEventListener('keydown', e => {
    if (e.repeat) return; keys[e.code] = true;
    if (e.code === 'Escape' && S.state === 'play') openMenu(true);
    if (S.state === 'play') { const m = /^Digit([1-8])$/.exec(e.code); if (m) selectNum(+m[1] - 1); if (e.code === 'KeyQ') nextWeapon(-1); if (e.code === 'KeyE') nextWeapon(1); }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; if (!locked && S.state === 'play' && !xrOn()) openMenu(true); });
  renderer.domElement.addEventListener('pointerdown', e => { if (xrOn() || S.state !== 'play') return; Snd.init(); if (!locked) { lockPtr(); } if (e.button === 0) { mouseDown = true; fireWeapon(); } });
  addEventListener('pointerup', e => { if (e.button === 0) mouseDown = false; });
  addEventListener('mousemove', e => { if (!locked || S.state !== 'play') return; C.look(-e.movementX * 0.0022, -e.movementY * 0.0022); });
  addEventListener('wheel', e => { if (S.state !== 'play') return; wheelAcc += e.deltaY; if (Math.abs(wheelAcc) > 40) { nextWeapon(wheelAcc > 0 ? 1 : -1); wheelAcc = 0; } }, { passive: true });
  menuC.addEventListener('pointermove', e => { const r = menuC.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 640, y = (e.clientY - r.top) / r.height * 460; const i = regions.findIndex(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); if (i !== sel) { sel = i; drawMenu(); } });
  menuC.addEventListener('pointerdown', e => { e.preventDefault(); Snd.init(); const r = menuC.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 640, y = (e.clientY - r.top) / r.height * 460; const i = regions.findIndex(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); click(i); });

  const ray = new THREE.Raycaster();
  function pollXR() {
    const s = renderer.xr.getSession(); if (!s) return; const edge = (k, v) => { const r = v && !gpPrev[k]; gpPrev[k] = v; return r; };
    for (const src of s.inputSources) { const gp = src.gamepad; if (!gp) continue; const h = src.handedness, b = gp.buttons, B = i => !!(b[i] && b[i].pressed);
      if (h === 'right') { const trg = B(0); S.fireHeld = trg; if (S.state === 'play') { if (edge('rt', trg)) fireWeapon(); if (edge('a', B(4))) jump(); if (edge('b', B(5))) nextWeapon(1); const ry = gp.axes.length >= 4 ? gp.axes[3] : 0, rxx = gp.axes.length >= 4 ? gp.axes[2] : 0; if (Math.abs(ry) < 0.4) S._sa = true; else if (S._sa && Math.abs(ry) > 0.85 && Math.abs(rxx) < 0.6) { S._sa = false; nextWeapon(ry < 0 ? 1 : -1); } S.zoom = B(1); } else if (edge('rt', trg)) click(sel); }
      if (h === 'left') { if (edge('y', B(5)) && S.state === 'play') openMenu(true); } }
    if (S.state === 'menu' && ctl.right) { // Zeigestrahl auf die Menüfläche
      ctl.right.updateMatrixWorld(true); const o = new THREE.Vector3().setFromMatrixPosition(ctl.right.matrixWorld), d = new THREE.Vector3(0, 0, -1).transformDirection(ctl.right.matrixWorld); ray.set(o, d);
      const hit = ray.intersectObject(menuMesh, false)[0]; let ns = -1; if (hit && hit.uv) { const x = hit.uv.x * 640, y = (1 - hit.uv.y) * 460; ns = regions.findIndex(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); }
      if (ns !== sel) { sel = ns; drawMenu(); } if (handGrp.parent !== ctl.right) ctl.right.add(handGrp); handGrp.visible = true; gun.visible = false; laser.visible = true; }
  }

  /* ---------- Springen und Zoom ---------- */
  S.jy = 0; S.vy = 0; S.zoom = false; const BASEFOV = camera.fov;
  function jump() { if (S.state === 'play' && !S.dead && S.jy <= 0 && S.vy === 0) { S.vy = 4.6; Snd.jump && Snd.jump(); } }
  function tickJump(dt) { if (S.jy > 0 || S.vy !== 0) { S.vy -= 14 * dt; S.jy += S.vy * dt; if (S.jy <= 0) { S.jy = 0; S.vy = 0; } } rig.position.y = S.jy; }
  addEventListener('contextmenu', e => { if (!xrOn() && S.state === 'play') e.preventDefault(); });
  renderer.domElement.addEventListener('pointerdown', e => { if (e.button === 2) jump(); });
  addEventListener('keydown', e => { if (e.code === 'Space' && S.state === 'play') { S.zoom = true; e.preventDefault(); } });
  addEventListener('keyup', e => { if (e.code === 'Space') S.zoom = false; });
  const zf = () => (S.cur === 'Scharfschuetzengewehr' ? 5 : 2.2);
  const scopeRT = new THREE.WebGLRenderTarget(512, 512), scopeCam = new THREE.PerspectiveCamera(14, 1, 0.1, 3000);
  const scopeM = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), new THREE.MeshBasicMaterial({ map: scopeRT.texture, fog: false, depthTest: false })); scopeM.renderOrder = 996; scopeM.visible = false; scene.add(scopeM);
  const scopeR = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.185, 40), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, depthTest: false })); scopeR.renderOrder = 997; scopeM.add(scopeR);
  function tickZoom() {
    const z = S.zoom && S.state === 'play' && !S.dead;
    if (!xrOn()) { const f = z ? BASEFOV / zf() : BASEFOV; if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }
    scopeM.visible = z && xrOn() && !!ctl.right;
  }
  function preRender() { // Zoom-Fenster in VR: Blick entlang der rechten Hand
    if (!scopeM.visible) return; ctl.right.updateMatrixWorld(true); ctl.right.getWorldPosition(scopeCam.position); aimV.set(0, 0, -1).transformDirection(ctl.right.matrixWorld); scopeCam.fov = 70 / zf(); scopeCam.updateProjectionMatrix();
    scopeCam.lookAt(scopeCam.position.clone().add(aimV)); scopeCam.updateMatrixWorld(true);
    const en = renderer.xr.enabled; renderer.xr.enabled = false; const pr = renderer.getRenderTarget(); egoP.visible = false; scopeM.visible = false; renderer.setRenderTarget(scopeRT); renderer.render(scene, scopeCam); renderer.setRenderTarget(pr); renderer.xr.enabled = en; scopeM.visible = true; egoP.visible = true;
    const h = head(); const cm = camera.getWorldQuaternion(hq); scopeM.position.copy(h).add(new THREE.Vector3(0.12, -0.12, -0.55).applyQuaternion(cm)); scopeM.quaternion.copy(cm);
  }

  /* ---------- Hauptschritt ---------- */
  let hudT = 0;
  function update(dt) {
    S.t += dt; tickJump(dt); tickZoom(); const p = ppos();
    if (xrOn()) { pollXR(); if (S.state === 'menu' && S.place > 0) { if (head().y > 0.4) placeMenu(); S.place--; } } else { cross.style.display = S.state === 'play' ? 'block' : 'none'; }
    if (S.state === 'play') {
      if (S.cd > 0) S.cd -= dt; if (S.flash > 0) S.flash -= dt; if (S.inv > 0) S.inv -= dt; if (S.nameT > 0) S.nameT -= dt; if (S.hurtT > 0) S.hurtT -= dt; if (S.toast) S.toast.t -= dt;
      for (const f of S.feed) f.life -= dt; S.feed = S.feed.filter(f => f.life > 0);
      const w = WBY[S.cur]; if (w && w.auto && (mouseDown || (xrOn() && S.fireHeld)) && !S.dead) fireWeapon();
      if (S.mode === 'dm' && !S.over) { S.time -= dt; if (S.time <= 0) { S.time = 0; S.over = true; Snd.pick(); S.screen = 'over'; openMenu(false); } }
      tickPeds(dt, p); tickBots(dt, p); tickRockets(dt); tickPickups(dt, p);
      for (let i = S.gfx.length - 1; i >= 0; i--) { S.gfx[i].life -= dt; if (S.gfx[i].life <= 0) S.gfx.splice(i, 1); }
      for (let i = S.tr.length - 1; i >= 0; i--) { S.tr[i].life -= dt; if (S.tr[i].life <= 0) S.tr.splice(i, 1); }
    } else { for (let i = S.tr.length - 1; i >= 0; i--) { S.tr[i].life -= dt; if (S.tr[i].life <= 0) S.tr.splice(i, 1); } }
    render(dt);
    { const fo = S.dead ? 0.55 : clamp(S.hurtT * 1.4, 0, 0.5); flashD.style.opacity = fo; flashX.material.opacity = xrOn() ? fo * 0.7 : 0; flashX.visible = fo > 0 && xrOn(); }
    // Anzeige
    hudT -= dt; if (hudT <= 0 && S.state === 'play') { hudT = 0.1; if (xrOn()) { const c = hudTex.userData.c, g = c.getContext('2d'); drawHud(g, 512, 320); hudTex.needsUpdate = true; } else { drawHud(hudC.getContext('2d'), 640, 360); } }
    hudC.style.display = !xrOn() && S.state === 'play' ? 'block' : 'none';
    if (xrOn()) egoI.style.display = 'none'; else { const w = WBY[S.cur]; if (S.state === 'play' && w && !S.dead) { const src = 'data/ego/' + w.id + (S.flash > 0 ? '_ego_schuss' : '_ego') + '.png'; if (egoI.dataset.s !== src) { egoI.dataset.s = src; egoI.src = src; } egoI.style.display = 'block'; const k = clamp((w.szEgo || 100) / 100, 0.3, 1.5); egoI.style.height = 62 * k + 'vh'; } else egoI.style.display = 'none'; }
    // VR: Anzeige am linken Handgelenk
    if (xrOn()) { hudMesh.visible = S.state === 'play'; if (hudMesh.visible) { const l = ctl.left; if (l) { l.updateMatrixWorld(true); hudMesh.position.setFromMatrixPosition(l.matrixWorld); hudMesh.quaternion.setFromRotationMatrix(l.matrixWorld); hudMesh.translateY(0.1); hudMesh.translateZ(-0.02); hudMesh.rotateX(-PI * 0.38); }
      else { const cm = S._fx ? camera : camera; hudMesh.position.copy(head()); hudMesh.quaternion.copy(cm.getWorldQuaternion(hq)); hudMesh.translateX(-0.35); hudMesh.translateY(-0.3); hudMesh.translateZ(-0.8); } } }
  }

  /* ---------- Start ---------- */
  resetLoadout(); drawMenu();
  const api = {
    update, preRender, jump, canMove: () => S.state === 'play' && !S.dead || (S.dead && false), ownsMouse: () => !xrOn(), locked: () => locked, S, startGame, openMenu,
    onXR(on) { Snd.init(); if (on) { menuC.style.display = 'none'; try { document.exitPointerLock(); } catch (e) { } hudC.style.display = 'none'; if (S.state === 'menu') openMenu(S.paused); } else { menuC.style.display = S.state === 'menu' ? 'block' : 'none'; menuMesh.visible = false; hudMesh.visible = false; handGrp.visible = false; laser.visible = false; } },
    dbg: { hand: () => [handGrp.visible, gun.visible, handGrp.parent && handGrp.parent.type, gun.scale.toArray(), hudMesh.visible, hudMesh.position.toArray(), S.state, handFor], fakeXR() { S._fx = true; conn[0].matrixAutoUpdate = conn[1].matrixAutoUpdate = true; ctl.right = conn[0]; ctl.left = conn[1]; conn[0].position.set(0.25, -0.35, -0.5); conn[1].position.set(-0.25, -0.35, -0.5); camera.add(conn[0], conn[1]); conn[0].updateMatrixWorld(true); }, nChars: () => chars.n, cp: () => [cp.x, cp.z], fire: fireWeapon, give: id => giveAmmo(WBY[id], 50), cur: id => { S.cur = id; }, tp: teleport, hurt, kill, ppos },
  };
  window.__G = api;
  if (Q.has('play')) { S.botN = Q.has('bots') ? +Q.get('bots') : S.botN; S.pedN = Q.has('peds') ? +Q.get('peds') : S.pedN; startGame(Q.get('play') === 'free' ? 'free' : 'dm'); }
  else openMenu(false);
  return api;
}
