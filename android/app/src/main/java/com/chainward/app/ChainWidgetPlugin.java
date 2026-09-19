package com.chainward.app;

import android.content.ComponentName;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.service.quicksettings.TileService;

/**
 * JS-to-native bridge for the home-screen widget and Quick Settings tile -
 * see app-shell.tsx, which calls update() with every fresh chain telemetry
 * reading (the same data already driving the in-app chain-state pill).
 * Neither native surface polls anything on its own; this is the only path
 * data ever reaches them.
 */
@CapacitorPlugin(name = "ChainWidget")
public class ChainWidgetPlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String factionName = call.getString("factionName", "");
        String state = call.getString("state", "idle");
        int current = call.getInt("current", 0);
        int maximum = call.getInt("maximum", 0);
        long deadlineEpochMs = doubleToLong(call.getDouble("deadlineEpochMs", 0d));
        long checkedAtEpochMs = doubleToLong(call.getDouble("checkedAtEpochMs", 0d));

        ChainWidgetProvider.saveAndPush(getContext(), factionName, state, current, maximum, deadlineEpochMs, checkedAtEpochMs);

        // Nudges an already-open Quick Settings panel to re-read the fresh
        // values immediately, rather than waiting for the next time the user
        // happens to pull the shade down.
        TileService.requestListeningState(getContext(), new ComponentName(getContext(), ChainWardTileService.class));

        call.resolve();
    }

    private static long doubleToLong(Double value) {
        return value == null ? 0L : Math.round(value);
    }
}
