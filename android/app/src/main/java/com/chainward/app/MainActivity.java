package com.chainward.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                this.bridge.getWebView().getSettings(),
                WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            );
        }
    }
}
