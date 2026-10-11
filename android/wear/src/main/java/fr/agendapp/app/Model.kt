package fr.agendapp.app

import android.graphics.Color
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

/** An event as the phone app shows it (already formatted there). */
data class Event(
    val id: String,
    val start: LocalDate,
    val end: LocalDate,          // exclusive for all-day events
    val allDay: Boolean,
    val from: LocalTime?,
    val to: LocalTime?,
    val title: String,           // "Patrol A · Jade C."
    val code: String,            // "PAT A"
    val type: String,            // "Patrol"
    val color: Int,
    val details: String,         // "Leader: A · Crew: B, C"
    val exported: Boolean,
    val pairs: List<Pair<String, String>> = emptyList(), // filled fields: [(label, value)]
) {
    val startAt: LocalDateTime = if (allDay || from == null) start.atStartOfDay() else start.atTime(from)
    val endAt: LocalDateTime = when {
        allDay || to == null -> end.atStartOfDay().let { if (it <= startAt) startAt.plusDays(1) else it }
        else -> end.atTime(to).let { if (it <= startAt) it.plusDays(1) else it }
    }

    fun covers(day: LocalDate) = if (allDay) !day.isBefore(start) && day.isBefore(end) else day == start

    /** Filled fields: [("Crew", "A, B"), …]. Older phone versions only sent `details`. */
    val fields: List<Pair<String, String>>
        get() = pairs.ifEmpty {
            details.split(" · ").mapNotNull { part ->
                val match = Regex("^(.+?) ?: (.+)$").find(part.trim())
                when {
                    part.isBlank() -> null
                    match == null -> "" to part.trim()
                    else -> match.groupValues[1].trim() to match.groupValues[2].trim()
                }
            }
        }

    /** Short title without names (the "Hide names" option). */
    fun label(hideNames: Boolean) = if (hideNames) code.ifBlank { type } else title.ifBlank { code }
}

data class MonthStat(val ym: String, val minutes: Int, val nights: Int, val daysOff: Int)

/** What the phone sends. */
data class Feed(
    val calendar: String,
    val events: List<Event>,
    val stats: List<MonthStat>,
    val palette: Map<String, Int>,
    val receivedAt: Long,
) {
    companion object {
        val EMPTY = Feed("AgendApp", emptyList(), emptyList(), emptyMap(), 0)

        fun parse(json: String, receivedAt: Long): Feed {
            val o = JSONObject(json)
            val items = o.optJSONArray("items")
            val events = (0 until (items?.length() ?: 0)).mapNotNull { i ->
                val e = items!!.getJSONObject(i)
                runCatching {
                    val ad = e.optBoolean("ad")
                    Event(
                        id = e.optString("id"),
                        start = LocalDate.parse(e.optString("d")),
                        end = LocalDate.parse(e.optString("e").ifEmpty { e.optString("d") }),
                        allDay = ad,
                        from = if (ad) null else LocalTime.parse(e.optString("s")),
                        to = if (ad) null else LocalTime.parse(e.optString("f")),
                        title = e.optString("t"),
                        code = e.optString("c"),
                        type = e.optString("ty"),
                        color = runCatching { Color.parseColor(e.optString("col")) }.getOrDefault(Color.GRAY),
                        details = e.optString("x"),
                        exported = e.optBoolean("ex"),
                        pairs = e.optJSONArray("fl")?.let { fl ->
                            (0 until fl.length()).mapNotNull { k ->
                                fl.optJSONArray(k)?.let { it.optString(0) to it.optString(1) }
                            }
                        }.orEmpty(),
                    )
                }.getOrNull()
            }.sortedWith(compareBy({ it.startAt }, { !it.allDay }))
            val st = o.optJSONArray("stats")
            val stats = (0 until (st?.length() ?: 0)).map { i ->
                val s = st!!.getJSONObject(i)
                MonthStat(s.optString("ym"), s.optInt("i"), s.optInt("c"), s.optInt("d"))
            }
            val pal = o.optJSONObject("palette")
            val palette = buildMap {
                pal?.keys()?.forEach { k -> runCatching { put(k, Color.parseColor(pal.getString(k))) } }
            }
            return Feed(o.optString("cal", "AgendApp"), events, stats, palette, receivedAt)
        }
    }
}

/** What the agenda shows at a given moment. */
object Agenda {
    val zone: ZoneId get() = ZoneId.systemDefault()
    fun now(): LocalDateTime = LocalDateTime.now(zone)

    /** Timed event in progress. */
    fun current(events: List<Event>, at: LocalDateTime) =
        events.firstOrNull { !it.allDay && it.startAt <= at && at < it.endAt }

    /** All-day events covering this day (rest, leave…). */
    fun allDayOn(events: List<Event>, day: LocalDate) = events.filter { it.allDay && it.covers(day) }

    /** Upcoming events (starting after [at]), in order. */
    fun upcoming(events: List<Event>, at: LocalDateTime, limit: Int = 3) =
        events.filter { it.startAt > at }.take(limit)

    fun on(events: List<Event>, day: LocalDate) =
        events.filter { it.covers(day) }.sortedWith(compareBy({ !it.allDay }, { it.startAt }))

    /** Upcoming days that have events, with those events. */
    fun days(events: List<Event>, from: LocalDate, count: Int): List<Pair<LocalDate, List<Event>>> =
        (0 until count).map { from.plusDays(it.toLong()) }
            .map { d -> d to on(events, d) }
            .filter { it.second.isNotEmpty() }

    /** Instants when the display changes: starts, ends, midnights (for the tile and complication). */
    fun boundaries(events: List<Event>, from: LocalDateTime, hours: Long, max: Int): List<LocalDateTime> {
        val until = from.plusHours(hours)
        val set = sortedSetOf<LocalDateTime>()
        for (e in events) {
            if (e.startAt in from..until) set += e.startAt
            if (e.endAt in from..until) set += e.endAt
        }
        var midnight = from.toLocalDate().plusDays(1).atStartOfDay()
        while (midnight <= until) { set += midnight; midnight = midnight.plusDays(1) }
        set.removeIf { it <= from }
        return listOf(from) + set.take(max - 1)
    }
}
