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
        // Epoch-millisecond values are always whole numbers with no decimal
        // point once JSON-serialized, and are always well beyond Integer
        // range - Capacitor's bridge (plain org.json under the hood) parses
        // a JSON number shaped like that as a Long, never a Double. getDouble()
        // only matches an actual Double and silently falls back otherwise, so
        // it was quietly reading 0 for both of these on every single call.
        long deadlineEpochMs = call.getLong("deadlineEpochMs", 0L);
        long checkedAtEpochMs = call.getLong("checkedAtEpochMs", 0L);

        ChainWidgetProvider.saveAndPush(getContext(), factionName, state, current, maximum, deadlineEpochMs, checkedAtEpochMs);

        // Nudges an already-open Quick Settings panel to re-read the fresh
        // values immediately, rather than waiting for the next time the user
        // happens to pull the shade down.
        TileService.requestListeningState(getContext(), new ComponentName(getContext(), ChainWardTileService.class));

        call.resolve();
    }
}
