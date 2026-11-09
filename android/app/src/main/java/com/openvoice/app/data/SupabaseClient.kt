package com.openvoice.app.data

import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.postgrest

object SupabaseClient {
    const val SUPABASE_URL = "https://pqsmoxoujdvihfiinmbu.supabase.co"
    const val SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxc21veG91amR2aWhmaWlubWJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxMDMzNTksImV4cCI6MjEwOTY3OTM1OX0.ObzGCBK1kyeCBG1YtOv4hQOESeu2pxR7eG_DXQMz5kk"

    val client = createSupabaseClient(
        supabaseUrl = SUPABASE_URL,
        supabaseKey = SUPABASE_ANON_KEY
    ) {
        install(Auth)
        install(Postgrest)
    }

    val auth get() = client.auth
    val postgrest get() = client.postgrest
}
