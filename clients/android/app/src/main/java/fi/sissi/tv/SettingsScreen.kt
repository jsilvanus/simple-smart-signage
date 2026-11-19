package fi.sissi.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import fi.sissi.tv.data.SCREEN_ID_REGEX
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Full-screen, D-pad navigable configuration UI shown on first launch
 * or when triggered via Menu / Settings / long-press Back.
 */
@Composable
fun SettingsScreen(
    initialServerUrl: String,
    initialScreenId: String,
    onSaveAndStart: (serverUrl: String, screenId: String) -> Unit,
) {
    var serverUrl by remember(initialServerUrl) { mutableStateOf(initialServerUrl) }
    var screenId by remember(initialScreenId) { mutableStateOf(initialScreenId) }
    var serverUrlError by remember { mutableStateOf(false) }
    var screenIdError by remember { mutableStateOf(false) }

    val serverFocus = remember { FocusRequester() }
    val screenFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        if (initialServerUrl.isBlank()) {
            serverFocus.requestFocus()
        } else {
            screenFocus.requestFocus()
        }
    }

    fun submit() {
        val normalizedServer = serverUrl.trim().trimEnd('/')
        val normalizedScreen = screenId.trim()
        val parsedUrl = normalizedServer.toHttpUrlOrNull()
        val validUrl = parsedUrl != null && (parsedUrl.scheme == "http" || parsedUrl.scheme == "https")
        val validScreen = SCREEN_ID_REGEX.matches(normalizedScreen)

        serverUrlError = !validUrl
        screenIdError = !validScreen
        if (validUrl && validScreen) {
            onSaveAndStart(normalizedServer, normalizedScreen)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0A0A0A))
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 560.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(R.string.settings_title),
                color = Color.White,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
            )

            Text(
                text = stringResource(R.string.settings_subtitle),
                color = Color(0xFFAAAAAA),
                fontSize = 16.sp,
            )

            Spacer(Modifier.height(4.dp))

            OutlinedTextField(
                value = serverUrl,
                onValueChange = {
                    serverUrl = it
                    serverUrlError = false
                },
                label = { Text(stringResource(R.string.label_server_url), color = Color(0xFFAAAAAA)) },
                placeholder = { Text(stringResource(R.string.hint_server_url), color = Color(0xFF555555)) },
                isError = serverUrlError,
                supportingText = if (serverUrlError) {
                    { Text(stringResource(R.string.error_invalid_server_url), color = MaterialTheme.colorScheme.error) }
                } else {
                    null
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(
                    onNext = { screenFocus.requestFocus() },
                ),
                colors = tvTextFieldColors(),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(serverFocus),
            )

            OutlinedTextField(
                value = screenId,
                onValueChange = {
                    screenId = it
                    screenIdError = false
                },
                label = { Text(stringResource(R.string.label_screen_id), color = Color(0xFFAAAAAA)) },
                placeholder = { Text(stringResource(R.string.hint_screen_id), color = Color(0xFF555555)) },
                isError = screenIdError,
                supportingText = if (screenIdError) {
                    { Text(stringResource(R.string.error_invalid_screen_id), color = MaterialTheme.colorScheme.error) }
                } else {
                    null
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(
                    onDone = { submit() },
                ),
                colors = tvTextFieldColors(),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(screenFocus),
            )

            Spacer(Modifier.height(4.dp))

            Button(
                onClick = { submit() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF1A73E8),
                    contentColor = Color.White,
                ),
            ) {
                Text(
                    text = stringResource(R.string.btn_save_start),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun tvTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Color(0xFF1A73E8),
    unfocusedBorderColor = Color(0xFF444444),
    focusedTextColor = Color.White,
    unfocusedTextColor = Color(0xFFCCCCCC),
    cursorColor = Color(0xFF1A73E8),
    focusedLabelColor = Color(0xFF1A73E8),
)
