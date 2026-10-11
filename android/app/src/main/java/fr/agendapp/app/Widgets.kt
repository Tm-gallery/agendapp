package fr.agendapp.app

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import androidx.core.widget.RemoteViewsCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/** Shared entry point of AgendApp's three home-screen widgets. */
object Widgets {
    const val ACTION_PREV = "fr.agendapp.app.widget.PREV"
    const val ACTION_NEXT = "fr.agendapp.app.widget.NEXT"
    const val ACTION_TODAY = "fr.agendapp.app.widget.TODAY"
    const val ACTION_BACKUP = "fr.agendapp.app.widget.BACKUP"

    val KINDS = linkedMapOf(
        "list" to ListWidget::class.java,
        "calendar" to CalendarWidget::class.java,
        "actions" to ActionsWidget::class.java,
    )

    fun kindOf(c: Context, id: Int): String? {
        val info = AppWidgetManager.getInstance(c).getAppWidgetInfo(id) ?: return null
        return KINDS.entries.firstOrNull { it.value.name == info.provider.className }?.key
    }

    fun ids(c: Context, kind: String): IntArray =
        AppWidgetManager.getInstance(c).getAppWidgetIds(ComponentName(c, KINDS.getValue(kind)))

    /** Placed widgets with their settings (for Settings › Widgets in the app). */
    fun list(c: Context): JSONArray {
        val arr = JSONArray()
        for (kind in KINDS.keys) for (id in ids(c, kind)) {
            arr.put(JSONObject().put("id", id).put("kind", kind).put("cfg", AppStore.widgetCfg(c, id, kind)))
        }
        return arr
    }

    fun update(c: Context, id: Int) {
        val mgr = AppWidgetManager.getInstance(c)
        when (kindOf(c, id)) {
            "list" -> ListWidget.render(c, mgr, id)
            "calendar" -> CalendarWidget.render(c, mgr, id)
            "actions" -> ActionsWidget.render(c, mgr, id)
        }
    }

    fun updateAll(c: Context) {
        val mgr = AppWidgetManager.getInstance(c)
        ids(c, "list").forEach { ListWidget.render(c, mgr, it) }
        ids(c, "calendar").forEach { CalendarWidget.render(c, mgr, it) }
        ids(c, "actions").forEach { ActionsWidget.render(c, mgr, it) }
    }

    fun requestPin(c: Context, kind: String): Boolean {
        val mgr = AppWidgetManager.getInstance(c)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !mgr.isRequestPinAppWidgetSupported) return false
        return mgr.requestPinAppWidget(ComponentName(c, KINDS[kind] ?: return false), null, null)
    }

    /** Opens the app on an action: agendapp://new, agendapp://day/2026-10-12, agendapp://sync… */
    fun open(c: Context, uri: String, requestCode: Int): PendingIntent =
        PendingIntent.getActivity(
            c, requestCode,
            Intent(Intent.ACTION_VIEW, Uri.parse(uri), c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun broadcast(c: Context, action: String, id: Int, requestCode: Int): PendingIntent =
        PendingIntent.getBroadcast(
            c, requestCode,
            Intent(c, WidgetReceiver::class.java).setAction(action).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** Widget size in dp (portrait), with a default until the launcher provides it. */
    fun sizeDp(mgr: AppWidgetManager, id: Int, defW: Int, defH: Int): Pair<Int, Int> {
        val o = mgr.getAppWidgetOptions(id)
        val w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH).takeIf { it > 0 } ?: defW
        val h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT).takeIf { it > 0 } ?: defH
        return w to h
    }
}

// ---------- Upcoming events list ----------

class ListWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, mgr: AppWidgetManager, ids: IntArray) = ids.forEach { render(c, mgr, it) }
    override fun onAppWidgetOptionsChanged(c: Context, mgr: AppWidgetManager, id: Int, o: Bundle) = render(c, mgr, id)
    override fun onDeleted(c: Context, ids: IntArray) = ids.forEach { AppStore.deleteWidgetCfg(c, it) }

    companion object {
        fun render(c: Context, mgr: AppWidgetManager, id: Int) {
            val cfg = AppStore.widgetCfg(c, id, "list")
            val days = cfg.optInt("days", 14)
            val max = cfg.optInt("max", 8)
            val details = cfg.optBoolean("details", true)
            val group = cfg.optBoolean("group", true)
            val today = Dates.today()
            val last = Dates.add(today, days - 1)
            val events = Feed.load(c)
                .filter { (if (it.allDay) it.end > today else it.start >= today) && it.start <= last }
                .take(max)

            val rv = RemoteViews(c.packageName, R.layout.widget_list)
            rv.setTextViewText(R.id.subtitle, when {
                events.isEmpty() -> c.getString(R.string.w_over_days, days)
                else -> c.resources.getQuantityString(R.plurals.w_events_over_days, events.size, events.size, days)
            })
            rv.setOnClickPendingIntent(R.id.btn_add, Widgets.open(c, "agendapp://new", 1))
            rv.setOnClickPendingIntent(R.id.header, Widgets.open(c, "agendapp://plan", 2))
            rv.setPendingIntentTemplate(
                R.id.list,
                PendingIntent.getActivity(
                    c, 1000 + id, Intent(Intent.ACTION_VIEW, null, c, MainActivity::class.java),
                    PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )

            val items = RemoteViewsCompat.RemoteCollectionItems.Builder().setHasStableIds(true).setViewTypeCount(2)
            var lastDay = ""
            var n = 0L
            for (e in events) {
                val day = if (e.start < today) today else e.start
                if (group && day != lastDay) {
                    lastDay = day
                    val h = RemoteViews(c.packageName, R.layout.widget_item_day)
                    h.setTextViewText(R.id.day, Dates.header(c, day))
                    h.setOnClickFillInIntent(R.id.day, Intent().setData(Uri.parse("agendapp://day/$day")))
                    items.addItem(n++, h)
                }
                val r = RemoteViews(c.packageName, R.layout.widget_item_event)
                r.setTextViewText(R.id.title, e.title)
                r.setTextViewText(R.id.time, whenText(c, e, day, group))
                r.setInt(R.id.bar, "setColorFilter", e.color)
                if (details && e.details.isNotBlank()) {
                    r.setTextViewText(R.id.details, e.details)
                    r.setViewVisibility(R.id.details, View.VISIBLE)
                } else {
                    r.setViewVisibility(R.id.details, View.GONE)
                }
                r.setOnClickFillInIntent(R.id.item, Intent().setData(Uri.parse("agendapp://day/${e.start}")))
                items.addItem(n++, r)
            }
            RemoteViewsCompat.setRemoteAdapter(c, rv, id, R.id.list, items.build())
            rv.setEmptyView(R.id.list, R.id.empty)
            mgr.updateAppWidget(id, rv)
        }

        fun whenText(c: Context, e: FeedItem, day: String, grouped: Boolean): String {
            val date = if (grouped) "" else "${Dates.dayShort(day)} ${Dates.dayNum(day)} · "
            val last = Dates.add(e.end, -1)
            return date + when {
                e.allDay && e.days > 1 -> c.getString(R.string.w_all_day_until, e.days, "${Dates.dayNum(last)} ${Dates.monthShort(last)}")
                e.allDay -> c.getString(R.string.w_all_day)
                else -> "${Dates.hm(e.from)} – ${Dates.hm(e.to)}"
            }
        }
    }
}

// ---------- Calendar (week, month, next days) ----------

class CalendarWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, mgr: AppWidgetManager, ids: IntArray) = ids.forEach { render(c, mgr, it) }
    override fun onAppWidgetOptionsChanged(c: Context, mgr: AppWidgetManager, id: Int, o: Bundle) = render(c, mgr, id)
    override fun onDeleted(c: Context, ids: IntArray) = ids.forEach { AppStore.deleteWidgetCfg(c, it) }

    companion object {
        fun render(c: Context, mgr: AppWidgetManager, id: Int) {
            val cfg = AppStore.widgetCfg(c, id, "calendar")
            val period = CalendarRenderer.period(c, cfg)
            val (wDp, hDp) = Widgets.sizeDp(mgr, id, 250, 250)
            val density = c.resources.displayMetrics.density
            val w = ((wDp - 20) * density).roundToInt().coerceIn(100, 1600)
            val h = ((hDp - 66) * density).roundToInt().coerceIn(80, 1600)
            val items = Feed.load(c)

            val rv = RemoteViews(c.packageName, R.layout.widget_calendar)
            rv.setTextViewText(R.id.title, period.title)
            rv.setImageViewBitmap(R.id.img_light, CalendarRenderer.draw(CalendarRenderer.themed(c, false), items, period, cfg, w, h))
            rv.setImageViewBitmap(R.id.img_dark, CalendarRenderer.draw(CalendarRenderer.themed(c, true), items, period, cfg, w, h))
            rv.setContentDescription(R.id.img_light, period.title)
            rv.setContentDescription(R.id.img_dark, period.title)
            val open = Widgets.open(c, "agendapp://day/${period.focus}", 2000 + id)
            rv.setOnClickPendingIntent(R.id.img_light, open)
            rv.setOnClickPendingIntent(R.id.img_dark, open)
            rv.setOnClickPendingIntent(R.id.btn_prev, Widgets.broadcast(c, Widgets.ACTION_PREV, id, 3000 + id))
            rv.setOnClickPendingIntent(R.id.btn_next, Widgets.broadcast(c, Widgets.ACTION_NEXT, id, 4000 + id))
            rv.setOnClickPendingIntent(R.id.btn_today, Widgets.broadcast(c, Widgets.ACTION_TODAY, id, 5000 + id))
            rv.setViewVisibility(R.id.btn_today, if (cfg.optInt("offset") == 0) View.GONE else View.VISIBLE)
            rv.setOnClickPendingIntent(R.id.btn_add, Widgets.open(c, "agendapp://new", 1))
            mgr.updateAppWidget(id, rv)
        }
    }
}

// ---------- Quick actions ----------

class ActionsWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, mgr: AppWidgetManager, ids: IntArray) = ids.forEach { render(c, mgr, it) }

    companion object {
        fun render(c: Context, mgr: AppWidgetManager, id: Int) {
            val rv = RemoteViews(c.packageName, R.layout.widget_actions)
            rv.setOnClickPendingIntent(R.id.btn_new, Widgets.open(c, "agendapp://new", 1))
            rv.setOnClickPendingIntent(R.id.btn_sync, Widgets.open(c, "agendapp://sync", 3))
            rv.setOnClickPendingIntent(R.id.btn_plan, Widgets.open(c, "agendapp://plan", 2))
            rv.setOnClickPendingIntent(R.id.btn_backup, Widgets.broadcast(c, Widgets.ACTION_BACKUP, id, 6000 + id))
            mgr.updateAppWidget(id, rv)
        }
    }
}

/** Widget buttons that don't open the app: calendar navigation and backup. */
class WidgetReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, intent: Intent) {
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        when (intent.action) {
            Widgets.ACTION_PREV, Widgets.ACTION_NEXT, Widgets.ACTION_TODAY -> {
                val cfg = AppStore.widgetCfg(c, id, "calendar")
                val offset = when (intent.action) {
                    Widgets.ACTION_PREV -> cfg.optInt("offset") - 1
                    Widgets.ACTION_NEXT -> cfg.optInt("offset") + 1
                    else -> 0
                }
                AppStore.setWidgetCfg(c, id, "calendar", JSONObject().put("offset", offset))
                CalendarWidget.render(c, AppWidgetManager.getInstance(c), id)
            }
            Widgets.ACTION_BACKUP -> {
                val pending = goAsync()
                val main = Handler(Looper.getMainLooper())
                Executors.newSingleThreadExecutor().execute {
                    val msg = try {
                        Backup.run(c)
                        c.getString(R.string.backup_done)
                    } catch (e: Exception) {
                        c.getString(R.string.backup_failed, e.message ?: e.javaClass.simpleName)
                    }
                    main.post { Toast.makeText(c, msg, Toast.LENGTH_SHORT).show() }
                    pending.finish()
                }
            }
        }
    }
}

/**
 * Widget configuration (long press › edit): the settings open inside the app, with the same look
 * as the rest. The widget is placed right away with default settings.
 */
class WidgetConfigActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        if (id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            Widgets.update(this, id)
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("agendapp://widget/$id"), this, MainActivity::class.java))
        }
        finish()
    }
}
