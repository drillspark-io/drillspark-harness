// 再生の時間を1か所で持つ。歩く・作業する・待つはすべてここのタスクになり、
// 一時停止と速度はタスクに渡す経過時間だけで効く（各所で setTimeout を使わない）。

export const CANCELLED = Symbol('cancelled');

export function createClock() {
  const tasks = new Set();
  let speed = 1;
  let paused = false;

  /** sec 秒かけて fn(0→1) を呼ぶ。終われば resolve、cancelAll で reject(CANCELLED) */
  function run(sec, fn = () => {}) {
    return new Promise((resolve, reject) => {
      const total = Math.max(0.0001, sec);
      let t = 0;
      tasks.add({
        step(d) {
          t = Math.min(total, t + d);
          fn(t / total);
          return t >= total;
        },
        resolve,
        reject,
      });
    });
  }

  function tick(dt) {
    if (paused) return;
    const d = Math.min(dt, 0.1) * speed;
    for (const task of [...tasks]) {
      if (task.step(d)) {
        tasks.delete(task);
        task.resolve();
      }
    }
  }

  function cancelAll() {
    for (const task of tasks) task.reject(CANCELLED);
    tasks.clear();
  }

  return {
    run,
    wait: (sec) => run(sec),
    tick,
    cancelAll,
    get speed() { return speed; },
    set speed(v) { speed = v; },
    get paused() { return paused; },
    set paused(v) { paused = v; },
  };
}

export const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** 所要時間（分）を作業アニメの秒に。対数で 1〜6 秒に収める（0 分は 0.6 秒で通過） */
export function workSeconds(minutes) {
  if (!minutes) return 0.6;
  return Math.min(6, 1 + Math.log2(1 + minutes) * 0.75);
}

export function formatMinutes(min) {
  if (!min) return '0分';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}
