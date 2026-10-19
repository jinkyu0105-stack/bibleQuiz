import { sermonMonthSchema, sermonThemeSchema, saveSermonThemeSchema } from "../../../shared/api/sermon-themes";
import { WeeklyError } from "./admin-weekly";

export async function readSermonTheme(db: D1Database, rawMonth: string) {
  const month = sermonMonthSchema.parse(rawMonth);
  const row = await db.prepare("SELECT value theme, updated_at revision FROM site_state WHERE key=?")
    .bind(`sermon_theme:${month}`).first<{ theme: string; revision: string }>();
  return sermonThemeSchema.parse({ month, theme: row?.theme ?? "", revision: row?.revision ?? null });
}

export async function saveSermonTheme(db: D1Database, rawMonth: string, raw: unknown, actor: string) {
  const month = sermonMonthSchema.parse(rawMonth), command = saveSermonThemeSchema.parse(raw);
  const key = `sermon_theme:${month}`, auditId = crypto.randomUUID();
  const at = new Date(Math.max(Date.now(), command.expectedRevision ? Date.parse(command.expectedRevision) + 1 : 0)).toISOString();
  // The audit insert is the compare-and-swap gate, inside the same D1 transaction.
  // Clearing retains a revision so an old tab cannot silently recreate a deleted theme.
  const results = await db.batch([
    db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
      SELECT ?,'sermon_theme',?,'monthly_theme_saved','access_admin',?,'{}',?
      WHERE (? IS NULL AND NOT EXISTS(SELECT 1 FROM site_state WHERE key=?))
        OR EXISTS(SELECT 1 FROM site_state WHERE key=? AND updated_at=?)`)
      .bind(auditId, month, actor, at, command.expectedRevision, key, key, command.expectedRevision),
    db.prepare(`INSERT INTO site_state(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM audit_logs WHERE id=?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
      .bind(key, command.theme, at, auditId),
  ]);
  if (results[0]?.meta.changes !== 1) throw new WeeklyError("CONFLICT");
  return sermonThemeSchema.parse({ month, theme: command.theme, revision: at });
}
