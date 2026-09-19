package com.chainward.app;

import android.animation.Animator;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.view.animation.Interpolator;
import android.view.animation.PathInterpolator;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "ChainwardSplash";

    // Held at a hard 4.5s floor: the web app may auto-trigger the biometric
    // system prompt right after mount (see connect-form.tsx's auto-unlock
    // effect), and that prompt is an OS-level window that renders above
    // everything, including this overlay. Giving the entrance choreography
    // and the page's own boot work a wide margin here is what keeps that
    // prompt from ever appearing mid-splash - independent of and in addition
    // to the JS-side wait on AppSplash.hide() actually completing. 4.5s also
    // gives the glow/ping choreography enough room to read as deliberate
    // rather than rushed, without drifting into "why is this taking so long".
    private static final long MIN_SPLASH_DISPLAY_MS = 4500;
    private static final long SPLASH_SAFETY_TIMEOUT_MS = 8500;
    private static final long PING_DURATION_MS = 2200;
    // A bare back press at the root of the WebView's history (nothing left to
    // navigate back through) used to exit the app immediately - an easy
    // accidental exit for a workspace app people keep open and swipe around
    // in all day. A second press within this window is what actually exits.
    private static final long EXIT_CONFIRM_WINDOW_MS = 2000;

    // Must match the com.google.firebase.messaging.default_notification_channel_id
    // meta-data in AndroidManifest.xml - that's what FCM falls back to for any
    // push arriving while this channel hasn't been created yet, so it's
    // created eagerly here rather than left to Firebase's own generic
    // auto-created channel (which defaults to IMPORTANCE_DEFAULT, no heads-up).
    // Two more channels split chain and faction-activity alerts out from this
    // default/fallback one (push-fcm.ts sets android.notification.channelId
    // per category) so a member can mute or re-tone one category from the
    // system Settings app without losing the other - Android has no
    // per-category control below the channel level, so this is the only
    // place that distinction can actually live.
    private static final String NOTIFICATION_CHANNEL_ID = "chainward_default";
    private static final String NOTIFICATION_CHANNEL_CHAIN_ID = "chainward_chain";
    private static final String NOTIFICATION_CHANNEL_MEMBERS_ID = "chainward_members";

    // Digital Asset Links for this host are already published at
    // public/.well-known/assetlinks.json (originally for the Credential
    // Manager passkey bridge - see the WEB_AUTHENTICATION_SUPPORT_FOR_APP
    // call below) with the "handle_all_urls" relation already declared, so
    // adding the App Links intent-filter in the manifest is all that's
    // needed to complete verified App Links for this domain. Only this exact
    // host is ever navigated to from an incoming intent - see
    // handleIncomingIntent() - so a malicious app crafting an explicit
    // ACTION_VIEW intent at this (necessarily exported) launcher Activity
    // can't steer the WebView anywhere else.
    private static final String DEEP_LINK_HOST = "chain-ward-ebon.vercel.app";

    // Material 3's easing tokens, expressed as the platform's own
    // PathInterpolator (available since API 21, no extra dependency needed).
    // Entrances get Emphasized Decelerate ("snappy" arrival, no overshoot);
    // the ambient ping loop gets the gentler Standard curve so it never
    // competes with an entrance for attention; the exit gets Emphasized
    // Accelerate, matched in kind (not just alpha) to the entrance.
    private static final Interpolator EMPHASIZED_DECELERATE = new PathInterpolator(0.05f, 0.7f, 0.1f, 1f);
    private static final Interpolator STANDARD = new PathInterpolator(0.4f, 0f, 0.2f, 1f);
    private static final Interpolator EMPHASIZED_ACCELERATE = new PathInterpolator(0.3f, 0f, 0.8f, 0.15f);
    // Emphasized Decelerate's near-instant 0->70% jump (by x=0.05) is what
    // read as a "pop" rather than a glide once it was on individual letters
    // at a short duration - fine for a single icon arriving with energy, too
    // abrupt for nine of them in quick succession. Material 3's Standard
    // Decelerate has no fast-start snap at all: velocity eases in smoothly
    // from zero and bleeds off just as smoothly, which is what a calm,
    // professional letter-by-letter reveal actually wants.
    private static final Interpolator STANDARD_DECELERATE = new PathInterpolator(0f, 0f, 0f, 1f);

    private volatile boolean splashOverlayLaidOut = false;
    private View splashOverlay;
    private long splashShownAtElapsed;
    private boolean splashHideRequested = false;
    private boolean entranceStarted = false;
    private boolean hideRequestedBeforeEntrance = false;
    private boolean reduceMotionPreferred = false;
    private boolean splashHidden = false;
    private Runnable splashHiddenCallback;
    private View connectionErrorOverlay;
    private long lastBackPressAtElapsed = 0;

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
        registerPlugin(ChainWidgetPlugin.class);
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

        createNotificationChannels();
        attachBackNavigationHandling();
        attachWebViewFailureHandling();
        attachNativeSplashOverlay();
        handleIncomingIntent(getIntent());
    }

    /**
     * Reused for both a cold start (called from onCreate, once the bridge's
     * WebView exists) and a warm restart of an already-running instance (see
     * onNewIntent - launchMode="singleTop" means a shortcut or App Link tap
     * while the app is alive reuses this same Activity instance instead of
     * creating a second one). A cold-start redirect happens invisibly behind
     * the still-showing native splash overlay, which covers the WebView
     * until the JS side calls AppSplash.hide() regardless of which URL it
     * ends up loading underneath.
     */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    /**
     * Handles both App Links (an external tap on a chain-ward-ebon.vercel.app
     * link - see the MainActivity intent-filter in AndroidManifest.xml) and
     * the static launcher shortcuts in res/xml/shortcuts.xml, which target
     * this exact same ACTION_VIEW + https data shape by explicit component.
     * Only ever navigates to the app's own host, checked here rather than
     * trusted from the manifest's intent-filter match alone - see
     * DEEP_LINK_HOST.
     */
    private void handleIncomingIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri data = intent.getData();
        if (data == null || !"https".equals(data.getScheme()) || !DEEP_LINK_HOST.equalsIgnoreCase(data.getHost())) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView != null) {
            webView.loadUrl(data.toString());
        }
    }

    /** Creates the channels FCM pushes land in up front, at IMPORTANCE_HIGH - see NOTIFICATION_CHANNEL_ID and friends. */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        manager.createNotificationChannel(buildChannel(NOTIFICATION_CHANNEL_ID, "General alerts", "Anything that doesn't fit a specific category, plus test notifications sent from Settings."));
        manager.createNotificationChannel(buildChannel(NOTIFICATION_CHANNEL_CHAIN_ID, "Chain alerts", "Chain warning and critical countdown pushes."));
        manager.createNotificationChannel(buildChannel(NOTIFICATION_CHANNEL_MEMBERS_ID, "Faction activity", "Member inactivity and watch-list alerts."));
    }

    private NotificationChannel buildChannel(String id, String name, String description) {
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        return channel;
    }

    /**
     * Without this, the hardware/gesture back button falls straight through
     * to stock Activity behaviour and finishes the app from any screen -
     * Capacitor itself has no back-button handling built in (that only
     * exists in the separate @capacitor/app plugin, which isn't installed
     * here). This steps back through the WebView's own history first, for a
     * workspace-style SPA where a bare back press should navigate, not exit.
     */
    private void attachBackNavigationHandling() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge.getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                long now = SystemClock.elapsedRealtime();
                if (now - lastBackPressAtElapsed <= EXIT_CONFIRM_WINDOW_MS) {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    return;
                }
                lastBackPressAtElapsed = now;
                Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
            }
        });
    }

    /**
     * Registers for the two failure modes Capacitor otherwise leaves
     * unhandled: a failed remote load (no connectivity, DNS failure, a
     * Vercel 5xx - shows a branded retry overlay instead of Chromium's bare
     * net-error interstitial) and a crashed WebView renderer (returning
     * false here, the default, means the OS kills the whole app process
     * outright instead of just this Activity).
     */
    private void attachWebViewFailureHandling() {
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                hideConnectionError();
            }

            @Override
            public void onReceivedError(WebView webView) {
                showConnectionError();
            }

            @Override
            public void onReceivedHttpError(WebView webView) {
                showConnectionError();
            }

            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                Log.w(TAG, "WebView renderer process gone (didCrash=" + detail.didCrash() + ") - finishing gracefully instead of letting the OS kill the app.");
                finish();
                return true;
            }
        });
    }

    private void showConnectionError() {
        if (connectionErrorOverlay == null) {
            View overlay = LayoutInflater.from(this).inflate(R.layout.view_connection_error, null);
            ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
            decorView.addView(overlay, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            Button retry = overlay.findViewById(R.id.connection_error_retry);
            retry.setOnClickListener(v -> {
                overlay.setVisibility(View.GONE);
                bridge.getWebView().reload();
            });
            connectionErrorOverlay = overlay;
        }
        connectionErrorOverlay.bringToFront();
        connectionErrorOverlay.setVisibility(View.VISIBLE);
    }

    private void hideConnectionError() {
        if (connectionErrorOverlay != null) {
            connectionErrorOverlay.setVisibility(View.GONE);
        }
    }

    /** Inflates the overlay and sets its pre-entrance view states, but starts no animation yet - that begins only once the OS splash is actually exiting (see the exit-animation listener in onCreate). */
    private void attachNativeSplashOverlay() {
        View overlay = LayoutInflater.from(this).inflate(R.layout.view_splash_overlay, null);
        ViewGroup decorView = (ViewGroup) getWindow().getDecorView();
        decorView.addView(overlay, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splashOverlay = overlay;

        View glow = overlay.findViewById(R.id.splash_glow);
        View logo = overlay.findViewById(R.id.splash_logo);
        LinearLayout titleRow = overlay.findViewById(R.id.splash_title_row);
        View tagline = overlay.findViewById(R.id.splash_tagline);

        logo.setScaleX(0.88f);
        logo.setScaleY(0.88f);
        glow.setScaleX(0.85f);
        glow.setScaleY(0.85f);
        buildTitleLetters(titleRow);
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

    /**
     * Populates the title row with one TextView per letter of "CHAINWARD" -
     * "CHAIN" in the primary title color, "WARD" in the brand accent,
     * matching the in-app wordmark - so the entrance choreography can cascade
     * them in individually instead of animating the word as one flat block.
     * Each starts pre-entrance: invisible, settled slightly low and small.
     */
    private void buildTitleLetters(LinearLayout row) {
        row.removeAllViews();
        String word = "CHAINWARD";
        int titleColor = ContextCompat.getColor(this, R.color.splash_title_text);
        int accentColor = ContextCompat.getColor(this, R.color.splash_accent);
        Typeface typeface = Typeface.create("sans-serif-medium", Typeface.BOLD);
        for (int i = 0; i < word.length(); i++) {
            TextView letter = new TextView(this);
            letter.setText(String.valueOf(word.charAt(i)));
            letter.setTextColor(i < 5 ? titleColor : accentColor);
            letter.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
            letter.setTypeface(typeface);
            letter.setLetterSpacing(0.26f);
            letter.setAlpha(0f);
            letter.setTranslationY(10f);
            letter.setScaleX(0.94f);
            letter.setScaleY(0.94f);
            row.addView(letter);
        }
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
        View iconGroup = overlay.findViewById(R.id.splash_icon_group);
        LinearLayout titleRow = overlay.findViewById(R.id.splash_title_row);
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
            .withEndAction(() -> {
                if (!reduceMotionPreferred) {
                    startGlowBreathing(glow);
                    startIconFloat(iconGroup);
                }
            })
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

        // The wordmark cascades in letter by letter rather than as one flat
        // block - each glides up from barely below and barely smaller, well
        // overlapped with its neighbours (a long per-letter duration against
        // a much shorter stagger) so the sequence reads as one continuous
        // wave passing through the word, not a rapid staccato of individual
        // pops. Standard Decelerate keeps that wave smooth throughout rather
        // than snapping most of the way there instantly.
        int letterCount = titleRow.getChildCount();
        for (int i = 0; i < letterCount; i++) {
            titleRow.getChildAt(i).animate()
                .alpha(1f)
                .translationY(0f)
                .scaleX(1f)
                .scaleY(1f)
                .setStartDelay(220 + i * 55L)
                .setDuration(620)
                .setInterpolator(STANDARD_DECELERATE)
                .start();
        }

        tagline.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(220 + letterCount * 55L + 120)
            .setDuration(500)
            .setInterpolator(STANDARD_DECELERATE)
            .start();

        entranceStarted = true;
        if (hideRequestedBeforeEntrance) {
            hideRequestedBeforeEntrance = false;
            hideNativeSplash(null);
        }
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

    /** A very slow, small vertical drift on the whole icon group - layered under the glow's breathing scale/alpha (a different property, so the two never fight) for a quietly "alive" idle state rather than a static hang. */
    private void startIconFloat(View iconGroup) {
        if (splashOverlay == null) {
            return;
        }
        ObjectAnimator floatAnim = ObjectAnimator.ofFloat(iconGroup, View.TRANSLATION_Y, 0f, -7f);
        floatAnim.setDuration(3400);
        floatAnim.setRepeatMode(ValueAnimator.REVERSE);
        floatAnim.setRepeatCount(ValueAnimator.INFINITE);
        floatAnim.setInterpolator(new AccelerateDecelerateInterpolator());
        loopingAnimators.add(floatAnim);
        floatAnim.start();
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
