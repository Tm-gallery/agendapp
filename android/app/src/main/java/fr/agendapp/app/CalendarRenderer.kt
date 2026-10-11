package fr.agendapp.app

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** Draws the calendar widget (month as a grid, week and next days as rows). */
object CalendarRenderer {

    class Period(val mode: String, val start: String, val count: Int, val title: String, val focus: String, val month: Int)

    fun period(c: Context, cfg: JSONObject): Period {
        val today = Dates.today()
        val offset = cfg.optInt("offset")
        return when (cfg.optString("mode", "month")) {
            "week" -> {
                val start = Dates.add(Dates.monday(today), offset * 7)
                if (offset == 0) Period("rows", start, 7, c.getString(R.string.w_this_week), today, -1)
                else Period("rows", start, 7, c.getString(R.string.w_week_of, "${Dates.dayNum(start)} ${Dates.monthShort(start)}"), start, -1)
            }
            "days" -> {
                val n = cfg.optInt("days", 5).coerceIn(2, 14)
                val start = Dates.add(today, offset * n)
                val end = Dates.add(start, n - 1)
                val title = if (offset == 0) c.getString(R.string.w_next_days, n) else "${Dates.dayNum(start)} ${Dates.monthShort(start)} – ${Dates.dayNum(end)} ${Dates.monthShort(end)}"
                Period("rows", start, n, title, start, -1)
            }
            else -> if (cfg.optBoolean("rolling")) {
                val start = Dates.add(Dates.monday(today), offset * 35)
                val end = Dates.add(start, 34)
                Period("grid", start, 5, "${Dates.dayNum(start)} ${Dates.monthShort(start)} – ${Dates.dayNum(end)} ${Dates.monthShort(end)}",
                    if (offset == 0) today else start, -1)
            } else {
                val first = Dates.cal(today).apply {
                    set(java.util.Calendar.DAY_OF_MONTH, 1)
                    add(java.util.Calendar.MONTH, offset)
                }
                val firstIso = Dates.iso(first)
                val month = first.get(java.util.Calendar.MONTH)
                val start = Dates.monday(firstIso)
                val nextMonth = Dates.iso((first.clone() as java.util.Calendar).apply { add(java.util.Calendar.MONTH, 1) })
                val weeks = (Dates.between(start, nextMonth) + 6) / 7
                Period("grid", start, weeks, Dates.monthTitle(first),
                    if (offset == 0) today else firstIso, month)
            }
        }
    }

    /** Light or dark themed context, to read the matching Material You colours. */
    fun themed(c: Context, dark: Boolean): Context {
        val conf = Configuration(c.resources.configuration)
        conf.uiMode = (conf.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
            if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        return c.createConfigurationContext(conf)
    }

    private class Colors(c: Context) {
        val on = ContextCompat.getColor(c, R.color.w_on)
        val onVar = ContextCompat.getColor(c, R.color.w_on_var)
        val surface = ContextCompat.getColor(c, R.color.w_surface)
        val primary = ContextCompat.getColor(c, R.color.w_primary)
        val onPrimary = ContextCompat.getColor(c, R.color.w_on_primary)
        val primaryContainer = ContextCompat.getColor(c, R.color.w_primary_container)
        val tertiary = ContextCompat.getColor(c, R.color.w_tertiary)
    }

    fun draw(c: Context, items: List<FeedItem>, p: Period, cfg: JSONObject, w: Int, h: Int): Bitmap {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val d = c.resources.displayMetrics.density
        val col = Colors(c)
        val labels = cfg.optBoolean("labels", true)
        if (p.mode == "grid") grid(canvas, d, col, items, p, labels, w, h) else rows(canvas, d, col, items, p, labels, w, h)
        return bmp
    }

    private val regular: Typeface = Typeface.create("google-sans", Typeface.NORMAL)
    private val medium: Typeface = Typeface.create("google-sans-medium", Typeface.NORMAL)

    private fun text(color: Int, sizePx: Float, bold: Boolean = false) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = sizePx
        typeface = if (bold) medium else regular
    }

