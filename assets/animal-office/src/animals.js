// 動物の社員。モデルは tsumugiya の staff_<名前>.glb（メートル単位・足元原点・正面 +Z）。
// クリップ: idle（ループ）/ bow / wave / blink / tilt。歩行クリップは無いので、歩きは位置の補間＋上下の揺れで出す。
// モデルが読めなければ、丸と円柱の代わりの子を立てる（1枚が壊れないように）。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const SCALE = 1.5;
const WALK_SPEED = 1.6; // m/秒（再生速度 1 のとき）

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** @param {Record<string,string>} models - { neko: base64, ... } */
export async function loadTemplates(models) {
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(Object.entries(models).map(async ([key, b64]) => {
    try {
      out[key] = await loader.parseAsync(b64ToBuffer(b64), '');
    } catch (err) {
      console.warn(`動物モデルを読めなかった: ${key}`, err);
    }
  }));
  return out;
}

function fallbackModel(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.35, 4, 12), m);
  body.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), m);
  head.position.y = 0.95;
  g.add(body, head);
  return g;
}

function makeShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(40,28,16,0.5)');
  r.addColorStop(1, 'rgba(40,28,16,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.01;
  return s;
}

/**
 * @param {{ scene: THREE.Object3D, animations: THREE.AnimationClip[] } | undefined} tpl
 * @param {{ key: string, name: string, color: string, lane: string }} info
 * @param {ReturnType<import('./motion.js').createClock>} clock
 */
export function makeAnimal(tpl, info, clock) {
  const root = new THREE.Group();
  const body = new THREE.Group(); // 歩きの揺れはここに乗せる（モデルのアニメと干渉させない）
  root.add(body);
  const model = tpl ? tpl.scene.clone(true) : fallbackModel(info.color);
  model.scale.setScalar(SCALE);
  body.add(model);
  root.add(makeShadow());

  const hand = new THREE.Group(); // 書類を持つ位置
  hand.position.set(0, 0.95, 0.42);
  body.add(hand);

  const mixer = new THREE.AnimationMixer(model);
  const clips = tpl ? tpl.animations : [];
  const act = (name, once) => {
    const c = THREE.AnimationClip.findByName(clips, name);
    if (!c) return null;
    const a = mixer.clipAction(c);
    if (once) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = name === 'bow';
    }
    return a;
  };
  const idle = act('idle', false);
  const bow = act('bow', true);
  const wave = act('wave', true);
  const blink = act('blink', true);
  const tilt = act('tilt', true);
  if (idle) {
    idle.play();
    idle.time = Math.random() * (idle.getClip().duration || 1);
  }
  mixer.addEventListener('finished', (e) => {
    if (e.action === bow && idle) {
      idle.reset().play();
      bow.crossFadeTo(idle, 0.3, false);
    } else if (e.action === wave || e.action === tilt || e.action === blink) {
      e.action.stop();
    }
  });

  const bubble = document.createElement('div');
  bubble.className = 'ao-bubble';
  bubble.hidden = true;
  const bubbleObj = new CSS2DObject(bubble);
  bubbleObj.position.set(0, 2.05, 0);
  bubbleObj.center.set(0.5, 1); // 下辺を頭の上に（CSS の transform は CSS2DRenderer に上書きされるので center で付ける）
  root.add(bubbleObj);

  let walking = 0; // 歩いている間の位相
  let working = 0;
  let nextBlink = 1 + Math.random() * 4;

  function update(dt, sceneDt) {
    mixer.update(sceneDt);
    nextBlink -= sceneDt;
    if (nextBlink <= 0 && blink) {
      nextBlink = 3 + Math.random() * 3;
      blink.reset().play();
    }
    if (walking) {
      walking += dt * 11;
      body.position.y = Math.abs(Math.sin(walking)) * 0.07;
      body.rotation.z = Math.sin(walking) * 0.07;
    } else if (working) {
      working += dt * 14;
      body.position.y = Math.abs(Math.sin(working)) * 0.02;
      body.rotation.z = 0;
    } else {
      body.position.y *= 0.8;
      body.rotation.z *= 0.8;
    }
  }

  function faceTo(x, z) {
    const dx = x - root.position.x;
    const dz = z - root.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 1e-3) root.rotation.y = Math.atan2(dx, dz);
  }

  /** 折れ線に沿って歩く。points は THREE.Vector3 の配列（先頭は今の位置でなくてよい） */
  // 新しい walk が始まったら古い walk は止まる（戻り道の途中で次の仕事に呼ばれたとき、2つが位置を奪い合わないように）
  let walkGen = 0;
  async function walk(points) {
    const my = ++walkGen;
    walking = walking || 0.01;
    try {
      for (const p of points) {
        if (my !== walkGen) return;
        const from = root.position.clone();
        const dist = from.distanceTo(p);
        if (dist < 0.02) continue;
        faceTo(p.x, p.z);
        await clock.run(dist / WALK_SPEED, (t) => { if (my === walkGen) root.position.lerpVectors(from, p, t); });
      }
    } finally {
      if (my === walkGen) {
        walking = 0;
        faceTo(root.position.x, root.position.z + 1); // 最後はカメラ側を向く
      }
    }
  }

  async function work(sec, text) {
    say(text);
    working = 0.01;
    if (tilt && sec > 2) tilt.reset().play();
    try {
      await clock.wait(sec);
    } finally {
      working = 0;
    }
    if (bow && sec > 1.5) {
      if (idle) idle.fadeOut(0.15);
      bow.reset().fadeIn(0.15).play();
    }
    say('');
  }

  function say(text) {
    bubble.textContent = text;
    bubble.hidden = !text;
  }

  function greet() {
    if (wave) wave.reset().play();
  }

  /** 書類を持ち上げる／手放す（paper は Group） */
  function hold(paper) {
    hand.add(paper);
    paper.position.set(0, 0, 0);
    paper.rotation.set(0, 0, 0);
  }

  return { root, info, update, walk, work, say, greet, hold, hand, faceTo };
}
