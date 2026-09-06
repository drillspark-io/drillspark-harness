export type Work = {
  id: string; name: string; who: string; freq: string; freqUnit: string;
  dur: string; durUnit: string; method: string; purpose: string;
  selected: boolean; trigger: string; work: string; tools: string; next: string;
};
export const freqUnits = ["回/月", "回/週", "回/日", "回/年"];
export const durUnits = ["分", "時間"];
export const blankWork = (): Work => ({
  id: crypto.randomUUID(), name: "", who: "", freq: "", freqUnit: "回/月",
  dur: "", durUnit: "分", method: "", purpose: "", selected: false,
  trigger: "", work: "", tools: "", next: "",
});
export function numberOf(value: string) {
  const normalized = value.trim().replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return /^(?:\d+\.?\d*|\.\d+)$/.test(normalized) ? Number(normalized) : NaN;
}
export function monthlyHours(row: Work) {
  const factor: Record<string, number> = {"回/月": 1, "回/週": 52 / 12, "回/日": 20, "回/年": 1 / 12};
  const hours = numberOf(row.freq) * numberOf(row.dur) * factor[row.freqUnit] / (row.durUnit === "分" ? 60 : 1);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}
export function problems(row: Work) {
  const result: string[] = [];
  if (!row.name.trim()) result.push("仕事の名前");
  if (!row.who.trim()) result.push("担当");
  if (numberOf(row.freq) <= 0 || numberOf(row.dur) <= 0 || !monthlyHours(row)) result.push("頻度と時間");
  if (!["実測", "未計測"].includes(row.method)) result.push("時間の測り方");
  if (!row.purpose.trim()) result.push("目的（不要でもOK）");
  for (const [name, value] of [["担当", row.who], ["目的", row.purpose]]) {
    if (/^(未確認|保留)[：:]\s*$/.test(value)) result.push(name + "の相談先");
  }
  return result;
}
export function validateRows(value: unknown): value is Work[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set();
  return value.every(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const keys = ["id", "name", "who", "freq", "freqUnit", "dur", "durUnit", "method", "purpose", "trigger", "work", "tools", "next"];
    if (!keys.every(k => typeof row[k] === "string" && row[k].length <= 2000)) return false;
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(row.id) || ids.has(row.id)) return false;
    ids.add(row.id);
    return typeof row.selected === "boolean" && freqUnits.includes(row.freqUnit) &&
      durUnits.includes(row.durUnit) && ["", "実測", "未計測"].includes(row.method) &&
      Object.keys(row).every(k => keys.includes(k) || k === "selected");
  });
}
