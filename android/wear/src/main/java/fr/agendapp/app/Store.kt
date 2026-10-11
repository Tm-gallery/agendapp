package fr.agendapp.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.wear.remote.interactions.RemoteActivityHelper
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await
import androidx.concurrent.futures.await
import java.io.File
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream

/** Watch settings. */
data class Settings(
    val phoneColors: Boolean = true,
    val hideNames: Boolean = false,
    val horizon: Int = 14,
)

/**
 * Watch data: the last copy received from the phone (feed.json), shared by the app, the tile and
 * the complication. No periodic polling: only the phone pushes data.
 */
object Store {
    const val PATH_FEED = "/agendapp/feed"
    const val PATH_SYNC = "/agendapp/sync"

    private val _feed = MutableStateFlow<Feed?>(null)
    val feed: StateFlow<Feed?> = _feed
    private val _settings = MutableStateFlow<Settings?>(null)
    val settings: StateFlow<Settings?> = _settings

    private val remoteExecutor by lazy { Executors.newSingleThreadExecutor() }

    private fun file(c: Context) = File(c.filesDir, "feed.json")
    private fun prefs(c: Context) = c.getSharedPreferences("watch", Context.MODE_PRIVATE)

    @Synchronized
    fun load(c: Context): Feed {
        _feed.value?.let { return it }
        val f = file(c)
        val feed = if (f.exists()) runCatching { Feed.parse(f.readText(), f.lastModified()) }.getOrNull() else null
        _feed.value = feed ?: Feed.EMPTY
        return _feed.value!!
    }

    @Synchronized
    fun save(c: Context, json: String) {
        val f = file(c)
        val tmp = File(f.parentFile, "feed.json.tmp")
        tmp.writeText(json)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        _feed.value = runCatching { Feed.parse(json, System.currentTimeMillis()) }.getOrDefault(Feed.EMPTY)
    }

    fun settings(c: Context): Settings {
        _settings.value?.let { return it }
        val p = prefs(c)
        return Settings(
            phoneColors = p.getBoolean("phoneColors", true),
            hideNames = p.getBoolean("hideNames", false),
            horizon = p.getInt("horizon", 14),
        ).also { _settings.value = it }
    }

    fun update(c: Context, s: Settings) {
        prefs(c).edit().putBoolean("phoneColors", s.phoneColors).putBoolean("hideNames", s.hideNames).putInt("horizon", s.horizon).apply()
        _settings.value = s
        refreshSurfaces(c)
    }

    /** Asks the tile and complication to refresh (only when something changed). */
    fun refreshSurfaces(c: Context) {
        runCatching { TileService.getUpdater(c).requestUpdate(AgendaTileService::class.java) }
        runCatching {
            ComplicationDataSourceUpdateRequester.create(c, ComponentName(c, NextEventComplication::class.java)).requestUpdateAll()
        }
    }

    fun decode(bytes: ByteArray): String = GZIPInputStream(bytes.inputStream()).bufferedReader().use { it.readText() }

    /** First launch: picks up the copy already present in the data layer. */
    suspend fun fetchExisting(c: Context): Boolean {
        val items = runCatching {
            Wearable.getDataClient(c).getDataItems(Uri.parse("wear://*$PATH_FEED")).await()
        }.getOrNull() ?: return false
        try {
            val item = items.maxByOrNull { DataMapItem.fromDataItem(it).dataMap.getLong("sent") } ?: return false
            val bytes = DataMapItem.fromDataItem(item).dataMap.getByteArray("json") ?: return false
            save(c, decode(bytes))
            refreshSurfaces(c)
            return true
        } finally {
            items.release()
        }
    }

    /** Asks the phone to resend the events. Returns false when no phone is reachable. */
    suspend fun requestSync(c: Context): Boolean {
        val nodes = runCatching { Wearable.getNodeClient(c).connectedNodes.await() }.getOrDefault(emptyList())
        var sent = false
        for (n in nodes) {
            runCatching { Wearable.getMessageClient(c).sendMessage(n.id, PATH_SYNC, ByteArray(0)).await() }.onSuccess { sent = true }
        }
        return sent
    }

    /** Opens the phone app on this day. */
    suspend fun openOnPhone(c: Context, day: java.time.LocalDate): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("agendapp://day/$day")).addCategory(Intent.CATEGORY_BROWSABLE)
        return runCatching {
            RemoteActivityHelper(c, remoteExecutor).startRemoteActivity(intent).await()
        }.isSuccess
    }
}

/** Receives the phone's data: saves it, then refreshes the tile and complication. */
class DataLayerService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (e in events) {
            if (e.type != DataEvent.TYPE_CHANGED || e.dataItem.uri.path != Store.PATH_FEED) continue
            val bytes = DataMapItem.fromDataItem(e.dataItem).dataMap.getByteArray("json") ?: continue
            runCatching { Store.save(applicationContext, Store.decode(bytes)) }
        }
        Store.refreshSurfaces(applicationContext)
    }
}
