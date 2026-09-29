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

/** 開始・終了（terminal）: ドア。start は緑、end は赤みの枠 */
export function door(isEnd) {
  const g = new THREE.Group();
  const frame = isEnd ? '#c9605a' : '#4f9d69';
  g.add(box(1.1, 0.1, 0.16, frame, 0, 2.0, 0));
  g.add(box(0.1, 2.0, 0.16, frame, -0.5, 0, 0));
  g.add(box(0.1, 2.0, 0.16, frame, 0.5, 0, 0));
  g.add(box(0.9, 1.98, 0.06, '#f3ead8', 0, 0, 0));
  g.add(cyl(0.035, 0.08, '#b89b4a', 0.3, 1.0, 0.06));
  const plate = textPlate(isEnd ? 'EXIT' : 'START', 0.8, 0.22, frame, '#ffffff');
  plate.position.set(0, 2.25, 0.02);
  g.add(plate);
  return g;
}

/** サブプロセス（subroutine）: エレベーター。子図があれば下向き ▼ が光る */
export function elevator(hasChild) {
  const g = new THREE.Group();
  g.add(box(1.4, 2.3, 0.3, '#8d99a6', 0, 0, -0.05, { metalness: 0.4, roughness: 0.4 }));
  g.add(box(0.58, 2.0, 0.04, '#c5cdd6', -0.3, 0, 0.12, { metalness: 0.6, roughness: 0.3 }));
  g.add(box(0.58, 2.0, 0.04, '#c5cdd6', 0.3, 0, 0.12, { metalness: 0.6, roughness: 0.3 }));
  const ind = textPlate(hasChild ? '▼' : '■', 0.34, 0.24, '#1d2430', hasChild ? '#ffcf4a' : '#667080');
  ind.position.set(0, 2.1, 0.16);
  g.add(ind);
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
    case 'subroutine': return elevator(node.drill);
    case 'database': return cabinet();
    case 'io': return counter();
    case 'document': return tray();
    default: return node.drill ? elevator(true) : desk();
  }
}
