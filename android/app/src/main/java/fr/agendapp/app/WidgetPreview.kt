package fr.agendapp.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.RemoteViews
import java.io.File
import kotlin.math.roundToInt

/**
 * Development tool (debug builds only): renders the widgets off-screen into cache/wpreview (PNG)
 * to check them without placing them on the home screen.
 */
object WidgetPreview {
    fun renderAll(c: Context, dark: Boolean): List<File> {
        val ctx = CalendarRenderer.themed(c, dark)
        val dir = File(c.cacheDir, "wpreview").apply { mkdirs() }
        val suffix = if (dark) "dark" else "light"
        val out = mutableListOf<File>()
        val d = c.resources.displayMetrics.density
        fun save(name: String, v: View, wDp: Int, hDp: Int) {
            val w = (wDp * d).roundToInt()
            val h = (hDp * d).roundToInt()
            v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            v.layout(0, 0, w, h)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            v.draw(Canvas(bmp))
            val f = File(dir, "$name-$suffix.png")
            f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            out += f
        }
        val items = Feed.load(c)
        for (mode in listOf("month", "week", "days")) {
            val cfg = AppStore.widgetDefaults("calendar").put("mode", mode)
            val p = CalendarRenderer.period(c, cfg)
            val rv = RemoteViews(c.packageName, R.layout.widget_calendar)
            rv.setTextViewText(R.id.title, p.title)
            val bmp = CalendarRenderer.draw(ctx, items, p, cfg, ((340 - 20) * d).roundToInt(), ((330 - 66) * d).roundToInt())
            rv.setImageViewBitmap(R.id.img_light, bmp)
            rv.setImageViewBitmap(R.id.img_dark, bmp)
            save("calendar-$mode", rv.apply(ctx, FrameLayout(ctx)), 340, 330)
        }
        save("actions", RemoteViews(c.packageName, R.layout.widget_actions).apply(ctx, FrameLayout(ctx)), 340, 170)

        // List: header and items, stacked as in the widget.
        val list = RemoteViews(c.packageName, R.layout.widget_list).apply(ctx, FrameLayout(ctx)) as LinearLayout
        val frame = list.getChildAt(1) as FrameLayout
        frame.removeAllViews()
        val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        frame.addView(col)
        val today = Dates.today()
        var last = ""
        for (e in items.filter { (if (it.allDay) it.end > today else it.start >= today) }.take(6)) {
            val day = if (e.start < today) today else e.start
            if (day != last) {
                last = day
                col.addView(RemoteViews(c.packageName, R.layout.widget_item_day).apply { setTextViewText(R.id.day, Dates.header(c, day)) }.apply(ctx, col))
            }
            val r = RemoteViews(c.packageName, R.layout.widget_item_event)
            r.setTextViewText(R.id.title, e.title)
            r.setTextViewText(R.id.time, ListWidget.whenText(c, e, day, grouped = true))
            r.setTextViewText(R.id.details, e.details)
            r.setInt(R.id.bar, "setColorFilter", e.color)
            col.addView(r.apply(ctx, col), LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = (3 * d).toInt() })
        }
        save("list", list, 340, 420)
        return out
    }
}