    private fun onColor(bg: Int) = if (ColorUtils.calculateLuminance(bg) > 0.55) Color.parseColor("#1A1B21") else Color.WHITE

    // Month: a 7-column grid, with pills showing the event codes.
    private fun grid(cv: Canvas, d: Float, col: Colors, items: List<FeedItem>, p: Period, labels: Boolean, w: Int, h: Int) {
        val today = Dates.today()
        val headH = 18 * d
        val gap = 3 * d
        val cw = (w - gap * 6) / 7f
        val ch = (h - headH - gap * (p.count - 1)) / p.count
        val monday = Dates.monday(today)
        val dow = Array(7) { java.text.SimpleDateFormat("EEEEE", java.util.Locale.getDefault()).format(Dates.cal(Dates.add(monday, it)).time) }
        val head = text(col.onVar, 11 * d, true).apply { textAlign = Paint.Align.CENTER }
        for (i in 0..6) {
            head.color = if (i >= 5) col.tertiary else col.onVar
            cv.drawText(dow[i], i * (cw + gap) + cw / 2, 12 * d, head)
        }
        val cell = Paint(Paint.ANTI_ALIAS_FLAG)
        val num = text(col.on, 11.5f * d, true)
        val pill = Paint(Paint.ANTI_ALIAS_FLAG)
        val pillH = min(14 * d, max(9 * d, (ch - 20 * d) / 3))
        val pillText = text(Color.WHITE, min(9.5f * d, pillH * 0.72f), true)
        for (r in 0 until p.count) for (i in 0..6) {
            val day = Dates.add(p.start, r * 7 + i)
            val inMonth = p.month < 0 || Dates.cal(day).get(java.util.Calendar.MONTH) == p.month
            val x = i * (cw + gap)
            val y = headH + r * (ch + gap)
            val rect = RectF(x, y, x + cw, y + ch)
            cell.color = if (day == today) col.primaryContainer else col.surface
            cell.alpha = if (inMonth) 255 else 90
            cv.drawRoundRect(rect, 8 * d, 8 * d, cell)

            // Day number (today: filled circle).
            val n = Dates.dayNum(day).toString()
            num.color = if (inMonth) col.on else col.onVar
            if (day == today) {
                val cx = x + 4 * d + 8 * d
                cell.color = col.primary
                cell.alpha = 255
                cv.drawCircle(cx, y + 11 * d, 8.5f * d, cell)
                num.color = col.onPrimary
                num.textAlign = Paint.Align.CENTER
                cv.drawText(n, cx, y + 15 * d, num)
                num.textAlign = Paint.Align.LEFT
            } else {
                cv.drawText(n, x + 5 * d, y + 15 * d, num)
            }

            val evs = Feed.on(items, day)
            if (evs.isEmpty()) continue
            val top = y + 22 * d
            val room = ((rect.bottom - top - 2 * d) / (pillH + 2 * d)).toInt().coerceAtLeast(0)
            if (!labels || room == 0) {
                // Round dots.
                val r0 = 3 * d
                evs.take(4).forEachIndexed { k, e ->
                    pill.color = e.color
                    pill.alpha = if (inMonth) 255 else 120
                    cv.drawCircle(x + 6 * d + k * (r0 * 2 + 2 * d), if (room == 0) rect.bottom - 6 * d else top + r0, r0, pill)
                }
                continue
            }
            val shown = if (evs.size > room) room - 1 else room
            evs.take(shown).forEachIndexed { k, e ->
                val py = top + k * (pillH + 2 * d)
                val pr = RectF(x + 2 * d, py, rect.right - 2 * d, py + pillH)
                pill.color = e.color
                pill.alpha = if (inMonth) 255 else 120
                cv.drawRoundRect(pr, 4 * d, 4 * d, pill)
                pillText.color = onColor(e.color)
                val label = TextUtils.ellipsize(e.code.ifBlank { e.title }, pillText, pr.width() - 4 * d, TextUtils.TruncateAt.END)
                cv.drawText(label, 0, label.length, pr.left + 2.5f * d, pr.bottom - (pillH - pillText.textSize) / 2 - 1.5f * d, pillText)
            }
            if (evs.size > shown) {
                val more = text(col.onVar, 9.5f * d, true)
                cv.drawText("+${evs.size - shown}", x + 4 * d, top + shown * (pillH + 2 * d) + pillH - 3 * d, more)
            }
        }
    }

