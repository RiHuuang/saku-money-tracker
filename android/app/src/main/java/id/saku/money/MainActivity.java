package id.saku.money;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.res.Configuration;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.window.SplashScreenView;

public class MainActivity extends BridgeActivity {
    public static volatile boolean visible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalStatementAIPlugin.class);
        registerPlugin(GoogleAuthPlugin.class);
        registerPlugin(HomeWidgetPlugin.class);
        if ("direct".equals(BuildConfig.FLAVOR)) registerPlugin(AppUpdatePlugin.class);
        registerPlugin(NotificationCapturePlugin.class);
        registerPlugin(AppLockPlugin.class);
        super.onCreate(savedInstanceState);
        getSplashScreen().setOnExitAnimationListener(this::revealWordmark);
    }

    // Once the coin has landed, the icon steps left as "saku." slides in beside it, then the splash fades into the app.
    private void revealWordmark(SplashScreenView splash) {
        View icon = splash.getIconView();
        float animatorScale = Settings.Global.getFloat(getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f);
        if (icon == null || animatorScale == 0f) {
            splash.remove();
            return;
        }
        float dp = getResources().getDisplayMetrics().density;
        ImageView wordmark = new ImageView(this);
        wordmark.setImageResource(R.drawable.saku_wordmark);
        wordmark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        wordmark.setAlpha(0f);
        wordmark.setTranslationX(92 * dp);
        splash.addView(wordmark, new FrameLayout.LayoutParams(Math.round(150 * dp), Math.round(49.4f * dp), Gravity.CENTER));

        long iconEnds = splash.getIconAnimationStart() == null || splash.getIconAnimationDuration() == null ? 0
            : splash.getIconAnimationStart().toEpochMilli() + splash.getIconAnimationDuration().toMillis();
        long wait = Math.max(0, iconEnds - System.currentTimeMillis()) + 80;
        PathInterpolator ease = new PathInterpolator(0.2f, 0f, 0f, 1f);
        icon.animate().setStartDelay(wait).setDuration(440).setInterpolator(ease)
            .translationX(-82 * dp).scaleX(0.6f).scaleY(0.6f).start();
        wordmark.animate().setStartDelay(wait + 120).setDuration(420).setInterpolator(ease)
            .translationX(64.5f * dp).alpha(1f).start();
        long settled = System.currentTimeMillis() + wait + 900;
        Runnable fadeOut = () -> {
            for (View part : new View[] { icon, wordmark }) part.animate().setStartDelay(0).setDuration(200).alpha(0f).start();
            splash.animate().setStartDelay(0).setDuration(240).alpha(0f).withEndAction(splash::remove).start();
        };
        splash.postDelayed(() -> fadeWhenReady(splash, settled + 3000, fadeOut), wait + 900);
    }

    // Holds the lockup until the web app has left its own loading screen, so the two logos never overlap.
    private void fadeWhenReady(SplashScreenView splash, long giveUpAt, Runnable fadeOut) {
        if (getBridge() == null || System.currentTimeMillis() > giveUpAt) {
            fadeOut.run();
            return;
        }
        getBridge().getWebView().evaluateJavascript(
            "document.readyState === 'complete' && !!document.querySelector('#root > *') && !document.querySelector('.loading')",
            ready -> {
                if ("true".equals(ready)) fadeOut.run();
                else splash.postDelayed(() -> fadeWhenReady(splash, giveUpAt, fadeOut), 100);
            });
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
