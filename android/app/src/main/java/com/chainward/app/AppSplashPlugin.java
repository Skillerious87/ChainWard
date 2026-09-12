package com.chainward.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppSplash")
public class AppSplashPlugin extends Plugin {

    @PluginMethod
    public void hide(PluginCall call) {
        ((MainActivity) getActivity()).hideNativeSplash();
        call.resolve();
    }
}
