package fr.agendapp.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.ButtonGroup
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.CardDefaults
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.IconButton
import androidx.wear.compose.material3.LinearProgressIndicator
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.OpenOnPhoneDialog
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.SwitchButton
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.curvedText
import androidx.wear.compose.material3.lazy.TransformationSpec
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.YearMonth
import java.time.temporal.ChronoUnit
import kotlin.math.abs

/** Current time, refreshed every minute while the screen is visible (nothing in the background). */
@Composable
fun rememberNow(): LocalDateTime {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val now by produceState(Agenda.now(), lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                value = Agenda.now()
                delay(60_000L - System.currentTimeMillis() % 60_000L)
            }
        }
    }
    return now
}

// ---------- Building blocks ----------

@Composable
private fun TransformingLazyColumnItemScope.Header(spec: TransformationSpec, text: String) {
    ListHeader(
        modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
        transformation = SurfaceTransformation(spec),
    ) { Text(text, textAlign = TextAlign.Center) }
}

/** Event card: a bar in the type's colour, title, times. */
@Composable
private fun TransformingLazyColumnItemScope.EventCard(
    spec: TransformationSpec,
    e: Event,
    hideNames: Boolean,
    now: LocalDateTime,
    onClick: () -> Unit,
) {
    val ctx = LocalContext.current
    val past = e.endAt <= now
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().transformedHeight(this, spec).alpha(if (past) 0.55f else 1f),
        transformation = SurfaceTransformation(spec),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.padding(end = 10.dp).width(5.dp).height(34.dp)
                    .clip(RoundedCornerShape(50)).background(Color(e.color)),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    e.label(hideNames), style = MaterialTheme.typography.titleSmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    Fmt.range(ctx, e), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                )
            }
        }
    }
}

/** Event in progress: a card filled with the type's colour, with progress. */
@Composable
private fun TransformingLazyColumnItemScope.NowCard(
    spec: TransformationSpec,
    e: Event,
    hideNames: Boolean,
    now: LocalDateTime,
    onClick: () -> Unit,
) {
    val ctx = LocalContext.current
    val fg = onColor(e.color)
    val total = Fmt.minutes(e).coerceAtLeast(1)
    val done = ChronoUnit.MINUTES.between(e.startAt, now).coerceIn(0, total)
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
        transformation = SurfaceTransformation(spec),
        colors = CardDefaults.cardColors(containerColor = Color(e.color), contentColor = fg, titleColor = fg),
    ) {
        Text(stringResource(R.string.ongoing_until, Fmt.hm(e.to!!)), style = MaterialTheme.typography.labelSmall, color = fg.copy(alpha = 0.85f))
        Text(
            e.label(hideNames), style = MaterialTheme.typography.titleMedium, color = fg,
            maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(6.dp))
        LinearProgressIndicator(
            progress = { done.toFloat() / total },
            modifier = Modifier.fillMaxWidth(),
            colors = ProgressIndicatorDefaults.colors(indicatorColor = fg, trackColor = fg.copy(alpha = 0.3f)),
        )
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.time_left, Fmt.duration(ctx, total - done)), style = MaterialTheme.typography.bodySmall, color = fg.copy(alpha = 0.85f))
    }
}

