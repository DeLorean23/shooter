import * as THREE from './three.module.js';

const TS = 2;                 // Meter pro Kachel
const EYE = 1.65;             // Augenhöhe am Bildschirm
const SPEED = 3.2;            // m/s
const FOG_HEX = 0xbcd8f2, SKY_TOP = 0x4f93e0;
const hexRaw = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
try { renderer.xr.setFoveation(1); } catch (e) { }
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_HEX);
scene.fog = new THREE.Fog(FOG_HEX, 140, 560);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 3000);
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
camera.position.y = EYE;

const loadTex = (url, o) => new Promise((ok, no) => new THREE.TextureLoader().load(url, t => { Object.assign(t, o); t.needsUpdate = true; ok(t); }, undefined, no));

let W = null, blocked = null, MW = 400;

async function init() {
  const [world, atlas, tiles, idx] = await Promise.all([
    fetch('data/world.json').then(r => r.json()),
    loadTex('data/atlas.png', { colorSpace: THREE.SRGBColorSpace, magFilter: THREE.NearestFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, anisotropy: 4 }),
    loadTex('data/tiles.png', { colorSpace: THREE.NoColorSpace, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false }),
    loadTex('data/ground.png', { colorSpace: THREE.NoColorSpace, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false }),
  ]);
  W = world; MW = world.mw;
  const [AW, AH] = world.atlas;

  /* ---------- Boden ---------- */
  const rows = (tiles.image.height / 16) | 0;
  const avg = (() => { // Durchschnittsfarbe je Kachel (für die Ferne)
    const c = document.createElement('canvas'); c.width = tiles.image.width; c.height = tiles.image.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(tiles.image, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array(16 * rows * 4);
    for (let t = 0; t < 16 * rows; t++) { const tx = (t & 15) * 16, ty = (t >> 4) * 16; let r = 0, gg = 0, b = 0, n = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const i = ((ty + y) * c.width + tx + x) * 4; if (d[i + 3] > 128) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } }
      out[t * 4] = n ? r / n : 90; out[t * 4 + 1] = n ? gg / n : 120; out[t * 4 + 2] = n ? b / n : 90; out[t * 4 + 3] = 255; }
    const tex = new THREE.DataTexture(out, 16, rows, THREE.RGBAFormat); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true; return tex;
  })();
  const fr = hexRaw(FOG_HEX);
  const gm = new THREE.ShaderMaterial({
    uniforms: { uIdx: { value: idx }, uTiles: { value: tiles }, uAvg: { value: avg }, uRows: { value: rows }, uMW: { value: MW }, uFogC: { value: new THREE.Vector3(...fr) }, uFogN: { value: scene.fog.near }, uFogF: { value: scene.fog.far } },
    vertexShader: `varying vec2 vP; varying float vD;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vP = wp.xz / ${TS.toFixed(1)}; vec4 mv = viewMatrix * wp; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `precision highp float; precision highp int;
      uniform sampler2D uIdx, uTiles, uAvg; uniform float uRows, uMW, uFogN, uFogF; uniform vec3 uFogC;
      varying vec2 vP; varying float vD;
      void main(){
        vec3 water = vec3(0.16,0.42,0.78); vec3 col = water;
        ivec2 c = ivec2(floor(vP));
        if (c.x >= 0 && c.y >= 0 && float(c.x) < uMW && float(c.y) < uMW) {
          vec3 t = floor(texelFetch(uIdx, c, 0).rgb * 255.0 + 0.5);
          int vis = int(t.r) + ((int(t.g) & 15) << 8) - 1;
          if (vis >= 0) {
            vec2 f = fract(vP); vec2 tc = vec2(float(vis & 15), float(vis >> 4));
            vec2 uv = (tc + clamp(f, vec2(0.002), vec2(0.998))) / vec2(16.0, uRows);
            vec4 tx = texture2D(uTiles, uv);
            vec3 av = texelFetch(uAvg, ivec2(vis & 15, vis >> 4), 0).rgb;
            float fw = max(fwidth(vP.x), fwidth(vP.y)) * 16.0;
            col = mix(tx.rgb, av, smoothstep(0.35, 1.1, fw));
            if (tx.a < 0.5) col = av;
          }
        }
        float fog = clamp((vD - uFogN) / (uFogF - uFogN), 0.0, 1.0);
        gl_FragColor = vec4(mix(col, uFogC, fog), 1.0);
      }`,
  });
  const R = 4000, gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute([-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, R], 3));
  gg.setIndex([0, 2, 1, 0, 3, 2]);
  const ground = new THREE.Mesh(gg, gm); ground.frustumCulled = false; scene.add(ground);

  /* ---------- Häuser (eine einzige Geometrie) ---------- */
  const pos = [], uv = [], ind = []; blocked = new Uint8Array(MW * MW);
  for (let i = 0; i < MW * MW; i++) { const g = parseInt(world.g[i], 12); blocked[i] = (g === 0 || g === 10 || g === 11) ? 1 : 0; }
  const U = (x, y) => [(x) / AW, 1 - (y) / AH];
  const quad = (p, r) => { const b = pos.length / 3, [rx, ry, rw, rh] = r, e = 0.5;
    for (const q of p) pos.push(...q);
    uv.push(...U(rx + e, ry + rh - e), ...U(rx + rw - e, ry + rh - e), ...U(rx + rw - e, ry + e), ...U(rx + e, ry + e));
    ind.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  for (const f of world.faces) { const [x0, z0, x1, z1, H] = f; quad([[x0, 0, z0], [x1, 0, z1], [x1, H, z1], [x0, H, z0]], f.slice(5)); }
  for (const f of world.roofs) { const [x0, z0, x1, z1, H] = f;
    uv.push(); const b = pos.length / 3, [rx, ry, rw, rh] = f.slice(5), e = 0.5;
    pos.push(x0, H, z0, x1, H, z0, x1, H, z1, x0, H, z1);
    uv.push(...U(rx + e, ry + e), ...U(rx + rw - e, ry + e), ...U(rx + rw - e, ry + rh - e), ...U(rx + e, ry + rh - e)); ind.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  for (const [x0, z0, x1, z1] of world.blk) for (let cz = Math.floor(z0 / TS); cz < Math.ceil(z1 / TS); cz++) for (let cx = Math.floor(x0 / TS); cx < Math.ceil(x1 / TS); cx++) if (cx >= 0 && cz >= 0 && cx < MW && cz < MW) blocked[cz * MW + cx] = 1;
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(ind);
  const bm = new THREE.MeshBasicMaterial({ map: atlas, side: THREE.DoubleSide, fog: true, alphaTest: 0.5 });
  const bld = new THREE.Mesh(bg, bm); bld.frustumCulled = false; scene.add(bld);

  /* ---------- Dinge (Aufsteller, drehen sich zum Spieler) ---------- */
  const fp = [], off = [], pu = [], pi = [];
  for (const p of world.props) { const [x, z, w, h, ax, ay, rx, ry, rw, rh] = p, b = fp.length / 3, e = 0.5;
    for (let k = 0; k < 4; k++) fp.push(x, 0, z);
    off.push(-ax, -(h - ay), w - ax, -(h - ay), w - ax, ay, -ax, ay);
    pu.push(...U(rx + e, ry + rh - e), ...U(rx + rw - e, ry + rh - e), ...U(rx + rw - e, ry + e), ...U(rx + e, ry + e));
    pi.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); pg.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 2));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2)); pg.setIndex(pi);
  const pm = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: atlas }, uFogC: { value: new THREE.Color(FOG_HEX) }, uFogN: { value: scene.fog.near }, uFogF: { value: scene.fog.far } },
    vertexShader: `attribute vec2 aOff; varying vec2 vUv; varying float vD;
      void main(){ vec3 d = cameraPosition - position; vec3 r = normalize(vec3(d.z, 0.0, -d.x) + vec3(1e-5, 0.0, 0.0));
        vec3 p = position + r * aOff.x + vec3(0.0, aOff.y, 0.0); vUv = uv; vec4 mv = viewMatrix * vec4(p, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uFogC; uniform float uFogN, uFogF; varying vec2 vUv; varying float vD;
      void main(){ vec4 c = texture2D(uMap, vUv); if (c.a < 0.5) discard; float fog = clamp((vD - uFogN) / (uFogF - uFogN), 0.0, 1.0);
        gl_FragColor = vec4(mix(c.rgb, uFogC, fog), 1.0); gl_FragColor = linearToOutputTexel(gl_FragColor); }`,
    side: THREE.DoubleSide,
  });
  const props = new THREE.Mesh(pg, pm); props.frustumCulled = false; scene.add(props);

  /* ---------- Himmel ---------- */
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2800, 24, 12), new THREE.ShaderMaterial({
    uniforms: { uH: { value: new THREE.Vector3(...fr) }, uT: { value: new THREE.Vector3(...hexRaw(SKY_TOP)) } }, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uH, uT; varying float vY; void main(){ gl_FragColor = vec4(mix(uH, uT, pow(clamp(vY,0.0,1.0), 0.55)), 1.0); }` }));
  sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky); sky.userData.follow = true; window.__sky = sky;

  rig.position.set(world.start[0], 0, world.start[1]);
  if (Q.has('x')) rig.position.set(+Q.get('x'), 0, +Q.get('z'));
  yaw = Q.has('yaw') ? +Q.get('yaw') * Math.PI / 180 : 0; pitch = Q.has('pitch') ? +Q.get('pitch') * Math.PI / 180 : 0;
  rig.rotation.y = yaw; camera.rotation.x = pitch;
}

