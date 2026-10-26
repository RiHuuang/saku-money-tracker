package id.saku.money;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.res.Configuration;

public class MainActivity extends BridgeActivity {
    public static volatile boolean visible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalStatementAIPlugin.class);
        registerPlugin(GoogleAuthPlugin.class);
        registerPlugin(HomeWidgetPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(NotificationCapturePlugin.class);
        registerPlugin(AppLockPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        visible = true;
        SakuAppearance.INSTANCE.applyChrome(this);
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        SakuAppearance.INSTANCE.applyChrome(this);
        SakuWidgets.INSTANCE.refreshAll(this);
    }

    @Override
    public void onStop() {
        visible = false;
        super.onStop();
    }
}
