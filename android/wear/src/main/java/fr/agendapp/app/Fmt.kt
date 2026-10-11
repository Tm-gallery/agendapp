package fr.agendapp.app

import android.content.Context
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** Formatting in the watch's language, matching the phone app ("7:30" / "7h30", "Wed 14 Oct"). */
object Fmt {
    private val locale: Locale get() = Locale.getDefault()
    private val french: Boolean get() = locale.language == "fr"

    fun hm(t: LocalTime): String = when {
        !french -> "%d:%02d".format(t.hour, t.minute)
        t.minute == 0 -> "${t.hour}h"
        else -> "${t.hour}h%02d".format(t.minute)
    }

    fun range(c: Context, e: Event): String =
        if (e.allDay) {
            if (e.end.minusDays(1) == e.start) c.getString(R.string.all_day)
            else "${dayShort(e.start).substringBeforeLast(' ')} → ${dayShort(e.end.minusDays(1))}"
        } else {
            "${hm(e.from!!)} – ${hm(e.to!!)}"
        }

    /** "Wed 14 Oct" / "mer. 14 oct." */
    fun dayShort(d: LocalDate): String = DateTimeFormatter.ofPattern("EEE d MMM", locale).format(d)

    /** "Wednesday 14 October" */
    fun dayLong(d: LocalDate): String =
        "${d.dayOfWeek.getDisplayName(TextStyle.FULL, locale)} ${d.dayOfMonth} ${d.month.getDisplayName(TextStyle.FULL, locale)}"
            .replaceFirstChar { it.titlecase(locale) }

    /** "Today", "Tomorrow", "Wed 14 Oct". */
    fun dayLabel(c: Context, d: LocalDate, today: LocalDate = LocalDate.now()): String = when (d) {
        today -> c.getString(R.string.today)
        today.plusDays(1) -> c.getString(R.string.tomorrow)
        today.minusDays(1) -> c.getString(R.string.yesterday)
        else -> dayShort(d).replaceFirstChar { it.titlecase(locale) }
    }

    /** "October 2026" */
    fun month(ym: YearMonth): String =
        "${ym.month.getDisplayName(TextStyle.FULL_STANDALONE, locale).replaceFirstChar { it.titlecase(locale) }} ${ym.year}"

    fun duration(c: Context, min: Long): String {
        val h = (min / 60).toInt()
        val m = (min % 60).toInt()
        return when {
            h == 0 -> c.getString(R.string.duration_min, m)
            m == 0 -> c.getString(R.string.duration_h, h)
            else -> c.getString(R.string.duration_hm, h, m)
        }
    }

    /** "In 2h 15m", "In 3 days", "Ongoing". */
    fun relative(c: Context, e: Event, now: LocalDateTime): String = when {
        e.startAt <= now && now < e.endAt -> c.getString(R.string.rel_ongoing)
        e.endAt <= now -> c.getString(R.string.rel_ended)
        else -> {
            val min = Duration.between(now, e.startAt).toMinutes()
            val days = java.time.temporal.ChronoUnit.DAYS.between(now.toLocalDate(), e.start)
            when {
                min < 1 -> c.getString(R.string.rel_now)
                min < 60 -> c.getString(R.string.rel_in_min, min.toInt())
                days == 0L -> c.getString(R.string.rel_in, duration(c, min))
                days == 1L -> c.getString(R.string.tomorrow)
                else -> c.getString(R.string.rel_in_days, days.toInt())
            }
        }
    }

    fun minutes(e: Event) = Duration.between(e.startAt, e.endAt).toMinutes()

    fun ago(c: Context, ms: Long, now: Long = System.currentTimeMillis()): String {
        if (ms <= 0) return c.getString(R.string.ago_never)
        val min = ((now - ms) / 60_000).toInt()
        return when {
            min < 1 -> c.getString(R.string.ago_now)
            min < 60 -> c.getString(R.string.ago_min, min)
            min < 24 * 60 -> c.getString(R.string.ago_h, min / 60)
            else -> c.getString(R.string.ago_d, min / (24 * 60))
        }
    }
}
