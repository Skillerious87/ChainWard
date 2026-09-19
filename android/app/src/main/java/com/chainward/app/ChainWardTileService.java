package com.chainward.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Quick Settings shade tile - swipe down twice, tap "ChainWard" to jump
 * straight to Live Chain. Reads the exact same SharedPreferences snapshot
 * the home-screen widget does (see ChainWidgetProvider/ChainWidgetPlugin);
 * there is deliberately only one place chain data lands natively.
 */
public class ChainWardTileService extends TileService {

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) return;

        SharedPreferences prefs = getSharedPreferences(ChainWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        boolean hasSynced = prefs.getLong("checked_at_epoch_ms", 0) > 0;
        String state = prefs.getString("state", "idle");
        long deadlineEpochMs = prefs.getLong("deadline_epoch_ms", 0);
        boolean chainRunning = ("active".equals(state) || "cooldown".equals(state)) && deadlineEpochMs > System.currentTimeMillis();

        tile.setLabel("ChainWard");
        if (!hasSynced) {
            tile.setSubtitle("Open to sync");
        } else if (chainRunning) {
            int current = prefs.getInt("current", 0);
            int maximum = prefs.getInt("maximum", 0);
            long remainingSeconds = Math.max(0, (deadlineEpochMs - System.currentTimeMillis()) / 1000);
            String countdown = String.format(java.util.Locale.US, "%d:%02d", remainingSeconds / 60, remainingSeconds % 60);
            tile.setSubtitle(("cooldown".equals(state) ? "Cooldown " : current + "/" + maximum + " · ") + countdown);
        } else {
            tile.setSubtitle("No chain running");
        }
        tile.setState(Tile.STATE_ACTIVE);
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        Intent openIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chain-ward-ebon.vercel.app/live-chain"));
        openIntent.setClassName(this, "com.chainward.app.MainActivity");
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        // TileService.startActivityAndCollapse(Intent) throws
        // UnsupportedOperationException once the app targets API 34+ - the
        // PendingIntent overload is the only one that still works there, but
        // it doesn't exist before API 34, hence the version branch.
        if (Build.VERSION.SDK_INT >= 34) {
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            startActivityAndCollapse(pendingIntent);
        } else {
            startActivityAndCollapseLegacy(openIntent);
        }
    }

    @SuppressWarnings("deprecation")
    private void startActivityAndCollapseLegacy(Intent intent) {
        startActivityAndCollapse(intent);
    }
}
