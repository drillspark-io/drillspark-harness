import { database } from "@/db/raw";
import { validateRows, problems } from "@/lib/inventory";

const headers = { "Cache-Control": "no-store" };
export async function GET() {
  const row = await database().prepare("SELECT rows_json, status, revision, updated_at FROM worksheets WHERE id = ?")
    .bind("main").first<{ rows_json: string; status: string; revision: number; updated_at: string }>();
  return Response.json(row ? { rows: JSON.parse(row.rows_json), status: row.status, revision: row.revision, updatedAt: row.updated_at } :
    { rows: [], status: "draft", revision: 0, updatedAt: null }, { headers });
}
export async function PUT(request: Request) {
  // The Site is owner-only at the Sites access gateway; never deploy it publicly.
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "この画面から保存してください。" }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return new Response(null, { status: 415 });
  const raw = await request.text();
  if (raw.length > 500000) return new Response(null, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (!body || !validateRows(body.rows) || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
      !["draft", "ready"].includes(body.status))
    return Response.json({ error: "入力内容を確認してください。" }, { status: 400, headers });
  if (body.status === "ready" && (!body.rows.length || body.rows.some((row: Parameters<typeof problems>[0]) => problems(row).length)))
    return Response.json({ error: "未入力の項目を確認してください。" }, { status: 400, headers });
  const result = await database().prepare(
    "INSERT INTO worksheets (id, rows_json, status, revision, updated_at) SELECT ?, ?, ?, 1, ? WHERE ? = 0 " +
    "ON CONFLICT(id) DO UPDATE SET rows_json = excluded.rows_json, status = excluded.status, " +
    "revision = worksheets.revision + 1, updated_at = excluded.updated_at WHERE worksheets.revision = ?"
  ).bind("main", JSON.stringify(body.rows), body.status, new Date().toISOString(), body.revision, body.revision).run();
  // For existing revisions, UPDATE is required (the insert SELECT intentionally only runs for first save).
  if (!result.meta.changes && body.revision > 0) {
    const updated = await database().prepare(
      "UPDATE worksheets SET rows_json = ?, status = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?"
    ).bind(JSON.stringify(body.rows), body.status, new Date().toISOString(), "main", body.revision).run();
    if (!updated.meta.changes) return Response.json({ error: "別の画面で更新されました。再読み込みして確認してください。" }, { status: 409, headers });
  } else if (!result.meta.changes) {
    return Response.json({ error: "別の画面で更新されました。再読み込みして確認してください。" }, { status: 409, headers });
  }
  return Response.json({ revision: body.revision + 1 }, { headers });
}
