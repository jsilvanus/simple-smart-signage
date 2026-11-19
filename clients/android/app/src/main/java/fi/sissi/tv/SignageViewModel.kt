package fi.sissi.tv

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import fi.sissi.tv.data.MediaCacheManager
import fi.sissi.tv.data.Playlist
import fi.sissi.tv.data.PlaylistEntry
import fi.sissi.tv.data.PlaylistSyncer
import fi.sissi.tv.data.SCREEN_ID_REGEX
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

data class SignageUiState(
    val serverUrl: String = "",
    val screenId: String = "",
    val needsSetup: Boolean = true,
    val activePlaylist: Playlist? = null,
    val pendingPlaylist: Playlist? = null,
    val currentIndex: Int = 0,
    val mediaDir: File,
) {
    val currentEntry: PlaylistEntry?
        get() = activePlaylist?.entries?.getOrNull(currentIndex)

    val nextEntry: PlaylistEntry?
        get() {
            val pending = pendingPlaylist
            if (pending != null && pending.entries.isNotEmpty()) {
                return pending.entries.first()
            }
            val active = activePlaylist ?: return null
            if (active.entries.isEmpty()) return null
            return active.entries[(currentIndex + 1) % active.entries.size]
        }
}

class SignageViewModel(application: Application) : AndroidViewModel(application) {

    private val prefs = application.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val filesDir: File = application.filesDir

    private val okHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val cacheManager = MediaCacheManager(filesDir, okHttpClient)
    private val syncer = PlaylistSyncer(filesDir, okHttpClient, cacheManager)

    private val _state = MutableStateFlow(
        SignageUiState(mediaDir = cacheManager.mediaDir),
    )
    val state: StateFlow<SignageUiState> = _state.asStateFlow()

    private var syncJob: Job? = null

    init {
        val savedServer = prefs.getString(KEY_SERVER_URL, "")?.trim().orEmpty()
        val savedScreen = prefs.getString(KEY_SCREEN_ID, "")?.trim().orEmpty()

        viewModelScope.launch(Dispatchers.IO) {
            cacheManager.cleanupTempFiles()
        }

        if (isValidConfig(savedServer, savedScreen)) {
            _state.update {
                it.copy(
                    serverUrl = savedServer,
                    screenId = savedScreen,
                    needsSetup = false,
                )
            }
            loadCachedAndStartSync(savedServer, savedScreen)
        }
    }

    fun saveAndStart(serverUrl: String, screenId: String) {
        val normalizedServer = serverUrl.trim().trimEnd('/')
        val normalizedScreen = screenId.trim()
        if (!isValidConfig(normalizedServer, normalizedScreen)) return

        val previous = _state.value
        val configChanged = previous.serverUrl != normalizedServer || previous.screenId != normalizedScreen

        prefs.edit()
            .putString(KEY_SERVER_URL, normalizedServer)
            .putString(KEY_SCREEN_ID, normalizedScreen)
            .apply()

        if (configChanged) {
            syncJob?.cancel()
            _state.update {
                it.copy(
                    serverUrl = normalizedServer,
                    screenId = normalizedScreen,
                    needsSetup = false,
                    activePlaylist = null,
                    pendingPlaylist = null,
                    currentIndex = 0,
                )
            }
            viewModelScope.launch(Dispatchers.IO) {
                syncer.clearCachedPlaylist()
            }
            startSyncLoop(normalizedServer, normalizedScreen, initialVersion = null)
        } else {
            _state.update { it.copy(needsSetup = false) }
            if (syncJob?.isActive != true) {
                startSyncLoop(normalizedServer, normalizedScreen, initialVersion = previous.activePlaylist?.version)
            }
        }
    }

    fun openSettings() {
        _state.update { it.copy(needsSetup = true) }
    }

    fun advanceToNext() {
        _state.update { current ->
            val pending = current.pendingPlaylist
            if (pending != null) {
                current.copy(
                    activePlaylist = pending,
                    pendingPlaylist = null,
                    currentIndex = 0,
                )
            } else {
                val entries = current.activePlaylist?.entries
                if (entries.isNullOrEmpty()) {
                    current.copy(currentIndex = 0)
                } else {
                    current.copy(currentIndex = (current.currentIndex + 1) % entries.size)
                }
            }
        }
    }

    private fun loadCachedAndStartSync(serverUrl: String, screenId: String) {
        viewModelScope.launch(Dispatchers.IO) {
            val cached = syncer.loadCachedPlaylist(serverUrl)
            if (cached != null) {
                _state.update { current ->
                    if (current.activePlaylist == null) {
                        current.copy(activePlaylist = cached, currentIndex = 0)
                    } else {
                        current
                    }
                }
            }
            startSyncLoop(serverUrl, screenId, initialVersion = cached?.version)
        }
    }

    private fun startSyncLoop(serverUrl: String, screenId: String, initialVersion: Long?) {
        syncJob?.cancel()
        syncJob = viewModelScope.launch(Dispatchers.IO) {
            syncer.runSyncLoop(
                serverUrl = serverUrl,
                screenId = screenId,
                initialVersion = initialVersion,
                activeFilenamesProvider = { activeFilenames() },
                onPlaylistUpdated = { newPlaylist -> onPlaylistSynced(newPlaylist) },
            )
        }
    }

    private fun onPlaylistSynced(newPlaylist: Playlist) {
        _state.update { current ->
            val active = current.activePlaylist
            if (active == null || active.entries.isEmpty()) {
                current.copy(
                    activePlaylist = newPlaylist,
                    pendingPlaylist = null,
                    currentIndex = 0,
                )
            } else {
                current.copy(pendingPlaylist = newPlaylist)
            }
        }
    }

    private fun activeFilenames(): Set<String> {
        val current = _state.value
        val active = current.activePlaylist?.entries?.map { it.localFilename }.orEmpty()
        val pending = current.pendingPlaylist?.entries?.map { it.localFilename }.orEmpty()
        return (active + pending).toSet()
    }

    private fun isValidConfig(serverUrl: String, screenId: String): Boolean {
        val httpUrl = serverUrl.toHttpUrlOrNull() ?: return false
        if (httpUrl.scheme != "http" && httpUrl.scheme != "https") return false
        return SCREEN_ID_REGEX.matches(screenId)
    }

    override fun onCleared() {
        syncJob?.cancel()
        super.onCleared()
    }

    companion object {
        private const val PREFS_NAME = "sissi_tv_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_SCREEN_ID = "screen_id"
    }
}
