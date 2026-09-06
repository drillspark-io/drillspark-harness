"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { blankWork, monthlyHours, problems, freqUnits, durUnits, type Work } from "@/lib/inventory";

type Sheet = { rows: Work[]; status: string; revision: number };
export default function Home() {
  const [rows, setRows] = useState<Work[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("保存した内容を確認しています…");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const revision = useRef(0);
  const queue = useRef(Promise.resolve());
  const latest = useRef<Work[]>([]);
  const generation = useRef(0);
  const blocked = useRef(false);
  const pending = useRef(0);
  const dirtyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/worksheet").then(async r => {
      if (!r.ok) throw Error("読み込めませんでした。再読み込みしてください。");
      const data: Sheet = await r.json();
      revision.current = data.revision;
      latest.current = data.rows.length ? data.rows : [blankWork()];
      setRows(latest.current); setReady(data.status === "ready"); setLoaded(true);
      setMessage(data.revision ? "保存した内容を読み込みました" : "入力すると自動で保存します");
    }).catch(e => setError(e.message));
    const unload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || pending.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("beforeunload", unload); if (timer.current) clearTimeout(timer.current); };
  }, []);

  function save(snapshot: Work[], status: string, version: number) {
    pending.current++;
    queue.current = queue.current.then(async () => {
      if (blocked.current) return;
      setBusy(true);
      try {
        const response = await fetch("/api/worksheet", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: snapshot, status, revision: revision.current }),
        });
        const data = await response.json() as { revision: number; error?: string };
        if (!response.ok) { if (response.status === 409) blocked.current = true; throw Error(data.error || "保存できませんでした。"); }
        revision.current = data.revision;
        if (generation.current === version) {
          dirtyRef.current = false; setDirty(false); setError(""); setReady(status === "ready");
          setMessage(status === "ready" ? "入力完了として保存しました" : "保存済み");
        }
      } catch (e) { setError((e as Error).message + " 入力は画面に残っています。"); }
      finally { setBusy(false); }
    }).finally(() => { pending.current--; });
  }
  function change(next: Work[]) {
    latest.current = next; setRows(next); setReady(false); setDirty(true); dirtyRef.current = true;
    generation.current++; setMessage("保存待ち…");
    if (timer.current) clearTimeout(timer.current);
    const version = generation.current;
    timer.current = setTimeout(() => save(next, "draft", version), 700);
  }
  function field(id: string, key: keyof Work, value: string) {
    change(latest.current.map(row => row.id === id ? { ...row, [key]: value } : row));
  }
  function finish() {
    if (timer.current) clearTimeout(timer.current);
    if (!rows.length || rows.some(row => problems(row).length)) {
      setError("各仕事の「あと入力する項目」を埋めてください。目的は「不要」でも大丈夫です。"); return;
    }
    save(latest.current, "ready", generation.current);
  }
  const total = rows.reduce((sum, row) => sum + monthlyHours(row), 0);
  return <main>
    <header><p className="eyebrow">DRILLSPARK / 仕事の見直し</p><h1>いつもの仕事を、<br className="mobile-break" />書き出してみましょう。</h1>
      <p className="lead">まずは1件からで大丈夫。時間はおおよそで構いません。</p></header>
    <section className="summary" aria-label="入力状況"><div><strong>{rows.length}</strong> 件の仕事</div>
      <div>合計 <strong>{total.toLocaleString("ja-JP", {maximumFractionDigits: 1})}</strong> 時間／月</div>
      <p>週は年52週、日は月20日で換算。見積もりの時間も含みます。</p></section>
    <p role="status" className="save-status">{busy ? "保存しています…" : message}</p>
    {error && <div role="alert" className="error">{error}
      {!blocked.current && loaded && <Button variant="outline" onClick={() => save(latest.current, "draft", generation.current)}>保存を再試行</Button>}</div>}
    {ready && !dirty && <section className="success"><h2>入力できました</h2><p>Codexの会話に戻って「入力した」と伝えてください。この一覧を読み取り、改善候補を一緒に選びます。</p>
      <p>書き直すと、入力完了の状態は解除されます。</p></section>}
    {loaded && rows.map((row, index) => <section className="work-card" key={row.id} aria-labelledby={row.id + "-heading"}>
      <div className="card-heading"><h2 id={row.id + "-heading"}><span>{String(index + 1).padStart(2, "0")}</span> {row.name || "仕事を入力"}</h2>
        <Button variant="ghost" onClick={() => change(rows.filter(r => r.id !== row.id))} aria-label={(row.name || "仕事" + (index + 1)) + "を一覧から外す"}>一覧から外す</Button></div>
      <div className="fields">
        <label className="wide">どんな仕事ですか？<Input value={row.name} onChange={e => field(row.id, "name", e.target.value)} placeholder="例：届いた請求書を表に転記する" maxLength={2000}/></label>
        <label>誰が担当していますか？<Input value={row.who} onChange={e => field(row.id, "who", e.target.value)} placeholder="例：自分、経理担当、兼務" maxLength={2000}/></label>
        <div className="time-group"><label>どのくらいの頻度？<Input inputMode="decimal" value={row.freq} onChange={e => field(row.id, "freq", e.target.value)} placeholder="例：30" /></label>
          <NativeSelect aria-label="頻度の単位" value={row.freqUnit} onChange={e => field(row.id, "freqUnit", e.target.value)}>{freqUnits.map(u => <option key={u}>{u}</option>)}</NativeSelect></div>
        <div className="time-group"><label>1回にかかる時間は？<Input inputMode="decimal" value={row.dur} onChange={e => field(row.id, "dur", e.target.value)} placeholder="例：4" /></label>
          <NativeSelect aria-label="時間の単位" value={row.durUnit} onChange={e => field(row.id, "durUnit", e.target.value)}>{durUnits.map(u => <option key={u}>{u}</option>)}</NativeSelect></div>
        <label>その時間は？<NativeSelect value={row.method} onChange={e => field(row.id, "method", e.target.value)}>
          <option value="">選んでください</option><option value="未計測">おおよその見積もり</option><option value="実測">実際に測った時間</option></NativeSelect></label>
        <p className="calculation">この仕事は <strong>{monthlyHours(row).toLocaleString("ja-JP", {maximumFractionDigits: 1})}</strong> 時間／月</p>
        <label className="wide">何のためにしていますか？<Textarea value={row.purpose} onChange={e => field(row.id, "purpose", e.target.value)} placeholder="例：支払い漏れを防ぐ。要らないと思う仕事なら「不要」でOKです。" maxLength={2000}/></label>
      </div>
      {problems(row).length > 0 && <p className="missing">あと入力する項目：{problems(row).join("・")}</p>}
    </section>)}
    {loaded && <footer><Button variant="outline" disabled={rows.length >= 100} onClick={() => change([...rows, blankWork()])}>＋ 仕事を追加</Button>
      <Button onClick={finish} disabled={busy || blocked.current || !rows.length}>入力を完了する</Button></footer>}
  </main>;
}
