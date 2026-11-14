package vn.nhipsong.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import vn.nhipsong.app.siwc.SiwcPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SiwcPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
