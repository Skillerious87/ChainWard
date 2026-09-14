package com.chainward.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppSplash")
public class AppSplashPlugin extends Plugin {

    @PluginMethod
    public void hide(PluginCall call) {
        // Resolves only once the splash overlay has actually been removed
        // from the view hierarchy, not when this call is made - callers
        // (native-splash-hide.tsx) rely on that to know it is safe to do
        // anything, like the biometric prompt, that must not render on top
        // of a still-visible splash.
        ((MainActivity) getActivity()).hideNativeSplash(call::resolve);
    }
}
