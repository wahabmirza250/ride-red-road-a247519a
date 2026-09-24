package com.getcapacitor.myapp;

import android.app.Instrumentation;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.BridgeActivity;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class StartupSmokeTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();

    private String evaluate(BridgeActivity activity, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result);
            done.countDown();
        }));
        assertTrue("WebView did not respond", done.await(5, TimeUnit.SECONDS));
        return value.get();
    }

    private void waitFor(BridgeActivity activity, String expression) throws Exception {
        for (int attempt = 0; attempt < 120; attempt++) {
            if ("true".equals(evaluate(activity, expression))) return;
            Thread.sleep(250);
        }
        fail("Screen did not appear: " + expression + " page=" + evaluate(activity, "document.body.innerText"));
    }

    @Test public void launcherAndNetworkFailureAreVisible() throws Exception {
        String packageName = instrumentation.getTargetContext().getPackageName();
        Intent intent = new Intent().setClassName(packageName, packageName + ".MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        BridgeActivity activity = (BridgeActivity) instrumentation.startActivitySync(intent);
        try {
            waitFor(activity, "document.querySelector('h1')?.innerText.startsWith('NEMT') === true");
            assertEquals("\"https://localhost/\"", evaluate(activity, "location.href"));
            if (packageName.endsWith("rides")) {
                assertEquals("false", evaluate(activity, "document.getElementById('provider-fields').hidden"));
                evaluate(activity, "document.getElementById('provider-code').value='../bad'; document.getElementById('continue').click()");
                waitFor(activity, "document.getElementById('validation')?.hidden === false");
            } else {
                evaluate(activity, "document.getElementById('continue').click()");
                waitFor(activity, "document.body.innerText.includes('Driver sign in') && document.querySelector('input[type=password]') !== null");
            }
            // Trigger a real DNS failure in the native WebView, then check bundled recovery.
            instrumentation.runOnMainSync(() -> activity.getBridge().getWebView().loadUrl("https://nemt-startup-test.invalid/"));
            waitFor(activity, "location.pathname === '/error.html' && document.getElementById('connection-error')?.hidden === false");
            assertEquals("\"Try again\"", evaluate(activity, "document.getElementById('continue').innerText"));
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
