package fr.agendapp.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.provider.MediaStore
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Button
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Native shell of AgendApp: the web app (assets/www) runs in a WebView served from
 * https://appassets.androidplatform.net (a secure context → localStorage, clipboard, camera).
 * The "AndroidBridge" provides what the WebView can't do alone: saving and sharing files, Material
 * You colours, insets, system bars, predictive back, the phone's calendar, backups, lock, widgets.
 */
class MainActivity : FragmentActivity() {

    private companion object {
        const val HOST = "appassets.androidplatform.net"
        const val START_URL = "https://$HOST/www/index.html"
        const val DOWNLOAD_DIR = "AgendApp"
    }

    private lateinit var root: FrameLayout
    private lateinit var webView: WebView

    private var insetTop = 0
    private var insetBottom = 0
    private var lastSeed = 0
    private var darkTheme = false

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var pendingWebPermission: PermissionRequest? = null
    private var pendingChooser: Pair<Intent, Boolean>? = null

    private lateinit var calendar: CalendarSync
    private val calExecutor = Executors.newSingleThreadExecutor()
    private var calPermissionLatch: CountDownLatch? = null
    private var stopped = false

    // Actions from shortcuts and widgets (agendapp://new, agendapp://day/…).
    private var pageReady = false
    private var pendingAction: Uri? = null

    // Biometric lock.
    private lateinit var lockOverlay: View
    private var locked = false
    private var prompting = false
    private var autoPrompt = false
    private var stoppedAt = 0L
    private var leftByUser = false
    private var lockArmed = false
    private var lockCallback: ((Boolean) -> Unit)? = null

