// 3D の上に重ねる操作盤。表示の文字はすべて textContent で入れる（図のラベルを HTML として解釈しない）。
import { formatMinutes, CANCELLED } from './motion.js';

const CSS = `
:root { --ao-bg: rgba(255,255,255,.92); --ao-fg: #1f2328; --ao-muted: #59636e; --ao-line: #d1d9e0;
  --ao-accent: #0969da; --ao-accent-fg: #fff; --ao-chip: #f6f8fa; --ao-warn: #9a6700;
  --ao-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif; }
@media (prefers-color-scheme: dark) { :root { --ao-bg: rgba(22,27,34,.92); --ao-fg: #e6edf3; --ao-muted: #9198a1; --ao-line: #3d444d;
  --ao-accent: #4493f8; --ao-chip: #1c2129; --ao-warn: #d29922; } }
html, body { margin: 0; height: 100%; overflow: hidden; background: #cfe3f2; font-family: var(--ao-font); color: var(--ao-fg); }
#app { position: fixed; inset: 0; }
#app canvas { display: block; }
.ao-css2d { position: absolute; inset: 0; pointer-events: none; z-index: 1; } /* 札の z-index は CSS2DRenderer が振るので、入れ物で閉じ込める */
.ao-panel { position: absolute; background: var(--ao-bg); border: 1px solid var(--ao-line); border-radius: 10px;
  box-shadow: 0 2px 10px rgba(0,0,0,.12); padding: 10px 12px; font-size: 13px; backdrop-filter: blur(6px); z-index: 2; }
.ao-top { left: 12px; top: 12px; max-width: min(46rem, calc(100vw - 24px)); }
.ao-top h1 { font-size: 16px; margin: 0 0 6px; }
.ao-crumb { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ao-crumb button { font: inherit; font-size: 12px; border: 1px solid var(--ao-line); background: var(--ao-chip); color: var(--ao-fg);
  border-radius: 999px; padding: 1px 10px; cursor: pointer; }
.ao-crumb button[aria-current="true"] { background: var(--ao-accent); border-color: var(--ao-accent); color: var(--ao-accent-fg); font-weight: 600; }
.ao-crumb i { color: var(--ao-muted); font-style: normal; }
.ao-ctrl { right: 12px; top: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 13rem; }
.ao-ctrl .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ao-ctrl button, .ao-ctrl select { font: inherit; border: 1px solid var(--ao-line); background: var(--ao-chip); color: var(--ao-fg); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ao-ctrl button.primary { background: var(--ao-accent); border-color: var(--ao-accent); color: var(--ao-accent-fg); font-weight: 600; min-width: 6.5rem; }
.ao-ctrl label { display: flex; gap: 6px; align-items: center; font-size: 12.5px; cursor: pointer; }
.ao-elapsed { font-variant-numeric: tabular-nums; color: var(--ao-muted); font-size: 12.5px; }
.ao-cap { left: 50%; bottom: 14px; transform: translateX(-50%); max-width: min(44rem, calc(100vw - 24px)); text-align: center; }
.ao-cap[hidden], .ao-choice[hidden], .ao-info[hidden] { display: none; }
.ao-cap b { font-size: 15px; }
.ao-cap small { display: block; color: var(--ao-muted); margin-top: 2px; }
.ao-cap-note { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: 4px;
  font-size: 12px; color: var(--ao-fg); text-align: left; border-top: 1px solid var(--ao-line); padding-top: 4px; }
.ao-choice button.ao-colored { color: #fff; border-color: transparent; font-weight: 700; }
.ao-tag .ao-note { margin-left: 3px; }
.ao-choice { z-index: 12; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; min-width: 18rem; }
.ao-choice p { margin: 0 0 8px; font-weight: 600; }
.ao-choice button { display: block; width: 100%; margin: 6px 0 0; font: inherit; padding: 6px 12px; border-radius: 6px;
  border: 1px solid var(--ao-accent); background: var(--ao-chip); color: var(--ao-fg); cursor: pointer; }
.ao-choice button:hover, .ao-choice button:focus-visible { background: var(--ao-accent); color: var(--ao-accent-fg); }
.ao-list { left: 12px; bottom: 14px; max-height: 42vh; overflow: auto; width: 17rem; padding: 6px 8px; }
.ao-list summary { cursor: pointer; font-weight: 600; padding: 2px 4px; }
.ao-list ol { list-style: none; margin: 4px 0 0; padding: 0; }
.ao-list li button { display: flex; gap: 6px; width: 100%; text-align: left; font: inherit; font-size: 12.5px; border: 0; background: none;
  color: var(--ao-fg); padding: 3px 4px; border-radius: 4px; cursor: pointer; }
.ao-list li button:hover, .ao-list li button:focus-visible, .ao-list li button.cur { background: var(--ao-chip); outline: 1px solid var(--ao-line); }
.ao-list .id { font: 600 11px ui-monospace, Consolas, monospace; color: var(--ao-muted); min-width: 2.4rem; }
.ao-list .min { margin-left: auto; color: var(--ao-muted); white-space: nowrap; }
.ao-info { right: 12px; bottom: 14px; width: 19rem; max-height: 40vh; overflow: auto; }
.ao-info h2 { font-size: 14px; margin: 0 0 4px; }
.ao-info p { margin: 4px 0; white-space: pre-wrap; color: var(--ao-muted); font-size: 12.5px; }
.ao-info button { font: inherit; margin-top: 6px; border: 1px solid var(--ao-accent); background: var(--ao-accent); color: var(--ao-accent-fg); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
.ao-toast { position: absolute; z-index: 11; left: 50%; top: 18%; transform: translateX(-50%); background: var(--ao-fg); color: var(--ao-bg);
  padding: 8px 16px; border-radius: 999px; font-weight: 600; font-size: 14px; pointer-events: none; transition: opacity .4s; }
.ao-loading { position: absolute; inset: 0; display: grid; place-items: center; font-size: 15px; color: #33415c; }
/* 家具の札。CSS2DObject.center で下辺中央を家具の真上に付け、下向きの三角で指す（transform は CSS2DRenderer が上書きするので使わない） */
.ao-tag { position: relative; background: rgba(255,255,255,.95); color: #1f2328; border: 1px solid #c9d1d9; border-radius: 6px; padding: 2px 7px;
  font-size: 12px; line-height: 1.3; max-width: 8rem; margin-bottom: 7px; pointer-events: none; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.ao-tag::after { content: ""; position: absolute; left: 50%; bottom: -7px; margin-left: -6px; border: 6px solid transparent; border-bottom: 0;
  border-top-color: rgba(255,255,255,.95); }
.ao-tag .ao-l { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ao-tag-sm { font-size: 10.5px; color: #59636e; background: rgba(255,255,255,.85); max-width: 7rem; }
.ao-tag .ao-id { display: block; font: 600 10px ui-monospace, Consolas, monospace; color: #59636e; }
.ao-tag .ao-dur { display: block; font-size: 10.5px; color: #0550ae; }
.ao-tag.hit { outline: 2px solid #0969da; }
.ao-css2d .ao-cull { visibility: hidden; }
.ao-css2d.ao-far .ao-dur, .ao-css2d.ao-far .ao-tag-sm { display: none; }
.ao-lane { pointer-events: none; background: rgba(255,255,255,.9); border-radius: 0 6px 6px 0; padding: 3px 9px 3px 7px; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.ao-lane-name { display: block; font-weight: 700; font-size: 13px; color: #33415c; }
.ao-lane-animal { display: block; font-size: 11px; color: #59636e; }
.ao-edge { font-size: 11px; background: #fff7e0; border: 1px solid #e3b341; color: #6b4e00; border-radius: 999px; padding: 0 7px; pointer-events: none; }
.ao-edge.ao-branch { font-size: 13px; font-weight: 700; color: #fff; border: 2px solid #fff; padding: 1px 10px; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
.ao-bubble { background: #fff; color: #1f2328; border: 2px solid #33415c; border-radius: 12px; padding: 4px 10px; font-size: 12.5px; font-weight: 600;
  white-space: nowrap; max-width: 16rem; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.ao-fallback { padding: 1.5rem; overflow: auto; height: 100%; box-sizing: border-box; background: #fff; color: #1f2328; }
.ao-fallback table { border-collapse: collapse; margin: .5rem 0 1.5rem; font-size: 13px; }
.ao-fallback th, .ao-fallback td { border-bottom: 1px solid #d1d9e0; padding: 4px 10px; text-align: left; }
@media (max-width: 640px) { .ao-list { display: none; } .ao-info { left: 12px; right: 12px; width: auto; } .ao-ctrl { top: auto; bottom: 90px; } }
.ao-curtain { position: absolute; inset: 0; background: rgba(20,24,32,.92); color: #fff; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; pointer-events: none; z-index: 10; text-align: center; padding: 0 16px; }
.ao-curtain-head { font-size: clamp(22px, 4vw, 36px); font-weight: 700; letter-spacing: .04em; }
.ao-curtain-sub { font-size: clamp(14px, 2.2vw, 18px); color: #cfd8e3; }
@media (prefers-reduced-motion: reduce) { .ao-toast { transition: none; } }
`;

