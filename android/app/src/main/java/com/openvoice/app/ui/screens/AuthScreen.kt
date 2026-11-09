package com.openvoice.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.openvoice.app.ui.theme.*

@Composable
fun AuthScreen(
    onLogin: (String, String) -> Unit,
    onSignup: (String, String) -> Unit,
    onGoogleLogin: () -> Unit,
    errorMessage: String,
    isLoading: Boolean = false
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var agreed by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BackgroundDark)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Logo & Title
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = Gold,
            modifier = Modifier.size(90.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(text = "OV", fontSize = 36.sp, fontWeight = FontWeight.Bold, color = BackgroundDark)
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "OPENVOICE",
            fontSize = 32.sp,
            fontWeight = FontWeight.Black,
            color = TextPrimary,
            letterSpacing = 2.sp
        )
        Text(
            text = "SPEAK YOUR TRUTH. NO CENSORS.",
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = Red,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 4.dp, bottom = 24.dp)
        )

        // Auth Form Card
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = SurfaceDark),
            border = BorderStroke(1.dp, BorderColor),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = { Text("Email", color = TextSecondary) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Gold,
                        unfocusedBorderColor = BorderColor,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Gold,
                        focusedContainerColor = SurfaceVariantDark,
                        unfocusedContainerColor = SurfaceVariantDark
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = { Text("Password", color = TextSecondary) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Gold,
                        unfocusedBorderColor = BorderColor,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        cursorColor = Gold,
                        focusedContainerColor = SurfaceVariantDark,
                        unfocusedContainerColor = SurfaceVariantDark
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                Button(
                    onClick = { onLogin(email, password) },
                    enabled = !isLoading,
                    colors = ButtonDefaults.buttonColors(containerColor = Gold),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(color = BackgroundDark, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Text("LOG IN", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = BackgroundDark)
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(vertical = 4.dp)
                ) {
                    Checkbox(
                        checked = agreed,
                        onCheckedChange = { agreed = it },
                        colors = CheckboxDefaults.colors(checkedColor = Gold)
                    )
                    Text(
                        text = "I am 18 or older and I agree to the OpenVoice rules.",
                        fontSize = 12.sp,
                        color = TextSecondary
                    )
                }

                OutlinedButton(
                    onClick = { onSignup(email, password) },
                    enabled = agreed && !isLoading,
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, Gold),
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("CREATE ACCOUNT", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Gold)
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(vertical = 8.dp)
                ) {
                    Divider(modifier = Modifier.weight(1f), color = BorderColor)
                    Text(" OR CONTINUE WITH ", fontSize = 11.sp, color = TextSecondary, modifier = Modifier.padding(horizontal = 8.dp))
                    Divider(modifier = Modifier.weight(1f), color = BorderColor)
                }

                Button(
                    onClick = onGoogleLogin,
                    enabled = agreed && !isLoading,
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().height(50.dp)
                ) {
                    Text("Continue with Google", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.Black)
                }

                if (errorMessage.isNotEmpty()) {
                    Text(
                        text = errorMessage,
                        color = Red,
                        fontSize = 13.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                    )
                }
            }
        }
    }
}