    private val folderPicker =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri != null) {
                contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
                )
                val name = androidx.documentfile.provider.DocumentFile.fromTreeUri(this, uri)?.name ?: uri.lastPathSegment.orEmpty()
                AppStore.setBackup(this, JSONObject().put("dest", "folder").put("folderUri", uri.toString()).put("folderName", name))
            }
            js("window.__agSettingsChanged && window.__agSettingsChanged()")
        }

    private val backCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            webView.evaluateJavascript("window.__androidBack && window.__androidBack()", null)
        }
    }

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
            val cb = fileCallback ?: return@registerForActivityResult
            fileCallback = null
            var uris: Array<Uri>? = null
            if (res.resultCode == RESULT_OK) {
                val data = res.data
                val clip = data?.clipData
                uris = when {
                    clip != null && clip.itemCount > 0 -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                    data?.data != null -> arrayOf(data.data!!)
                    else -> cameraUri?.takeIf { capturedPhotoExists() }?.let { arrayOf(it) }
                }
            }
            cameraUri = null
            cb.onReceiveValue(uris)
        }

    // Camera permission: for QR scanning (getUserMedia) or taking a photo from the file chooser.
    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pendingWebPermission?.let { req ->
                if (granted) req.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else {
                    req.deny()
                    toast(getString(R.string.camera_denied))
                }
            }
            pendingWebPermission = null
            pendingChooser?.let { (content, image) -> launchChooser(content, image && granted) }
            pendingChooser = null
        }

    // Calendar permission: asked on the first send (or when deletion sync is turned on).
    private val calendarPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (!calendar.hasPermission() && !shouldShowRequestPermissionRationale(Manifest.permission.WRITE_CALENDAR)) {
                // Permanently denied: only the app's system settings page can grant it now.
                toast(getString(R.string.calendar_denied))
                try {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
                } catch (_: ActivityNotFoundException) {
                }
            }
            calPermissionLatch?.countDown()
            calPermissionLatch = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        darkTheme = isSystemDark()
        calendar = CalendarSync(this)

        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            overScrollMode = WebView.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = true
                setSupportZoom(false)
                builtInZoomControls = false
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
            }
            addJavascriptInterface(Bridge(), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == HOST) return false
                    openExternal(request.url)
                    return true
                }

                override fun onPageFinished(view: WebView, url: String) {
                    pushInsets()
                    pageReady = true
                    dispatchAction()
                }
            }
            webChromeClient = Chrome()
        }

        lockOverlay = buildLockOverlay()
        root = FrameLayout(this).apply {
            addView(webView)
            addView(lockOverlay)
        }
        setContentView(root)

        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val density = resources.displayMetrics.density
            val imeVisible = ime.bottom > bars.bottom
            // The keyboard shrinks the WebView; otherwise content goes under the bars (edge-to-edge).
            v.setPadding(bars.left, 0, bars.right, if (imeVisible) ime.bottom else 0)
            insetTop = (bars.top / density).roundToInt()
            insetBottom = if (imeVisible) 0 else (bars.bottom / density).roundToInt()
            pushInsets()
            WindowInsetsCompat.CONSUMED
        }

        onBackPressedDispatcher.addCallback(this, backCallback)
        applyBarAppearance()

        lastSeed = seedColor()
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL)
        }

        applyRecentsPrivacy()
        if (lockEnabled()) setLocked(true)
        if (savedInstanceState == null) handleIntent(intent)
        Backup.schedule(this, replace = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (locked && autoPrompt) {
            autoPrompt = false
            lockOverlay.post { promptUnlock() }
        }
        // The wallpaper (hence the Material You palette) may have changed.
        val seed = seedColor()
        if (seed != lastSeed) {
            lastSeed = seed
            webView.evaluateJavascript("window.__m3SetSeed && window.__m3SetSeed($seed)", null)
        }
    }

    override fun onStart() {
        super.onStart()
        // Back in the app: events may have been deleted in the calendar in the meantime.
        if (stopped) webView.evaluateJavascript("window.__calResume && window.__calResume()", null)
        if (lockArmed && lockEnabled() && !locked) {
            val delay = AppStore.lock(this).optLong("delay") * 1000
            if (SystemClock.elapsedRealtime() - stoppedAt >= delay) setLocked(true)
        }
        lockArmed = false
        stopped = false
    }

    // The lock only arms when the user leaves the app (home, recent apps) or turns the screen off:
    // not after a file chooser, a share sheet or entering the device PIN.
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        leftByUser = true
    }

    override fun onStop() {
        stopped = true
        val screenOff = !getSystemService(android.os.PowerManager::class.java).isInteractive
        if ((leftByUser || screenOff) && !isChangingConfigurations) {
            lockArmed = true
            stoppedAt = SystemClock.elapsedRealtime()
        }
        leftByUser = false
        super.onStop()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        calExecutor.shutdown()
        root.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    // ---------- Theme ----------

    /** Material You seed colour (Android 12+), or 0: the page then uses its default colour. */
    private fun seedColor(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) getColor(android.R.color.system_accent1_500) else 0

    private fun isSystemDark(): Boolean =
        (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES

    private fun applyBarAppearance() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !darkTheme
            isAppearanceLightNavigationBars = !darkTheme
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.isNavigationBarContrastEnforced = false
    }

    private fun pushInsets() {
        if (::webView.isInitialized) {
            webView.evaluateJavascript("window.__setInsets && window.__setInsets($insetTop, $insetBottom)", null)
        }
    }

    // ---------- Files ----------

    private fun saveToDownloads(name: String, mime: String, bytes: ByteArray) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$DOWNLOAD_DIR")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: error("insert")
                contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                contentResolver.update(uri, values, null, null)
            } else {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED
                ) {
                    // Android 7–9 without storage permission: use the share sheet instead.
                    shareBytes(name, mime, bytes)
                    return
                }
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), DOWNLOAD_DIR)
                dir.mkdirs()
                FileOutputStream(uniqueFile(dir, name)).use { it.write(bytes) }
            }
            toast(getString(R.string.saved_to))
        } catch (e: Exception) {
            toast(getString(R.string.save_failed))
        }
    }

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name)
        val base = name.substringBeforeLast('.')
        val ext = name.substringAfterLast('.', "")
        var i = 1
        while (f.exists()) f = File(dir, if (ext.isEmpty()) "$base ($i)" else "$base ($i).$ext").also { i++ }
        return f
    }

    private fun shareBytes(name: String, mime: String, bytes: ByteArray) {
        val dir = File(cacheDir, "share").apply { mkdirs() }
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val file = File(dir, safe).apply { writeBytes(bytes) }
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri(safe, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runOnUiThread { startActivity(Intent.createChooser(send, getString(R.string.share_title))) }
    }

    private fun capturedPhotoExists(): Boolean =
        File(File(cacheDir, "camera"), "photo.jpg").let { it.exists() && it.length() > 0 }

    private fun launchChooser(content: Intent, withCamera: Boolean) {
        val chooser = Intent.createChooser(content, getString(R.string.choose_file))
        if (withCamera) {
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val photo = File(dir, "photo.jpg").apply { delete() }
            val uri = FileProvider.getUriForFile(this, "$packageName.files", photo)
            cameraUri = uri
            val capture = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                clipData = ClipData.newRawUri("photo", uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(capture))
        }
        try {
            fileChooserLauncher.launch(chooser)
        } catch (e: ActivityNotFoundException) {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
        }
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
        }
    }

    private fun hasCameraPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }

    private fun dialogTheme() =
        if (darkTheme) android.R.style.Theme_DeviceDefault_Dialog_Alert
        else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert

    // ---------- Shortcuts and widgets ----------

    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "agendapp") return
        // Links opened from outside (watch, browser): navigation only.
        if (intent.hasCategory(Intent.CATEGORY_BROWSABLE) && uri.host !in setOf("day", "plan", "new")) return
        setIntent(Intent(intent).setData(null)) // not run again after the activity is recreated
        if (uri.host == "backup") {
            calExecutor.execute { runBackupWithToast() }
            return
        }
        pendingAction = uri
        dispatchAction()
    }

    private fun dispatchAction() {
        val uri = pendingAction ?: return
        if (!pageReady || locked) return
        pendingAction = null
        val name = JSONObject.quote(uri.host.orEmpty())
        val arg = JSONObject.quote(uri.pathSegments.firstOrNull().orEmpty())
        webView.evaluateJavascript("window.__agAction && window.__agAction($name, $arg)", null)
    }

    private fun runBackupWithToast() {
        try {
            Backup.run(this)
            toast(getString(R.string.backup_done))
        } catch (e: Exception) {
            toast(getString(R.string.backup_failed, e.message ?: e.javaClass.simpleName))
        }
        js("window.__agSettingsChanged && window.__agSettingsChanged()")
    }

    // ---------- App lock ----------

    private fun authenticators() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    private fun lockStatus(): Int = BiometricManager.from(this).canAuthenticate(authenticators())

    private fun lockAvailable() = lockStatus() == BiometricManager.BIOMETRIC_SUCCESS

    // Without a screen lock (removed in the meantime) the app doesn't lock: it could never be opened again.
    private fun lockEnabled() = AppStore.lock(this).optBoolean("enabled") && lockAvailable()

    private fun applyRecentsPrivacy() {
        val hide = AppStore.lock(this).let { it.optBoolean("enabled") && it.optBoolean("hideRecents", true) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(!hide)
        } else if (hide) {
            window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }

    private fun setLocked(on: Boolean) {
        locked = on
        autoPrompt = on
        lockOverlay.visibility = if (on) View.VISIBLE else View.GONE
        webView.importantForAccessibility =
            if (on) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        if (!on) dispatchAction()
    }

    private fun promptUnlock() {
        if (!locked || prompting) return
        if (!lockEnabled()) { setLocked(false); return }
        authenticate(getString(R.string.lock_title)) { ok -> if (ok) setLocked(false) }
    }

    private fun authenticate(title: String, done: (Boolean) -> Unit) {
        if (prompting) return
        prompting = true
        val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                prompting = false
                done(true)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                prompting = false
                done(false)
            }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(getString(R.string.lock_subtitle))
                .setAllowedAuthenticators(authenticators())
                .setConfirmationRequired(false)
                .build(),
        )
    }

    private fun buildLockOverlay(): View {
        val d = resources.displayMetrics.density
        val onSurface = getColor(R.color.w_on)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(getColor(R.color.surface))
            isClickable = true
            isFocusable = true
            visibility = View.GONE
            addView(ImageView(this@MainActivity).apply {
                setImageResource(R.drawable.ic_w_lock)
                setColorFilter(getColor(R.color.w_primary))
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.w_square_tonal)
                setPadding((20 * d).toInt(), (20 * d).toInt(), (20 * d).toInt(), (20 * d).toInt())
            }, LinearLayout.LayoutParams((88 * d).toInt(), (88 * d).toInt()))
            addView(TextView(this@MainActivity).apply {
                text = getString(R.string.app_name)
                textSize = 28f
                setTextColor(onSurface)
                typeface = android.graphics.Typeface.create("google-sans-medium", android.graphics.Typeface.NORMAL)
                setPadding(0, (24 * d).toInt(), 0, (4 * d).toInt())
            })
            addView(TextView(this@MainActivity).apply {
                text = getString(R.string.lock_subtitle)
                textSize = 15f
                setTextColor(getColor(R.color.w_on_var))
            })
            addView(Button(this@MainActivity).apply {
                text = getString(R.string.lock_button)
                isAllCaps = false
                textSize = 16f
                setTextColor(getColor(R.color.w_on_primary))
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.w_pill_primary)
                setPadding((28 * d).toInt(), 0, (28 * d).toInt(), 0)
                setOnClickListener { promptUnlock() }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, (52 * d).toInt()).apply { topMargin = (32 * d).toInt() })
        }
    }

    private fun nativeSettings(): String {
        val lock = AppStore.lock(this)
        val status = lockStatus()
        lock.put("available", status == BiometricManager.BIOMETRIC_SUCCESS)
        lock.put("availMsg", when (status) {
            BiometricManager.BIOMETRIC_SUCCESS -> ""
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> getString(R.string.lock_unavailable)
            else -> getString(R.string.lock_no_hardware)
        })
        return JSONObject().put("backup", AppStore.backup(this)).put("lock", lock).toString()
    }

    // ---------- Phone calendar ----------

    /** Called off the main thread: waits for the user's answer if needed. */
    private fun ensureCalendarPermission(): Boolean {
        if (calendar.hasPermission()) return true
        val latch = CountDownLatch(1)
        runOnUiThread {
            calPermissionLatch = latch
            calendarPermissionLauncher.launch(arrayOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR))
        }
        latch.await()
        return calendar.hasPermission()
    }

    private fun js(code: String) = runOnUiThread { if (!isDestroyed) webView.evaluateJavascript(code, null) }

    private fun calendarTool(tool: String, args: JSONObject): String {
        if (!ensureCalendarPermission()) {
            throw CalendarSync.CalError("approval_required", getString(R.string.calendar_denied))
        }
        return when (tool) {
            "list_calendars" -> calendar.listCalendars().toString()
            "create_event" -> JSONObject().put("id", calendar.upsert(null, args)).toString()
            "update_event" -> JSONObject().put("id", calendar.upsert(args.optString("eventId"), args)).toString()
            else -> throw CalendarSync.CalError("unknown_tool", tool)
        }
    }

    private fun jsonList(json: String): List<String> =
        try {
            JSONArray(json).let { a -> (0 until a.length()).map { a.getString(it) } }
        } catch (_: Exception) {
            emptyList()
        }

    // ---------- WebChromeClient ----------

    private inner class Chrome : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            val accept = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }.filter { it.isNotEmpty() }
            val image = accept.isNotEmpty() && accept.all { it.startsWith("image/") }
            val content = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = if (image) "image/*" else "*/*"
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            val cameraAvailable = image && packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
            if (cameraAvailable && !hasCameraPermission()) {
                pendingChooser = content to true
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            } else {
                launchChooser(content, cameraAvailable)
            }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources) {
                request.deny()
                return
            }
            if (hasCameraPermission()) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            } else {
                pendingWebPermission?.deny()
                pendingWebPermission = request
                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }

        override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity, dialogTheme())
                .setMessage(message)
                .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                .setOnCancelListener { result.confirm() }
                .show()
            return true
        }

        override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean {
            AlertDialog.Builder(this@MainActivity, dialogTheme())
                .setMessage(message)
                .setPositiveButton(R.string.ok) { _, _ -> result.confirm() }
                .setNegativeButton(R.string.cancel) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }
                .show()
            return true
        }
    }

    // ---------- JavaScript bridge ----------

    @Suppress("unused")
    private inner class Bridge {
        @JavascriptInterface
        fun getSeedColor(): Int = lastSeed

        @JavascriptInterface
        fun getInsets(): String = """{"top":$insetTop,"bottom":$insetBottom}"""

        @JavascriptInterface
        fun setDarkTheme(dark: Boolean) = runOnUiThread {
            darkTheme = dark
            applyBarAppearance()
        }

        @JavascriptInterface
        fun setBackEnabled(enabled: Boolean) = runOnUiThread { backCallback.isEnabled = enabled }

        @JavascriptInterface
        fun saveFile(name: String, mime: String, base64: String) =
            saveToDownloads(name, mime, Base64.decode(base64, Base64.DEFAULT))

        @JavascriptInterface
        fun shareFile(name: String, mime: String, base64: String) =
            shareBytes(name, mime, Base64.decode(base64, Base64.DEFAULT))

        @JavascriptInterface
        fun shareText(title: String, text: String) = runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TEXT, text)
            }
            startActivity(Intent.createChooser(send, getString(R.string.share_title)))
        }

        @JavascriptInterface
        fun copyText(text: String) = runOnUiThread {
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("AgendApp", text))
            // Android 13+ already shows its own confirmation.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) toast(getString(R.string.copied))
        }

        /** Stands in for a "Google Calendar" connector: answers through window.__calDone(id, ok, json). */
        @JavascriptInterface
        fun calCall(id: Int, tool: String, args: String) = calExecutor.execute {
            val (ok, result) = try {
                true to calendarTool(tool, JSONObject(args))
            } catch (e: CalendarSync.CalError) {
                false to JSONObject().put("code", e.code).put("message", e.message).toString()
            } catch (e: Exception) {
                false to JSONObject().put("code", "calendar_error")
                    .put("message", getString(R.string.calendar_failed, e.message ?: e.javaClass.simpleName)).toString()
            }
            js("window.__calDone && window.__calDone($id, $ok, ${JSONObject.quote(result)})")
        }

        @JavascriptInterface
        fun getCalSync(): Boolean = calendar.deleteSync

        @JavascriptInterface
        fun setCalSync(on: Boolean) {
            calendar.deleteSync = on
            if (on) calExecutor.execute {
                if (!ensureCalendarPermission()) {
                    calendar.deleteSync = false
                    js("window.__calSyncState && window.__calSyncState(false)")
                }
            }
        }

        /** Keys of events deleted in the calendar (synchronous, read-only). */
        @JavascriptInterface
        fun calMissing(keys: String): String =
            try {
                JSONArray(calendar.missing(jsonList(keys))).toString()
            } catch (_: Exception) {
                "[]"
            }

        @JavascriptInterface
        fun calDelete(keys: String) = calExecutor.execute {
            if (!calendar.hasPermission()) return@execute
            try {
                val n = calendar.delete(jsonList(keys))
                if (n > 0) toast(resources.getQuantityString(R.plurals.calendar_deleted, n, n))
            } catch (_: Exception) {
            }
        }

        // ---------- Data, backup, lock, widgets ----------

        /** Copy of the data and of the formatted events (widgets, scheduled backups, watch). */
        @JavascriptInterface
        fun persist(state: String, feed: String) {
            val ctx = applicationContext
            calExecutor.execute {
                runCatching {
                    AppStore.writeAtomic(AppStore.stateFile(ctx), state)
                    AppStore.writeAtomic(AppStore.feedFile(ctx), feed)
                    Widgets.updateAll(ctx)
                    Backup.onDataChanged(ctx)
                    WatchSync.push(ctx)
                }
            }
        }

        @JavascriptInterface
        fun getNativeSettings(): String = nativeSettings()

        @JavascriptInterface
        fun setNativeSettings(json: String) {
            val patch = runCatching { JSONObject(json) }.getOrNull() ?: return
            patch.optJSONObject("backup")?.let {
                it.remove("last")
                AppStore.setBackup(this@MainActivity, it)
                Backup.schedule(this@MainActivity, replace = true)
            }
            patch.optJSONObject("lock")?.let {
                it.remove("enabled") // only through setLockEnabled, after authentication
                AppStore.setLock(this@MainActivity, it)
                runOnUiThread { applyRecentsPrivacy() }
            }
        }

        /** Turning the lock on or off requires authenticating first. */
        @JavascriptInterface
        fun setLockEnabled(on: Boolean) = runOnUiThread {
            if (!lockAvailable()) {
                js("window.__agSettingsChanged && window.__agSettingsChanged()")
                return@runOnUiThread
            }
            authenticate(getString(if (on) R.string.lock_enable_title else R.string.lock_disable_title)) { ok ->
                if (ok) {
                    AppStore.setLock(this@MainActivity, JSONObject().put("enabled", on))
                    applyRecentsPrivacy()
                }
                js("window.__agSettingsChanged && window.__agSettingsChanged()")
            }
        }

        @JavascriptInterface
        fun pickBackupFolder() = runOnUiThread {
            try {
                folderPicker.launch(null)
            } catch (_: ActivityNotFoundException) {
                toast(getString(R.string.backup_folder_lost))
            }
        }

        @JavascriptInterface
        fun openBackupFolder() = runOnUiThread {
            try {
                startActivity(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS))
            } catch (_: ActivityNotFoundException) {
            }
        }

        @JavascriptInterface
        fun backupNow() = calExecutor.execute { runBackupWithToast() }

        @JavascriptInterface
        fun listWidgets(): String = Widgets.list(this@MainActivity).toString()

        @JavascriptInterface
        fun pinWidget(kind: String) = runOnUiThread {
            if (!Widgets.requestPin(this@MainActivity, kind)) toast(getString(R.string.w_pin_unsupported))
        }

        @JavascriptInterface
        fun setWidgetCfg(id: Int, json: String) {
            val kind = Widgets.kindOf(this@MainActivity, id) ?: return
            val patch = runCatching { JSONObject(json) }.getOrNull() ?: return
            AppStore.setWidgetCfg(this@MainActivity, id, kind, patch)
            Widgets.update(this@MainActivity, id)
        }

        /** Debug builds: renders the widgets off-screen (cache/wpreview) to check them. */
        @JavascriptInterface
        fun debugWidgetPreview(): String {
            if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return "[]"
            return JSONArray((WidgetPreview.renderAll(this@MainActivity, false) + WidgetPreview.renderAll(this@MainActivity, true)).map { it.name }).toString()
        }

        @JavascriptInterface
        fun watchInfo(): String = WatchSync.info(this@MainActivity)

        @JavascriptInterface
        fun watchRefresh() = WatchSync.refreshNodes(applicationContext) {
            js("window.__agSettingsChanged && window.__agSettingsChanged()")
        }

        @JavascriptInterface
        fun watchSyncNow() = calExecutor.execute {
            WatchSync.push(applicationContext, force = true) {
                toast(getString(R.string.watch_sent))
                js("window.__agSettingsChanged && window.__agSettingsChanged()")
            }
        }

        @JavascriptInterface
        fun keepScreenOn(on: Boolean) = runOnUiThread {
            if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        /**
         * Per-app language for the native parts (widgets, shortcuts, notifications), chosen in the
         * app's settings; "" follows the system. Android 13+ only: older versions follow the system.
         */
        @JavascriptInterface
        fun setAppLanguage(tag: String) = runOnUiThread {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@runOnUiThread
            val wanted = if (tag.isBlank()) android.os.LocaleList.getEmptyLocaleList() else android.os.LocaleList.forLanguageTags(tag)
            val manager = getSystemService(android.app.LocaleManager::class.java)
            if (manager.applicationLocales != wanted) {
                manager.applicationLocales = wanted
                Widgets.updateAll(applicationContext)
            }
        }
    }
}
