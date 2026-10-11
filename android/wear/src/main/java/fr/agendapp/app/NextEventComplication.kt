package fr.agendapp.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationText
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.CountDownTimeReference
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.MonochromaticImage
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.TimeDifferenceComplicationText
import androidx.wear.watchface.complications.data.TimeDifferenceStyle
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationDataTimeline
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.TimeInterval
import androidx.wear.watchface.complications.datasource.TimelineEntry
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.TimeUnit

/**
 * "Next event" complication (short or long text).
 *
 * Battery: a timeline computed 24 h in advance (one entry per change) and a countdown drawn by the
 * watch face itself; no periodic update is needed, apart from a safety refresh every 6 hours and
 * whenever the phone sends data.
 */
class NextEventComplication : ComplicationDataSourceService() {

    override fun onComplicationRequest(request: ComplicationRequest, listener: ComplicationRequestListener) {
        val feed = Store.load(this)
        val s = Store.settings(this)
        val now = Agenda.now()
        val type = request.complicationType
        val bounds = Agenda.boundaries(feed.events, now, 24, 16)
        val default = data(this, type, feed, s, now)
        val entries = bounds.drop(1).mapIndexed { i, at ->
            val end = bounds.getOrNull(i + 2) ?: at.plusHours(24)
            TimelineEntry(TimeInterval(instant(at), instant(end)), data(this, type, feed, s, at))
        }
        listener.onComplicationDataTimeline(ComplicationDataTimeline(default, entries))
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData {
        val today = LocalDate.now()
        val sample = Event(
            "preview", today, today, false, LocalTime.of(13, 0), LocalTime.of(19, 0),
            "Patrol A", "PAT A", "Patrol", 0xFF3F51B5.toInt(), "", false,
        )
        val feed = Feed.EMPTY.copy(events = listOf(sample), receivedAt = 1)
        return data(this, type, feed, Settings(), today.atTime(9, 0))
    }

    private fun instant(t: LocalDateTime) = t.atZone(Agenda.zone).toInstant()

    private fun plain(s: String): ComplicationText = PlainComplicationText.Builder(s).build()

    private fun tap(c: Context, id: String?): PendingIntent {
        val i = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (id != null) i.putExtra(MainActivity.EXTRA_EVENT, id)
        return PendingIntent.getActivity(c, id?.hashCode() ?: 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun data(c: Context, type: ComplicationType, feed: Feed, s: Settings, at: LocalDateTime): ComplicationData {
        val today = at.toLocalDate()
        val current = Agenda.current(feed.events, at)
        val next = Agenda.upcoming(feed.events, at, 1).firstOrNull()
        val allDay = Agenda.allDayOn(feed.events, today).firstOrNull()
        val e = current ?: next?.takeIf { it.start == today } ?: allDay ?: next
        val icon = MonochromaticImage.Builder(Icon.createWithResource(c, R.drawable.ic_upcoming)).build()

        if (e == null) {
            val text = plain(if (feed.receivedAt == 0L) "—" else c.getString(R.string.free))
            val none = plain(c.getString(R.string.no_upcoming))
            return when (type) {
                ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text, none)
                    .setMonochromaticImage(icon).setTapAction(tap(c, null)).build()
                ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(plain(c.getString(R.string.nothing_planned)), none)
                    .setMonochromaticImage(icon).setTapAction(tap(c, null)).build()
                else -> NoDataComplicationData()
            }
        }

        val short = e.type.ifBlank { e.code }.take(7)
        val when_ = when {
            e === current -> null
            e.allDay -> c.getString(R.string.all_day_short)
            e.start == today -> Fmt.hm(e.from!!)
            else -> Fmt.dayLabel(c, e.start, today).substringBefore(' ').take(5)
        }
        // In progress: countdown to the end, updated by the watch face without waking the app.
        val countdown = current?.let {
            TimeDifferenceComplicationText.Builder(TimeDifferenceStyle.SHORT_DUAL_UNIT, CountDownTimeReference(instant(it.endAt)))
                .setMinimumTimeUnit(TimeUnit.MINUTES).build()
        }
        val description = plain("${e.label(s.hideNames)}, ${Fmt.dayLabel(c, e.start, today)}, ${Fmt.range(c, e)}")

        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(countdown ?: plain(when_ ?: ""), description)
                .setTitle(plain(short))
                .setMonochromaticImage(icon)
                .setTapAction(tap(c, e.id))
                .build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(plain("${e.label(s.hideNames)} · ${Fmt.range(c, e)}"), description)
                .setTitle(plain(if (e === current) c.getString(R.string.ongoing_ends, Fmt.hm(e.to!!)) else Fmt.dayLabel(c, e.start, today)))
                .setMonochromaticImage(icon)
                .setTapAction(tap(c, e.id))
                .build()
            else -> NoDataComplicationData()
        }
    }
}
