package com.openvoice.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        bridge?.webView?.let { webView ->
            val defaultUa = webView.settings.userAgentString
            val customUa = defaultUa.replace("; wv", "").replace("Version/4.0 ", "")
            webView.settings.userAgentString = customUa
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
        }
    }
}
