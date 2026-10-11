package fr.agendapp.app

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * Data shared by the app, the widgets and scheduled backups:
 * - state.json: a copy of the web app's data (same format as "Back up everything (JSON)");
 * - feed.json: events already formatted by the app (title, times, colour) for widgets and the watch;
 * - native settings (backup, lock, widgets) in SharedPreferences.
 */
object AppStore {

    private const val PREFS = "agendapp"

    fun stateFile(c: Context) = File(c.filesDir, "state.json")
    fun feedFile(c: Context) = File(c.filesDir, "feed.json")

    fun writeAtomic(file: File, text: String) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun read(c: Context, key: String, defaults: JSONObject): JSONObject {
        val saved = prefs(c).getString(key, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
        return merge(defaults, saved)
    }

    private fun write(c: Context, key: String, value: JSONObject) = prefs(c).edit().putString(key, value.toString()).apply()

    private fun merge(base: JSONObject, patch: JSONObject?): JSONObject {
        val out = JSONObject(base.toString())
        patch?.keys()?.forEach { out.put(it, patch.get(it)) }
        return out
    }

    // ---------- Backup ----------

    private fun backupDefaults() = JSONObject()
        .put("enabled", false).put("freq", "daily").put("time", "03:00").put("weekday", 1)
        .put("dest", "downloads").put("folderUri", "").put("folderName", "")
        .put("method", "history").put("keep", 10).put("content", "full")
        .put("last", JSONObject())

    fun backup(c: Context) = read(c, "backup", backupDefaults())
    fun setBackup(c: Context, patch: JSONObject): JSONObject = merge(backup(c), patch).also { write(c, "backup", it) }

    // ---------- App lock ----------

    private fun lockDefaults() = JSONObject().put("enabled", false).put("delay", 0).put("hideRecents", true)

    fun lock(c: Context) = read(c, "lock", lockDefaults())
    fun setLock(c: Context, patch: JSONObject): JSONObject = merge(lock(c), patch).also { write(c, "lock", it) }

    // ---------- Widgets ----------

    fun widgetDefaults(kind: String): JSONObject = when (kind) {
        "list" -> JSONObject().put("days", 14).put("max", 8).put("details", true).put("group", true)
        "calendar" -> JSONObject().put("mode", "month").put("days", 5).put("labels", true).put("rolling", false).put("offset", 0)
        else -> JSONObject()
    }

    fun widgetCfg(c: Context, id: Int, kind: String) = read(c, "widget:$id", widgetDefaults(kind))
    fun setWidgetCfg(c: Context, id: Int, kind: String, patch: JSONObject): JSONObject =
        merge(widgetCfg(c, id, kind), patch).also { write(c, "widget:$id", it) }

    fun deleteWidgetCfg(c: Context, id: Int) = prefs(c).edit().remove("widget:$id").apply()
}
