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
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.AccelerateInterpolator;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.OvershootInterpolator;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final long MIN_SPLASH_DISPLAY_MS = 3000;
    private static final long SPLASH_SAFETY_TIMEOUT_MS = 8000;
    private static final long PING_DURATION_MS = 2600;
    private static final long PING_STAGGER_MS = 1300;

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

        View glowOuter = overlay.findViewById(R.id.splash_glow_outer);
        View pingOuter = overlay.findViewById(R.id.splash_ping_outer);
        View pingInner = overlay.findViewById(R.id.splash_ping_inner);
        View glow = overlay.findViewById(R.id.splash_glow);
        View logo = overlay.findViewById(R.id.splash_logo);
        TextView title = overlay.findViewById(R.id.splash_title);
        View tagline = overlay.findViewById(R.id.splash_tagline);
        View progressTrack = overlay.findViewById(R.id.splash_progress_track);
        View progressRunner = overlay.findViewById(R.id.splash_progress_runner);

        title.setText(buildTitleText());

        logo.setScaleX(0.82f);
        logo.setScaleY(0.82f);
        logo.setRotation(-6f);
        glow.setScaleX(0.85f);
        glow.setScaleY(0.85f);
        glowOuter.setScaleX(0.85f);
        glowOuter.setScaleY(0.85f);
        title.setTranslationY(22f);
        tagline.setTranslationY(16f);

        // Two soft halos fade in first, settling into slow ambient breathing
        // loops at slightly different paces for an organic, layered glow.
        glowOuter.animate()
            .alpha(0.55f)
            .scaleX(1f)
            .scaleY(1f)
            .setStartDelay(20)
            .setDuration(750)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> startGlowBreathing(glowOuter, 1f, 1.1f, 0.4f, 0.65f, 2600))
            .start();

        glow.animate()
            .alpha(0.85f)
            .scaleX(1f)
            .scaleY(1f)
            .setStartDelay(60)
            .setDuration(650)
            .setInterpolator(new DecelerateInterpolator())
            .withEndAction(() -> startGlowBreathing(glow, 1f, 1.07f, 0.68f, 0.9f, 1900))
            .start();

        // Radar-style pings radiate outward from behind the shield, staggered
        // so a new ring appears roughly every half a pulse cycle. Kept subtle
        // (modest scale/alpha) so it reads as an ambient security cue rather
        // than a busy loading animation.
        startPingLoop(pingOuter, 500);
        startPingLoop(pingInner, 500 + PING_STAGGER_MS);

        // The shield settles in with a restrained, barely-there overshoot —
        // a refined settle rather than a bounce.
        logo.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .rotation(0f)
            .setStartDelay(120)
            .setDuration(700)
            .setInterpolator(new OvershootInterpolator(1.05f))
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

    /** Renders "CHAIN" in the primary title color and "WARD" in the brand accent, matching the in-app wordmark. */
    private SpannableString buildTitleText() {
        String text = "CHAINWARD";
        SpannableString spanned = new SpannableString(text);
        int accentColor = ContextCompat.getColor(this, R.color.splash_accent);
        spanned.setSpan(new ForegroundColorSpan(accentColor), 5, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return spanned;
    }

    private void startGlowBreathing(View glow, float scaleFrom, float scaleTo, float alphaFrom, float alphaTo, long duration) {
        if (splashOverlay == null) {
            return;
        }
        PropertyValuesHolder scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, scaleFrom, scaleTo);
        PropertyValuesHolder scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, scaleFrom, scaleTo);
        PropertyValuesHolder alpha = PropertyValuesHolder.ofFloat(View.ALPHA, alphaFrom, alphaTo);
        ObjectAnimator breathe = ObjectAnimator.ofPropertyValuesHolder(glow, scaleX, scaleY, alpha);
        breathe.setDuration(duration);
        breathe.setRepeatMode(ValueAnimator.REVERSE);
        breathe.setRepeatCount(ValueAnimator.INFINITE);
        breathe.setInterpolator(new AccelerateDecelerateInterpolator());
        loopingAnimators.add(breathe);
        breathe.start();
    }

    private void startPingLoop(View ring, long startDelay) {
        PropertyValuesHolder scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 0.75f, 1.28f);
        PropertyValuesHolder scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.75f, 1.28f);
        PropertyValuesHolder alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.42f, 0f);
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
            shimmer.setDuration(1300);
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
