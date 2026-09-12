package com.chainward.app;

import android.os.Bundle;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebViewCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebViewCompat.setWebAuthenticationSupport(
                this.bridge.getWebView(),
                WebViewFeature.WEB_AUTHENTICATION_SUPPORT_APP
            );
        }
    }
}
