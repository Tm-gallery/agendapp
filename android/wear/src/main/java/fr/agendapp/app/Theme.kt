package fr.agendapp.app

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.dynamicColorScheme
import androidx.wear.protolayout.types.argb

/**
 * Colours: the phone's (Material You, sent with the events) when the option is on, otherwise the
 * watch's dynamic colours (Wear OS 6+), otherwise the default Material 3 theme.
 */
object Palette {
    private val roles = listOf(
        "primary", "primaryDim", "primaryContainer", "onPrimary", "onPrimaryContainer",
        "secondary", "secondaryDim", "secondaryContainer", "onSecondary", "onSecondaryContainer",
        "tertiary", "tertiaryDim", "tertiaryContainer", "onTertiary", "onTertiaryContainer",
        "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh", "onSurface", "onSurfaceVariant",
        "outline", "outlineVariant",
    )

    fun usable(p: Map<String, Int>) = roles.all { it in p }

    fun compose(p: Map<String, Int>): ColorScheme {
        fun c(k: String) = Color(p.getValue(k))
        return ColorScheme(
            primary = c("primary"), primaryDim = c("primaryDim"), primaryContainer = c("primaryContainer"),
            onPrimary = c("onPrimary"), onPrimaryContainer = c("onPrimaryContainer"),
            secondary = c("secondary"), secondaryDim = c("secondaryDim"), secondaryContainer = c("secondaryContainer"),
            onSecondary = c("onSecondary"), onSecondaryContainer = c("onSecondaryContainer"),
            tertiary = c("tertiary"), tertiaryDim = c("tertiaryDim"), tertiaryContainer = c("tertiaryContainer"),
            onTertiary = c("onTertiary"), onTertiaryContainer = c("onTertiaryContainer"),
            surfaceContainerLow = c("surfaceContainerLow"), surfaceContainer = c("surfaceContainer"),
            surfaceContainerHigh = c("surfaceContainerHigh"), onSurface = c("onSurface"),
            onSurfaceVariant = c("onSurfaceVariant"), outline = c("outline"), outlineVariant = c("outlineVariant"),
        )
    }

    fun tile(p: Map<String, Int>): androidx.wear.protolayout.material3.ColorScheme {
        fun c(k: String) = p.getValue(k).argb
        return androidx.wear.protolayout.material3.ColorScheme(
            primary = c("primary"), primaryDim = c("primaryDim"), primaryContainer = c("primaryContainer"),
            onPrimary = c("onPrimary"), onPrimaryContainer = c("onPrimaryContainer"),
            secondary = c("secondary"), secondaryDim = c("secondaryDim"), secondaryContainer = c("secondaryContainer"),
            onSecondary = c("onSecondary"), onSecondaryContainer = c("onSecondaryContainer"),
            tertiary = c("tertiary"), tertiaryDim = c("tertiaryDim"), tertiaryContainer = c("tertiaryContainer"),
            onTertiary = c("onTertiary"), onTertiaryContainer = c("onTertiaryContainer"),
            surfaceContainerLow = c("surfaceContainerLow"), surfaceContainer = c("surfaceContainer"),
            surfaceContainerHigh = c("surfaceContainerHigh"), onSurface = c("onSurface"),
            onSurfaceVariant = c("onSurfaceVariant"), outline = c("outline"), outlineVariant = c("outlineVariant"),
        )
    }

    /** The phone's colours, if wanted and available. */
    fun phone(c: Context): Map<String, Int>? {
        val p = Store.load(c).palette
        return if (Store.settings(c).phoneColors && usable(p)) p else null
    }
}

/** Readable text colour on an event type's colour. */
fun onColorArgb(argb: Int): Int = if (Color(argb).luminance() > 0.45f) 0xFF1B1B1F.toInt() else 0xFFFFFFFF.toInt()
fun onColor(argb: Int): Color = Color(onColorArgb(argb))

@Composable
fun AgendaTheme(feed: Feed?, settings: Settings?, content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val p = feed?.palette.orEmpty()
    val scheme = when {
        settings?.phoneColors != false && Palette.usable(p) -> Palette.compose(p)
        else -> dynamicColorScheme(ctx) ?: ColorScheme()
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
