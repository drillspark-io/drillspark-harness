// 入口。ページ内の <script type="application/json"> 2つ（office-data / office-models）だけを読み、外へは取りに行かない。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { injectCss, createHud, renderFallback } from './hud.js';
import { loadTemplates } from './animals.js';
import { buildFloor } from './floor.js';
import { createClock, ease, CANCELLED } from './motion.js';
import { createPlayer } from './playback.js';

const readJson = (id) => JSON.parse(document.getElementById(id).textContent);

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

async function boot() {
  const data = readJson('office-data');
  const models = readJson('office-models');
  injectCss();
  const app = document.getElementById('app');
  if (!webglOk()) {
    renderFallback(app, data);
    return;
  }
  const loading = document.createElement('div');
  loading.className = 'ao-loading';
  loading.textContent = '社員が出社しています…';
  app.append(loading);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.append(renderer.domElement);
  const css2d = new CSS2DRenderer();
  css2d.domElement.className = 'ao-css2d';
  app.append(css2d.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe3f2');
  scene.fog = new THREE.Fog('#cfe3f2', 60, 140);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 3;
  controls.maxDistance = 120;

  scene.add(new THREE.HemisphereLight('#ffffff', '#b9a98f', 1.6));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  const clock = createClock();
  const templates = await loadTemplates(models);
  loading.remove();

  const floors = new Map();
  let current = null;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const hud = createHud(app, {
    onPlay() {
      if (!player.running) {
        clock.paused = false;
        player.play(data.rootKey).catch((e) => { if (e !== CANCELLED) console.error(e); });
      } else {
        clock.paused = !clock.paused;
        hud.setPaused(clock.paused);
      }
    },
    onReset: reset,
    onSpeed(v) { clock.speed = v; },
  });
  hud.setTitle(data.title);

  /** 階をシーンから外す。CSS2D の札は子孫には removed が届かず DOM に残るので、ここで外す（戻れば描画時に付け直される） */
  function detach(f) {
    scene.remove(f.group);
    f.group.traverse((o) => { if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element); });
  }

  function getFloor(key) {
    if (!floors.has(key)) floors.set(key, buildFloor(data.floors[key], templates, clock));
    return floors.get(key);
  }

  function fitCamera(f) {
    const aspect = camera.aspect || 1;
    const dist = f.span * (aspect < 1 ? 1.1 / aspect : 0.78) + 4;
    controls.target.copy(f.center);
    camera.position.set(f.center.x, dist * 0.62, f.center.z + dist * 0.8);
    const s = f.span / 2 + 4;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: s * 4 + 40 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.position.set(f.center.x + s * 0.6, s * 1.8 + 10, f.center.z + s);
    sun.target.position.copy(f.center);
  }

  function chainOf(key) {
    const chain = [];
    for (let k = key; k; k = data.floors[k].parent) chain.unshift(k);
    return chain.map((k) => ({ key: k, title: data.floors[k].title, floorName: data.floors[k].floorName }));
  }

  function showFloorUi(f) {
    hud.setCrumb(chainOf(f.key), f.key, (k) => browseTo(k));
    hud.setList(f.data, (id) => pick(id, true));
    hud.showInfo(null);
  }

  async function goFloor(key, instant) {
    if (current && current.key === key) return current;
    const next = getFloor(key);
    const prev = current;
    current = next;
    scene.add(next.group);
    showFloorUi(next);
    fitCamera(next);
    if (!prev || instant || reduceMotion) {
      next.group.position.y = 0;
      if (prev) detach(prev);
      return next;
    }
    const dy = next.data.depth >= prev.data.depth ? 1 : -1; // 深い階へ＝床が上へ抜けていく
    hud.toast(`${next.data.floorName} ${next.data.title}`);
    try {
      await clock.run(1.1, (t) => {
        const e = ease(t);
        prev.group.position.y = 14 * dy * e;
        next.group.position.y = -14 * dy * (1 - e);
      });
    } finally {
      detach(prev);
      prev.group.position.y = 0;
      next.group.position.y = 0;
    }
    return next;
  }

  function browseTo(key) {
    if (player.running) {
      hud.toast('再生中は階を移れません（↺ 最初から で止める）');
      return;
    }
    goFloor(key).catch(() => {});
  }

  /** 工程を選ぶ: カメラを寄せ、説明を出す。子図があれば「下の階へ」 */
  function pick(id, move) {
    if (!current) return;
    const n = current.nodes.get(id);
    if (!n) return;
    if (move) {
      const delta = new THREE.Vector3(n.x, 0, n.z).sub(controls.target);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    const canEnter = n.drill && data.floors[id] && !player.running;
    hud.showInfo(current.data, n, canEnter ? () => browseTo(id) : null);
    hud.markCurrent(id);
  }

  const player = createPlayer({
    clock,
    hud,
    opts: hud.opts,
    goFloor: (k) => goFloor(k),
    hasFloor: (k) => !!data.floors[k],
  });

  function reset() {
    clock.cancelAll();
    hud.cancelChoice();
    clock.paused = false;
    for (const f of floors.values()) detach(f);
    floors.clear();
    current = null;
    goFloor(data.rootKey, true);
  }

  // クリックで工程を選ぶ（ドラッグと区別する）
  const ray = new THREE.Raycaster();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || !current) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(current.group, true).find((h) => h.object.userData.nodeId);
    if (hit) pick(hit.object.userData.nodeId, false);
  });

  function resize() {
    const w = app.clientWidth;
    const h = app.clientHeight;
    renderer.setSize(w, h);
    css2d.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  await goFloor(data.rootKey, true);

  const timer = new THREE.Clock();
  const tmp = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const raw = timer.getDelta();
    clock.tick(raw);
    const scaled = clock.paused ? 0 : Math.min(raw, 0.1) * clock.speed;
    for (const f of floors.values()) f.update(scaled, raw);
    if (player.running && hud.opts.follow && player.carrier && !clock.paused) {
      player.carrier.root.getWorldPosition(tmp);
      const delta = tmp.setY(0).sub(controls.target).multiplyScalar(Math.min(1, raw * 2.5));
      controls.target.add(delta);
      camera.position.add(delta);
      // 追っている間は寄る（全景のままだと動物が豆粒になる）
      const off = camera.position.clone().sub(controls.target);
      if (off.length() > 15) camera.position.copy(controls.target).add(off.multiplyScalar(1 - Math.min(1, raw * 1.5) * 0.5));
    }
    controls.update();
    renderer.render(scene, camera);
    css2d.render(scene, camera);
  });
}

boot().catch((err) => {
  console.error(err);
  const app = document.getElementById('app');
  if (app) app.textContent = `表示に失敗しました: ${err && err.message ? err.message : err}`;
});
