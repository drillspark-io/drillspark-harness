// 図1枚 = フロア1つ。座標はビルド時に決まっている（node.x / node.z、lane.z）。
// ここでは家具・床の通路・札・動物を置くだけで、並べ方は決めない。
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { propFor, paper as makePaper, stairsUp, STAIR_HOLE } from './props.js';
import { makeAnimal } from './animals.js';
import { formatMinutes } from './motion.js';

const LANE_DEPTH = 4.2;
const SPOT_BACK = 0.95; // 机の奥（-Z）に動物が立つ
const GAP_X = 2.1; // 机の列の間（通路）。ビルドの X_STEP 4.2 の半分

function label(html, cls) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  return new CSS2DObject(el);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const FLOOR_TEXT_EVERY = 10; // 床の部署名の間隔（m）。机3つ分

const YES = /^(yes|y|はい|ある|あり|ok|可|承認|合格|いる|できる|済)/i;
const NO = /^(no|n|いいえ|ない|なし|ng|否|却下|不合格|いない|できない|未)/i;
const BRANCH_OTHER = ['#7b61ff', '#d98200', '#0b8fa6', '#b04ab0'];
/** 分岐の答えの色。はい系は緑、いいえ系は赤、それ以外は順に */
export function branchColor(text, i) {
  const t = String(text || '').trim();
  if (NO.test(t)) return '#d1495b';
  if (YES.test(t)) return '#2e9d57';
  return BRANCH_OTHER[i % BRANCH_OTHER.length];
}

/** 敷物の淡い色から、文字と帯に使う濃い色を作る */
function accentOf(color) {
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  return `#${c.setHSL(hsl.h, Math.min(1, hsl.s + 0.35), 0.38).getHexString()}`;
}

/** 床に寝かせた文字（部署名）。影は受けない・奥行きは書き込まない（机の足元に潜っても破綻しない） */
function floorText(text, color) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.globalAlpha = 1;
  g.font = 'bold 96px sans-serif';
  g.textBaseline = 'middle';
  let t = text;
  while (g.measureText(t).width > c.width - 20 && t.length > 2) t = `${t.slice(0, -2)}…`;
  g.fillText(t, 10, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.78), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/**
 * 床の板（x0..x1 × z0..z1）に長方形の穴を開けたもの。thick が 0 なら平面、>0 なら上面が y=thick の厚板。
 * Shape は XY 平面で作り、X 軸で -90° 回して床に寝かせる（shape の y = 世界の -z）
 */
