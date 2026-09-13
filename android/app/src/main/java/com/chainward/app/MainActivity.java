package com.chainward.app;

import android.animation.Animator;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final long MIN_SPLASH_DISPLAY_MS = 3000;
    private static final long SPLASH_SAFETY_TIMEOUT_MS = 8000;
    private static final long PING_DURATION_MS = 2200;
    private static final long PING_STAGGER_MS = 1100;

    private volatile boolean splashOverlayAttached = false;
    private View splashOverlay;
    private long splashShownAtElapsed;
    private boolean splashHideRequested = false;

    private final Handler splashHandler = new Handler(Looper.getMainLooper());
    private final Runnable splashSafetyRunnable = this::performSplashHide;
    private final List<Animator> loopingAnimators = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        // Keeps Android's own pre-app splash frozen on screen until our custom
        // overlay is fully attached underneath it, so the handoff between the
        // two has zero gap instead of flashing bare content in between.
        splashScreen.setKeepOnScreenCondition(() -> !splashOverlayAttached);

        registerPlugin(AppSplashPlugin.class);
        super.onCreate(savedInstanceState);

        // androidx.core.splashscreen swaps in postSplashScreenTheme right as
        // the icon splash dismisses; reasserting transparent bars here covers
        // that instant regardless of what the theme swap briefly restores.
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

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

        View pingOuter = overlay.findViewById(R.id.splash_ping_outer);
        View pingInner = overlay.findViewById(R.id.splash_ping_inner);
        View glow = overlay.findViewById(R.id.splash_glow);
        View logo = overlay.findViewById(R.id.splash_logo);
        View title = overlay.findViewById(R.id.splash_title);
        View tagline = overlay.findViewById(R.id.splash_tagline);
        View progressTrack = overlay.findViewById(R.id.splash_progress_track);
        View progressRunner = overlay.findViewById(R.id.splash_progress_runner);

        logo.setScaleX(0.82f);
        logo.setScaleY(0.82f);
        logo.setRotation(-6f);
        glow.setScaleX(0.85f);
        glow.setScaleY(0.85f);
        title.setTranslationY(22f);
        tagline.setTranslationY(16f);

        // Soft halo fades in first, settling into a slow ambient breathing loop.
        glow.animate()
            .alpha(0.85f)
            .scaleX(1f)
            .scaleY(1f)
            .setStartDelay(60)
            .setDuration(650)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> startGlowBreathing(glow))
            .start();

        // Radar-style pings radiate outward from behind the shield, staggered
        // so a new ring appears roughly every half a pulse cycle.
        startPingLoop(pingOuter, 500);
        startPingLoop(pingInner, 500 + PING_STAGGER_MS);

        // The shield settles in with a gentle overshoot for a premium "pop".
        logo.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .rotation(0f)
            .setStartDelay(120)
            .setDuration(680)
            .setInterpolator(new OvershootInterpolator(1.6f))
            .start();

        title.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(340)
            .setDuration(520)
            .setInterpolator(new DecelerateInterpolator())
            .start();

        tagline.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(440)
            .setDuration(520)
            .setInterpolator(new DecelerateInterpolator())
            .start();

        progressTrack.animate()
            .alpha(1f)
            .setStartDelay(680)
            .setDuration(320)
            .withEndAction(() -> startProgressShimmer(progressTrack, progressRunner))
            .start();

        // Releases Android's own splash now that ours is in place behind it;
        // ours is fully opaque from frame one, so the handoff is seamless.
        splashOverlayAttached = true;

        splashHandler.postDelayed(splashSafetyRunnable, SPLASH_SAFETY_TIMEOUT_MS);
    }

    private void startGlowBreathing(View glow) {
        if (splashOverlay == null) {
            return;
        }
        PropertyValuesHolder scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.08f);
        PropertyValuesHolder scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.08f);
        PropertyValuesHolder alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.65f, 0.9f);
        ObjectAnimator breathe = ObjectAnimator.ofPropertyValuesHolder(glow, scaleX, scaleY, alpha);
        breathe.setDuration(1700);
        breathe.setRepeatMode(ValueAnimator.REVERSE);
        breathe.setRepeatCount(ValueAnimator.INFINITE);
        breathe.setInterpolator(new AccelerateDecelerateInterpolator());
        loopingAnimators.add(breathe);
        breathe.start();
    }

    private void startPingLoop(View ring, long startDelay) {
        PropertyValuesHolder scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 0.7f, 1.45f);
        PropertyValuesHolder scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.7f, 1.45f);
        PropertyValuesHolder alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.55f, 0f);
        ObjectAnimator ping = ObjectAnimator.ofPropertyValuesHolder(ring, scaleX, scaleY, alpha);
        ping.setStartDelay(startDelay);
        ping.setDuration(PING_DURATION_MS);
        ping.setRepeatMode(ValueAnimator.RESTART);
        ping.setRepeatCount(ValueAnimator.INFINITE);
        ping.setInterpolator(new DecelerateInterpolator());
        loopingAnimators.add(ping);
        ping.start();
    }

    private void startProgressShimmer(View track, View runner) {
        track.post(() -> {
            if (splashOverlay == null) {
                return;
            }
            float startX = -runner.getWidth();
            float endX = track.getWidth();
            runner.setTranslationX(startX);
            ObjectAnimator shimmer = ObjectAnimator.ofFloat(runner, View.TRANSLATION_X, startX, endX);
            shimmer.setDuration(1100);
            shimmer.setInterpolator(new LinearInterpolator());
            shimmer.setRepeatMode(ValueAnimator.RESTART);
            shimmer.setRepeatCount(ValueAnimator.INFINITE);
            loopingAnimators.add(shimmer);
            shimmer.start();
        });
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

        for (Animator animator : loopingAnimators) {
            animator.cancel();
        }
        loopingAnimators.clear();

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