/* ---------- Bewegung ---------- */
let yaw = 0, pitch = 0;
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; }); addEventListener('keyup', e => { keys[e.code] = false; });
let drag = false;
renderer.domElement.addEventListener('pointerdown', e => { drag = true; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointerup', () => { drag = false; });
renderer.domElement.addEventListener('pointermove', e => { if (!drag || renderer.xr.isPresenting) return; yaw -= e.movementX * 0.004; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.004)); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const isBlocked = (x, z) => { const cx = Math.floor(x / TS), cz = Math.floor(z / TS); if (cx < 0 || cz < 0 || cx >= MW || cz >= MW) return true; return blocked[cz * MW + cx] === 1; };
const free = (x, z) => { const r = 0.35; return !(isBlocked(x - r, z - r) || isBlocked(x + r, z - r) || isBlocked(x - r, z + r) || isBlocked(x + r, z + r)); };
function moveBy(dx, dz) { const p = rig.position; if (free(p.x + dx, p.z)) p.x += dx; if (free(p.x, p.z + dz)) p.z += dz; }

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
let snapArmed = true;
function stepXR(dt) {
  const s = renderer.xr.getSession(); if (!s) return;
  let lx = 0, ly = 0, rx = 0;
  for (const src of s.inputSources) { const gp = src.gamepad; if (!gp) continue; const a = gp.axes, X = a.length >= 4 ? a[2] : a[0], Y = a.length >= 4 ? a[3] : a[1];
    if (src.handedness === 'left') { lx = X; ly = Y; } else if (src.handedness === 'right') { rx = X; } }
  const dz = Math.abs(lx) < 0.15 && Math.abs(ly) < 0.15;
  if (!dz) { const xc = renderer.xr.getCamera(); xc.getWorldQuaternion(tmpQ); tmpV.set(0, 0, -1).applyQuaternion(tmpQ); const h = Math.atan2(-tmpV.x, -tmpV.z) ; // Blickrichtung
    const fx = -Math.sin(h), fz = -Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
    moveBy((fx * -ly + sx * lx) * SPEED * dt, (fz * -ly + sz * lx) * SPEED * dt); }
  if (Math.abs(rx) < 0.35) snapArmed = true;
  else if (snapArmed && Math.abs(rx) > 0.7) { snapArmed = false; const ang = (rx > 0 ? -1 : 1) * Math.PI / 6;
    const xc = renderer.xr.getCamera(); const head = new THREE.Vector3().setFromMatrixPosition(xc.matrixWorld);
    const before = head.clone(); rig.rotation.y += ang; rig.updateMatrixWorld(true);
    // Kopf bleibt am Platz: Rig um die Kopfposition drehen
    const rel = before.clone().sub(rig.position); const c = Math.cos(ang), sn = Math.sin(ang);
    const rx2 = rel.x * c + rel.z * sn, rz2 = rel.x * -sn + rel.z * c; rig.position.x += rel.x - rx2; rig.position.z += rel.z - rz2; }
}
function stepDesk(dt) {
  rig.rotation.y = yaw; camera.rotation.x = pitch;
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (keys.ArrowLeft) yaw += 1.6 * dt; if (keys.ArrowRight) yaw -= 1.6 * dt;
  if (f || r) { const fx = -Math.sin(yaw), fz = -Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw); moveBy((fx * f + sx * r) * SPEED * dt, (fz * f + sz * r) * SPEED * dt); }
}

let tLast = performance.now();
renderer.setAnimationLoop(() => {
  const tn = performance.now(), dt = Math.min((tn - tLast) / 1000, 0.1); tLast = tn;
  if (W) { if (renderer.xr.isPresenting) stepXR(dt); else stepDesk(dt);
    const hp = new THREE.Vector3().setFromMatrixPosition((renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).matrixWorld); if (window.__sky) window.__sky.position.copy(hp); }
  renderer.render(scene, camera);
});

/* ---------- Start ---------- */
(async () => {
  try { await init(); } catch (e) { $('m').textContent = 'Fehler beim Laden: ' + e.message; console.error(e); return; }
  $('m').textContent = 'Stadt geladen.';
  const hide = () => { $('s').style.display = 'none'; };
  $('z').disabled = false; $('z').onclick = hide;
  let vr = false; try { vr = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { }
  if (vr) { $('b').disabled = false; $('b').onclick = async () => {
    try { const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] }); await renderer.xr.setSession(s); hide(); s.addEventListener('end', () => { $('s').style.display = 'flex'; }); }
    catch (e) { $('m').textContent = 'VR konnte nicht gestartet werden: ' + e.message; } }; $('m').textContent = 'Stadt geladen. Mit dem linken Stick gehen, mit dem rechten Stick drehen.'; }
  else { $('b').textContent = 'VR nicht verfügbar'; $('m').textContent = 'Stadt geladen. Am Bildschirm: WASD gehen, Maus ziehen zum Umsehen. Für VR diese Seite im Quest-Browser öffnen.'; }
  if (Q.has('auto')) hide();
})();
