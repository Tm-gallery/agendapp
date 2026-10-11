package fr.agendapp.app

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.documentfile.provider.DocumentFile
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Automatic backup: a JSON copy of the data (the "Back up everything" format, so it can be
 * restored from Settings › Backup & restore), written to Downloads/AgendApp/Backups or to a folder
 * picked by the user (Storage Access Framework: SD card, cloud storage app…).
 */
object Backup {

    private const val PREFIX = "agendapp-backup"
    private const val SUBDIR = "AgendApp/Backups"
    private const val MIME = "application/json"

    class BackupError(message: String) : Exception(message)

    /** Runs a backup with the current settings; returns the name of the written file. */
    fun run(c: Context): String {
        val cfg = AppStore.backup(c)
        val result = runCatching {
            val src = AppStore.stateFile(c)
            if (!src.exists()) throw BackupError(c.getString(R.string.backup_no_data))
            var json = src.readText()
            if (cfg.optString("content") == "config") {
                json = JSONObject(json).put("events", org.json.JSONArray()).put("usage", JSONObject()).toString()
            }
            val history = cfg.optString("method") != "single"
            val name = if (history) "$PREFIX-${SimpleDateFormat("yyyy-MM-dd_HHmm", Locale.ROOT).format(Date())}.json" else "$PREFIX.json"
            val keep = cfg.optInt("keep", 10).coerceIn(1, 60)
            val bytes = json.toByteArray()
            if (cfg.optString("dest") == "folder") {
                writeToTree(c, Uri.parse(cfg.optString("folderUri")), name, bytes, history, keep)
            } else {
                writeToDownloads(c, name, bytes, history, keep)
            }
            name
        }
        val last = JSONObject().put("at", System.currentTimeMillis()).put("ok", result.isSuccess)
            .put("file", result.getOrNull() ?: "")
            .put("msg", result.exceptionOrNull()?.let { it.message ?: it.javaClass.simpleName } ?: "")
        AppStore.setBackup(c, JSONObject().put("last", last))
        return result.getOrThrow()
    }

    private fun writeToDownloads(c: Context, name: String, bytes: ByteArray, history: Boolean, keep: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Android 7 to 9: the app's own folder, no permission needed (Android/data/fr.agendapp.app/files).
            val dir = File(c.getExternalFilesDir(null), "Backups").apply { mkdirs() }
            File(dir, name).writeBytes(bytes)
            if (history) dir.listFiles { f -> f.name.startsWith("$PREFIX-") }?.sortedByDescending { it.name }?.drop(keep)?.forEach { it.delete() }
            return
        }
        val cr = c.contentResolver
        val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
        val path = "${Environment.DIRECTORY_DOWNLOADS}/$SUBDIR/"
        // Our existing files (the app may modify and delete the files it created).
        val mine = mutableListOf<Pair<Long, String>>()
        cr.query(
            collection, arrayOf(MediaStore.Downloads._ID, MediaStore.Downloads.DISPLAY_NAME),
            "${MediaStore.Downloads.RELATIVE_PATH} = ? AND ${MediaStore.Downloads.DISPLAY_NAME} LIKE ?",
            arrayOf(path, "$PREFIX%"), null,
        )?.use { cur -> while (cur.moveToNext()) mine += cur.getLong(0) to cur.getString(1) }

        val existing = mine.firstOrNull { it.second == name }?.first
        val uri = if (existing != null) {
            ContentUris.withAppendedId(collection, existing)
        } else {
            cr.insert(collection, ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, MIME)
                put(MediaStore.Downloads.RELATIVE_PATH, path)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }) ?: throw BackupError(c.getString(R.string.backup_write_refused))
        }
        cr.openOutputStream(uri, "wt")!!.use { it.write(bytes) }
        cr.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)

        if (history) {
            (mine.filter { it.second.startsWith("$PREFIX-") && it.second != name }.map { it } + (0L to name))
                .sortedByDescending { it.second }.drop(keep)
                .forEach { (id, _) -> if (id != 0L) cr.delete(ContentUris.withAppendedId(collection, id), null, null) }
        }
    }

    private fun writeToTree(c: Context, tree: Uri, name: String, bytes: ByteArray, history: Boolean, keep: Int) {
        val dir = DocumentFile.fromTreeUri(c, tree)
        if (dir == null || !dir.canWrite()) throw BackupError(c.getString(R.string.backup_folder_lost))
        val file = dir.findFile(name) ?: dir.createFile(MIME, name.removeSuffix(".json"))
            ?: throw BackupError(c.getString(R.string.backup_create_failed))
        c.contentResolver.openOutputStream(file.uri, "wt")!!.use { it.write(bytes) }
        if (history) {
            dir.listFiles().filter { it.name?.startsWith("$PREFIX-") == true }
                .sortedByDescending { it.name }.drop(keep).forEach { it.delete() }
        }
    }

    // ---------- Scheduling (WorkManager) ----------

    private const val PERIODIC = "backup-periodic"
    private const val ON_CHANGE = "backup-change"

    /** Applies the settings; [replace] realigns the next run on the chosen time. */
    fun schedule(c: Context, replace: Boolean) {
        val wm = WorkManager.getInstance(c)
        val cfg = AppStore.backup(c)
        val freq = cfg.optString("freq")
        if (!cfg.optBoolean("enabled") || freq == "change") {
            wm.cancelUniqueWork(PERIODIC)
            if (!cfg.optBoolean("enabled")) wm.cancelUniqueWork(ON_CHANGE)
            return
        }
        val weekly = freq == "weekly"
        val request = PeriodicWorkRequestBuilder<BackupWorker>(if (weekly) 7L else 1L, TimeUnit.DAYS)
            .setInitialDelay(delayUntil(cfg.optString("time", "03:00"), if (weekly) cfg.optInt("weekday", 1) else 0), TimeUnit.MILLISECONDS)
            .build()
        wm.enqueueUniquePeriodicWork(
            PERIODIC,
            if (replace) ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE else ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    /** "On change" mode: one copy a few minutes after the last change. */
    fun onDataChanged(c: Context) {
        val cfg = AppStore.backup(c)
        if (!cfg.optBoolean("enabled") || cfg.optString("freq") != "change") return
        WorkManager.getInstance(c).enqueueUniqueWork(
            ON_CHANGE, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<BackupWorker>().setInitialDelay(2, TimeUnit.MINUTES).build(),
        )
    }

    /** Delay until the next occurrence of [time] (and of [weekday], 1 = Monday, when not 0). */
    private fun delayUntil(time: String, weekday: Int): Long {
        val now = Calendar.getInstance()
        val next = (now.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, time.substringBefore(':').toIntOrNull() ?: 3)
            set(Calendar.MINUTE, time.substringAfter(':').toIntOrNull() ?: 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (weekday in 1..7) {
            val target = if (weekday == 7) Calendar.SUNDAY else weekday + 1
            while (next.get(Calendar.DAY_OF_WEEK) != target || !next.after(now)) next.add(Calendar.DAY_OF_YEAR, 1)
        } else if (!next.after(now)) {
            next.add(Calendar.DAY_OF_YEAR, 1)
        }
        return next.timeInMillis - now.timeInMillis
    }
}

class BackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result =
        try {
            Backup.run(applicationContext)
            Result.success()
        } catch (e: Backup.BackupError) {
            Result.failure() // a settings problem: retrying would not help
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
}
