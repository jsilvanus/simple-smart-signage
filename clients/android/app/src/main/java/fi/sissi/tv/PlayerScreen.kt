package fi.sissi.tv

import android.net.Uri
import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import fi.sissi.tv.data.MediaKind
import fi.sissi.tv.data.PlaylistEntry
import kotlinx.coroutines.delay
import java.io.File

private data class SlideKey(
    val version: Long,
    val index: Int,
    val entry: PlaylistEntry,
    val file: File,
)

/**
 * Full-screen signage player on a neutral `#000` background.
 * Renders images with a 500ms Crossfade + Coil preloading, and videos with a
 * single Media3 ExoPlayer instance. Renders only black when no playlist is ready.
 */
@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    state: SignageUiState,
    onAdvance: () -> Unit,
) {
    val context = LocalContext.current
    val currentOnAdvance by rememberUpdatedState(onAdvance)
    val currentState by rememberUpdatedState(state)

    val imageLoader = remember(context) { ImageLoader(context) }
    val exoPlayer = remember(context) {
        ExoPlayer.Builder(context).build().apply {
            repeatMode = Player.REPEAT_MODE_OFF
        }
    }

    var videoLoopGeneration by remember { mutableIntStateOf(0) }

    DisposableEffect(exoPlayer) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) {
                    val s = currentState
                    val singleVideo = s.activePlaylist?.entries?.size == 1 && s.pendingPlaylist == null
                    if (singleVideo) {
                        exoPlayer.seekTo(0)
                        exoPlayer.play()
                        videoLoopGeneration++
                    } else {
                        currentOnAdvance()
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                currentOnAdvance()
            }
        }
        exoPlayer.addListener(listener)
        onDispose {
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    val activePlaylist = state.activePlaylist
    val entry = state.currentEntry

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        if (activePlaylist == null || activePlaylist.entries.isEmpty() || entry == null) {
            LaunchedEffect(Unit) {
                exoPlayer.stop()
                exoPlayer.clearMediaItems()
            }
            return@Box
        }

        val mediaFile = File(state.mediaDir, entry.localFilename)
        val slideKey = SlideKey(
            version = activePlaylist.version,
            index = state.currentIndex,
            entry = entry,
            file = mediaFile,
        )

        if (!mediaFile.isFile || mediaFile.length() == 0L) {
            LaunchedEffect(slideKey) {
                exoPlayer.stop()
                delay(100L)
                currentOnAdvance()
            }
            return@Box
        }

        when (entry.kind) {
            MediaKind.IMAGE -> {
                LaunchedEffect(slideKey) {
                    exoPlayer.stop()
                    exoPlayer.clearMediaItems()

                    val next = state.nextEntry
                    if (next != null && next.kind == MediaKind.IMAGE) {
                        val nextFile = File(state.mediaDir, next.localFilename)
                        if (nextFile.isFile) {
                            imageLoader.enqueue(
                                ImageRequest.Builder(context)
                                    .data(nextFile)
                                    .build(),
                            )
                        }
                    }

                    delay(entry.seconds * 1000L)
                    currentOnAdvance()
                }

                Crossfade(
                    targetState = slideKey,
                    animationSpec = tween(durationMillis = 500),
                    label = "image_crossfade",
                ) { slide ->
                    AsyncImage(
                        model = slide.file,
                        imageLoader = imageLoader,
                        contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color.Black),
                    )
                }
            }

            MediaKind.VIDEO -> {
                LaunchedEffect(slideKey) {
                    exoPlayer.setMediaItem(MediaItem.fromUri(Uri.fromFile(mediaFile)))
                    exoPlayer.prepare()
                    exoPlayer.playWhenReady = true
                }

                LaunchedEffect(slideKey, videoLoopGeneration) {
                    delay((entry.seconds + 5L) * 1000L)
                    currentOnAdvance()
                }

                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT,
                            )
                            useController = false
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                            setShutterBackgroundColor(android.graphics.Color.BLACK)
                            player = exoPlayer
                        }
                    },
                    update = { view ->
                        if (view.player !== exoPlayer) {
                            view.player = exoPlayer
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}