function slab(x0, x1, z0, z1, holes, thick) {
  const shape = new THREE.Shape();
  shape.moveTo(x0, -z1);
  shape.lineTo(x1, -z1);
  shape.lineTo(x1, -z0);
  shape.lineTo(x0, -z0);
  shape.closePath();
  for (const h of holes) {
    if (h.x1 <= x0 || h.x0 >= x1 || h.z1 <= z0 || h.z0 >= z1) continue;
    const p = new THREE.Path();
    const hz0 = Math.max(h.z0, z0 + 0.01);
    const hz1 = Math.min(h.z1, z1 - 0.01);
    p.moveTo(h.x0, -hz1);
    p.lineTo(h.x0, -hz0);
    p.lineTo(h.x1, -hz0);
    p.lineTo(h.x1, -hz1);
    p.closePath();
    shape.holes.push(p);
  }
  const geo = thick > 0 ? new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }) : new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

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
  const laneTags = [];
  const nodeTags = [];

  // 床と部署の島
  const w = b.maxX - b.minX + 5;
  const d = b.maxZ - b.minZ + 5;
  // 下り階段の穴。床（厚み 0.2）と敷物の両方に同じ穴を開ける
  const holes = floor.nodes.filter((n) => n.drill).map((n) => ({
    x0: n.x + STAIR_HOLE.x0, x1: n.x + STAIR_HOLE.x1, z0: n.z + STAIR_HOLE.z0, z1: n.z + STAIR_HOLE.z1,
  }));
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const base = new THREE.Mesh(slab(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, holes, 0.2), new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.95 }));
  base.position.y = -0.2;
  base.receiveShadow = true;
  group.add(base);
  for (const lane of floor.lanes) {
    const z0 = lane.z - 0.5 - (LANE_DEPTH - 0.4) / 2;
    const z1 = z0 + LANE_DEPTH - 0.4;
    const rug = new THREE.Mesh(slab(cx - (w - 1) / 2, cx + (w - 1) / 2, z0, z1, holes, 0), new THREE.MeshStandardMaterial({ color: lane.color, roughness: 1 }));
    rug.position.y = 0.005;
    rug.receiveShadow = true;
    group.add(rug);
    const accent = accentOf(lane.color);
    // 敷物の前後の縁に部署色の線（淡い敷物どうしの境目を分かるように）
    for (const ez of [z0 + 0.04, z1 - 0.04]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(w - 1, 0.08), new THREE.MeshBasicMaterial({ color: accent }));
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(cx, 0.009, ez);
      group.add(edge);
    }
    // 部署名の札。左端に置き、カメラが寄って左端が画面外に出たら画面の左へ張り付く（main.js が x を動かす）
    const tag = label(`<span class="ao-lane-name">${esc(lane.name)}</span><span class="ao-lane-animal">${esc(lane.animalName)}</span>`, 'ao-lane');
    tag.element.style.borderLeft = `5px solid ${accent}`;
    tag.center.set(0, 0.5);
    tag.position.set(b.minX - 4.2, 0.2, lane.z - 0.5);
    group.add(tag);
    laneTags.push({ tag, homeX: b.minX - 4.2, z: lane.z - 0.5 });
    // 床に部署名を書く（敷物の奥の帯に一定間隔で）。左端の札だけだと、途中に寄ったとき何の部署か分からない
    const paint = floorText(`${lane.name}（${lane.animalName}）`, accent);
    for (let x = b.minX + 1; x <= b.maxX + 0.5; x += FLOOR_TEXT_EVERY) {
      const m = paint.clone();
      m.position.set(x + 2.5, 0.012, z0 + 0.55);
      group.add(m);
    }
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
    // 下の階へ行くことは床の看板（▼ B1F）が示すので、札には書かない
    // 備考がある工程は 📝（クリックすると右下に備考が出る）
    const note = n.note ? '<span class="ao-note" title="備考あり（クリックで表示）">📝</span>' : '';
    const tag = label(`<span class="ao-id">${esc(n.id)}${note}</span><span class="ao-l">${esc(n.label)}</span>${dur}`, small ? 'ao-tag ao-tag-sm' : 'ao-tag');
    const laneOf = floor.lanes.find((l) => l.name === n.lane);
    if (laneOf) {
      tag.element.style.borderLeft = `5px solid ${accentOf(laneOf.color)}`; // 札の左の帯 = 部署の色
      tag.element.title = `${laneOf.name}（${laneOf.animalName}）`;
    }
    // 机・案内板・書類の札は家具の手前に吊り下げる（上に浮かせると、机の奥に立つ動物にかぶって見えなかった）。
    // 扉と階段は背が高く手前が通路なので、上に付けて下向きの三角で指す
    const below = !n.drill && n.type !== 'terminal';
    if (below) {
      tag.element.classList.add('ao-tag-below');
      tag.center.set(0.5, 0);
      // 隣の段の札と横に重ならないよう、奇数段は画面上で下へずらす（床の奥行きでずらすと隣の部署の帯に入り込んだ）
      if (!small && (n.rank || 0) % 2) tag.element.classList.add('ao-tag-odd');
      tag.position.set(0, 0.05, small ? 0.3 : 0.45);
    } else {
      tag.center.set(0.5, 1);
      tag.position.set(0, n.type === 'terminal' ? 2.4 : 1.75, 0);
    }
    tag.element.dataset.nodeId = n.id;
    // 重なりを間引くときの順位（小さいほど残す）。分岐・開始／終了・階段は流れの骨なので工程より先に残す
    tag.userData.priority = small ? 2 : n.type === 'decision' || n.type === 'terminal' || n.drill ? 0.5 : 1;
    obj.add(tag);
    nodeTags.push(tag);
  }

  // 通路（辺）
  // 机・案内板は奥に立つ（机越しに顔が見える）。ドア・書庫・受付は背が高く奥だと隠れ、階段は奥が穴なので、手前の左に立つ
  const LOW = new Set(['process', 'decision', 'document', 'subroutine']); // 子図の無いサブプロセスは机
  const spot = (id) => {
    const n = nodes.get(id);
    if (LOW.has(n.type) && !n.drill) return new THREE.Vector3(n.x, 0, n.z - SPOT_BACK);
    return new THREE.Vector3(n.x - 0.95, 0, n.z + 0.55);
  };
  // 分岐から出る辺は答えで色を分ける（はい系＝緑・いいえ系＝赤・ほか）。線・矢印・札を同じ色にし、どの線がどの答えか見て分かるように
  const branchIndex = new Map();
  for (const n of floor.nodes) {
    if (n.type !== 'decision') continue;
    floor.edges.filter((e) => e.from === n.id && !e.data).forEach((e, i) => branchIndex.set(e, i));
  }
  for (const e of floor.edges) {
    const a = nodes.get(e.from);
    const c = nodes.get(e.to);
    if (!a || !c) continue;
    const bi = branchIndex.get(e);
    const branch = bi !== undefined ? branchColor(e.label, bi) : null;
    const y = e.data ? 0.03 : 0.04 + (bi || 0) * 0.01;
    const dz = (bi || 0) * 0.16; // 同じ分岐から出る線は少しずらして重ねない
    let pts;
    if (e.back) {
      // 戻り：床から浮いた弧（ループだと分かるように）
      const mid = new THREE.Vector3((a.x + c.x) / 2, Math.min(1.2 + Math.abs(a.x - c.x) * 0.08, 2.2), Math.min(a.z, c.z) - 1.8);
      pts = [new THREE.Vector3(a.x, 0.3, a.z - 0.5), mid, new THREE.Vector3(c.x, 0.3, c.z - 0.5)];
    } else if (branch && bi > 0 && Math.abs(a.z - c.z) < 0.01) {
      // 同じ列を行く 2 本目以降の分岐は、手前に一段ずらした道を通す（1 本目と重なって見分けられなかった）
      const zz = a.z + 0.6 + 0.75 * bi;
      pts = [new THREE.Vector3(a.x, y, a.z + 0.6), new THREE.Vector3(a.x + 0.6, y, zz), new THREE.Vector3(c.x - 0.6, y, zz), new THREE.Vector3(c.x, y, c.z + 0.6)];
    } else if (Math.abs(a.z - c.z) < 0.01 || e.data) {
      pts = [new THREE.Vector3(a.x, y, a.z + 0.6 + dz), new THREE.Vector3(c.x, y, c.z + (e.data ? -0.3 : 0.6 + dz))];
    } else {
      const mx = c.x - GAP_X + dz;
      pts = [new THREE.Vector3(a.x, y, a.z + 0.6 + dz), new THREE.Vector3(mx, y, a.z + 0.6 + dz), new THREE.Vector3(mx, y, c.z + 0.6), new THREE.Vector3(c.x, y, c.z + 0.6)];
    }
    const color = branch || (e.data ? '#b8b0a2' : e.back ? '#e39a4c' : e.dashed ? '#8fb3d9' : '#5b8fc9');
    const tube = edgeTube(pts, color, e.data ? 0.025 : branch ? 0.06 : 0.045);
    if (e.back) Object.assign(tube.material, { transparent: true, opacity: 0.75 });
    group.add(tube);
    if (!e.data) {
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      group.add(arrowHead(last.clone().lerp(prev, 0.35), last.clone().sub(prev), color));
    }
    if (e.label || branch) {
      // 分岐の札は、線が分かれた先に置く（出どころの近くだと、答えの札どうしが並んでどちらの線か分からなかった）
      //   別の部署へ曲がる線 → 曲がった後の縦の区間 ／ 戻りの弧 → 弧の頂上 ／ 同じ列 → 行き先寄り
      const detour = pts.length === 4 && Math.abs(pts[1].z - pts[2].z) < 0.01;
      const at = e.back ? pts[1].clone()
        : detour ? pts[1].clone().lerp(pts[2], Math.min(0.5, 1.2 / Math.max(0.1, pts[1].distanceTo(pts[2]))))
          : pts.length === 4 ? pts[1].clone().lerp(pts[2], 0.5)
            : pts[0].clone().lerp(pts[1], branch ? 0.35 : 0.45);
      const tag = label(esc(e.label || '→'), branch ? 'ao-edge ao-branch' : 'ao-edge');
      if (branch) tag.element.style.background = branch;
      tag.position.copy(at).setY(at.y + 0.3);
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

  // 下の階では START と EXIT のドアの奥に上り階段を付ける。上の階から階段を下りてドアから入り、終わったらドアから階段を上って戻る
  const stairsAt = new Map();
  if (floor.parent) {
    for (const n of floor.nodes) {
      if (n.type !== "terminal" || (n.id !== floor.start && !n.isEnd)) continue;
      const s = stairsUp(n.id === floor.start ? `▲ ${floor.parentFloorName} から` : `▲ ${floor.parentFloorName} へ`);
      s.position.set(n.x, 0, n.z - 0.5);
      group.add(s);
      stairsAt.set(n.id, s);
    }
  }

  /** 任意の地点への道: z が同じならまっすぐ、違えば机の列の間を通る */
  function routeTo(fromPos, to, gapX) {
    if (Math.abs(fromPos.z - to.z) < 0.05) return [to.clone()];
    return [new THREE.Vector3(gapX, 0, fromPos.z), new THREE.Vector3(gapX, 0, to.z), to.clone()];
  }

  /** 別の部署の机へ行く道: 自分の通路 → 相手の机の手前の列間 → 相手の通路 */
  function route(fromPos, toId, stopShort) {
    const t = spot(toId);
    const pts = routeTo(fromPos, t, t.x - GAP_X);
    if (stopShort && pts.length > 1) pts.pop();
    return pts;
  }

  /** 工程に一緒に出てくる相手の立ち位置（担当の右隣。2人目はさらに右） */
  function besideSpot(id, i) {
    const s = spot(id);
    return new THREE.Vector3(s.x + 0.85 * (i + 1), 0, s.z + 0.3);
  }

  // この階に部署が無い相手は、客として床の手前から入ってきて、終わったら帰る
  const guests = new Map();
  function guestFor(w) {
    if (!guests.has(w.lane)) {
      const g = makeAnimal(templates[w.animal], { key: w.animal, name: w.animalName, color: '#dddddd', lane: w.lane }, clock);
      g.root.visible = false;
      group.add(g.root);
      guests.set(w.lane, g);
    }
    return guests.get(w.lane);
  }
  const doorway = (x) => new THREE.Vector3(x, 0, b.maxZ + 1.5);

  function update(dt, sceneDt) {
    for (const a of animals.values()) a.update(dt, sceneDt);
    for (const g of guests.values()) if (g.root.visible) g.update(dt, sceneDt);
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
    routeTo,
    besideSpot,
    guestFor,
    doorway,
    stairsAt,
    gapX: (id) => nodes.get(id).x + GAP_X,
    update,
    animalOf: (id) => animals.get(nodes.get(id)?.lane),
    laneTags,
    nodeTags,
    bounds: b,
    width: w,
    depth: d,
    center: new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2),
    span: Math.max(w, d),
  };
}
