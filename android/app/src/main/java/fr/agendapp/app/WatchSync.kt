package fr.agendapp.app

import android.content.Context
import android.os.Build
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/**
 * Sends events to the watch app (wear module) through the Wear OS data layer.
 *
 * Battery-friendly by design: a single DataItem, rewritten only when its content changes (its hash
 * is compared with the previous one). The watch never asks on its own; it can only request a resend
 * when the user taps "Sync".
 */
object WatchSync {
    const val PATH_FEED = "/agendapp/feed"
    const val PATH_SYNC = "/agendapp/sync"

    private fun prefs(c: Context) = c.getSharedPreferences("agendapp", Context.MODE_PRIVATE)

    /** Window sent: one past week, three months ahead. */
    private fun payload(c: Context): String? {
        val f = AppStore.feedFile(c)
        if (!f.exists()) return null
        val feed = runCatching { JSONObject(f.readText()) }.getOrNull() ?: return null
        val today = Dates.today()
        val from = Dates.add(today, -7)
        val to = Dates.add(today, 92)
        val items = JSONArray()
        feed.optJSONArray("items")?.let { arr ->
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val end = o.optString("e").ifEmpty { o.optString("d") }
                if (end >= from && o.optString("d") < to) items.put(o)
            }
        }
        return JSONObject()
            .put("v", 1)
            .put("cal", feed.optString("cal"))
            .put("items", items)
            .put("stats", feed.optJSONArray("stats") ?: JSONArray())
            .put("palette", palette(c))
            .toString()
    }

    /** The phone's Material You roles (dark theme, as used on watches). */
    private fun palette(c: Context): JSONObject {
        val p = JSONObject()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return p
        fun col(id: Int) = String.format("#%08X", c.getColor(id))
        val r = android.R.color::class.java
        fun sys(name: String) = col(r.getField("system_$name").getInt(null))
        listOf("accent1" to "primary", "accent2" to "secondary", "accent3" to "tertiary").forEach { (a, role) ->
            p.put(role, sys("${a}_200"))
            p.put("${role}Dim", sys("${a}_300"))
            p.put("${role}Container", sys("${a}_700"))
            p.put("on${role.replaceFirstChar { it.uppercase() }}", sys("${a}_800"))
            p.put("on${role.replaceFirstChar { it.uppercase() }}Container", sys("${a}_100"))
        }
        p.put("surfaceContainerLow", sys("neutral1_900"))
        p.put("surfaceContainer", sys("neutral1_800"))
        p.put("surfaceContainerHigh", sys("neutral1_700"))
        p.put("onSurface", sys("neutral1_50"))
        p.put("onSurfaceVariant", sys("neutral2_200"))
        p.put("outline", sys("neutral2_400"))
        p.put("outlineVariant", sys("neutral2_700"))
        return p
    }

    private fun gzip(s: String): ByteArray = ByteArrayOutputStream().also { out ->
        GZIPOutputStream(out).use { it.write(s.toByteArray()) }
    }.toByteArray()

    /** Call off the main thread. Sends nothing when nothing changed, unless [force]. */
    fun push(c: Context, force: Boolean = false, onDone: (() -> Unit)? = null) {
        val body = payload(c) ?: return
        val hash = body.hashCode()
        if (!force && prefs(c).getInt("watch:hash", 0) == hash) return
        val req = PutDataMapRequest.create(PATH_FEED).apply {
            dataMap.putByteArray("json", gzip(body))
            dataMap.putLong("sent", System.currentTimeMillis())
        }.asPutDataRequest().setUrgent()
        runCatching {
            Wearable.getDataClient(c).putDataItem(req)
                .addOnSuccessListener {
                    prefs(c).edit().putInt("watch:hash", hash).putLong("watch:at", System.currentTimeMillis()).apply()
                    onDone?.invoke()
                }
                .addOnFailureListener { onDone?.invoke() }
        }.onFailure { onDone?.invoke() } // no Google Play services / Wear OS
    }

    /** Connected watches (names), cached for the settings screen. */
    fun refreshNodes(c: Context, onDone: () -> Unit) {
        runCatching {
            Wearable.getNodeClient(c).connectedNodes
                .addOnSuccessListener { nodes ->
                    prefs(c).edit().putString("watch:nodes", JSONArray(nodes.map { it.displayName }).toString()).apply()
                    onDone()
                }
                .addOnFailureListener {
                    prefs(c).edit().remove("watch:nodes").apply()
                    onDone()
                }
        }
    }

    fun info(c: Context): String = JSONObject()
        .put("nodes", runCatching { JSONArray(prefs(c).getString("watch:nodes", "[]")) }.getOrDefault(JSONArray()))
        .put("at", prefs(c).getLong("watch:at", 0))
        .toString()
}

/** Requests from the watch: resend the events ("Sync" on the watch). */
class WatchListener : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == WatchSync.PATH_SYNC) WatchSync.push(applicationContext, force = true)
    }
}
