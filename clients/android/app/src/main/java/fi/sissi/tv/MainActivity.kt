package fi.sissi.tv

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : ComponentActivity() {

    private val viewModel: SignageViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableImmersiveMode()

        intent?.data?.let { handleDeepLink(it) }

        setContent {
            val state by viewModel.state.collectAsState()
            SissiTvApp(
                state = state,
                onSaveAndStart = viewModel::saveAndStart,
                onAdvance = viewModel::advanceToNext,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.data?.let { handleDeepLink(it) }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            enableImmersiveMode()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            viewModel.openSettings()
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_BACK && !viewModel.state.value.needsSetup) {
            event?.startTracking()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && !viewModel.state.value.needsSetup) {
            viewModel.openSettings()
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    private fun enableImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun handleDeepLink(uri: Uri) {
        if (uri.scheme != "sissi-tv" || uri.host != "screen") return
        val server = uri.getQueryParameter("server") ?: return
        val screen = uri.getQueryParameter("screen") ?: return
        viewModel.saveAndStart(server, screen)
    }
}

@Composable
private fun SissiTvApp(
    state: SignageUiState,
    onSaveAndStart: (serverUrl: String, screenId: String) -> Unit,
    onAdvance: () -> Unit,
) {
    AnimatedContent(
        targetState = state.needsSetup,
        transitionSpec = { fadeIn() togetherWith fadeOut() },
        label = "sissi_root_transition",
    ) { showSettings ->
        if (showSettings) {
            SettingsScreen(
                initialServerUrl = state.serverUrl,
                initialScreenId = state.screenId,
                onSaveAndStart = onSaveAndStart,
            )
        } else {
            PlayerScreen(
                state = state,
                onAdvance = onAdvance,
            )
        }
    }
}
