package com.openvoice.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.openvoice.app.data.SupabaseClient
import com.openvoice.app.data.models.PostRecord
import com.openvoice.app.data.models.UserProfile
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.query.Order
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class AppViewModel : ViewModel() {

    private val _isLoggedIn = MutableStateFlow(false)
    val isLoggedIn: StateFlow<Boolean> = _isLoggedIn.asStateFlow()

    private val _authError = MutableStateFlow<String?>(null)
    val authError: StateFlow<String?> = _authError.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _userProfile = MutableStateFlow<UserProfile?>(null)
    val userProfile: StateFlow<UserProfile?> = _userProfile.asStateFlow()

    private val _posts = MutableStateFlow<List<PostRecord>>(emptyList())
    val posts: StateFlow<List<PostRecord>> = _posts.asStateFlow()

    init {
        checkCurrentSession()
    }

    fun checkCurrentSession() {
        viewModelScope.launch {
            try {
                val user = SupabaseClient.auth.currentUserOrNull()
                if (user != null) {
                    _isLoggedIn.value = true
                    loadProfile(user.id)
                    loadPosts()
                } else {
                    _isLoggedIn.value = false
                }
            } catch (e: Exception) {
                _isLoggedIn.value = false
            }
        }
    }

    fun login(emailInput: String, passwordInput: String) {
        if (emailInput.isBlank() || passwordInput.isBlank()) {
            _authError.value = "Please enter email and password."
            return
        }

        viewModelScope.launch {
            _isLoading.value = true
            _authError.value = null
            try {
                SupabaseClient.auth.signInWith(Email) {
                    email = emailInput.trim()
                    password = passwordInput
                }
                val user = SupabaseClient.auth.currentUserOrNull()
                if (user != null) {
                    _isLoggedIn.value = true
                    loadProfile(user.id)
                    loadPosts()
                }
            } catch (e: Exception) {
                _authError.value = e.localizedMessage ?: "Login failed. Please check credentials."
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun signUp(emailInput: String, passwordInput: String) {
        if (emailInput.isBlank() || passwordInput.isBlank()) {
            _authError.value = "Please enter email and password."
            return
        }

        viewModelScope.launch {
            _isLoading.value = true
            _authError.value = null
            try {
                SupabaseClient.auth.signUpWith(Email) {
                    email = emailInput.trim()
                    password = passwordInput
                }
                val user = SupabaseClient.auth.currentUserOrNull()
                if (user != null) {
                    _isLoggedIn.value = true
                    loadProfile(user.id)
                    loadPosts()
                } else {
                    _authError.value = "Signup complete. Please check your email to verify."
                }
            } catch (e: Exception) {
                _authError.value = e.localizedMessage ?: "Signup failed."
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun loadProfile(userId: String) {
        viewModelScope.launch {
            try {
                val profile = SupabaseClient.postgrest.from("profiles")
                    .select {
                        filter {
                            eq("id", userId)
                        }
                    }.decodeList<UserProfile>().firstOrNull()

                _userProfile.value = profile
            } catch (e: Exception) {
                // Profile load error handled gracefully
            }
        }
    }

    fun loadPosts() {
        viewModelScope.launch {
            try {
                val list = SupabaseClient.postgrest.from("posts")
                    .select {
                        order("created_at", Order.DESCENDING)
                    }.decodeList<PostRecord>()

                _posts.value = list
            } catch (e: Exception) {
                // Post load fallback
            }
        }
    }

    fun createPost(content: String, onSuccess: () -> Unit) {
        if (content.isBlank()) return
        val user = SupabaseClient.auth.currentUserOrNull() ?: return

        viewModelScope.launch {
            try {
                val newPost = PostRecord(
                    userId = user.id,
                    content = content.trim()
                )
                SupabaseClient.postgrest.from("posts").insert(newPost)
                loadPosts()
                onSuccess()
            } catch (e: Exception) {
                // Handle error
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            try {
                SupabaseClient.auth.signOut()
            } catch (_: Exception) {}
            _isLoggedIn.value = false
            _userProfile.value = null
        }
    }
}
