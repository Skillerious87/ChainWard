package com.chainward.app;

import android.animation.Animator;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.Interpolator;
import android.view.animation.PathInterpolator;
import android.widget.TextView;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "ChainwardSplash";

    // Held at a hard 4s floor: the web app may auto-trigger the biometric
    // system prompt right after mount (see connect-form.tsx's auto-unlock
    // effect), and that prompt is an OS-level window that renders above
    // everything, including this overlay. Giving the entrance choreography
    // and the page's own boot work a wide margin here is what keeps that
    // prompt from ever appearing mid-splash - independent of and in addition
    // to the JS-side wait on AppSplash.hide() actually completing.
    private static final long MIN_SPLASH_DISPLAY_MS = 4000;
    private static final long SPLASH_SAFETY_TIMEOUT_MS = 8000;
    private static final long PING_DURATION_MS = 2200;

    // Material 3's easing tokens, expressed as the platform's own
    // PathInterpolator (available since API 21, no extra dependency needed).
    // Entrances get Emphasized Decelerate ("snappy" arrival, no overshoot);
    // the ambient ping loop gets the gentler Standard curve so it never
    // competes with an entrance for attention; the exit gets Emphasized
    // Accelerate, matched in kind (not just alpha) to the entrance.
    private static final Interpolator EMPHASIZED_DECELERATE = new PathInterpolator(0.05f, 0.7f, 0.1f, 1f);
    private static final Interpolator STANDARD = new PathInterpolator(0.4f, 0f, 0.2f, 1f);
    private static final Interpolator EMPHASIZED_ACCELERATE = new PathInterpolator(0.3f, 0f, 0.8f, 0.15f);

    private volatile boolean splashOverlayLaidOut = false;
    private View splashOverlay;
    private long splashShownAtElapsed;
    private boolean splashHideRequested = false;
    private boolean entranceStarted = false;
    private boolean hideRequestedBeforeEntrance = false;
    private boolean reduceMotionPreferred = false;
    private boolean splashHidden = false;
    private Runnable splashHiddenCallback;

    private final Handler splashHandler = new Handler(Looper.getMainLooper());
    private final Runnable splashSafetyRunnable = () -> {
        Log.w(TAG, "Safety timeout fired - the web app never called AppSplash.hide() within " + SPLASH_SAFETY_TIMEOUT_MS + "ms");
        performSplashHide();
    };
    private final List<Animator> loopingAnimators = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        // Keeps Android's own pre-app splash frozen on screen until our
        // overlay has actually painted a frame underneath it (see the
        // OnPreDrawListener in attachNativeSplashOverlay) - not merely
        // "attached to the view hierarchy", which doesn't guarantee a draw
        // pass has happened yet.
        splashScreen.setKeepOnScreenCondition(() -> !splashOverlayLaidOut);
        // The only sanctioned point to touch the OS splash before it exits.
        // Registered before any async work per Google's own guidance -
        // registering it late means it can silently never fire, falling
        // back to an uncustomized abrupt dismissal instead.
        splashScreen.setOnExitAnimationListener(provider -> {
            startEntranceChoreography();
            // Once this listener is set, the framework will not auto-dismiss
            // the OS splash - remove() is mandatory, not optional cleanup.
            // Our overlay is already fully painted underneath (guaranteed by
            // the OnPreDrawListener gate above), so there is nothing to wait
            // on: remove it in the same frame the choreography starts.
            provider.remove();
        });

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

        attachNativeSplashOverlay();
    }

    /** Inflates the overlay and sets its pre-entrance view states, but starts no animation yet - that begins only once the OS splash is actually exiting (see the exit-animation listener in onCreate). */
    private void attachNativeSplashOverlay() {
        View overlay = LayoutInflater.from(this).inflate(R.layout.view_splash_overlay, null);
        ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
        decorView.addView(overlay, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splashOverlay = overlay;

        View glow = overlay.findViewById(R.id.splash_glow);
        View logo = overlay.findViewById(R.id.splash_logo);
        TextView title = overlay.findViewById(R.id.splash_title);
        View tagline = overlay.findViewById(R.id.splash_tagline);

        title.setText(buildTitleText());

        logo.setScaleX(0.88f);
        logo.setScaleY(0.88f);
        glow.setScaleX(0.85f);
        glow.setScaleY(0.85f);
        title.setTranslationY(16f);
        tagline.setTranslationY(12f);

        // Armed here, not from the entrance choreography, so the ceiling
        // covers the whole splash-showing window - including a scenario
        // where the predraw gate below never fires - not just the part
        // after the OS splash agrees to exit.
        splashHandler.postDelayed(splashSafetyRunnable, SPLASH_SAFETY_TIMEOUT_MS);

        // Gates the OS splash's exit on a real draw pass, not just on the
        // view having been added to the hierarchy - guarantees our overlay
        // is genuinely painted underneath before the system tears its own
        // splash down, so the handoff has nothing to visibly jump past.
        overlay.getViewTreeObserver().addOnPreDrawListener(new ViewTreeObserver.OnPreDrawListener() {
            @Override
            public boolean onPreDraw() {
                overlay.getViewTreeObserver().removeOnPreDrawListener(this);
                splashOverlayLaidOut = true;
                return true;
            }
        });
    }

    /** Fired from the OS splash's exit-animation listener - this is the actual first visible moment of our overlay's own motion. */
    private void startEntranceChoreography() {
        View overlay = splashOverlay;
        if (overlay == null) {
            return;
        }
        splashShownAtElapsed = SystemClock.elapsedRealtime();
        reduceMotionPreferred = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ValueAnimator.areAnimatorsEnabled();

        View glow = overlay.findViewById(R.id.splash_glow);
        View ping = overlay.findViewById(R.id.splash_ping_ring);
        View logo = overlay.findViewById(R.id.splash_logo);
        View title = overlay.findViewById(R.id.splash_title);
        View tagline = overlay.findViewById(R.id.splash_tagline);

        // One soft halo behind the shield - a single accent motion reads as
        // confident; layering a second, near-identical glow just erodes that.
        glow.animate()
            .alpha(0.85f)
            .scaleX(1f)
            .scaleY(1f)
            .setStartDelay(0)
            .setDuration(450)
            .setInterpolator(EMPHASIZED_DECELERATE)
            .withEndAction(() -> { if (!reduceMotionPreferred) startGlowBreathing(glow); })
            .start();

        // A single radar-style pulse radiates outward once the halo has
        // settled - an ambient "actively securing" cue, not a busy loader.
        if (!reduceMotionPreferred) startPingLoop(ping, 450);

        // A restrained ease-out settle - arrives with energy, decelerates,
        // stops. No overshoot: that liveliness belongs to interactive
        // moments the user's own gesture drives, not a passive brand reveal.
        logo.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setStartDelay(80)
            .setDuration(450)
            .setInterpolator(EMPHASIZED_DECELERATE)
            .start();

        title.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(180)
            .setDuration(300)
            .setInterpolator(EMPHASIZED_DECELERATE)
            .start();

        tagline.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(260)
            .setDuration(300)
            .setInterpolator(EMPHASIZED_DECELERATE)
            .start();

        entranceStarted = true;
        if (hideRequestedBeforeEntrance) {
            hideRequestedBeforeEntrance = false;
            hideNativeSplash(null);
        }
    }

    /** Renders "CHAIN" in the primary title color and "WARD" in the brand accent, matching the in-app wordmark. */
    private SpannableString buildTitleText() {
        String text = "CHAINWARD";
        SpannableString spanned = new SpannableString(text);
        int accentColor = ContextCompat.getColor(this, R.color.splash_accent);
        spanned.setSpan(new ForegroundColorSpan(accentColor), 5, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        return spanned;
    }

    private void startGlowBreathing(View glow) {
        if (splashOverlay == null) {
            return;
        }
        PropertyValuesHolder scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.07f);
        PropertyValuesHolder scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.07f);
        PropertyValuesHolder alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.68f, 0.9f);
        ObjectAnimator breathe = ObjectAnimator.ofPropertyValuesHolder(glow, scaleX, scaleY, alpha);
        breathe.setDuration(1900);
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
        ping.setInterpolator(STANDARD);
        loopingAnimators.add(ping);
        ping.start();
    }

    /**
     * Called from {@link AppSplashPlugin} once the live page has mounted.
     * Enforces a minimum display time from the moment the overlay's entrance
     * actually started (not from when it was merely attached): if that
     * hasn't elapsed yet, the actual hide is scheduled for whatever time
     * remains instead of firing immediately. A call arriving before the
     * entrance has even started (the JS bridge mounting unusually fast) is
     * deferred until it has, since there is no meaningful elapsed time to
     * measure against yet.
     *
     * {@code onHidden}, if given, fires only once the overlay has actually
     * been removed from the view hierarchy - not when this method returns.
     * That's what lets the JS side (see AppSplashPlugin and
     * native-splash-hide.tsx) know the splash is truly gone before it does
     * anything, like triggering the biometric prompt, that must not overlap
     * it. Calling this more than once (or after the splash already finished)
     * is safe: callbacks are chained rather than dropped, and a call arriving
     * after the splash is gone fires its callback immediately.
     */
    public void hideNativeSplash(Runnable onHidden) {
        runOnUiThread(() -> {
            if (splashHidden) {
                if (onHidden != null) onHidden.run();
                return;
            }
            if (onHidden != null) {
                Runnable previous = splashHiddenCallback;
                splashHiddenCallback = previous == null ? onHidden : () -> {
                    previous.run();
                    onHidden.run();
                };
            }
            if (splashOverlay == null || splashHideRequested) {
                return;
            }
            if (!entranceStarted) {
                hideRequestedBeforeEntrance = true;
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

        // Motion parity with the entrance: a matched Emphasized Accelerate
        // curve and a small scale-down, not just a flat alpha dissolve -
        // exits deserve as much intention as entrances.
        overlay.animate()
            .alpha(0f)
            .scaleX(0.96f)
            .scaleY(0.96f)
            .setDuration(280)
            .setInterpolator(EMPHASIZED_ACCELERATE)
            .withEndAction(() -> {
                ViewGroup parent = (ViewGroup) overlay.getParent();
                if (parent != null) {
                    parent.removeView(overlay);
                }
                splashHidden = true;
                Runnable callback = splashHiddenCallback;
                splashHiddenCallback = null;
                if (callback != null) {
                    callback.run();
                }
            })
            .start();
    }

    @Override
    public void onDestroy() {
        // Belt-and-suspenders: performSplashHide() already cancels these on
        // the normal path, but if the Activity is torn down before that ever
        // runs (a JS bridge error that never calls hide(), or the process
        // being trimmed mid-splash), nothing else releases these infinite
        // animators and pending Handler callbacks from holding the splash
        // Views - and transitively this Activity - alive.
        splashHandler.removeCallbacksAndMessages(null);
        for (Animator animator : loopingAnimators) {
            animator.cancel();
        }
        loopingAnimators.clear();
        super.onDestroy();
    }
}
