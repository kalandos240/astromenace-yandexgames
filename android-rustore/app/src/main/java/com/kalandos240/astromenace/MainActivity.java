package com.kalandos240.astromenace;

import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

public final class MainActivity extends Activity {
    private static final String TAG = "AstroMenaceAndroid";
    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/game/index.html";
    private static final long DOUBLE_BACK_EXIT_MS = 1400L;

    private WebView webView;
    private FrameLayout controlsLayer;
    private TextView loadingOverlay;
    private EditText imeInput;
    private String imePreviousValue = "";
    private boolean imeInternalChange;
    private boolean pageReady;
    private long lastBackAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        configureCutout();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        webView = createGameWebView();
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        controlsLayer = new FrameLayout(this);
        controlsLayer.setVisibility(View.GONE);
        installTouchControls(controlsLayer);

        // The native mobile controls layer sits above the WebView. Intercept
        // only the pilot-name field band here; the AstroMenace profile menu
        // continuously accepts SDL text input, so this tap does not need to
        // reach the canvas. All other touches remain untouched.
        controlsLayer.setOnTouchListener((layer, event) -> {
            if (event.getActionMasked() != MotionEvent.ACTION_DOWN
                    || layer.getWidth() <= 0
                    || layer.getHeight() <= 0
                    || !pageReady) {
                return false;
            }

            float normalizedX = event.getX() / layer.getWidth();
            float normalizedY = event.getY() / layer.getHeight();

            if (normalizedX >= 0.18f && normalizedX <= 0.72f
                    && normalizedY >= 0.295f && normalizedY <= 0.345f) {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.__astroMobileKeyboard&&"
                                    + "window.__astroMobileKeyboard.show&&"
                                    + "window.__astroMobileKeyboard.show();",
                            null);
                }
                Log.i(TAG, "PROFILE_NAME_HOTSPOT");
                return true;
            }
            return false;
        });

        root.addView(controlsLayer, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        imeInput = createNativeImeInput();
        FrameLayout.LayoutParams imeParams = new FrameLayout.LayoutParams(
                dp(2), dp(2), Gravity.START | Gravity.BOTTOM);
        imeParams.leftMargin = dp(2);
        imeParams.bottomMargin = dp(2);
        root.addView(imeInput, imeParams);

        loadingOverlay = createLoadingOverlay();
        loadingOverlay.setVisibility(View.GONE);
        root.addView(loadingOverlay, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(root);
        root.post(this::hideSystemUi);
        installBackHandler();

        Log.i(TAG, "STARTING " + APP_URL);
        webView.loadUrl(APP_URL);
    }

    private WebView createGameWebView() {
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebView view = new WebView(this);
        view.setBackgroundColor(Color.BLACK);
        view.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.setHorizontalScrollBarEnabled(false);
        view.setVerticalScrollBarEnabled(false);
        view.setHapticFeedbackEnabled(false);

        // Canvas-based SDL games are not native text editors, so Android will
        // not open an IME by itself. Detect taps on AstroMenace's pilot-name
        // field at the native WebView layer and ask the injected HTML bridge
        // to focus its tiny text editor. Returning false preserves the same
        // touch for SDL/menu handling.
        view.setOnTouchListener((touchedView, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_UP
                    && touchedView.getWidth() > 0
                    && touchedView.getHeight() > 0) {
                float normalizedX = event.getX() / touchedView.getWidth();
                float normalizedY = event.getY() / touchedView.getHeight();

                if (normalizedX >= 0.18f && normalizedX <= 0.72f
                        && normalizedY >= 0.295f && normalizedY <= 0.345f
                        && pageReady) {
                    view.post(() -> view.evaluateJavascript(
                            "window.__astroMobileKeyboard&&"
                                    + "window.__astroMobileKeyboard.show&&"
                                    + "window.__astroMobileKeyboard.show();",
                            null));
                    Log.i(TAG, "PROFILE_NAME_TAP");
                }
            }
            return false;
        });

        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }

        WebView.setWebContentsDebuggingEnabled(false);
        view.addJavascriptInterface(new AndroidHostBridge(), "AndroidHost");

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                String line = "JS " + message.messageLevel() + ": "
                        + message.message() + " @" + message.lineNumber();
                switch (message.messageLevel()) {
                    case ERROR:
                        Log.e(TAG, line);
                        break;
                    case WARNING:
                        Log.w(TAG, line);
                        break;
                    default:
                        Log.d(TAG, line);
                        break;
                }
                return true;
            }
        });

        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView v, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView v, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                installJavascriptInputBridge();
                hideSystemUi();
                Log.i(TAG, "PAGE_FINISHED " + url);
            }

            @Override
            public void onReceivedError(
                    WebView v,
                    WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    startupError("Ошибка загрузки страницы: " + error.getDescription());
                }
            }

            @Override
            public boolean onRenderProcessGone(
                    WebView v,
                    RenderProcessGoneDetail detail) {
                String reason = detail.didCrash()
                        ? "WebView renderer crashed"
                        : "WebView renderer was killed (likely memory pressure)";
                Log.e(TAG, "RENDER_PROCESS_GONE: " + reason);
                startupError(reason);
                return true;
            }
        });

        return view;
    }

    private EditText createNativeImeInput() {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setInputType(
                InputType.TYPE_CLASS_TEXT
                        | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                        | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        input.setBackgroundColor(Color.TRANSPARENT);
        input.setTextColor(Color.TRANSPARENT);
        input.setHintTextColor(Color.TRANSPARENT);
        input.setCursorVisible(false);
        input.setAlpha(0.01f);
        input.setPadding(0, 0, 0, 0);

        input.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {}

            @Override
            public void afterTextChanged(Editable editable) {
                if (imeInternalChange) return;
                String current = editable.toString();
                forwardImeDiff(imePreviousValue, current);
                imePreviousValue = current;
            }
        });

        input.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE
                    || (event != null
                    && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER)) {
                tapKey("Enter", "Enter", 13);
                hideNativeKeyboard();
                return true;
            }
            return false;
        });

        return input;
    }

    private void forwardImeDiff(String previous, String current) {
        int prefix = 0;
        int previousLength = previous.length();
        int currentLength = current.length();

        while (prefix < previousLength
                && prefix < currentLength
                && previous.charAt(prefix) == current.charAt(prefix)) {
            prefix++;
        }

        int previousSuffix = previousLength;
        int currentSuffix = currentLength;
        while (previousSuffix > prefix
                && currentSuffix > prefix
                && previous.charAt(previousSuffix - 1) == current.charAt(currentSuffix - 1)) {
            previousSuffix--;
            currentSuffix--;
        }

        int removedCodePoints = previous.codePointCount(prefix, previousSuffix);
        for (int i = 0; i < removedCodePoints; i++) {
            tapKey("Backspace", "Backspace", 8);
        }

        String inserted = current.substring(prefix, currentSuffix);
        for (int offset = 0; offset < inserted.length();) {
            int codePoint = inserted.codePointAt(offset);
            sendTextCharacter(new String(Character.toChars(codePoint)));
            offset += Character.charCount(codePoint);
        }

        if (removedCodePoints > 0 || !inserted.isEmpty()) {
            Log.i(TAG, "NATIVE_IME_TEXT_CHANGE removed="
                    + removedCodePoints + " inserted=" + inserted.length());
        }
    }

    private void sendTextCharacter(String character) {
        if (!pageReady || webView == null || character == null || character.isEmpty()) return;
        webView.evaluateJavascript(
                "window.__astroAndroidInput&&window.__astroAndroidInput.text&&"
                        + "window.__astroAndroidInput.text(" + quoteJs(character) + ");",
                null);
    }

    private void showNativeKeyboard() {
        if (imeInput == null) return;

        imeInternalChange = true;
        imeInput.setText("");
        imeInput.setSelection(0);
        imePreviousValue = "";
        imeInternalChange = false;

        imeInput.setVisibility(View.VISIBLE);
        imeInput.setFocusableInTouchMode(true);
        imeInput.requestFocus();

        InputMethodManager inputMethodManager =
                (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (inputMethodManager != null) {
            imeInput.post(() -> inputMethodManager.showSoftInput(
                    imeInput,
                    InputMethodManager.SHOW_IMPLICIT));
        }

        Log.i(TAG, "SOFT_KEYBOARD_SHOW");
    }

    private void hideNativeKeyboard() {
        if (imeInput == null) return;

        InputMethodManager inputMethodManager =
                (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (inputMethodManager != null) {
            inputMethodManager.hideSoftInputFromWindow(imeInput.getWindowToken(), 0);
        }

        imeInput.clearFocus();
        if (webView != null) webView.requestFocus();
        hideSystemUi();
        Log.i(TAG, "SOFT_KEYBOARD_HIDE");
    }

    private TextView createLoadingOverlay() {
        TextView view = new TextView(this);
        view.setText("Загрузка AstroMenace…");
        view.setTextColor(Color.WHITE);
        view.setTextSize(18f);
        view.setGravity(Gravity.CENTER);
        view.setBackgroundColor(Color.BLACK);
        view.setPadding(dp(28), dp(28), dp(28), dp(28));
        return view;
    }

    private void installJavascriptInputBridge() {
        if (!pageReady || webView == null) return;

        String js = "(function(){"
                + "if(window.__astroAndroidInput)return;"
                + "function make(type,key,code,kc){"
                + "var e=new KeyboardEvent(type,{key:key,code:code,bubbles:true,cancelable:true,repeat:false});"
                + "try{Object.defineProperty(e,'keyCode',{get:function(){return kc;}});"
                + "Object.defineProperty(e,'which',{get:function(){return kc;}});}catch(_){}return e;}"
                + "function emit(type,key,code,kc){"
                + "var targets=[window,document,document.getElementById('canvas')];"
                + "for(var i=0;i<targets.length;i++){if(targets[i]){try{targets[i].dispatchEvent(make(type,key,code,kc));}catch(_){}}}}"
                + "function emitText(ch){"
                + "var canvas=document.getElementById('canvas');if(!canvas||!ch)return;"
                + "var cp=ch.codePointAt(0)||0;"
                + "function one(type,which){"
                + "var e=new KeyboardEvent(type,{key:ch,bubbles:true,cancelable:true});"
                + "try{Object.defineProperty(e,'keyCode',{get:function(){return cp;}});"
                + "Object.defineProperty(e,'which',{get:function(){return which;}});"
                + "Object.defineProperty(e,'charCode',{get:function(){return type==='keypress'?cp:0;}});}catch(_){}"
                + "canvas.dispatchEvent(e);}"
                + "one('keydown',cp);one('keypress',cp);one('keyup',cp);"
                + "}"
                + "window.__astroAndroidInput={"
                + "down:function(key,code,kc){emit('keydown',key,code,kc);},"
                + "up:function(key,code,kc){emit('keyup',key,code,kc);},"
                + "text:function(ch){emitText(ch);},"
                + "pause:function(){window.dispatchEvent(new Event('blur'));},"
                + "resume:function(){window.dispatchEvent(new Event('focus'));}"
                + "};"
                + "})();";

        webView.evaluateJavascript(js, null);
    }

    private void installTouchControls(FrameLayout root) {
        int size = dp(62);
        int gap = dp(4);
        int left = dp(20);
        int bottom = dp(20);

        addHoldButton(root, "▲", "ArrowUp", "ArrowUp", 38,
                left + size + gap, bottom + (size + gap) * 2,
                size, size, Gravity.START | Gravity.BOTTOM);

        addHoldButton(root, "▼", "ArrowDown", "ArrowDown", 40,
                left + size + gap, bottom,
                size, size, Gravity.START | Gravity.BOTTOM);

        addHoldButton(root, "◀", "ArrowLeft", "ArrowLeft", 37,
                left, bottom + size + gap,
                size, size, Gravity.START | Gravity.BOTTOM);

        addHoldButton(root, "▶", "ArrowRight", "ArrowRight", 39,
                left + (size + gap) * 2, bottom + size + gap,
                size, size, Gravity.START | Gravity.BOTTOM);

        addHoldButton(root, "АТАКА 1", "z", "KeyZ", 90,
                dp(118), dp(30), dp(96), dp(72),
                Gravity.END | Gravity.BOTTOM);

        addHoldButton(root, "АТАКА 2", "x", "KeyX", 88,
                dp(20), dp(126), dp(86), dp(64),
                Gravity.END | Gravity.BOTTOM);

        TextView pause = createButton("II", dp(50), dp(50));
        FrameLayout.LayoutParams pauseParams =
                new FrameLayout.LayoutParams(dp(50), dp(50), Gravity.TOP | Gravity.START);
        pauseParams.leftMargin = dp(16);
        pauseParams.topMargin = dp(16);
        pause.setLayoutParams(pauseParams);
        pause.setOnClickListener(v -> tapKey("Escape", "Escape", 27));
        root.addView(pause);
    }

    private void addHoldButton(
            FrameLayout root,
            String label,
            String key,
            String code,
            int keyCode,
            int horizontalMargin,
            int verticalMargin,
            int width,
            int height,
            int gravity) {

        TextView button = createButton(label, width, height);
        FrameLayout.LayoutParams params =
                new FrameLayout.LayoutParams(width, height, gravity);

        if ((gravity & Gravity.END) == Gravity.END) {
            params.rightMargin = horizontalMargin;
        } else {
            params.leftMargin = horizontalMargin;
        }

        if ((gravity & Gravity.BOTTOM) == Gravity.BOTTOM) {
            params.bottomMargin = verticalMargin;
        } else {
            params.topMargin = verticalMargin;
        }

        button.setLayoutParams(params);
        button.setOnTouchListener((v, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                case MotionEvent.ACTION_POINTER_DOWN:
                    v.setAlpha(1.0f);
                    sendKey(true, key, code, keyCode);
                    return true;

                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_POINTER_UP:
                case MotionEvent.ACTION_CANCEL:
                    v.setAlpha(0.72f);
                    sendKey(false, key, code, keyCode);
                    return true;

                default:
                    return true;
            }
        });

        root.addView(button);
    }

    private TextView createButton(String label, int width, int height) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setTextColor(Color.WHITE);
        view.setTextSize(label.length() > 2 ? 12f : 24f);
        view.setGravity(Gravity.CENTER);
        view.setAlpha(0.72f);
        view.setPadding(dp(4), dp(4), dp(4), dp(4));

        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(150, 15, 24, 40));
        background.setStroke(dp(1), Color.argb(200, 175, 210, 255));
        background.setCornerRadius(Math.min(width, height) * 0.22f);

        view.setBackground(background);
        return view;
    }

    private void sendKey(boolean down, String key, String code, int keyCode) {
        if (!pageReady || webView == null) return;

        String method = down ? "down" : "up";
        String js = "window.__astroAndroidInput&&window.__astroAndroidInput."
                + method + "("
                + quoteJs(key) + ","
                + quoteJs(code) + ","
                + keyCode + ");";

        webView.evaluateJavascript(js, null);
    }

    private void tapKey(String key, String code, int keyCode) {
        sendKey(true, key, code, keyCode);
        if (webView != null) {
            webView.postDelayed(() -> sendKey(false, key, code, keyCode), 70L);
        }
    }

    private static String quoteJs(String value) {
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    private void installBackHandler() {
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::handleBack);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (Build.VERSION.SDK_INT < 33) {
            handleBack();
        }
    }

    private void handleBack() {
        long now = System.currentTimeMillis();

        if (now - lastBackAt <= DOUBLE_BACK_EXIT_MS) {
            finish();
            return;
        }

        lastBackAt = now;
        tapKey("Escape", "Escape", 27);
    }

    @Override
    protected void onPause() {
        if (webView != null && pageReady) {
            webView.evaluateJavascript(
                    "window.__astroAndroidInput&&window.__astroAndroidInput.pause();"
                            + "window.Module&&Module.yandexSyncSave&&Module.yandexSyncSave(true);",
                    null);
            webView.onPause();
            webView.pauseTimers();
        }

        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();

        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();

            if (pageReady) {
                installJavascriptInputBridge();
                webView.evaluateJavascript(
                        "window.__astroAndroidInput&&window.__astroAndroidInput.resume();",
                        null);
            }
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }

    private void gameReady() {
        runOnUiThread(() -> {
            if (loadingOverlay != null) loadingOverlay.setVisibility(View.GONE);
            Log.i(TAG, "GAME_READY");
        });
    }

    private void menuVisible() {
        runOnUiThread(() -> {
            if (controlsLayer != null) controlsLayer.setVisibility(View.VISIBLE);
            if (webView != null) {
                webView.evaluateJavascript(
                        "(()=>{const c=document.getElementById('canvas');"
                                + "if(!c)return;"
                                + "const r=c.getBoundingClientRect();"
                                + "AndroidHost.viewportReport(Math.round(r.width),Math.round(r.height),"
                                + "Math.round(window.innerWidth),Math.round(window.innerHeight));})()",
                        null);
            }
            Log.i(TAG, "MENU_VISIBLE");
        });
    }

    private void startupError(String message) {
        runOnUiThread(() -> {
            Log.e(TAG, "STARTUP_ERROR: " + message);
            if (loadingOverlay != null) {
                loadingOverlay.setVisibility(View.VISIBLE);
                loadingOverlay.setText("Ошибка запуска AstroMenace\n\n" + message);
            }
        });
    }

    private final class AndroidHostBridge {
        @JavascriptInterface
        public void gameReady() {
            MainActivity.this.gameReady();
        }

        @JavascriptInterface
        public void startupError(String message) {
            MainActivity.this.startupError(message);
        }

        @JavascriptInterface
        public void menuVisible() {
            MainActivity.this.menuVisible();
        }

        @JavascriptInterface
        public void viewportReport(int canvasWidth, int canvasHeight, int viewportWidth, int viewportHeight) {
            int deltaWidth = Math.abs(canvasWidth - viewportWidth);
            int deltaHeight = Math.abs(canvasHeight - viewportHeight);
            if (deltaWidth <= 2 && deltaHeight <= 2) {
                Log.i(TAG, "FULLSCREEN_CANVAS_PASS canvas="
                        + canvasWidth + "x" + canvasHeight
                        + " viewport=" + viewportWidth + "x" + viewportHeight);
            } else {
                Log.e(TAG, "FULLSCREEN_CANVAS_FAIL canvas="
                        + canvasWidth + "x" + canvasHeight
                        + " viewport=" + viewportWidth + "x" + viewportHeight);
            }
        }

        @JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(MainActivity.this::showNativeKeyboard);
        }

        @JavascriptInterface
        public void hideKeyboard() {
            runOnUiThread(MainActivity.this::hideNativeKeyboard);
        }
    }

    private void configureCutout() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }
    }

    private void hideSystemUi() {
        Window window = getWindow();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();

            if (controller != null) {
                controller.hide(
                        WindowInsets.Type.statusBars()
                                | WindowInsets.Type.navigationBars());

                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            @SuppressWarnings("deprecation")
            int flags =
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE;

            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
