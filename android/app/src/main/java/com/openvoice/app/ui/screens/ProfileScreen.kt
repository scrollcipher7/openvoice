package com.openvoice.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.openvoice.app.data.models.UserProfile
import com.openvoice.app.ui.theme.*

@Composable
fun ProfileScreen(
    profile: UserProfile?,
    isLoading: Boolean,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (isLoading && profile == null) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(BackgroundDark),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = Gold)
        }
        return
    }

    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .verticalScroll(scrollState)
    ) {
        // Cover Photo Banner
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(150.dp)
                .background(SurfaceVariantDark)
        ) {
            if (!profile?.coverUrl.isNullOrEmpty()) {
                AsyncImage(
                    model = profile?.coverUrl,
                    contentDescription = "Cover Photo",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }

        // Header with Avatar and Names
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
        ) {
            // Overlapping Avatar
            Box(
                modifier = Modifier
                    .offset(y = (-45).dp)
                    .size(90.dp)
                    .clip(CircleShape)
                    .background(SurfaceDark)
                    .border(3.dp, Gold, CircleShape),
                contentAlignment = Alignment.Center
            ) {
                if (!profile?.avatarUrl.isNullOrEmpty()) {
                    AsyncImage(
                        model = profile?.avatarUrl,
                        contentDescription = "Avatar",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    val initials = (profile?.displayName ?: profile?.username ?: "OV")
                        .take(2)
                        .uppercase()
                    Text(
                        text = initials,
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Bold,
                        color = Gold
                    )
                }
            }

            // Names & Admin Badge
            Column(modifier = Modifier.offset(y = (-35).dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = profile?.displayName ?: profile?.username ?: "OpenVoice Member",
                        fontSize = 24.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    if (profile?.isAdmin == true) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Surface(
                            shape = RoundedCornerShape(4.dp),
                            color = Red,
                            modifier = Modifier.padding(2.dp)
                        ) {
                            Text(
                                text = "ADMIN",
                                color = Color.White,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                }

                if (!profile?.username.isNullOrEmpty()) {
                    Text(
                        text = "@${profile?.username}",
                        fontSize = 14.sp,
                        color = Gold
                    )
                }

                if (!profile?.bio.isNullOrEmpty()) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = profile?.bio.orEmpty(),
                        fontSize = 14.sp,
                        color = TextSecondary,
                        lineHeight = 20.sp
                    )
                }
            }
        }

        // Details Section Cards
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .offset(y = (-20).dp)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            ProfileInfoSection(title = "ABOUT") {
                profile?.hometown?.let { ProfileRow(label = "Hometown", value = it) }
                profile?.relationshipStatus?.let { ProfileRow(label = "Relationship", value = it) }
                profile?.lookingFor?.let { ProfileRow(label = "Looking For", value = it) }
                profile?.website?.let { ProfileRow(label = "Website", value = it) }
                if (profile?.hometown == null && profile?.relationshipStatus == null && profile?.website == null) {
                    Text("No bio information provided yet.", fontSize = 13.sp, color = TextSecondary)
                }
            }

            if (!profile?.interests.isNullOrEmpty()) {
                ProfileInfoSection(title = "INTERESTS") {
                    Text(profile?.interests.orEmpty(), fontSize = 13.sp, color = TextPrimary)
                }
            }

            if (!profile?.favoriteMusic.isNullOrEmpty() || !profile?.favoriteMovies.isNullOrEmpty()) {
                ProfileInfoSection(title = "FAVORITES") {
                    profile?.favoriteMusic?.let { ProfileRow(label = "Music", value = it) }
                    profile?.favoriteMovies?.let { ProfileRow(label = "Movies", value = it) }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Sign Out Button
            OutlinedButton(
                onClick = onSignOut,
                border = BorderStroke(1.dp, Red),
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Red),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
            ) {
                Icon(Icons.Default.ExitToApp, contentDescription = "Sign Out", modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("SIGN OUT", fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }

            Spacer(modifier = Modifier.height(40.dp))
        }
    }
}

@Composable
private fun ProfileInfoSection(
    title: String,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceDark),
        border = BorderStroke(1.dp, BorderColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Gold)
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text(
                    text = title,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = BackgroundDark
                )
            }
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
                content = content
            )
        }
    }
}

@Composable
private fun ProfileRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(text = "$label: ", fontSize = 13.sp, color = TextSecondary, fontWeight = FontWeight.Medium)
        Text(text = value, fontSize = 13.sp, color = TextPrimary)
    }
}
