package com.chainward.app;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final long MIN_SPLASH_DISPLAY_MS = 3000;
    private static final long SPLASH_SAFETY_TIMEOUT_MS = 8000;

    private volatile boolean splashOverlayAttached = false;
    private View splashOverlay;
    private long splashShownAtElapsed;
    private boolean splashHideRequested = false;

    private final Handler splashHandler = new Handler(Looper.getMainLooper());
    private final Runnable splashSafetyRunnable = this::performSplashHide;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        // Keeps Android's own pre-app splash frozen on screen until our custom
        // overlay is fully attached underneath it, so the handoff between the
        // two has zero gap instead of flashing bare content in between.
        splashScreen.setKeepOnScreenCondition(() -> !splashOverlayAttached);

        registerPlugin(AppSplashPlugin.class);
        super.onCreate(savedInstanceState);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                this.bridge.getWebView().getSettings(),
                WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            );
        }

        showNativeSplash();
    }

    private void showNativeSplash() {
        View overlay = LayoutInflater.from(this).inflate(R.layout.view_splash_overlay, null);
        ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
        decorView.addView(overlay, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splashOverlay = overlay;
        splashShownAtElapsed = SystemClock.elapsedRealtime();

        View logo = overlay.findViewById(R.id.splash_logo);
        View title = overlay.findViewById(R.id.splash_title);
        View pulseBar = overlay.findViewById(R.id.splash_pulse_bar);

        logo.setScaleX(0.85f);
        logo.setScaleY(0.85f);
        title.setTranslationY(24f);

        logo.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(80).setDuration(520).setInterpolator(new DecelerateInterpolator()).start();

        title.animate().alpha(1f).translationY(0f).setStartDelay(280).setDuration(480).setInterpolator(new DecelerateInterpolator()).start();

        pulseBar.animate().alpha(1f).setStartDelay(600).setDuration(300).withEndAction(() -> startPulseLoop(pulseBar)).start();

        // Releases Android's own splash now that ours is in place behind it;
        // ours is fully opaque from frame one, so the handoff is seamless.
        splashOverlayAttached = true;

        splashHandler.postDelayed(splashSafetyRunnable, SPLASH_SAFETY_TIMEOUT_MS);
    }

    private void startPulseLoop(View pulseBar) {
        if (splashOverlay == null) {
            return;
        }
        ObjectAnimator pulse = ObjectAnimator.ofFloat(pulseBar, View.ALPHA, 1f, 0.25f);
        pulse.setDuration(900);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.start();
    }

    /**
     * Called from {@link AppSplashPlugin} once the live page has mounted.
     * Enforces a 3s minimum display time: if that hasn't elapsed yet, the
     * actual hide is scheduled for whatever time remains instead of firing
     * immediately.
     */
    public void hideNativeSplash() {
        runOnUiThread(() -> {
            if (splashOverlay == null || splashHideRequested) {
                return;
            }
            splashHideRequested = true;
            splashHandler.removeCallbacks(splashSafetyRunnable);

            long elapsed = SystemClock.elapsedRealtime() - splashShownAtElapsed;
            long remaining = MIN_SPLASH_DISPLAY_MS - elapsed;
            if (remaining <= 0) {
                performSplashHide();
            } else {
                splashHandler.postDelayed(this::performSplashHide, remaining);
            }
        });
    }

    private void performSplashHide() {
        View overlay = splashOverlay;
        if (overlay == null) {
            return;
        }
        splashOverlay = null;

        overlay.animate()
            .alpha(0f)
            .setDuration(450)
            .setInterpolator(new AccelerateInterpolator())
            .withEndAction(() -> {
                ViewGroup parent = (ViewGroup) overlay.getParent();
                if (parent != null) {
                    parent.removeView(overlay);
                }
            })
            .start();
    }
}
