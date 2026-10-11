plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Watch app (Wear OS): same application id and signing key as the phone app, which the
// Wearable data layer requires to connect them.
android {
    namespace = "fr.agendapp.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "fr.agendapp.app"
        minSdk = 30
        targetSdk = 34
        versionCode = rootProject.extra["appVersionCode"] as Int
        versionName = rootProject.extra["appVersionName"] as String
    }

    // Release signing: the key file and its password come from the environment (GitHub Actions
    // secrets), never from the repository. Phone and watch must share the same key.
    val keystore = System.getenv("AGENDAPP_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = keystore
                storeType = "pkcs12"
                storePassword = System.getenv("AGENDAPP_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("AGENDAPP_KEY_ALIAS") ?: "agendapp"
                keyPassword = System.getenv("AGENDAPP_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")

    implementation("androidx.wear.compose:compose-material3:1.5.6")
    implementation("androidx.wear.compose:compose-foundation:1.5.6")
    implementation("androidx.wear.compose:compose-navigation:1.5.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.wear:wear-input:1.2.0")
    implementation("androidx.wear:wear-remote-interactions:1.1.0")

    implementation("androidx.wear.tiles:tiles:1.5.0")
    implementation("androidx.wear.protolayout:protolayout:1.3.0")
    implementation("androidx.wear.protolayout:protolayout-material3:1.3.0")
    implementation("androidx.wear.protolayout:protolayout-expression:1.3.0")
    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.2.1")
    implementation("androidx.concurrent:concurrent-futures-ktx:1.2.0")

    implementation("com.google.android.gms:play-services-wearable:19.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
}