    // Week / next days: one row per day, events as pills with their times.
    private fun rows(cv: Canvas, d: Float, col: Colors, items: List<FeedItem>, p: Period, labels: Boolean, w: Int, h: Int) {
        val today = Dates.today()
        val gap = 3 * d
        val rh = (h - gap * (p.count - 1)) / p.count
        val labelW = 46 * d
        val bg = Paint(Paint.ANTI_ALIAS_FLAG)
        val dayName = text(col.onVar, 10.5f * d, true).apply { textAlign = Paint.Align.CENTER }
        val dayNum = text(col.on, min(17 * d, rh * 0.42f), true).apply { textAlign = Paint.Align.CENTER }
        val pillH = min(24 * d, rh - 8 * d).coerceAtLeast(10 * d)
        val pillText = text(Color.WHITE, min(11.5f * d, pillH * 0.5f), true)
        val empty = text(col.onVar, min(12 * d, rh * 0.4f))
        for (r in 0 until p.count) {
            val day = Dates.add(p.start, r)
            val y = r * (rh + gap)
            val rect = RectF(0f, y, w.toFloat(), y + rh)
            bg.color = col.surface
            cv.drawRoundRect(rect, min(14 * d, rh / 2), min(14 * d, rh / 2), bg)

            val cx = labelW / 2 + 2 * d
            val isToday = day == today
            val compact = rh < 34 * d
            if (isToday) {
                bg.color = col.primary
                cv.drawRoundRect(RectF(4 * d, y + 3 * d, labelW, y + rh - 3 * d), min(12 * d, (rh - 6 * d) / 2), min(12 * d, (rh - 6 * d) / 2), bg)
            }
            dayName.color = if (isToday) col.onPrimary else col.onVar
            dayNum.color = if (isToday) col.onPrimary else col.on
            if (compact) {
                dayNum.textSize = min(12 * d, rh * 0.5f)
                cv.drawText("${Dates.dayShort(day).take(3)} ${Dates.dayNum(day)}", cx, y + rh / 2 + dayNum.textSize * 0.35f, dayNum)
            } else {
                cv.drawText(Dates.dayShort(day).removeSuffix("."), cx, y + rh / 2 - 2 * d, dayName)
                cv.drawText(Dates.dayNum(day).toString(), cx, y + rh / 2 + dayNum.textSize * 0.85f, dayNum)
            }

            val evs = Feed.on(items, day)
            var x = labelW + 8 * d
            val right = w - 6 * d
            if (evs.isEmpty()) {
                cv.drawText("—", x, y + rh / 2 + empty.textSize * 0.35f, empty)
                continue
            }
            val py = y + (rh - pillH) / 2
            for ((k, e) in evs.withIndex()) {
                val label = if (!labels) "" else buildString {
                    append(e.code.ifBlank { e.title })
                    if (!e.allDay && rh >= 30 * d) append("  ${Dates.hm(e.from)}–${Dates.hm(e.to)}")
                }
                val remaining = evs.size - k
                val moreW = if (remaining > 1) 26 * d else 0f
                val want = if (labels) pillText.measureText(label) + 16 * d else pillH
                val pw = min(want, right - x - moreW)
                if (pw < 28 * d) {
                    cv.drawText("+$remaining", x, y + rh / 2 + 4 * d, text(col.onVar, 11 * d, true))
                    break
                }
                bg.color = e.color
                cv.drawRoundRect(RectF(x, py, x + pw, py + pillH), pillH / 2, pillH / 2, bg)
                if (labels) {
                    pillText.color = onColor(e.color)
                    val t = TextUtils.ellipsize(label, pillText, pw - 14 * d, TextUtils.TruncateAt.END)
                    cv.drawText(t, 0, t.length, x + 7 * d, py + pillH / 2 + pillText.textSize * 0.36f, pillText)
                }
                x += pw + 4 * d
            }
        }
    }
}
