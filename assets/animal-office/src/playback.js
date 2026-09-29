// 再生: 書類1枚が開始から辺の順に机を回る。
// - 同じ部署の次の机へは、担当が書類を持って歩く
// - 別の部署へは、手前まで届けて手渡し、自分の机へ戻る
// - 分岐は選ばせる（自動なら戻り辺でない最初の辺。戻り辺しか無ければそこで終わる＝無限ループにしない）
// - 子図を持つ工程は、エレベーターで下の階へ潜って再生し、終わったら戻る
// - 成果物・データストアへの辺は流れではない。作業中に書類の写しがトレイへ飛ぶだけ
import * as THREE from 'three';
import { CANCELLED, workSeconds, formatMinutes } from './motion.js';
import { paper as makePaper } from './props.js';

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

  async function doNode(f, node, dive) {
    fileOutputs(f, node);
    if (dive) {
      // 下の階へ潜る工程の時間は、中の工程の合計で数える（親の時間も足すと二重になる）
      carrier.say(`${node.label} — 下の階へ`);
      await clock.wait(0.8);
      carrier.say('');
      return;
    }
    elapsed += node.dur || 0;
    hud.setElapsed(formatMinutes(elapsed));
    if (node.type === 'terminal') {
      carrier.greet();
      await clock.wait(0.6);
      return;
    }
    const text = node.type === 'decision' ? `${node.label}` : `${node.label}${node.dur ? ` ⏱${formatMinutes(node.dur)}` : ''}`;
    await carrier.work(node.type === 'decision' ? 1.2 : workSeconds(node.dur), text);
  }

  async function nextEdge(f, node) {
    const outs = f.data.edges.filter((e) => e.from === node.id && !e.data);
    if (!outs.length) return null;
    if (outs.length === 1 && (!outs[0].back || !ctx.opts.auto)) return outs[0];
    if (ctx.opts.auto) return outs.find((e) => !e.back) || null;
    const i = await hud.choose(node, outs.map((e) => ({ label: e.label || f.nodes.get(e.to)?.label || e.to, back: e.back })));
    return outs[i];
  }

  async function playFloor(key) {
    const f = await ctx.goFloor(key);
    let cur = f.data.start;
    if (!cur) return;
    carrier = f.animalOf(cur);
    f.paper.visible = true;
    f.paper.position.copy(f.spot(cur)).setY(0.9);
    await carrier.walk([f.spot(cur)]);
    carrier.hold(f.paper);
    for (;;) {
      const node = f.nodes.get(cur);
      hud.setStep(f.data, node, carrier.info);
      const dive = node.drill && ctx.opts.enterSub && ctx.hasFloor(node.id);
      await doNode(f, node, dive);
      if (dive) {
        const back = carrier;
        await playFloor(node.id);
        await ctx.goFloor(key);
        carrier = back;
        hud.setStep(f.data, node, carrier.info);
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
