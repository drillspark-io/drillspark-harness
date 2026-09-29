// 工程の形ごとの家具。素材を持たず、箱・円柱・球だけで作る（外部読み込みゼロの1枚に収めるため）。
// 原点は床の中心、正面（動物が立つ側の反対＝カメラ側）は +Z。
import * as THREE from 'three';

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts }));
  return matCache.get(key);
}

function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(r, h, color, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  return m;
}

function textPlate(text, w, h, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round(256 * (h / w));
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = `bold ${Math.round(c.height * 0.62)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
}

/** 作業（process）: 机・モニター・キーボード */
export function desk() {
  const g = new THREE.Group();
  g.add(box(1.4, 0.06, 0.8, '#c8a47e', 0, 0.7, 0));
  for (const [x, z] of [[-0.62, -0.32], [0.62, -0.32], [-0.62, 0.32], [0.62, 0.32]]) g.add(box(0.06, 0.7, 0.06, '#8a6a4a', x, 0, z));
  g.add(box(0.56, 0.36, 0.04, '#39424e', 0, 0.86, 0.12));
  g.add(box(0.5, 0.3, 0.01, '#9fd3f5', 0, 0.89, 0.1, { emissive: '#3b7fb0', emissiveIntensity: 0.35 }));
  g.add(box(0.06, 0.1, 0.06, '#39424e', 0, 0.76, 0.14));
  g.add(box(0.42, 0.02, 0.14, '#e8e8e8', 0, 0.76, -0.2));
  return g;
}

/** 分岐（decision）: 案内板（ひし形に ?） */
export function signpost() {
  const g = new THREE.Group();
  g.add(cyl(0.05, 1.3, '#7a6a55'));
  g.add(cyl(0.3, 0.05, '#7a6a55'));
  const board = textPlate('?', 0.62, 0.62, '#f5c542', '#4a3500');
  board.rotation.z = Math.PI / 4;
  board.position.set(0, 1.45, 0.03);
  g.add(board);
  const back = board.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.03;
  g.add(back);
  return g;
}

/**
 * 開始・終了（terminal）: ドア。start は緑、end は赤みの枠。
 * 扉は左の蝶番で手前（+Z）へ開く。userData.setOpen(0〜1)（下の階では、奥の階段との出入りで開け閉めする）
 */
export function door(isEnd) {
  const g = new THREE.Group();
  const frame = isEnd ? '#c9605a' : '#4f9d69';
  g.add(box(1.1, 0.1, 0.16, frame, 0, 2.0, 0));
  g.add(box(0.1, 2.0, 0.16, frame, -0.5, 0, 0));
  g.add(box(0.1, 2.0, 0.16, frame, 0.5, 0, 0));
  const hinge = new THREE.Group();
  hinge.position.set(-0.45, 0, 0);
  hinge.add(box(0.9, 1.98, 0.06, '#f3ead8', 0.45, 0, 0));
  hinge.add(cyl(0.035, 0.08, '#b89b4a', 0.75, 1.0, 0.06));
  g.add(hinge);
  const plate = textPlate(isEnd ? 'EXIT' : 'START', 0.8, 0.22, frame, '#ffffff');
  plate.position.set(0, 2.25, 0.02);
  g.add(plate);
  g.userData.setOpen = (t) => { hinge.rotation.y = -1.5 * t; };
  return g;
}

// ---------- 階段（子図のある工程 = 下の階へ下りる入口） ----------
/** 下り階段の床の穴（原点からの相対）。床と敷物にこの形の穴を開ける（floor.js） */
export const STAIR_HOLE = { x0: -0.65, x1: 0.65, z0: -0.75, z1: 0.5 }; // 奥の通路（z-0.95）を塞がない奥行き
const STEPS = 10;
const RISE = 0.2;
const RUN = 0.12;

function rail(x0, z0, x1, z1) {
  const g = new THREE.Group();
  const len = Math.hypot(x1 - x0, z1 - z0);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), mat('#6d5a44'));
  bar.position.set((x0 + x1) / 2, 0.9, (z0 + z1) / 2);
  bar.rotation.y = Math.atan2(x1 - x0, z1 - z0);
  g.add(bar);
  for (const [x, z] of [[x0, z0], [x1, z1]]) g.add(cyl(0.03, 0.9, '#6d5a44', x, 0, z, 8));
  return g;
}

/**
 * 下り階段: 床の穴の中を奥（-Z）へ下りていく段と、穴の下の竪穴（暗い壁）、三方の手すり、▼ の札。
 * userData.path は動物が辿る点（床の手前 → 段を下りて床下へ消える）
 */
export function stairsDown(caption) {
  const g = new THREE.Group();
  const { x0, x1, z0, z1 } = STAIR_HOLE;
  const w = x1 - x0;
  // 段と竪穴は影を受けない（床の厚板の影で真っ黒な穴に見え、階段だと分からなくなった）
  const unshadowed = (m) => { m.castShadow = false; m.receiveShadow = false; return m; };
  for (let i = 0; i < STEPS; i += 1) {
    const top = -(i + 1) * RISE;
    const z = z1 - 0.1 - i * RUN;
    g.add(unshadowed(box(w - 0.04, 0.12, RUN + 0.02, i % 2 ? '#e2cda9' : '#f0dfc0', 0, top - 0.12, z - RUN / 2)));
    g.add(unshadowed(box(w - 0.04, 0.02, 0.03, '#8a6a4a', 0, top - 0.02, z - 0.015))); // 段鼻
  }
  // 竪穴: 穴の縁から下へ明るい壁（床下が空洞に見えないように）
  const depth = STEPS * RISE + 0.6;
  g.add(unshadowed(box(w, depth, 0.05, '#d6cab6', 0, -depth, z0)));
  g.add(unshadowed(box(0.05, depth, z1 - z0, '#cbbfa9', x0, -depth, (z0 + z1) / 2)));
  g.add(unshadowed(box(0.05, depth, z1 - z0, '#cbbfa9', x1, -depth, (z0 + z1) / 2)));
  g.add(unshadowed(box(w, 0.05, z1 - z0, '#8d8070', 0, -depth, (z0 + z1) / 2)));
  // 穴の縁に黄色い線（床の開口だと一目で分かるように）
  for (const [bw, bd, bx, bz] of [[w + 0.1, 0.06, 0, z1 + 0.03], [0.06, z1 - z0, x0 - 0.03, (z0 + z1) / 2], [0.06, z1 - z0, x1 + 0.03, (z0 + z1) / 2]]) {
    g.add(unshadowed(box(bw, 0.012, bd, '#f2c94c', bx, 0.006, bz)));
  }
  g.add(rail(x0 - 0.04, z1, x0 - 0.04, z0));
  g.add(rail(x1 + 0.04, z1, x1 + 0.04, z0));
  g.add(rail(x0 - 0.04, z0 - 0.04, x1 + 0.04, z0 - 0.04));
  const sign = textPlate(caption || '▼', 1.2, 0.42, '#2d6a4f', '#ffffff');
  sign.position.set(0, 1.3, z0 - 0.04);
  g.add(sign, cyl(0.03, 1.1, '#6d5a44', 0.58, 0, z0 - 0.04, 8), cyl(0.03, 1.1, '#6d5a44', -0.58, 0, z0 - 0.04, 8));
  const path = [new THREE.Vector3(0, 0, z1 + 0.35), new THREE.Vector3(0, 0, z1 - 0.05)];
  for (let i = 0; i < STEPS; i += 1) path.push(new THREE.Vector3(0, -(i + 1) * RISE, z1 - 0.1 - (i + 0.5) * RUN));
  g.userData.path = path;
  return g;
}

/** 上り階段（下の階の出入口。START／EXIT のドアの奥に置く）: 奥へ上っていく段と手すり、▲ の札。userData.path は上から下りてくる点（最上段 → ドアのすぐ奥） */
export function stairsUp(caption) {
  const g = new THREE.Group();
  const w = 1.0;
  const pts = [];
  for (let i = 0; i < STEPS; i += 1) {
    const top = (i + 1) * RISE;
    const z = 0.4 - i * RUN;
    g.add(box(w, top, RUN, i % 2 ? '#c9b18f' : '#d8c3a2', 0, 0, z - RUN / 2));
    pts.push(new THREE.Vector3(0, top, z - RUN / 2));
  }
  const zTop = 0.4 - STEPS * RUN;
  g.add(rail(-w / 2 - 0.04, 0.4, -w / 2 - 0.04, zTop));
  g.add(rail(w / 2 + 0.04, 0.4, w / 2 + 0.04, zTop));
  const sign = textPlate(caption || '▲', 0.9, 0.3, '#2d6a4f', '#ffffff');
  sign.position.set(0, STEPS * RISE + 0.5, zTop);
  g.add(sign);
  g.userData.path = [...pts.reverse(), new THREE.Vector3(0, 0, 0.42)];
  return g;
}

/** データストア（database）: 書庫キャビネット */
export function cabinet() {
  const g = new THREE.Group();
  g.add(box(0.7, 1.3, 0.5, '#6f7f95'));
  for (const y of [0.15, 0.55, 0.95]) g.add(box(0.6, 0.3, 0.02, '#8494ab', 0, y, 0.26));
  return g;
}

/** 入出力（io）: 受付カウンター */
export function counter() {
  const g = new THREE.Group();
  g.add(box(1.4, 0.95, 0.5, '#d58f5c'));
  g.add(box(1.5, 0.05, 0.6, '#f1d2b0', 0, 0.95, 0));
  const plate = textPlate('受付', 0.5, 0.18, '#ffffff', '#b0602b');
  plate.position.set(0, 0.6, 0.26);
  g.add(plate);
  return g;
}

/** 成果物（document）: 書類トレイ。置かれた枚数を積める */
export function tray() {
  const g = new THREE.Group();
  g.add(box(0.5, 0.5, 0.4, '#b98d5f'));
  g.add(box(0.46, 0.04, 0.34, '#f0e6d0', 0, 0.5, 0));
  const stack = new THREE.Group();
  stack.position.y = 0.54;
  g.add(stack);
  g.userData.addSheet = () => {
    const n = stack.children.length;
    if (n >= 12) return;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.22), mat('#ffffff'));
    s.position.set((Math.random() - 0.5) * 0.03, n * 0.014, (Math.random() - 0.5) * 0.03);
    stack.add(s);
  };
  return g;
}

/** 運ばれる書類 */
export function paper() {
  const g = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), mat('#ffffff', { emissive: '#fff6d8', emissiveIntensity: 0.25 }));
  g.add(sheet);
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.022, 0.02), mat('#8aa4c8'));
  line.position.z = -0.04;
  g.add(line);
  return g;
}

export function propFor(node) {
  switch (node.type) {
    case 'decision': return signpost();
    case 'terminal': return door(node.isEnd);
    case 'subroutine': return node.drill ? stairsDown(node.stairLabel) : desk();
    case 'database': return cabinet();
    case 'io': return counter();
    case 'document': return tray();
    default: return node.drill ? stairsDown(node.stairLabel) : desk();
  }
}
