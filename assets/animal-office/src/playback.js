// 再生: 書類1枚が開始から辺の順に机を回る。
// - 同じ部署の次の机へは、担当が書類を持って歩く
// - 別の部署へは、手前まで届けて手渡し、自分の机へ戻る
// - 分岐は選ばせる（自動なら戻り辺でない最初の辺。戻り辺しか無ければそこで終わる＝無限ループにしない）
// - 子図を持つ工程は、担当が床の階段を下りて下の階へ行く。下の階では START のドアの奥の階段から下りてきてドアから入り、
//   終わったら EXIT のドアから奥の階段を上って戻り、元の階の床の階段から上がってくる
// - 工程名に別の部署の名前が出てくる工程（例: 創業者がユーザーと話す）は、その部署の動物も来て2匹で作業する。
//   その部署がこの階に無ければ、客として床の手前から入ってきて、終わったら帰る
// - 成果物・データストアへの辺は流れではない。作業中に書類の写しがトレイへ飛ぶだけ
import * as THREE from 'three';
import { CANCELLED, workSeconds, formatMinutes } from './motion.js';
import { paper as makePaper } from './props.js';
import { branchColor } from './floor.js';

export function createPlayer(ctx) {
  const { clock, hud } = ctx;
  let running = false;
  let elapsed = 0;
  let carrier = null;

  async function toss(f, from, to) {
    const p = f.paper;
    const a = new THREE.Vector3();
    p.getWorldPosition(a);
    f.group.worldToLocal(a);
    f.group.add(p);
    const b = new THREE.Vector3();
    to.hand.getWorldPosition(b);
    f.group.worldToLocal(b);
    await clock.run(0.45, (t) => {
      p.position.lerpVectors(a, b, t);
      p.position.y += Math.sin(t * Math.PI) * 0.5;
      p.rotation.y = t * Math.PI;
    });
    to.hold(p);
  }

  /** 成果物・データストアへ写しを飛ばす（待たない） */
  function fileOutputs(f, node) {
    const outs = f.data.edges.filter((e) => e.from === node.id && e.data);
    for (const e of outs) {
      const target = f.objects.get(e.to);
      if (!target) continue;
      const copy = makePaper();
      const a = f.spot(node.id).setY(0.9);
      const b = target.position.clone().setY(0.8);
      f.group.add(copy);
      clock.run(0.9, (t) => {
        copy.position.lerpVectors(a, b, t);
        copy.position.y += Math.sin(t * Math.PI) * 0.9;
      }).then(() => {
        f.group.remove(copy);
        if (target.userData.addSheet) target.userData.addSheet();
      }, () => f.group.remove(copy));
    }
  }

  const along = (obj, pts) => pts.map((p) => obj.position.clone().add(p));

  /** 床の階段を下りて消える（書類を持ったまま） */
  async function goDown(f, node) {
    const stairs = f.objects.get(node.id);
    const path = along(stairs, stairs.userData.path);
    await carrier.walk([path[0]]);
    carrier.say(`▼ ${node.label} の中へ`);
    await clock.wait(0.7);
    carrier.say('');
    await carrier.walk(path.slice(1));
    carrier.root.visible = false;
  }

  /** 下の階から戻り、床の階段を上ってくる */
  async function comeUp(f, node, animal) {
    const stairs = f.objects.get(node.id);
    const path = along(stairs, stairs.userData.path).reverse();
    animal.root.position.copy(path[0]);
    animal.root.visible = true;
    await animal.walk(path.slice(1));
    await animal.walk([f.spot(node.id)]);
  }

  const swing = (door, from, to) => clock.run(0.35, (t) => door.userData.setOpen(from + (to - from) * t));

  /** 下の階: START のドアの奥の階段を下りてきて、ドアを開けて入り、開始の立ち位置へ */
  async function arrive(f, animal, startId) {
    const stairs = f.stairsAt.get(startId);
    const door = f.objects.get(startId);
    animal.root.visible = true;
    if (!stairs || !door) {
      animal.root.position.copy(f.spot(startId));
      return;
    }
    const path = along(stairs, stairs.userData.path);
    animal.root.position.copy(path[0]);
    await animal.walk(path.slice(1));
    await swing(door, 0, 1);
    await animal.walk([door.position.clone().setZ(door.position.z + 0.8)]);
    swing(door, 1, 0).catch(() => {});
    await animal.walk([f.spot(startId)]);
  }

  /** 下の階の終わり: EXIT のドアを開けて奥の階段を上り、上の階へ戻る（EXIT に階段が無ければ START の階段から） */
  async function leave(f, animal, endId) {
    const id = f.stairsAt.has(endId) ? endId : f.data.start;
    const stairs = f.stairsAt.get(id);
    const door = f.objects.get(id);
    if (!stairs || !door) {
      animal.root.visible = false;
      return;
    }
    const path = along(stairs, stairs.userData.path).reverse();
    const front = door.position.clone().setZ(door.position.z + 0.8);
    await animal.walk(f.routeTo(animal.root.position, front, front.x + 2.1));
    animal.say('▲ 上の階へ戻る');
    await swing(door, 0, 1);
    await animal.walk(path);
    swing(door, 1, 0).catch(() => {});
    animal.say('');
    animal.root.visible = false;
  }

  /** 工程に一緒に出てくる相手（この階の部署の動物か、客）。担当自身は除く。2匹まで */
  function partnersOf(f, node) {
    const out = [];
    for (const w of node.with || []) {
      const a = f.animals.get(w.lane) || f.guestFor(w);
      if (a && a !== carrier && !out.includes(a)) out.push(a);
    }
    return out.slice(0, 2);
  }

  async function workTogether(f, node, sec, text) {
    const partners = partnersOf(f, node);
    const homes = partners.map((p) => (p.root.visible ? p.root.position.clone() : null));
    await Promise.all(partners.map((p, i) => {
      const to = f.besideSpot(node.id, i);
      if (!p.root.visible) {
        p.root.position.copy(f.doorway(to.x));
        p.root.visible = true;
      }
      return p.walk(f.routeTo(p.root.position, to, f.gapX(node.id)));
    }));
    if (partners.length) {
      carrier.faceTo(partners[0].root.position.x, partners[0].root.position.z);
      for (const p of partners) p.faceTo(carrier.root.position.x, carrier.root.position.z);
    }
    await Promise.all([carrier.work(sec, text), ...partners.map((p) => p.work(sec, `${p.info.name}も一緒に`))]);
    partners.forEach((p, i) => {
      const home = homes[i];
      const to = home || f.doorway(p.root.position.x);
      p.walk(f.routeTo(p.root.position, to, f.gapX(node.id))).then(() => { if (!home) p.root.visible = false; }, () => {});
    });
  }

  async function doNode(f, node, dive) {
    fileOutputs(f, node);
    if (dive) return; // 下の階へ行く工程の時間は中の工程の合計で数える（親の時間も足すと二重になる）
    elapsed += node.dur || 0;
    hud.setElapsed(formatMinutes(elapsed));
    if (node.type === 'terminal') {
      carrier.greet();
      await clock.wait(0.6);
      return;
    }
    // 工程名は机の札にあるので、吹き出しは今の様子と時間だけ（同じ文が2つ並んで見にくかった）
    const text = node.type === 'decision' ? '考え中…' : `作業中${node.dur ? ` ⏱${formatMinutes(node.dur)}` : ''}`;
    await workTogether(f, node, node.type === 'decision' ? 1.2 : workSeconds(node.dur), text);
  }

  async function nextEdge(f, node) {
    const outs = f.data.edges.filter((e) => e.from === node.id && !e.data);
    if (!outs.length) return null;
    if (outs.length === 1 && (!outs[0].back || !ctx.opts.auto)) return outs[0];
    if (ctx.opts.auto) return outs.find((e) => !e.back) || null;
    const i = await hud.choose(node, outs.map((e, k) => ({ label: e.label || f.nodes.get(e.to)?.label || e.to, back: e.back, color: branchColor(e.label, k) })));
    return outs[i];
  }

  async function playFloor(key, viaStairs) {
    const f = await ctx.goFloor(key, viaStairs ? 'down' : null);
    let cur = f.data.start;
    if (!cur) return;
    carrier = f.animalOf(cur);
    f.paper.visible = true;
    carrier.hold(f.paper);
    if (viaStairs) await arrive(f, carrier, cur);
    else await carrier.walk([f.spot(cur)]);
    for (;;) {
      const node = f.nodes.get(cur);
      hud.setStep(f.data, node, carrier.info, partnersOf(f, node).map((p) => p.info));
      const dive = node.drill && ctx.opts.enterSub && ctx.hasFloor(node.id);
      await doNode(f, node, dive);
      if (dive) {
        const back = carrier;
        await goDown(f, node);
        await playFloor(node.id, true);
        await ctx.goFloor(key, 'up');
        carrier = back;
        hud.setStep(f.data, node, carrier.info);
        await comeUp(f, node, carrier);
      }
      const e = await nextEdge(f, node);
      if (!e) break;
      const nextAnimal = f.animalOf(e.to);
      if (!nextAnimal || nextAnimal === carrier) {
        await carrier.walk(f.route(carrier.root.position, e.to, false));
      } else {
        await Promise.all([
          carrier.walk(f.route(carrier.root.position, e.to, true)),
          nextAnimal.walk(f.route(nextAnimal.root.position, e.to, false)),
        ]);
        await toss(f, carrier, nextAnimal);
        const leaving = carrier;
        leaving.walk(f.route(leaving.root.position, cur, false)).catch(() => {});
        carrier = nextAnimal;
      }
      cur = e.to;
    }
    if (viaStairs) {
      await leave(f, carrier, cur); // 書類を持ったまま上の階へ
      return;
    }
    // 出口: 書類を消す
    await clock.run(0.5, (t) => f.paper.scale.setScalar(1 - t));
    f.paper.visible = false;
    f.paper.scale.setScalar(1);
  }

  async function play(rootKey) {
    if (running) return;
    running = true;
    elapsed = 0;
    hud.setElapsed(formatMinutes(0));
    hud.setPlaying(true);
    try {
      await playFloor(rootKey);
      hud.toast(`完了 — 合計 ${formatMinutes(elapsed)}`);
    } catch (err) {
      if (err !== CANCELLED) throw err;
    } finally {
      running = false;
      carrier = null;
      hud.setStep(null);
      hud.setPlaying(false);
    }
  }

  return {
    play,
    get running() { return running; },
    get carrier() { return carrier; },
  };
}