export function injectCss() {
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** @param {HTMLElement} app */
export function createHud(app, handlers) {
  const top = el('div', 'ao-panel ao-top');
  const h1 = el('h1');
  const crumb = el('nav', 'ao-crumb');
  crumb.setAttribute('aria-label', '階');
  top.append(h1, crumb);

  const ctrl = el('div', 'ao-panel ao-ctrl');
  const playBtn = el('button', 'primary', '▶ 再生');
  const resetBtn = el('button', '', '↺ 最初から');
  const speed = el('select');
  speed.setAttribute('aria-label', '速度');
  for (const v of [0.5, 1, 2, 4]) {
    const o = el('option', '', `×${v}`);
    o.value = String(v);
    if (v === 1) o.selected = true;
    speed.append(o);
  }
  const opt = (text, checked) => {
    const l = el('label');
    const c = el('input');
    c.type = 'checkbox';
    c.checked = checked;
    l.append(c, document.createTextNode(text));
    return [l, c];
  };
  const [autoL, auto] = opt('分岐を自動で選ぶ', false);
  const [subL, sub] = opt('サブプロセスにも入る', true);
  const [folL, follow] = opt('カメラが書類を追う', true);
  const elapsed = el('div', 'ao-elapsed', '経過 0分');
  const row1 = el('div', 'row');
  row1.append(playBtn, resetBtn, speed);
  ctrl.append(row1, autoL, subL, folL, elapsed);

  const cap = el('div', 'ao-panel ao-cap');
  cap.hidden = true;
  cap.setAttribute('aria-live', 'polite');
  const choice = el('div', 'ao-panel ao-choice');
  choice.hidden = true;
  choice.setAttribute('role', 'dialog');

  const list = el('details', 'ao-panel ao-list');
  list.open = window.innerHeight > 900;
  const listSum = el('summary', '', '工程');
  const ol = el('ol');
  list.append(listSum, ol);

  const info = el('div', 'ao-panel ao-info');
  info.hidden = true;

  app.append(top, ctrl, cap, choice, list, info);

  playBtn.addEventListener('click', () => handlers.onPlay());
  resetBtn.addEventListener('click', () => handlers.onReset());
  speed.addEventListener('change', () => handlers.onSpeed(Number(speed.value)));

  let pendingReject = null;

  return {
    opts: {
      get auto() { return auto.checked; },
      get enterSub() { return sub.checked; },
      get follow() { return follow.checked; },
    },
    setTitle(t) { h1.textContent = t; document.title = t; },
    setCrumb(chain, currentKey, onJump) {
      crumb.replaceChildren();
      chain.forEach((c, i) => {
        if (i) crumb.append(el('i', '', '›'));
        const b = el('button', '', `${c.floorName} ${c.title}`);
        if (c.key === currentKey) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => onJump(c.key));
        crumb.append(b);
      });
    },
    setList(floor, onPick) {
      listSum.textContent = `工程（${floor.nodes.filter((n) => !n.side).length}）`;
      ol.replaceChildren();
      for (const n of floor.nodes) {
        const li = el('li');
        const b = el('button');
        b.dataset.nodeId = n.id;
        b.append(el('span', 'id', n.id), el('span', '', n.label), el('span', 'min', n.dur ? formatMinutes(n.dur) : ''));
        b.addEventListener('click', () => onPick(n.id));
        li.append(b);
        ol.append(li);
      }
    },
    markCurrent(id) {
      for (const b of ol.querySelectorAll('button')) b.classList.toggle('cur', b.dataset.nodeId === id);
    },
    showInfo(floor, node, onEnter) {
      if (!node) { info.hidden = true; return; }
      info.replaceChildren();
      const lane = floor.lanes.find((l) => l.name === node.lane);
      info.append(el('h2', '', `${node.id}  ${node.label}`));
      info.append(el('p', '', `${lane ? `${lane.name}（${lane.animalName}）` : ''}${node.dur ? ` ・ ⏱ ${formatMinutes(node.dur)}` : ''}`));
      if (node.note) info.append(el('p', '', node.note));
      if (onEnter) {
        const b = el('button', '', '▼ 階段でこの工程の中（下の階）へ');
        b.addEventListener('click', onEnter);
        info.append(b);
      }
      const close = el('button', '', '閉じる');
      close.style.marginLeft = '6px';
      close.addEventListener('click', () => { info.hidden = true; });
      info.append(close);
      info.hidden = false;
    },
    setStep(floor, node, animal, partners = []) {
      if (!floor || !node) { cap.hidden = true; this.markCurrent(null); return; }
      const who = [`${node.lane}（${animal ? animal.name : ''}）`, ...partners.map((p) => `${p.lane}（${p.name}）`)].join(' ＋ ');
      cap.replaceChildren(
        el('b', '', `${node.id}  ${node.label}`),
        el('small', '', `${who}${node.dur ? ` ・ ⏱ ${formatMinutes(node.dur)}` : ''}`),
      );
      if (node.note) cap.append(el('span', 'ao-cap-note', `📝 ${node.note}`)); // 再生中は備考もここに出す
      cap.hidden = false;
      this.markCurrent(node.id);
    },
    setElapsed(t) { elapsed.textContent = `経過 ${t}`; },
    setPlaying(on) { playBtn.textContent = on ? '⏸ 一時停止' : '▶ 再生'; },
    setPaused(p) { playBtn.textContent = p ? '▶ 続ける' : '⏸ 一時停止'; },
    choose(node, options) {
      return new Promise((resolve, reject) => {
        pendingReject = reject;
        choice.replaceChildren(el('p', '', node.label));
        options.forEach((o, i) => {
          const b = el('button', o.color ? 'ao-colored' : '', `${o.back ? '↩ ' : '→ '}${o.label}`);
          if (o.color) b.style.background = o.color; // 床の線と同じ色
          b.addEventListener('click', () => { choice.hidden = true; pendingReject = null; resolve(i); });
          choice.append(b);
        });
        choice.hidden = false;
        choice.querySelector('button')?.focus();
      });
    },
    cancelChoice() {
      choice.hidden = true;
      if (pendingReject) pendingReject(CANCELLED);
      pendingReject = null;
    },
    /** 階を移るときの暗幕。set(0〜1) で濃さ、remove() で片付ける */
    curtain(head, sub) {
      const c = el('div', 'ao-curtain');
      c.setAttribute('role', 'status');
      c.append(el('div', 'ao-curtain-head', head), el('div', 'ao-curtain-sub', sub));
      c.style.opacity = '0';
      app.append(c);
      return { set(o) { c.style.opacity = String(o); }, remove() { c.remove(); } };
    },
    toast(text) {
      const t = el('div', 'ao-toast', text);
      app.append(t);
      setTimeout(() => { t.style.opacity = '0'; }, 2200);
      setTimeout(() => t.remove(), 2800);
    },
  };
}

/** WebGL が無いとき: 工程表だけを出す */
export function renderFallback(app, data) {
  const box = el('div', 'ao-fallback');
  box.append(el('h1', '', data.title), el('p', '', 'この環境では 3D を表示できないため、工程の表だけを出しています。'));
  for (const key of data.order) {
    const f = data.floors[key];
    box.append(el('h2', '', `${f.floorName} ${f.title}`));
    const t = el('table');
    const head = el('tr');
    for (const h of ['ID', '工程', '部署（担当）', '時間']) head.append(el('th', '', h));
    t.append(head);
    for (const n of f.nodes) {
      const tr = el('tr');
      const lane = f.lanes.find((l) => l.name === n.lane);
      for (const v of [n.id, n.label, lane ? `${lane.name}（${lane.animalName}）` : '', n.dur ? formatMinutes(n.dur) : '']) tr.append(el('td', '', v));
      t.append(tr);
    }
    box.append(t);
  }
  app.replaceChildren(box);
}
