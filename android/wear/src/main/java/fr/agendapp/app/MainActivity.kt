package fr.agendapp.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.NavHostController
import androidx.wear.compose.material3.AppScaffold
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import kotlinx.coroutines.launch
import java.time.LocalDate

/**
 * Watch app. Screens:
 *  Home (upcoming) ─┬─ Event ── Open on phone
 *                   ├─ Calendar (month) ── Day ── Event
 *                   └─ Settings
 * The tile and the complication open the home screen or an event directly.
 */
class MainActivity : ComponentActivity() {
    private var nav: NavHostController? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        Store.load(this)
        Store.settings(this)
        setContent { App(intent.getStringExtra(EXTRA_EVENT)) { nav = it } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_EVENT)?.let { id ->
            nav?.navigate("event/$id") { popUpTo("home") }
        }
    }

    companion object {
        const val EXTRA_EVENT = "event"
    }
}

@androidx.compose.runtime.Composable
private fun App(startEvent: String?, onNav: (NavHostController) -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val feed by Store.feed.collectAsState()
    val settings by Store.settings.collectAsState()
    val nav = rememberSwipeDismissableNavController()
    onNav(nav)

    LaunchedEffect(Unit) {
        // First launch: use data already synced, otherwise ask the phone for it.
        if ((feed?.receivedAt ?: 0L) == 0L && !Store.fetchExisting(ctx)) Store.requestSync(ctx)
        if (startEvent != null) nav.navigate("event/$startEvent")
    }

    val f = feed ?: Feed.EMPTY
    val s = settings ?: Settings()
    AgendaTheme(f, s) {
        AppScaffold {
            SwipeDismissableNavHost(navController = nav, startDestination = "home") {
                composable("home") {
                    HomeScreen(
                        f, s,
                        onEvent = { nav.navigate("event/$it") },
                        onMonth = { nav.navigate("month") },
                        onSettings = { nav.navigate("settings") },
                        onSync = { scope.launch { Store.requestSync(ctx) } },
                    )
                }
                composable("event/{id}") { EventScreen(f, s, it.arguments?.getString("id").orEmpty()) }
                composable("month") { MonthScreen(f) { d -> nav.navigate("day/$d") } }
                composable("day/{date}") {
                    val d = runCatching { LocalDate.parse(it.arguments?.getString("date")) }.getOrDefault(LocalDate.now())
                    DayScreen(f, s, d) { id -> nav.navigate("event/$id") }
                }
                composable("settings") { SettingsScreen(f, s) }
            }
        }
    }
}
