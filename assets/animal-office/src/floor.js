// 図1枚 = フロア1つ。座標はビルド時に決まっている（node.x / node.z、lane.z）。
// ここでは家具・床の通路・札・動物を置くだけで、並べ方は決めない。
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { propFor, paper as makePaper } from './props.js';
import { makeAnimal } from './animals.js';
import { formatMinutes } from './motion.js';

const LANE_DEPTH = 4.2;
const SPOT_BACK = 0.95; // 机の奥（-Z）に動物が立つ
const GAP_X = 1.7; // 机の列の間（通路）

function label(html, cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return new CSS2DObject(el);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function edgeTube(points, color, radius) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.05);
  const geo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 10), radius, 6, false);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
}

function arrowHead(at, dir, color) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 10), new THREE.MeshStandardMaterial({ color }));
  cone.position.copy(at);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return cone;
}

/**
 * @param {object} floor - ビルドが埋めたフロアのデータ
 * @param {Record<string, object>} templates - 動物の glTF
 * @param {object} clock
 */
export function buildFloor(floor, templates, clock) {
  const group = new THREE.Group();
  group.name = `floor-${floor.key}`;
  const nodes = new Map(floor.nodes.map((n) => [n.id, n]));
  const objects = new Map();
  const b = floor.bounds;

  // 床と部署の島
  const w = b.maxX - b.minX + 5;
  const d = b.maxZ - b.minZ + 5;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d), new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.95 }));
  base.position.set((b.minX + b.maxX) / 2, -0.1, (b.minZ + b.maxZ) / 2);
  base.receiveShadow = true;
  group.add(base);
  for (const lane of floor.lanes) {
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(w - 1, LANE_DEPTH - 0.4), new THREE.MeshStandardMaterial({ color: lane.color, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set((b.minX + b.maxX) / 2, 0.005, lane.z - 0.5);
    rug.receiveShadow = true;
    group.add(rug);
    const tag = label(`<span class="ao-lane-name">${esc(lane.name)}</span><span class="ao-lane-animal">${esc(lane.animalName)}</span>`, 'ao-lane');
    tag.position.set(b.minX - 2.8, 0.2, lane.z - 0.5);
    group.add(tag);
  }

  // 家具と札
  for (const n of floor.nodes) {
    const obj = propFor(n);
    obj.position.set(n.x, 0, n.z);
    obj.traverse((o) => { o.userData.nodeId = n.id; });
    group.add(obj);
    objects.set(n.id, obj);
    const small = n.side;
    const dur = n.dur ? `<span class="ao-dur">⏱ ${formatMinutes(n.dur)}</span>` : '';
    const drill = n.drill ? '<span class="ao-drill">▼ 下の階</span>' : '';
    const tag = label(`<span class="ao-id">${esc(n.id)}</span>${esc(n.label)}${dur}${drill}`, small ? 'ao-tag ao-tag-sm' : 'ao-tag');
    tag.position.set(0, small ? 0.9 : n.type === 'terminal' || n.drill || n.type === 'subroutine' ? 2.75 : 1.55, 0);
    tag.element.dataset.nodeId = n.id;
    obj.add(tag);
  }

  // 通路（辺）
  // 机・案内板は奥に立つ（机越しに顔が見える）。ドア・エレベーター・書庫・受付は背が高く奥だと隠れるので、手前の左に立つ
  const LOW = new Set(['process', 'decision', 'document']);
  const spot = (id) => {
    const n = nodes.get(id);
    if (LOW.has(n.type) && !n.drill) return new THREE.Vector3(n.x, 0, n.z - SPOT_BACK);
    return new THREE.Vector3(n.x - 0.95, 0, n.z + 0.55);
  };
  for (const e of floor.edges) {
    const a = nodes.get(e.from);
    const c = nodes.get(e.to);
    if (!a || !c) continue;
    const y = e.data ? 0.03 : 0.04;
    let pts;
    if (e.back) {
      // 戻り：床から浮いた弧（ループだと分かるように）
      const mid = new THREE.Vector3((a.x + c.x) / 2, 1.6 + Math.abs(a.x - c.x) * 0.12, Math.min(a.z, c.z) - 1.8);
      pts = [new THREE.Vector3(a.x, 0.3, a.z - 0.5), mid, new THREE.Vector3(c.x, 0.3, c.z - 0.5)];
    } else if (Math.abs(a.z - c.z) < 0.01 || e.data) {
      pts = [new THREE.Vector3(a.x, y, a.z + 0.6), new THREE.Vector3(c.x, y, c.z + (e.data ? -0.3 : 0.6))];
    } else {
      const mx = c.x - GAP_X;
      pts = [new THREE.Vector3(a.x, y, a.z + 0.6), new THREE.Vector3(mx, y, a.z + 0.6), new THREE.Vector3(mx, y, c.z + 0.6), new THREE.Vector3(c.x, y, c.z + 0.6)];
    }
    const color = e.data ? '#b8b0a2' : e.back ? '#e39a4c' : e.dashed ? '#8fb3d9' : '#5b8fc9';
    group.add(edgeTube(pts, color, e.data ? 0.025 : 0.045));
    if (!e.data) {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      group.add(arrowHead(last.clone().lerp(prev, 0.35), last.clone().sub(prev), color));
    }
    if (e.label) {
      const mid = pts[Math.floor(pts.length / 2)].clone().lerp(pts[Math.floor((pts.length - 1) / 2)], 0.5);
      const tag = label(esc(e.label), 'ao-edge');
      tag.position.copy(mid).setY(mid.y + 0.25);
      group.add(tag);
    }
  }

  // 動物（部署に1匹）。最初は部署でいちばん左の工程に立つ
  const animals = new Map();
  for (const lane of floor.lanes) {
    const first = floor.nodes.filter((n) => n.lane === lane.name && !n.side).sort((p, q) => p.x - q.x)[0];
    const a = makeAnimal(templates[lane.animal], { key: lane.animal, name: lane.animalName, color: lane.color, lane: lane.name }, clock);
    if (first) a.root.position.copy(spot(first.id));
    else a.root.position.set(b.minX, 0, lane.z - SPOT_BACK);
    group.add(a.root);
    animals.set(lane.name, a);
  }

  const paper = makePaper();
  paper.visible = false;
  group.add(paper);

  /** 別の部署の机へ行く道: 自分の通路 → 相手の机の手前の列間 → 相手の通路 */
  function route(fromPos, toId, stopShort) {
    const t = spot(toId);
    if (Math.abs(fromPos.z - t.z) < 0.05) return [t];
    const gx = t.x - GAP_X;
    const pts = [new THREE.Vector3(gx, 0, fromPos.z), new THREE.Vector3(gx, 0, t.z)];
    if (!stopShort) pts.push(t);
    return pts;
  }

  function update(dt, sceneDt) {
    for (const a of animals.values()) a.update(dt, sceneDt);
  }

  return {
    key: floor.key,
    data: floor,
    group,
    nodes,
    objects,
    animals,
    paper,
    spot,
    route,
    update,
    animalOf: (id) => animals.get(nodes.get(id)?.lane),
    center: new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2),
    span: Math.max(w, d),
  };
}
