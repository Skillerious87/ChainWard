package com.chainward.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Home-screen "ChainWard: Live Chain" widget. Holds no polling logic of its
 * own - every value it ever shows was pushed in by ChainWidgetPlugin.update(),
 * called from the JS side (see app-shell.tsx) whenever the live app's own
 * chain telemetry changes. onUpdate() below only re-renders the last known
 * values (e.g. after a widget is first placed, or the device reboots); it
 * never fetches anything itself.
 *
 * The countdown is a real ticking android.widget.Chronometer, not a static
 * label - RemoteViews supports driving one entirely off a base time with no
 * further updates needed, which is what lets this stay live without any
 * periodic wake-up (updatePeriodMillis is 0 - see chain_widget_info.xml).
 */
public class ChainWidgetProvider extends AppWidgetProvider {

    static final String PREFS_NAME = "chainward_widget";
    private static final String KEY_FACTION = "faction_name";
    private static final String KEY_STATE = "state";
    private static final String KEY_CURRENT = "current";
    private static final String KEY_MAXIMUM = "maximum";
    private static final String KEY_DEADLINE_EPOCH_MS = "deadline_epoch_ms";
    private static final String KEY_CHECKED_AT_EPOCH_MS = "checked_at_epoch_ms";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        pushToAllInstances(context);
    }

    /** Called from ChainWidgetPlugin with a fresh reading. Persists it, then re-renders every placed instance immediately. */
    static void saveAndPush(Context context, String factionName, String state, int current, int maximum, long deadlineEpochMs, long checkedAtEpochMs) {
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        editor.putString(KEY_FACTION, factionName);
        editor.putString(KEY_STATE, state);
        editor.putInt(KEY_CURRENT, current);
        editor.putInt(KEY_MAXIMUM, maximum);
        editor.putLong(KEY_DEADLINE_EPOCH_MS, deadlineEpochMs);
        editor.putLong(KEY_CHECKED_AT_EPOCH_MS, checkedAtEpochMs);
        editor.apply();
        pushToAllInstances(context);
    }

    private static void pushToAllInstances(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, ChainWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids.length == 0) return;

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String factionName = prefs.getString(KEY_FACTION, "");
        String state = prefs.getString(KEY_STATE, "idle");
        int current = prefs.getInt(KEY_CURRENT, 0);
        int maximum = prefs.getInt(KEY_MAXIMUM, 0);
        long deadlineEpochMs = prefs.getLong(KEY_DEADLINE_EPOCH_MS, 0);
        long checkedAtEpochMs = prefs.getLong(KEY_CHECKED_AT_EPOCH_MS, 0);

        RemoteViews views = buildViews(context, factionName, state, current, maximum, deadlineEpochMs, checkedAtEpochMs);
        for (int id : ids) {
            manager.updateAppWidget(id, views);
        }
    }

    private static final int COLOR_ACCENT = 0xFF91E653;
    private static final int COLOR_CRITICAL = 0xFFFF5D68;
    private static final int COLOR_MUTED = 0xFF8FA89B;
    /** A chain inside its final minute - matches shell.css's :root[data-chain-danger="critical"] threshold exactly. */
    private static final long CRITICAL_THRESHOLD_SECONDS = 60;

    private static RemoteViews buildViews(Context context, String factionName, String state, int current, int maximum, long deadlineEpochMs, long checkedAtEpochMs) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.chain_widget);
        views.setTextViewText(R.id.widget_faction, factionName == null || factionName.isEmpty() ? "ChainWard" : factionName);

        boolean hasSynced = checkedAtEpochMs > 0;
        boolean chainRunning = "active".equals(state) || "cooldown".equals(state);
        long remainingSeconds = Math.max(0, (deadlineEpochMs - System.currentTimeMillis()) / 1000);
        boolean critical = "active".equals(state) && remainingSeconds > 0 && remainingSeconds <= CRITICAL_THRESHOLD_SECONDS;

        if (hasSynced && chainRunning) {
            views.setViewVisibility(R.id.widget_active_group, View.VISIBLE);
            views.setViewVisibility(R.id.widget_idle, View.GONE);
            views.setInt(R.id.widget_root, "setBackgroundResource", critical ? R.drawable.widget_background_critical : R.drawable.widget_background);

            int accent = critical ? COLOR_CRITICAL : "cooldown".equals(state) ? COLOR_MUTED : COLOR_ACCENT;
            views.setTextViewText(R.id.widget_score, current + " / " + maximum);
            views.setTextColor(R.id.widget_score, accent);
            views.setInt(R.id.widget_icon, "setColorFilter", accent);

            int visibleProgressId = critical ? R.id.widget_progress_critical : "cooldown".equals(state) ? R.id.widget_progress_muted : R.id.widget_progress_active;
            for (int id : new int[] { R.id.widget_progress_active, R.id.widget_progress_critical, R.id.widget_progress_muted }) {
                views.setViewVisibility(id, id == visibleProgressId ? View.VISIBLE : View.GONE);
            }
            views.setProgressBar(visibleProgressId, Math.max(1, maximum), Math.max(0, Math.min(current, maximum)), false);

            views.setInt(R.id.widget_countdown, "setBackgroundResource", critical ? R.drawable.widget_badge_critical : "cooldown".equals(state) ? R.drawable.widget_badge_muted : R.drawable.widget_badge_accent);
            views.setTextColor(R.id.widget_countdown, accent);
            // Chronometer renders purely off this base against the system clock -
            // no further app-side ticks needed for it to keep counting down.
            long base = SystemClock.elapsedRealtime() + (deadlineEpochMs - System.currentTimeMillis());
            views.setChronometer(R.id.widget_countdown, base, "cooldown".equals(state) ? "Cooldown · %s" : "Drops in · %s", true);
            views.setChronometerCountDown(R.id.widget_countdown, true);
        } else {
            views.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_background);
            views.setInt(R.id.widget_icon, "setColorFilter", COLOR_ACCENT);
            views.setViewVisibility(R.id.widget_active_group, View.GONE);
            views.setViewVisibility(R.id.widget_idle, View.VISIBLE);
            views.setTextViewText(R.id.widget_idle, hasSynced ? "No chain running" : "Open ChainWard to sync");
        }

        views.setTextViewText(R.id.widget_updated, hasSynced
            ? "Updated " + DateUtils.getRelativeTimeSpanString(checkedAtEpochMs, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)
            : "");

        Intent openIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chain-ward-ebon.vercel.app/live-chain"));
        openIntent.setClassName(context, "com.chainward.app.MainActivity");
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        return views;
    }
}
