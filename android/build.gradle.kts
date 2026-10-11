plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}

// Version shared by the phone and watch apps, taken from the release tag in GitHub Actions
// (v1.2.3 → versionName 1.2.3, versionCode 10203). Local builds are 1.0.0.
val appVersion = System.getenv("AGENDAPP_VERSION")?.removePrefix("v") ?: "1.0.0"
val versionParts = (appVersion.split(".").map { it.toIntOrNull() ?: 0 } + listOf(0, 0, 0)).take(3)
extra["appVersionName"] = appVersion
extra["appVersionCode"] = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
