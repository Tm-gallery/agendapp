package fr.agendapp.app

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.provider.CalendarContract
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Colors
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Writes events directly into the phone's calendars (CalendarContract), without going through a
 * server: Google Calendar reads the same provider, and Android syncs it with the account.
 *
 * Receives the payloads the web app prepares for a "Google Calendar" connector (summary,
 * startTime, colorId, overrideReminders…). Every sent event gets a stable key (stored by the app
 * in `gcalId`) mapped here to the calendar row; a key whose row disappeared is recreated, and
 * deletions made by AgendApp leave a marker so they are never mistaken for deletions made in the
 * calendar.
 */
class CalendarSync(private val ctx: Context) {

    class CalError(val code: String, message: String) : Exception(message)

    private val prefs = ctx.getSharedPreferences("calsync", Context.MODE_PRIVATE)
    private val cr get() = ctx.contentResolver

    var deleteSync: Boolean
        get() = prefs.getBoolean("deleteSync", false)
        set(v) = prefs.edit().putBoolean("deleteSync", v).apply()

    fun hasPermission(): Boolean =
        listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR).all {
            ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED
        }

    // ---------- Calendars ----------

    private class Cal(val id: Long, val name: String, val account: String, val type: String, val primary: Boolean)

    private fun writableCalendars(): List<Cal> {
        val out = mutableListOf<Cal>()
        cr.query(
            Calendars.CONTENT_URI,
            arrayOf(Calendars._ID, Calendars.CALENDAR_DISPLAY_NAME, Calendars.ACCOUNT_NAME, Calendars.ACCOUNT_TYPE, Calendars.IS_PRIMARY, Calendars.OWNER_ACCOUNT),
            "${Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${Calendars.SYNC_EVENTS} = 1",
            arrayOf(Calendars.CAL_ACCESS_CONTRIBUTOR.toString()),
            null,
        )?.use { c ->
            while (c.moveToNext()) {
                val account = c.getString(2).orEmpty()
                val primary = c.getInt(4) == 1 || (c.getString(5) == account && account.contains('@'))
                out += Cal(c.getLong(0), c.getString(1).orEmpty(), account, c.getString(3).orEmpty(), primary)
            }
        }
        // Google calendars first, the primary one on top.
        return out.sortedWith(compareBy({ it.type != GOOGLE }, { !it.primary }, { it.account }, { it.name }))
    }

    fun listCalendars(): JSONArray {
        val arr = JSONArray()
        for (c in writableCalendars()) {
            val name = when {
                c.name.isBlank() || c.name == c.account -> c.account.ifBlank { ctx.getString(R.string.calendar_default_name) }
                c.type == CalendarContract.ACCOUNT_TYPE_LOCAL -> ctx.getString(R.string.calendar_on_phone, c.name)
                else -> "${c.name} · ${c.account}"
            }
            arr.put(JSONObject().put("id", c.id.toString()).put("summary", name).put("primary", c.primary && c.type == GOOGLE))
        }
        return arr
    }

    private fun defaultCalendar(): Long? = writableCalendars().firstOrNull()?.id

    private fun calendarAccount(calId: Long): Pair<String, String>? =
        cr.query(ContentUris.withAppendedId(Calendars.CONTENT_URI, calId), arrayOf(Calendars.ACCOUNT_NAME, Calendars.ACCOUNT_TYPE), null, null, null)
            ?.use { c -> if (c.moveToFirst()) c.getString(0).orEmpty() to c.getString(1).orEmpty() else null }

    // ---------- Events ----------

    /** Creates or updates the event with [key] (a new key if null); returns the key. */
    fun upsert(key: String?, a: JSONObject): String {
        val k = key?.takeIf { it.isNotBlank() } ?: "ag_${UUID.randomUUID()}"
        val calId = a.optString("calendarId").toLongOrNull()?.takeIf { calendarAccount(it) != null }
            ?: defaultCalendar()
            ?: throw CalError("no_calendar", ctx.getString(R.string.calendar_none))
        val values = eventValues(calId, a)

        var row: Long? = null
        mapping(k)?.let { (oldCal, oldRow) ->
            if (oldCal == calId && rowAlive(oldRow)) {
                values.remove(Events.CALENDAR_ID)
                cr.update(ContentUris.withAppendedId(Events.CONTENT_URI, oldRow), values, null, null)
                values.put(Events.CALENDAR_ID, calId)
                row = oldRow
            } else if (oldCal != calId) {
                deleteRow(oldRow) // the destination calendar changed
            }
        }
        val id = row ?: cr.insert(Events.CONTENT_URI, values)?.let(ContentUris::parseId)
            ?: throw CalError("insert_failed", ctx.getString(R.string.calendar_refused))
        setReminders(id, a)
        prefs.edit().putString("m:$k", "$calId:$id").remove("t:$k").apply()
        return k
    }

    /** Removes events sent by AgendApp from the calendar (after a deletion in the app). */
    fun delete(keys: List<String>): Int {
        var n = 0
        val ed = prefs.edit()
        for (k in keys) {
            val (_, row) = mapping(k) ?: continue
            if (deleteRow(row)) n++
            ed.remove("m:$k").putBoolean("t:$k", true)
        }
        ed.apply()
        return n
    }

    /** Keys whose event was deleted in the calendar (while the calendar itself still exists). */
    fun missing(keys: List<String>): List<String> {
        if (!hasPermission()) return emptyList()
        val calOk = HashMap<Long, Boolean>()
        return keys.filter { k ->
            if (prefs.getBoolean("t:$k", false)) return@filter false
            val (cal, row) = mapping(k) ?: return@filter false
            calOk.getOrPut(cal) { calendarAccount(cal) != null } && !rowAlive(row)
        }
    }

    private fun mapping(key: String): Pair<Long, Long>? {
        val v = prefs.getString("m:$key", null) ?: return null
        val cal = v.substringBefore(':').toLongOrNull() ?: return null
        val row = v.substringAfter(':').toLongOrNull() ?: return null
        return cal to row
    }

    private fun rowAlive(row: Long): Boolean =
        cr.query(ContentUris.withAppendedId(Events.CONTENT_URI, row), arrayOf(Events._ID, Events.DELETED), null, null, null)
            ?.use { c -> c.moveToFirst() && c.getInt(1) == 0 } ?: false

    private fun deleteRow(row: Long): Boolean =
        cr.delete(ContentUris.withAppendedId(Events.CONTENT_URI, row), null, null) > 0

    private fun eventValues(calId: Long, a: JSONObject) = ContentValues().apply {
        put(Events.CALENDAR_ID, calId)
        put(Events.TITLE, a.optString("summary"))
        put(Events.DESCRIPTION, a.optString("description"))
        put(Events.EVENT_LOCATION, a.optString("location"))
        if (a.optBoolean("allDay")) {
            val start = parse(a.getString("startTime"), UTC)
            var end = parse(a.getString("endTime"), UTC)
            if (end <= start) end = start + DAY
            put(Events.DTSTART, start)
            put(Events.DTEND, end)
            put(Events.ALL_DAY, 1)
            put(Events.EVENT_TIMEZONE, "UTC")
            put(Events.EVENT_END_TIMEZONE, "UTC")
        } else {
            val tz = a.optString("timeZone").ifBlank { TimeZone.getDefault().id }
            val zone = TimeZone.getTimeZone(tz)
            val start = parse(a.getString("startTime"), zone)
            var end = parse(a.getString("endTime"), zone)
            if (end <= start) end = start + 60_000
            put(Events.DTSTART, start)
            put(Events.DTEND, end)
            put(Events.ALL_DAY, 0)
            put(Events.EVENT_TIMEZONE, tz)
            put(Events.EVENT_END_TIMEZONE, tz)
        }
        put(
            Events.AVAILABILITY,
            if (a.optString("availability") == "AVAILABILITY_FREE") Events.AVAILABILITY_FREE else Events.AVAILABILITY_BUSY,
        )
        val colorId = a.optString("colorId")
        val key = colorId.takeIf { it.isNotBlank() }?.let { colorKey(calId, it) }
        if (key != null) {
            put(Events.EVENT_COLOR_KEY, key)
        } else {
            GOOGLE_COLORS[colorId]?.let { put(Events.EVENT_COLOR, Color.parseColor(it)) }
        }
        put(Events.HAS_ALARM, if (reminders(a).isEmpty()) 0 else 1)
    }

    /** Google accounts expose their 11 event colours under the keys "1" to "11". */
    private fun colorKey(calId: Long, colorId: String): String? {
        val (account, type) = calendarAccount(calId) ?: return null
        return cr.query(
            Colors.CONTENT_URI, arrayOf(Colors.COLOR_KEY),
            "${Colors.ACCOUNT_NAME} = ? AND ${Colors.ACCOUNT_TYPE} = ? AND ${Colors.COLOR_TYPE} = ? AND ${Colors.COLOR_KEY} = ?",
            arrayOf(account, type, Colors.TYPE_EVENT.toString(), colorId), null,
        )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }

    private fun reminders(a: JSONObject): List<Int> {
        val list = a.optJSONArray("overrideReminders") ?: return emptyList()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it)?.optInt("minutes", -1)?.takeIf { m -> m >= 0 } }.distinct()
    }

    private fun setReminders(event: Long, a: JSONObject) {
        cr.delete(Reminders.CONTENT_URI, "${Reminders.EVENT_ID} = ?", arrayOf(event.toString()))
        for (m in reminders(a)) {
            cr.insert(Reminders.CONTENT_URI, ContentValues().apply {
                put(Reminders.EVENT_ID, event)
                put(Reminders.MINUTES, m)
                put(Reminders.METHOD, Reminders.METHOD_ALERT)
            })
        }
    }

    private fun parse(s: String, zone: TimeZone): Long {
        val fmt = SimpleDateFormat(if (s.length > 10) "yyyy-MM-dd'T'HH:mm:ss" else "yyyy-MM-dd", Locale.ROOT)
        fmt.timeZone = zone
        return fmt.parse(if (s.length in 11..16) "$s:00" else s)?.time
            ?: throw CalError("bad_date", ctx.getString(R.string.calendar_bad_date, s))
    }

    private companion object {
        const val GOOGLE = "com.google"
        const val DAY = 86_400_000L
        val UTC: TimeZone = TimeZone.getTimeZone("UTC")
        val GOOGLE_COLORS = mapOf(
            "1" to "#7986cb", "2" to "#33b679", "3" to "#8e24aa", "4" to "#e67c73", "5" to "#f6bf26", "6" to "#f4511e",
            "7" to "#039be5", "8" to "#616161", "9" to "#3f51b5", "10" to "#0b8043", "11" to "#d50000",
        )
    }
}
