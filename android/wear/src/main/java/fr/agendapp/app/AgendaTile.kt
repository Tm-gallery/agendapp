package fr.agendapp.app

import android.content.Context
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DeviceParametersBuilders.DeviceParameters
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.LayoutElement
import androidx.wear.protolayout.ModifiersBuilders.Clickable
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material3.CardColors
import androidx.wear.protolayout.material3.ColorScheme
import androidx.wear.protolayout.material3.MaterialScope
import androidx.wear.protolayout.material3.Typography
import androidx.wear.protolayout.material3.materialScope
import androidx.wear.protolayout.material3.primaryLayout
import androidx.wear.protolayout.material3.text
import androidx.wear.protolayout.material3.textEdgeButton
import androidx.wear.protolayout.material3.titleCard
import androidx.wear.protolayout.modifiers.clickable
import androidx.wear.protolayout.types.argb
import androidx.wear.protolayout.types.layoutString
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.time.LocalDateTime

/**
 * "AgendApp" tile: the current or next event, then the one after.
 *
 * Battery: the tile is never recomputed on a fixed interval. It provides a timeline in advance (one
 * layout per change: an event starting or ending, midnight) over 48 h, and the system switches
 * between them on its own. It is only rebuilt when the phone sends data, when a setting changes,
 * or at the latest every 12 hours.
 */
class AgendaTileService : TileService() {

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val tile = AgendaTile.build(this, requestParams.deviceConfiguration)
        return CallbackToFutureAdapter.getFuture { it.set(tile); "tile" }
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> {
        val res = ResourceBuilders.Resources.Builder().setVersion(AgendaTile.RES_VERSION).build()
        return CallbackToFutureAdapter.getFuture { it.set(res); "res" }
    }
}

object AgendaTile {
    const val RES_VERSION = "1"
    private const val HOURS = 48L
    private const val MAX_ENTRIES = 24
    private const val FRESHNESS_MS = 12 * 3600_000L
    private const val FRESHNESS_MIN_MS = 15 * 60_000L

    private fun ms(t: LocalDateTime) = t.atZone(Agenda.zone).toInstant().toEpochMilli()

    fun build(c: Context, device: DeviceParameters): TileBuilders.Tile {
        val feed = Store.load(c)
        val settings = Store.settings(c)
        val palette = Palette.phone(c)
        val bounds = Agenda.boundaries(feed.events, Agenda.now(), HOURS, MAX_ENTRIES)
        val timeline = TimelineBuilders.Timeline.Builder()
        bounds.forEachIndexed { i, at ->
            val validity = TimelineBuilders.TimeInterval.Builder().apply {
                if (i > 0) setStartMillis(ms(at))
                bounds.getOrNull(i + 1)?.let { setEndMillis(ms(it)) }
            }.build()
            val root = materialScope(
                c, device,
                allowDynamicTheme = palette == null,
                defaultColorScheme = palette?.let(Palette::tile) ?: ColorScheme(),
            ) { content(c, feed, settings, at) }
            timeline.addTimelineEntry(
                TimelineBuilders.TimelineEntry.Builder()
                    .setValidity(validity)
                    .setLayout(LayoutElementBuilders.Layout.Builder().setRoot(root).build())
                    .build(),
            )
        }
        return TileBuilders.Tile.Builder()
            .setResourcesVersion(RES_VERSION)
            .setTileTimeline(timeline.build())
            // Read again at the latest when the timeline ends (12 hours at most).
            .setFreshnessIntervalMillis((ms(bounds.last()) - System.currentTimeMillis()).coerceIn(FRESHNESS_MIN_MS, FRESHNESS_MS).takeIf { bounds.size >= MAX_ENTRIES } ?: FRESHNESS_MS)
            .build()
    }

    private fun open(c: Context, eventId: String?): Clickable {
        val activity = ActionBuilders.AndroidActivity.Builder()
            .setPackageName(c.packageName)
            .setClassName(MainActivity::class.java.name)
        if (eventId != null) {
            activity.addKeyToExtraMapping(MainActivity.EXTRA_EVENT, ActionBuilders.AndroidStringExtra.Builder().setValue(eventId).build())
        }
        return clickable(ActionBuilders.LaunchAction.Builder().setAndroidActivity(activity.build()).build(), id = "open:${eventId ?: "home"}")
    }

    private fun MaterialScope.content(c: Context, feed: Feed, s: Settings, at: LocalDateTime): LayoutElement {
        val today = at.toLocalDate()
        val events = feed.events
        val current = Agenda.current(events, at)
        val allDay = Agenda.allDayOn(events, today).firstOrNull()
        val upcoming = Agenda.upcoming(events, at, 2).filter { it.start.isBefore(today.plusDays(31)) }
        val main = current ?: allDay?.takeIf { upcoming.firstOrNull()?.start != today } ?: upcoming.firstOrNull()
        val then = (if (main === upcoming.firstOrNull()) upcoming.drop(1) else upcoming).firstOrNull()

        val title = when {
            main == null -> "AgendApp"
            main === current -> c.getString(R.string.ongoing)
            main.allDay && main.covers(today) -> c.getString(R.string.today)
            else -> Fmt.dayLabel(c, main.start, today)
        }

        return primaryLayout(
            titleSlot = { text(title.layoutString) },
            mainSlot = {
                if (main == null) {
                    text(
                        c.getString(if (feed.receivedAt == 0L) R.string.open_phone_app else R.string.nothing_planned).layoutString,
                        typography = Typography.TITLE_MEDIUM, maxLines = 2,
                    )
                } else {
                    val on = onColorArgb(main.color)
                    val card = titleCard(
                        onClick = open(c, main.id),
                        title = { text(main.label(s.hideNames).layoutString, maxLines = 2) },
                        content = {
                            text(
                                when {
                                    main.allDay && main.end.minusDays(1) != main.start -> c.getString(R.string.until, Fmt.dayShort(main.end.minusDays(1)))
                                    else -> Fmt.range(c, main)
                                }.layoutString,
                            )
                        },
                        time = {
                            text(
                                when {
                                    main === current -> "→ ${Fmt.hm(main.to!!)}"
                                    main.allDay -> c.getString(R.string.all_day_short)
                                    else -> Fmt.hm(main.from!!)
                                }.layoutString,
                            )
                        },
                        height = expand(),
                        colors = CardColors(
                            backgroundColor = main.color.argb,
                            titleColor = on.argb,
                            contentColor = on.argb,
                            timeColor = on.argb,
                        ),
                    )
                    if (then == null) card
                    else LayoutElementBuilders.Column.Builder()
                        .setWidth(expand()).setHeight(expand())
                        .addContent(LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand()).addContent(card).build())
                        .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(4f)).build())
                        .addContent(
                            text(
                                c.getString(
                                    R.string.then_next,
                                    then.label(true),
                                    if (then.start == today && !then.allDay) Fmt.hm(then.from!!) else Fmt.dayLabel(c, then.start, today),
                                ).layoutString,
                                typography = Typography.BODY_SMALL,
                                color = colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            ),
                        )
                        .build()
                }
            },
            bottomSlot = {
                textEdgeButton(onClick = open(c, null)) { text(c.getString(R.string.tile_button).layoutString) }
            },
        )
    }
}