@Composable
private fun TransformingLazyColumnItemScope.Note(spec: TransformationSpec, text: String) {
    Text(
        text,
        modifier = Modifier.fillMaxWidth().transformedHeight(this, spec).padding(horizontal = 8.dp, vertical = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

// ---------- Home: upcoming ----------

@Composable
fun HomeScreen(feed: Feed, settings: Settings, onEvent: (String) -> Unit, onMonth: () -> Unit, onSettings: () -> Unit, onSync: () -> Unit) {
    val ctx = LocalContext.current
    val now = rememberNow()
    val today = now.toLocalDate()
    val listState = rememberTransformingLazyColumnState()
    val spec = rememberTransformationSpec()
    val current = Agenda.current(feed.events, now)
    val days = Agenda.days(feed.events, today, settings.horizon)
    val stat = feed.stats.firstOrNull { it.ym == YearMonth.from(today).toString() }

    ScreenScaffold(
        scrollState = listState,
        edgeButton = {
            EdgeButton(onClick = onMonth, buttonSize = EdgeButtonSize.Medium) {
                Icon(painterResource(R.drawable.ic_calendar), contentDescription = stringResource(R.string.calendar))
            }
        },
    ) { padding ->
        TransformingLazyColumn(state = listState, contentPadding = padding) {
            item { Header(spec, Fmt.dayLong(today)) }
            if (feed.receivedAt == 0L) {
                item { Note(spec, ctx.getString(R.string.nothing_received)) }
                item {
                    Button(
                        onClick = onSync,
                        modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                        transformation = SurfaceTransformation(spec),
                        icon = { Icon(painterResource(R.drawable.ic_sync), null) },
                        label = { Text(stringResource(R.string.sync)) },
                    )
                }
            }
            if (current != null) item { NowCard(spec, current, settings.hideNames, now) { onEvent(current.id) } }
            val seen = mutableSetOf<String>()
            for ((day, events) in days) {
                // A multi-day all-day event appears once (on the first day shown).
                val shown = events.filter { it != current && (it.allDay || it.endAt > now) && seen.add(it.id) }
                if (shown.isEmpty()) continue
                if (day != today) item(key = "h$day") { Header(spec, Fmt.dayLabel(ctx, day, today)) }
                shown.forEach { e ->
                    item(key = "$day/${e.id}") { EventCard(spec, e, settings.hideNames, now) { onEvent(e.id) } }
                }
            }
            if (feed.receivedAt != 0L && days.isEmpty()) item { Note(spec, ctx.getString(R.string.nothing_in_days, settings.horizon)) }
            if (stat != null && (stat.minutes > 0 || stat.daysOff > 0)) {
                item {
                    Card(
                        onClick = onMonth,
                        modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                        transformation = SurfaceTransformation(spec),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        ),
                    ) {
                        val month = Fmt.month(YearMonth.from(today)).substringBefore(' ')
                        Text(stringResource(R.string.month_summary, month), style = MaterialTheme.typography.labelSmall)
                        Text(Fmt.duration(ctx, stat.minutes.toLong()), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        val extra = listOfNotNull(
                            stat.nights.takeIf { it > 0 }?.let { ctx.resources.getQuantityString(R.plurals.nights, it, it) },
                            stat.daysOff.takeIf { it > 0 }?.let { ctx.getString(R.string.days_off, it) },
                        )
                        if (extra.isNotEmpty()) Text(extra.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            item {
                FilledTonalButton(
                    onClick = onSettings,
                    modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                    transformation = SurfaceTransformation(spec),
                    icon = { Icon(painterResource(R.drawable.ic_settings), null) },
                    label = { Text(stringResource(R.string.settings)) },
                    secondaryLabel = { Text(stringResource(R.string.received, Fmt.ago(ctx, feed.receivedAt)), maxLines = 1) },
                )
            }
        }
    }
}

// ---------- Event details ----------

@Composable
fun EventScreen(feed: Feed, settings: Settings, id: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val now = rememberNow()
    val listState = rememberTransformingLazyColumnState()
    val spec = rememberTransformationSpec()
    var phoneDialog by remember { mutableStateOf(false) }
    var phoneError by remember { mutableStateOf(false) }
    val e = feed.events.firstOrNull { it.id == id }

    ScreenScaffold(scrollState = listState) { padding ->
        TransformingLazyColumn(state = listState, contentPadding = padding) {
            if (e == null) {
                item { Note(spec, ctx.getString(R.string.event_missing)) }
                return@TransformingLazyColumn
            }
            item {
                Box(Modifier.fillMaxWidth().transformedHeight(this, spec), contentAlignment = Alignment.Center) {
                    Text(
                        e.type,
                        modifier = Modifier.clip(CircleShape).background(Color(e.color)).padding(horizontal = 12.dp, vertical = 4.dp),
                        color = onColor(e.color), style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
            item {
                Text(
                    e.label(false),
                    modifier = Modifier.fillMaxWidth().transformedHeight(this, spec).padding(horizontal = 6.dp),
                    style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center,
                )
            }
            item {
                Column(
                    Modifier.fillMaxWidth().transformedHeight(this, spec),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(Fmt.dayLong(e.start), style = MaterialTheme.typography.bodyMedium)
                    Text(
                        if (e.allDay) Fmt.range(ctx, e) else "${Fmt.range(ctx, e)} · ${Fmt.duration(ctx, Fmt.minutes(e))}",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(Fmt.relative(ctx, e, now), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                }
            }
            e.fields.forEach { (label, value) ->
                item {
                    Column(
                        Modifier.fillMaxWidth().transformedHeight(this, spec)
                            .clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainer)
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                    ) {
                        if (label.isNotEmpty()) Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        Text(value, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            item {
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            phoneError = !Store.openOnPhone(ctx, e.start)
                            phoneDialog = !phoneError
                        }
                    },
                    modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                    transformation = SurfaceTransformation(spec),
                    icon = { Icon(painterResource(R.drawable.ic_phone), null) },
                    label = { Text(stringResource(R.string.open_on_phone)) },
                    secondaryLabel = if (phoneError) ({ Text(stringResource(R.string.phone_unreachable)) }) else null,
                )
            }
        }
    }
    OpenOnPhoneDialog(
        visible = phoneDialog,
        onDismissRequest = { phoneDialog = false },
        curvedText = { curvedText(ctx.getString(R.string.on_phone)) },
    )
}

// ---------- Day ----------

@Composable
fun DayScreen(feed: Feed, settings: Settings, initial: LocalDate, onEvent: (String) -> Unit) {
    val ctx = LocalContext.current
    var day by rememberSaveable { mutableStateOf(initial.toString()) }
    val date = LocalDate.parse(day)
    val now = rememberNow()
    val listState = rememberTransformingLazyColumnState()
    val spec = rememberTransformationSpec()
    val events = Agenda.on(feed.events, date)

    ScreenScaffold(scrollState = listState) { padding ->
        TransformingLazyColumn(state = listState, contentPadding = padding) {
            item { Header(spec, Fmt.dayLabel(ctx, date, now.toLocalDate()).let { if (it.length < 10) "$it · ${Fmt.dayShort(date)}" else it }) }
            if (events.isEmpty()) item { Note(spec, ctx.getString(R.string.nothing_planned)) }
            events.forEach { e -> item(key = e.id) { EventCard(spec, e, settings.hideNames, now) { onEvent(e.id) } } }
            item {
                val prev = remember { MutableInteractionSource() }
                val next = remember { MutableInteractionSource() }
                ButtonGroup(Modifier.fillMaxWidth().transformedHeight(this, spec)) {
                    FilledTonalIconButton(
                        onClick = { day = date.minusDays(1).toString() },
                        modifier = Modifier.weight(1f).animateWidth(prev),
                        interactionSource = prev,
                    ) { Icon(painterResource(R.drawable.ic_prev), stringResource(R.string.prev_day)) }
                    FilledTonalIconButton(
                        onClick = { day = date.plusDays(1).toString() },
                        modifier = Modifier.weight(1f).animateWidth(next),
                        interactionSource = next,
                    ) { Icon(painterResource(R.drawable.ic_next), stringResource(R.string.next_day)) }
                }
            }
        }
    }
}

// ---------- Month ----------

/** One-letter weekday headings, Monday first, in the watch's language. */
private fun weekdayLetters(): List<String> =
    java.time.DayOfWeek.entries.map { it.getDisplayName(java.time.format.TextStyle.NARROW, java.util.Locale.getDefault()) }

@Composable
fun MonthScreen(feed: Feed, onDay: (LocalDate) -> Unit) {
    val ctx = LocalContext.current
    val now = rememberNow()
    val today = now.toLocalDate()
    var ymText by rememberSaveable { mutableStateOf(YearMonth.from(today).toString()) }
    val ym = YearMonth.parse(ymText)
    val focus = remember { FocusRequester() }
    var acc by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) { focus.requestFocus() }

    val first = ym.atDay(1)
    val start = first.minusDays((first.dayOfWeek.value - 1).toLong())
    val weeks = ((ChronoUnit.DAYS.between(start, ym.atEndOfMonth()) / 7) + 1).toInt()
    val stat = feed.stats.firstOrNull { it.ym == ym.toString() }

    ScreenScaffold {
        Column(
            Modifier.fillMaxSize()
                .onRotaryScrollEvent {
                    acc += it.verticalScrollPixels
                    if (abs(acc) > 120f) {
                        ymText = (if (acc > 0) ym.plusMonths(1) else ym.minusMonths(1)).toString()
                        acc = 0f
                    }
                    true
                }
                .focusRequester(focus).focusable()
                .padding(horizontal = 30.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { ymText = ym.minusMonths(1).toString() }, modifier = Modifier.size(32.dp)) {
                    Icon(painterResource(R.drawable.ic_prev), stringResource(R.string.prev_month), Modifier.size(20.dp))
                }
                Text(
                    Fmt.month(ym).let { if (ym.year == today.year) it.substringBefore(' ') else it },
                    modifier = Modifier.weight(1f), textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.titleSmall, maxLines = 1,
                )
                IconButton(onClick = { ymText = ym.plusMonths(1).toString() }, modifier = Modifier.size(32.dp)) {
                    Icon(painterResource(R.drawable.ic_next), stringResource(R.string.next_month), Modifier.size(20.dp))
                }
            }
            Row(Modifier.fillMaxWidth()) {
                weekdayLetters().forEach {
                    Text(
                        it, modifier = Modifier.weight(1f), textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            for (w in 0 until weeks) {
                Row(Modifier.fillMaxWidth()) {
                    for (d in 0 until 7) {
                        val date = start.plusDays((w * 7 + d).toLong())
                        val inMonth = date.month == ym.month
                        val colors = Agenda.on(feed.events, date).map { it.color }.distinct().take(3)
                        val isToday = date == today
                        Column(
                            Modifier.weight(1f).height(21.dp).clip(CircleShape)
                                .background(if (isToday) MaterialTheme.colorScheme.primary else Color.Transparent)
                                .clickable { onDay(date) }
                                .alpha(if (inMonth) 1f else 0.35f),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                "${date.dayOfMonth}", style = MaterialTheme.typography.labelSmall,
                                color = if (isToday) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                                colors.forEach { c -> Box(Modifier.size(3.dp).clip(CircleShape).background(Color(c))) }
                            }
                        }
                    }
                }
            }
            if (stat != null && stat.minutes > 0) {
                Text(
                    stringResource(R.string.worked, Fmt.duration(ctx, stat.minutes.toLong())),
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

// ---------- Settings ----------

@Composable
fun SettingsScreen(feed: Feed, settings: Settings) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberTransformingLazyColumnState()
    val spec = rememberTransformationSpec()
    var syncState by remember { mutableStateOf<String?>(null) }
    val set = { s: Settings -> Store.update(ctx, s) }

    ScreenScaffold(scrollState = listState) { padding ->
        TransformingLazyColumn(state = listState, contentPadding = padding) {
            item { Header(spec, ctx.getString(R.string.settings)) }
            item {
                Button(
                    onClick = {
                        syncState = ctx.getString(R.string.request_sending)
                        scope.launch {
                            val ok = Store.requestSync(ctx)
                            syncState = ctx.getString(if (ok) R.string.request_sent else R.string.phone_unreachable)
                            if (ok) { delay(4000); syncState = null }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                    transformation = SurfaceTransformation(spec),
                    icon = { Icon(painterResource(R.drawable.ic_sync), null) },
                    label = { Text(stringResource(R.string.sync)) },
                    secondaryLabel = { Text(syncState ?: stringResource(R.string.received, Fmt.ago(ctx, feed.receivedAt)), maxLines = 1) },
                )
            }
            item {
                SwitchButton(
                    checked = settings.phoneColors,
                    onCheckedChange = { set(settings.copy(phoneColors = it)) },
                    modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                    transformation = SurfaceTransformation(spec),
                    icon = { Icon(painterResource(R.drawable.ic_palette), null) },
                    label = { Text(stringResource(R.string.phone_colors)) },
                )
            }
            item {
                SwitchButton(
                    checked = settings.hideNames,
                    onCheckedChange = { set(settings.copy(hideNames = it)) },
                    modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                    transformation = SurfaceTransformation(spec),
                    icon = { Icon(painterResource(R.drawable.ic_visibility_off), null) },
                    label = { Text(stringResource(R.string.hide_names)) },
                    secondaryLabel = { Text(stringResource(R.string.codes_only)) },
                )
            }
            item {
                val next = when (settings.horizon) { 7 -> 14; 14 -> 30; else -> 7 }
                FilledTonalButton(
                    onClick = { set(settings.copy(horizon = next)) },
                    modifier = Modifier.fillMaxWidth().transformedHeight(this, spec),
                    transformation = SurfaceTransformation(spec),
                    icon = { Icon(painterResource(R.drawable.ic_date_range), null) },
                    label = { Text(stringResource(R.string.period_shown)) },
                    secondaryLabel = { Text(stringResource(R.string.n_days, settings.horizon)) },
                )
            }
            item {
                Note(spec, ctx.getString(R.string.settings_note, feed.events.size, feed.calendar))
            }
        }
    }
}
