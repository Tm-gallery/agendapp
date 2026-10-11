plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.agendapp.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "fr.agendapp.app"
        minSdk = 24
        targetSdk = 35
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
    androidResources {
        // woff2 fonts are already compressed.
        noCompress += listOf("woff2")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.core:core-remoteviews:1.1.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("com.google.android.gms:play-services-wearable:19.0.0")
}
