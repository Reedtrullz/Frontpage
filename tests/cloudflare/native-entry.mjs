import { timingSafeEqual } from "node:crypto";

// Deny every outbound fetch before the SUT is imported.
const deniedFetch = async () => {
  throw new Error("Native regression blocked outbound fetch.");
};
globalThis.fetch = deniedFetch;
if (globalThis.fetch !== deniedFetch) {
  throw new Error("Native regression could not install its deny-all fetch guard.");
}

const runtime = await import("../../.open-next/do-entry.mjs");

const json = (body, status = 200) => Response.json(body, { status });

export class FrontpageDO extends runtime.FrontpageDO {
  async fetch(request) {
    const url = new URL(request.url);
    return url.pathname.startsWith("/__qa/") ? this.qa(request, url) : super.fetch(request);
  }

  async qa(request, url) {
    // The key is checked before the body is read, so an unkeyed caller never reaches the parser.
    const given = Buffer.from(request.headers.get("x-qa-key") ?? "");
    const expected = Buffer.from(this.env.QA_SEED_KEY ?? "");
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected) || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/__qa/egress") {
      try {
        await fetch("https://egress.invalid/");
        return json({ blocked: false });
      } catch (error) {
        return json({ blocked: true, message: error.message });
      }
    }
    if (url.pathname !== "/__qa/seed") return new Response("Not found", { status: 404 });
    const { action, entries = [] } = await request.json();
    const sql = this.state.storage.sql;
    if (action === "backup") {
      for (const table of ["metrics_v2_files", "metrics_v2_active"]) {
        sql.exec("DROP TABLE IF EXISTS qa_backup_" + table);
        sql.exec("CREATE TABLE qa_backup_" + table + " AS SELECT * FROM " + table);
      }
    } else if (action === "restore") {
      for (const table of ["metrics_v2_files", "metrics_v2_active"]) {
        sql.exec("DELETE FROM " + table);
        sql.exec("INSERT INTO " + table + " SELECT * FROM qa_backup_" + table);
        sql.exec("DROP TABLE qa_backup_" + table);
      }
    } else if (action === "apply") {
      // Rows go straight into the tables the production reader queries; each gets a fresh hash.
      for (const { name, data } of entries) {
        const hash = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
        sql.exec("INSERT INTO metrics_v2_files (hash, data, uploaded_at) VALUES (?, ?, ?)", hash, Buffer.from(data, "base64"), Date.now());
        sql.exec("UPDATE metrics_v2_active SET files = json_set(files, ?, ?) WHERE id = 1", '$."' + name + '"', hash);
      }
    } else {
      return json({ error: "unknown action" }, 400);
    }
    return json({ ok: true, action, entries: entries.length });
  }
}

export default runtime.default;
