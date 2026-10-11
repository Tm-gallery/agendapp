package fr.agendapp.app

import android.content.Context
import android.graphics.Color
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** An event as the app shows it (title, short code, times, type colour), read from feed.json. */
data class FeedItem(
    val id: String,
    val start: String,       // YYYY-MM-DD
    val end: String,         // end date (exclusive for all-day events)
    val allDay: Boolean,
    val from: String,        // HH:MM
    val to: String,
    val title: String,
    val code: String,
    val type: String,
    val color: Int,
    val details: String,
) {
    /** Days covered by the event (a night shift stays attached to the day it starts). */
    fun covers(day: String): Boolean = if (allDay) day >= start && day < end else day == start
    val days: Int get() = if (allDay) Dates.between(start, end).coerceAtLeast(1) else 1
}

/** Events prepared by the web app (see platform/android/native.js), cached until the file changes. */
object Feed {
    private var cache: Pair<Long, List<FeedItem>>? = null

    fun load(c: Context): List<FeedItem> {
        val f = AppStore.feedFile(c)
        if (!f.exists()) return emptyList()
        cache?.let { if (it.first == f.lastModified()) return it.second }
        val items = runCatching {
            val arr = JSONObject(f.readText()).getJSONArray("items")
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                FeedItem(
                    id = o.optString("id"), start = o.optString("d"), end = o.optString("e"), allDay = o.optBoolean("ad"),
                    from = o.optString("s"), to = o.optString("f"), title = o.optString("t"), code = o.optString("c"),
                    type = o.optString("ty"),
                    color = runCatching { Color.parseColor(o.optString("col")) }.getOrDefault(Color.GRAY),
                    details = o.optString("x"),
                )
            }
        }.getOrDefault(emptyList())
        cache = f.lastModified() to items
        return items
    }

    fun on(items: List<FeedItem>, day: String) = items.filter { it.covers(day) }
}

/** Dates as YYYY-MM-DD strings in local time, formatted in the app's language. */
object Dates {
    private val locale: Locale get() = Locale.getDefault()
    private val french: Boolean get() = locale.language == "fr"

    fun cal(iso: String): Calendar = Calendar.getInstance().apply {
        clear()
        set(iso.substring(0, 4).toInt(), iso.substring(5, 7).toInt() - 1, iso.substring(8, 10).toInt())
    }

    fun iso(c: Calendar) = String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
    fun today(): String = iso(Calendar.getInstance())
    fun add(iso: String, n: Int): String = iso(cal(iso).apply { add(Calendar.DAY_OF_YEAR, n) })
    fun between(a: String, b: String): Int = ((cal(b).timeInMillis - cal(a).timeInMillis + 43_200_000L) / 86_400_000L).toInt()

    /** Monday of the week of [iso]. */
    fun monday(iso: String): String {
        val c = cal(iso)
        val dow = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7 // Monday = 0
        return add(iso, -dow)
    }

    private fun format(iso: String, pattern: String) = SimpleDateFormat(pattern, locale).format(cal(iso).time)

    fun dayName(iso: String): String = format(iso, "EEEE")
    fun dayShort(iso: String): String = format(iso, "EEE")
    fun dayNum(iso: String) = cal(iso).get(Calendar.DAY_OF_MONTH)
    fun monthShort(iso: String): String = format(iso, "MMM")

    /** "Mon 12 Oct" / "lun. 12 oct.". */
    fun short(iso: String) = "${dayShort(iso)} ${dayNum(iso)} ${monthShort(iso)}"

    /** "October 2026". */
    fun monthTitle(c: Calendar): String =
        SimpleDateFormat("LLLL yyyy", locale).format(c.time).replaceFirstChar { it.titlecase(locale) }

    /** "Today · Saturday 10 Oct", "Tomorrow · …", "Monday 12 Oct". */
    fun header(c: Context, iso: String): String {
        val label = "${dayName(iso)} ${dayNum(iso)} ${monthShort(iso)}"
        return when (iso) {
            today() -> c.getString(R.string.w_today_label, label)
            add(today(), 1) -> c.getString(R.string.w_tomorrow_label, label)
            else -> label.replaceFirstChar { it.titlecase(locale) }
        }
    }

    /** "08:00" → "8:00" (French: "8h"), "07:30" → "7:30" (French: "7h30"). */
    fun hm(t: String): String {
        val h = t.substringBefore(':').toIntOrNull() ?: return t
        val m = t.substringAfter(':', "00")
        return when {
            !french -> "$h:$m"
            m == "00" -> "${h}h"
            else -> "${h}h$m"
        }
    }
}
