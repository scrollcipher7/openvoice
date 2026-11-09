package com.openvoice.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.openvoice.app.ui.screens.AuthScreen
import com.openvoice.app.ui.screens.HomeScreen
import com.openvoice.app.ui.screens.ProfileScreen
import com.openvoice.app.ui.theme.*

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    object Home : Screen("home", "HOME", Icons.Default.Home)
    object Reels : Screen("reels", "REELS", Icons.Default.PlayArrow)
    object Live : Screen("live", "LIVE", Icons.Default.Videocam)
    object Dating : Screen("dating", "DATING", Icons.Default.Favorite)
    object Alerts : Screen("alerts", "ALERTS", Icons.Default.Notifications)
    object Profile : Screen("profile", "PROFILE", Icons.Default.Person)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OpenVoiceApp(
    viewModel: AppViewModel = viewModel()
) {
    val isLoggedIn by viewModel.isLoggedIn.collectAsState()
    val authError by viewModel.authError.collectAsState()
    val userProfile by viewModel.userProfile.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    var currentScreen by remember { mutableStateOf<Screen>(Screen.Home) }

    val items = listOf(
        Screen.Home,
        Screen.Reels,
        Screen.Live,
        Screen.Dating,
        Screen.Alerts,
        Screen.Profile
    )

    OpenVoiceTheme {
        if (!isLoggedIn) {
            AuthScreen(
                onLogin = { email, pass -> viewModel.login(email, pass) },
                onSignup = { email, pass -> viewModel.signUp(email, pass) },
                onGoogleLogin = { /* Google sign-in */ },
                errorMessage = authError.orEmpty(),
                isLoading = isLoading
            )
        } else {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = { Text("OPENVOICE", fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, color = Gold) },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceDark)
                    )
                },
                bottomBar = {
                    NavigationBar(
                        containerColor = SurfaceDark,
                        contentColor = TextSecondary
                    ) {
                        items.forEach { screen ->
                            NavigationBarItem(
                                icon = { Icon(screen.icon, contentDescription = screen.title) },
                                label = { Text(screen.title, fontSize = 10.sp) },
                                selected = currentScreen == screen,
                                onClick = { currentScreen = screen },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Gold,
                                    selectedTextColor = Gold,
                                    unselectedIconColor = TextSecondary,
                                    unselectedTextColor = TextSecondary,
                                    indicatorColor = SurfaceVariantDark
                                )
                            )
                        }
                    }
                }
            ) { innerPadding ->
                Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
                    when (currentScreen) {
                        is Screen.Home -> HomeScreen()
                        is Screen.Profile -> ProfileScreen(
                            profile = userProfile,
                            isLoading = isLoading,
                            onSignOut = { viewModel.signOut() }
                        )
                        else -> {
                            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text(text = "${currentScreen.title} Screen", color = TextPrimary, fontSize = 20.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}
