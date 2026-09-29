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
  // タッチのピンチ・ドラッグはブラウザに渡さず 3D の操作にする（2 本指 = 拡大縮小と平行移動、1 本指 = 回転）
  renderer.domElement.style.touchAction = 'none';
  const css2d = new CSS2DRenderer();
  css2d.domElement.className = 'ao-css2d';
  app.append(css2d.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe3f2');
  scene.fog = new THREE.Fog('#cfe3f2', 60, 140);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // 地図と同じ操作: 左ドラッグ／1 本指 = 平行移動（床に沿って）、右ドラッグ = 回転、ホイール／ピンチ = 拡大縮小、矢印キー = 移動
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false;
  controls.zoomToCursor = false; // カーソルの位置へ寄せると、パッドのピンチで場所がずれて飛んだ。画面の中心へ寄る
  controls.listenToKeyEvents(window);
  controls.keyPanSpeed = 25;
  controls.zoomSpeed = 1.6;
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
        useFollowDistance();
        player.play(data.rootKey).catch((e) => { if (e !== CANCELLED) console.error(e); });
      } else {
        clock.paused = !clock.paused;
        hud.setPaused(clock.paused);
      }
    },
    onReset: reset,
    onSpeed(v) { clock.speed = v; },
    onZoom(k) {
      const off = camera.position.clone().sub(controls.target);
      const len = THREE.MathUtils.clamp(off.length() * k, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(off.setLength(len));
      zoomScale = len / baseDist; // 寄り具合を覚える（階が変わっても保つ）
    },
    onFit() {
      zoomScale = 1;
      stopFollowByUser();
      if (current) fitCamera(current);
    },
  });
  hud.setTitle(data.title);
  // 今の工程（札の重なりを間引くとき最優先で残す）
  let focusId = null;
  const setStep = hud.setStep;
  hud.setStep = (f, n, ...rest) => { focusId = n ? n.id : null; return setStep.call(hud, f, n, ...rest); };

  /** 階をシーンから外す。CSS2D の札は子孫には removed が届かず DOM に残るので、ここで外す（戻れば描画時に付け直される） */
  function detach(f) {
    scene.remove(f.group);
    f.group.traverse((o) => { if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element); });
  }

  function getFloor(key) {
    if (!floors.has(key)) floors.set(key, buildFloor(data.floors[key], templates, clock));
    return floors.get(key);
  }

  const ELEV = THREE.MathUtils.degToRad(52); // 見下ろす角度。浅いと部署の列が重なって見えた
  /** 幅 w・奥行き d が画面に収まる距離（横は水平画角、奥行きは見下ろした分の見かけの高さで） */
  function distanceFor(w, d) {
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * (camera.aspect || 1));
    const byW = (w / 2) / Math.tan(hHalf);
    const byD = ((d * Math.sin(ELEV)) / 2) / Math.tan(vHalf);
    return Math.max(byW, byD) * 1.12; // 上下の操作盤の分だけ余白
  }
  function placeCamera(target, dist) {
    controls.target.copy(target);
    camera.position.set(target.x, target.y + dist * Math.sin(ELEV), target.z + dist * Math.cos(ELEV));
  }
  // カメラの距離 = 基準の距離 × 利用者の寄り具合（zoomScale）。基準は、止まっているときは全景、再生中は部署が全部入る程度。
  // 寄り具合は ＋／－・ホイール・ピンチで変わり、階が変わっても保つ。「全体」で 1 に戻す。
  // 追従中にカメラが距離を勝手に変えることはしない（毎コマ引き戻していて「勝手に縮小される」と言われた）
  let zoomScale = 1;
  /** 利用者がカメラを動かしたら追従を止める（再生中に引き戻さない）。右上のチェックで戻せる */
  function stopFollowByUser() {
    if (!player || !player.running || !hud.opts.follow) return;
    hud.setFollow(false);
    hud.toast('カメラの追従を止めました（右上の「カメラが書類を追う」で戻せます）');
  }
  let baseDist = 20;
  controls.addEventListener('end', () => { zoomScale = camera.position.distanceTo(controls.target) / baseDist; });
  const overviewOf = (f) => {
    const visW = Math.min(f.width, Math.max(46, f.depth * 2.2));
    return { visW, dist: distanceFor(visW, f.depth) };
  };
  const followBaseOf = (f) => { const o = overviewOf(f); return Math.min(o.dist, Math.max(14, distanceFor(22, f.depth))); };

  /** 再生を始めるとき: 基準を「追従の距離」に切り替え、寄り具合はそのまま */
  function useFollowDistance() {
    if (!current) return;
    baseDist = followBaseOf(current);
    const off = camera.position.clone().sub(controls.target);
    camera.position.copy(controls.target).add(off.setLength(THREE.MathUtils.clamp(baseDist * zoomScale, controls.minDistance, controls.maxDistance)));
  }

  function fitCamera(f) {
    // 横に長い階は全体を入れると豆粒になる。約 46m 幅（机 10 列ほど）までに絞り、開始（左端）から見せる（部署名は左に張り付く）
    const { visW, dist } = overviewOf(f);
    const cx = f.width <= visW ? f.center.x : f.bounds.minX - 2.5 + visW / 2;
    baseDist = player && player.running ? followBaseOf(f) : dist;
    placeCamera(new THREE.Vector3(cx, 0, f.center.z), THREE.MathUtils.clamp(baseDist * zoomScale, controls.minDistance, controls.maxDistance));
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

  function swapTo(next, prev) {
    current = next;
    if (prev) detach(prev);
    scene.add(next.group);
    showFloorUi(next);
    fitCamera(next);
  }

  /**
   * 階を移る。mode: true = すぐ（最初から）／ 'down' 'up' = 階段で下りる・上る ／ 省略 = 深さで向きを決める。
   * 暗幕を下ろし、「▼ 階段で B1F へ」と行き先を大きく出してから階を替え、幕を上げる
   */
  async function goFloor(key, mode) {
    if (current && current.key === key) return current;
    const next = getFloor(key);
    const prev = current;
    if (!prev || mode === true) {
      swapTo(next, prev);
      return next;
    }
    const down = mode ? mode === 'down' : next.data.depth > prev.data.depth;
    const head = down ? `▼ 階段で ${next.data.floorName} へ下りる` : `▲ 階段で ${next.data.floorName} へ戻る`;
    const sub = down ? `「${next.data.title}」の中` : `「${next.data.title}」`;
    const curtain = hud.curtain(head, sub);
    const fade = reduceMotion ? 0.05 : 0.45;
    try {
      await clock.run(fade, (t) => curtain.set(ease(t)));
      swapTo(next, prev);
      await clock.wait(reduceMotion ? 0.3 : 0.7);
      await clock.run(fade, (t) => curtain.set(1 - ease(t)));
    } finally {
      curtain.remove(); // 途中で「最初から」に止められたときは reset が階を作り直す
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
    const key = current.key;
    hud.showInfo(current.data, n, canEnter ? () => browseTo(id) : null, n.side ? null : () => playFrom(key, id));
    hud.markCurrent(id);
  }

  const player = createPlayer({
    clock,
    hud,
    opts: hud.opts,
    goFloor: (k, mode) => goFloor(k, mode),
    hasFloor: (k) => !!data.floors[k],
    parentOf: (k) => data.floors[k].parent,
  });

  /** 選んだ工程から再生する（再生中なら止めてから） */
  async function playFrom(key, id) {
    if (player.running) {
      reset();
      await player.idle();
    }
    clock.paused = false;
    hud.showInfo(null);
    const run = player.play(data.rootKey, { key, id });
    useFollowDistance();
    run.catch((e) => { if (e !== CANCELLED) console.error(e); });
  }

  function reset() {
    clock.cancelAll();
    hud.cancelChoice();
    clock.paused = false;
    for (const f of floors.values()) detach(f);
    floors.clear();
    current = null;
    goFloor(data.rootKey, true);
  }

  // 札をクリックしても工程を選ぶ（札は家具の上に浮いているので、押しても家具に当たらなかった）
  css2d.domElement.addEventListener('click', (e) => {
    const tag = e.target.closest && e.target.closest('.ao-tag');
    if (tag && tag.dataset.nodeId) pick(tag.dataset.nodeId, false);
  });

  // クリックで工程を選ぶ（ドラッグと区別する）
  const ray = new THREE.Raycaster();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (downAt && e.buttons && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) stopFollowByUser();
  });
  // タッチパッドのピンチは Ctrl 付きのホイールとして細かく大量に届く。OrbitControls の感度では効かず、
  // 1 回ずつ大きく動かすと効きすぎて飛んだ。量をためて（1 回の上限つき）、描画のたびに少しずつ画面の中心へ寄せる
  let pinchLog = 0;
  renderer.domElement.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pinchLog = THREE.MathUtils.clamp(pinchLog + THREE.MathUtils.clamp(e.deltaY * 0.005, -0.06, 0.06), -1.2, 1.2);
  }, { capture: true, passive: false });
  function applyPinch(raw) {
    if (Math.abs(pinchLog) < 1e-4) return;
    const step = pinchLog * Math.min(1, raw * 12);
    pinchLog -= step;
    const off = camera.position.clone().sub(controls.target);
    const next = THREE.MathUtils.clamp(off.length() * Math.exp(step), controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(off.setLength(next));
    zoomScale = next / baseDist;
  }

  // ダブルクリックした床の場所へ寄る（見たい所へすぐ行けるように）
  renderer.domElement.addEventListener('dblclick', (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return;
    stopFollowByUser();
    const off = camera.position.clone().sub(controls.target).multiplyScalar(0.7);
    controls.target.copy(p);
    camera.position.copy(p).add(off);
    zoomScale = off.length() / baseDist;
  });
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
  let frame = 0;
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector3();
  const hitPt = new THREE.Vector3();

  /** 部署名の札を、左端が画面外なら画面の左端へ張り付かせる（表計算の行見出しのように） */
  function stickLaneTags(f) {
    for (const lt of f.laneTags) {
      ndc.set(controls.target.x, 0, lt.z).project(camera);
      ray.setFromCamera({ x: -0.97, y: ndc.y }, camera);
      const x = ray.ray.intersectPlane(ground, hitPt) ? hitPt.x : lt.homeX;
      lt.tag.position.x = Math.min(Math.max(lt.homeX, x), f.bounds.maxX);
    }
  }

  /**
   * 札の重なりを間引く。今の工程・選んだ工程を先に、次に工程の札（左から）、最後に書類の小札。
   * 重なった後ろ側は visibility で隠す（CSS2DRenderer が display を使うので触らない）。遠いときは時間の行を省く
   */
  function cullTags(f) {
    css2d.domElement.classList.toggle('ao-far', camera.position.distanceTo(controls.target) > 30);
    const items = [];
    for (const t of f.nodeTags) {
      const el = t.element;
      if (!el.isConnected || el.style.display === 'none') continue;
      el.classList.remove('ao-cull');
      const id = el.dataset.nodeId;
      // 再生中の今の工程は、頭の上の作業カードに出ているので机の札は隠す
      el.classList.toggle('ao-busy', !!(player.running && id === focusId));
      const pri = id === focusId ? 0 : t.userData.priority;
      items.push({ el, pri, r: el.getBoundingClientRect() });
    }
    items.sort((p, q) => p.pri - q.pri || p.r.left - q.r.left);
    const kept = [];
    for (const it of items) {
      const hit = kept.some((k) => it.r.left < k.right - 2 && it.r.right > k.left + 2 && it.r.top < k.bottom - 2 && it.r.bottom > k.top + 2);
      if (hit) it.el.classList.add('ao-cull');
      else kept.push(it.r);
    }
  }
  renderer.setAnimationLoop(() => {
    const raw = timer.getDelta();
    clock.tick(raw);
    const scaled = clock.paused ? 0 : Math.min(raw, 0.1) * clock.speed;
    for (const f of floors.values()) f.update(scaled, raw);
    if (player.running && hud.opts.follow && player.carrier && player.carrier.root.visible && !clock.paused && current) {
      player.carrier.root.getWorldPosition(tmp);
      tmp.setY(0);
      // 奥行きが浅い階（部署が3つ程度まで）は横だけ追い、全部の部署を画面に残す（寄りすぎて渡し先が映らなかった）
      if (current.depth <= 16) tmp.z = current.center.z;
      const k = Math.min(1, raw * 2.5);
      const delta = tmp.sub(controls.target).multiplyScalar(k);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    applyPinch(raw);
    controls.update();
    if (current && (++frame % 3 === 0)) stickLaneTags(current);
    renderer.render(scene, camera);
    css2d.render(scene, camera);
    if (current && frame % 8 === 0) cullTags(current);
  });
}

boot().catch((err) => {
  console.error(err);
  const app = document.getElementById('app');
  if (app) app.textContent = `表示に失敗しました: ${err && err.message ? err.message : err}`;
});
