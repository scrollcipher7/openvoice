package com.openvoice.app.data.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class UserProfile(
    val id: String = "",
    val username: String? = null,
    @SerialName("display_name") val displayName: String? = null,
    val bio: String? = null,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    @SerialName("cover_url") val coverUrl: String? = null,
    @SerialName("is_admin") val isAdmin: Boolean? = false,
    val hometown: String? = null,
    @SerialName("relationship_status") val relationshipStatus: String? = null,
    @SerialName("looking_for") val lookingFor: String? = null,
    val interests: String? = null,
    @SerialName("favorite_music") val favoriteMusic: String? = null,
    @SerialName("favorite_movies") val favoriteMovies: String? = null,
    val website: String? = null
)

@Serializable
data class PostRecord(
    val id: Long = 0,
    @SerialName("user_id") val userId: String = "",
    val content: String = "",
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("link_url") val linkUrl: String? = null,
    @SerialName("created_at") val createdAt: String = ""
)
