package com.kalandos240.astromenace;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
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

import com.yandex.mobile.ads.common.AdError;
import com.yandex.mobile.ads.common.AdRequest;
import com.yandex.mobile.ads.common.AdRequestError;
import com.yandex.mobile.ads.common.ImpressionData;
import com.yandex.mobile.ads.common.YandexAds;
import com.yandex.mobile.ads.interstitial.InterstitialAd;
import com.yandex.mobile.ads.interstitial.InterstitialAdEventListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoadListener;
import com.yandex.mobile.ads.interstitial.InterstitialAdLoader;

public final class MainActivity extends Activity {
    private static final String TAG = "AstroMenaceAndroid";
    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/game/index.html";
    private static final long DOUBLE_BACK_EXIT_MS = 1400L;
    private static final long INTERSTITIAL_COOLDOWN_MS = 120_000L;
    private static final long INTERSTITIAL_SAFE_POINT_DELAY_MS = 1_600L;
    private static final long PROFILE_KEYBOARD_ARM_MS = 45_000L;

    private WebView webView;
    private FrameLayout controlsLayer;
    private JoystickView joystickView;
    private TextView loadingOverlay;
    private EditText imeInput;
    private String imePreviousValue = "";
    private boolean imeInternalChange;
    private boolean imeShowRequested;
    private boolean pageReady;
    private boolean smokeTestMode;
    private boolean smokeSelfTestStarted;
    private boolean engineGameplayActive;
    private boolean pauseMenuVisible;
    private boolean gameplayActive;
    private boolean gameplayTouchBlockLogged;
    private boolean profileScreenActive;
    private boolean profileKeyboardArmed;
    private boolean profileKeyboardCanArm = true;
    private long profileKeyboardArmedUntil;
    private boolean pauseFlowActive;
    private int safePointGeneration;
    private long lastBackAt;

    private InterstitialAdLoader interstitialAdLoader;
    private InterstitialAd interstitialAd;
    private boolean adSdkInitialized;
    private boolean adLoadInProgress;
    private boolean adShowing;
    private long nextInterstitialAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        smokeTestMode = getIntent().getBooleanExtra("astromenace_smoke", false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFormat(PixelFormat.RGBA_8888);
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

        // Keep the overlay itself non-clickable so blank regions pass through
        // to the WebView. Only the actual virtual control buttons consume
        // touches. This is required for menu buttons and the profile field.
        controlsLayer.setClickable(false);
        controlsLayer.setFocusable(false);

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

        nextInterstitialAt = SystemClock.elapsedRealtime() + INTERSTITIAL_COOLDOWN_MS;
        initializeYandexMobileAds();

        Log.i(TAG, "STARTING " + APP_URL);
        webView.loadUrl(APP_URL);
    }

    private void initializeYandexMobileAds() {
        YandexAds.initialize(this, () -> {
            adSdkInitialized = true;
            Log.i(TAG, "YANDEX_ADS_SDK_INITIALIZED");
            interstitialAdLoader = new InterstitialAdLoader(this);
            loadInterstitialAd();
        });
    }

    private void loadInterstitialAd() {
        if (!adSdkInitialized
                || interstitialAdLoader == null
                || interstitialAd != null
                || adLoadInProgress
                || isFinishing()) {
            return;
        }

        adLoadInProgress = true;
        String adUnitId = getString(R.string.yandex_interstitial_ad_unit_id);
        Log.i(TAG, "YANDEX_AD_LOAD_REQUESTED unit=" + adUnitId);

        AdRequest request = new AdRequest.Builder(adUnitId).build();
        interstitialAdLoader.loadAd(request, new InterstitialAdLoadListener() {
            @Override
            public void onAdLoaded(InterstitialAd ad) {
                adLoadInProgress = false;
                interstitialAd = ad;
                Log.i(TAG, "YANDEX_AD_LOADED");
            }

            @Override
            public void onAdFailedToLoad(AdRequestError error) {
                adLoadInProgress = false;
                interstitialAd = null;
                Log.w(TAG, "YANDEX_AD_LOAD_FAILED: " + error);
            }
        });
    }

    private void requestInterstitialAtSafePoint(String reason) {
        final int generation = ++safePointGeneration;
        Log.d(TAG, "YANDEX_AD_SAFE_POINT_SCHEDULED reason=" + reason);

        View scheduler = webView != null ? webView : getWindow().getDecorView();
        scheduler.postDelayed(() -> {
            if (generation != safePointGeneration || gameplayActive || isFinishing()) {
                Log.d(TAG, "YANDEX_AD_SKIP unsafe-transition reason=" + reason);
                return;
            }

            long now = SystemClock.elapsedRealtime();

            if (adShowing) {
                Log.d(TAG, "YANDEX_AD_SKIP already-showing reason=" + reason);
                return;
            }

            if (now < nextInterstitialAt) {
                Log.d(TAG, "YANDEX_AD_SKIP cooldown reason=" + reason
                        + " remainingMs=" + (nextInterstitialAt - now));
                return;
            }

            if (interstitialAd == null) {
                Log.d(TAG, "YANDEX_AD_SKIP not-loaded reason=" + reason);
                loadInterstitialAd();
                return;
            }

            hideNativeKeyboard();
            if (controlsLayer != null) controlsLayer.setVisibility(View.GONE);

            InterstitialAd ad = interstitialAd;
            adShowing = true;
            nextInterstitialAt = now + INTERSTITIAL_COOLDOWN_MS;

            ad.setAdEventListener(new InterstitialAdEventListener() {
                @Override
                public void onAdShown() {
                    Log.i(TAG, "YANDEX_AD_SHOWN reason=" + reason);
                }

                @Override
                public void onAdFailedToShow(AdError error) {
                    Log.w(TAG, "YANDEX_AD_SHOW_FAILED: " + error);
                    finishInterstitial(ad);
                }

                @Override
                public void onAdDismissed() {
                    Log.i(TAG, "YANDEX_AD_DISMISSED");
                    finishInterstitial(ad);
                }

                @Override
                public void onAdClicked() {
                    Log.i(TAG, "YANDEX_AD_CLICKED");
                }

                @Override
                public void onAdImpression(ImpressionData impressionData) {
                    Log.i(TAG, "YANDEX_AD_IMPRESSION");
                }
            });

            try {
                ad.show(this);
            } catch (RuntimeException error) {
                Log.e(TAG, "YANDEX_AD_SHOW_EXCEPTION", error);
                finishInterstitial(ad);
            }
        }, INTERSTITIAL_SAFE_POINT_DELAY_MS);
    }

    private void finishInterstitial(InterstitialAd finishedAd) {
        runOnUiThread(() -> {
            try {
                finishedAd.setAdEventListener(null);
            } catch (RuntimeException ignored) {
            }

            if (interstitialAd == finishedAd) {
                interstitialAd = null;
            }
            adShowing = false;

            hideSystemUi();
            if (webView != null && pageReady) {
                webView.evaluateJavascript(
                        "window.__astroAndroidInput&&window.__astroAndroidInput.resume();",
                        null);
            }

            loadInterstitialAd();
        });
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

        // Mobile gameplay is controlled exclusively by the native joystick
        // and action buttons. Direct canvas touches are swallowed while a
        // mission is active so SDL cannot interpret a finger as mouse steering.
        //
        // The native keyboard is armed only after the Start Game button opens
        // the profile screen. This prevents workshop/system buttons at similar
        // coordinates from ever opening Android's IME.
        view.setOnTouchListener((touchedView, event) -> {
            // In missions, only the native joystick and action buttons control
            // the ship. All direct canvas touches are swallowed.
            if (gameplayActive) {
                if (event.getActionMasked() == MotionEvent.ACTION_UP && !gameplayTouchBlockLogged) {
                    gameplayTouchBlockLogged = true;
                    Log.i(TAG, "GAMEPLAY_CANVAS_TOUCH_BLOCKED");
                }
                return true;
            }

            // Menus and workshop keep WebView's native touch->mouse handling,
            // which Emscripten/SDL already supports reliably on real devices.
            if (event.getActionMasked() == MotionEvent.ACTION_UP
                    && touchedView.getWidth() > 0
                    && touchedView.getHeight() > 0) {
                float normalizedX = Math.max(0.0f,
                        Math.min(1.0f, event.getX() / touchedView.getWidth()));
                float normalizedY = Math.max(0.0f,
                        Math.min(1.0f, event.getY() / touchedView.getHeight()));
                handleMenuTap(normalizedX, normalizedY);
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
        settings.setOffscreenPreRaster(true);
        settings.setTextZoom(100);

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

    private boolean isProfileKeyboardArmed() {
        if (!profileKeyboardArmed) return false;
        if (SystemClock.elapsedRealtime() <= profileKeyboardArmedUntil) return true;
        disarmProfileKeyboard("expired");
        return false;
    }

    private void armProfileKeyboard() {
        if (!profileKeyboardCanArm) return;
        profileKeyboardCanArm = false;
        profileKeyboardArmed = true;
        profileKeyboardArmedUntil = SystemClock.elapsedRealtime() + PROFILE_KEYBOARD_ARM_MS;
        Log.i(TAG, "PROFILE_KEYBOARD_ARMED");
    }

    private void disarmProfileKeyboard(String reason) {
        if (!profileKeyboardArmed) return;
        profileKeyboardArmed = false;
        profileKeyboardArmedUntil = 0L;
        Log.i(TAG, "PROFILE_KEYBOARD_DISARMED " + reason);
    }

    private void handleMenuTap(float normalizedX, float normalizedY) {
        // Text input is allowed only when the C++ engine explicitly reports
        // that the PROFILE menu is active. No coordinate-only arming is used.
        if (profileScreenActive
                && normalizedX >= 0.18f && normalizedX <= 0.72f
                && normalizedY >= 0.285f && normalizedY <= 0.350f) {
            if (pageReady) {
                webView.post(this::showNativeKeyboard);
                Log.i(TAG, "PROFILE_NAME_TAP");
            }
            return;
        }

        // In-game QUIT is handled by AstroMenace itself and returns to the
        // main menu. Do not terminate the Android Activity here.
        if (pauseFlowActive
                && normalizedX >= 0.34f && normalizedX <= 0.50f
                && normalizedY >= 0.54f && normalizedY <= 0.68f) {
            Log.i(TAG, "CONFIRMED_QUIT_TO_MENU_TAP");
        }
    }

    private void setProfileInputMode(boolean enabled) {
        runOnUiThread(() -> {
            profileScreenActive = enabled;
            if (!enabled && imeInput != null && imeInput.hasFocus()) {
                hideNativeKeyboard();
            }
            Log.i(TAG, enabled
                    ? "PROFILE_INPUT_MODE_ON"
                    : "PROFILE_INPUT_MODE_OFF");
        });
    }

    private void finishCleanlyAfterGameQuit() {
        if (isFinishing() || isDestroyed()) return;
        Log.i(TAG, "ANDROID_CLEAN_GAME_EXIT");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask();
        } else {
            finish();
        }
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
                disarmProfileKeyboard("submitted");
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

        imeShowRequested = true;
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
        int joystickSize = dp(176);

        joystickView = new JoystickView(this);
        FrameLayout.LayoutParams joystickParams = new FrameLayout.LayoutParams(
                joystickSize,
                joystickSize,
                Gravity.START | Gravity.BOTTOM);
        joystickParams.leftMargin = dp(22);
        joystickParams.bottomMargin = dp(20);
        root.addView(joystickView, joystickParams);

        addHoldButton(root, "АТАКА 1", "z", "KeyZ", 90,
                dp(118), dp(30), dp(96), dp(72),
                Gravity.END | Gravity.BOTTOM);

        addHoldButton(root, "АТАКА 2", "x", "KeyX", 88,
                dp(20), dp(126), dp(86), dp(64),
                Gravity.END | Gravity.BOTTOM);

        TextView pause = createButton("II", dp(54), dp(54));
        FrameLayout.LayoutParams pauseParams =
                new FrameLayout.LayoutParams(dp(54), dp(54), Gravity.TOP | Gravity.START);
        pauseParams.leftMargin = dp(16);
        pauseParams.topMargin = dp(16);
        pause.setLayoutParams(pauseParams);
        pause.setContentDescription("Пауза");
        pause.setOnClickListener(v -> {
            pauseFlowActive = true;
            tapKey("Escape", "Escape", 27);
            Log.i(TAG, "PAUSE_BUTTON_TAPPED");
        });
        root.addView(pause);
    }

    private final class JoystickView extends View {
        private final Paint basePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint rimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint knobPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        private float centerX;
        private float centerY;
        private float baseRadius;
        private float knobRadius;
        private float knobX;
        private float knobY;

        private boolean leftPressed;
        private boolean rightPressed;
        private boolean upPressed;
        private boolean downPressed;

        JoystickView(Context context) {
            super(context);
            setClickable(true);
            setFocusable(false);

            basePaint.setColor(Color.argb(92, 18, 32, 52));
            rimPaint.setStyle(Paint.Style.STROKE);
            rimPaint.setStrokeWidth(dp(2));
            rimPaint.setColor(Color.argb(180, 175, 210, 255));
            knobPaint.setColor(Color.argb(170, 105, 155, 210));
        }

        @Override
        protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
            centerX = width * 0.5f;
            centerY = height * 0.5f;
            baseRadius = Math.min(width, height) * 0.40f;
            knobRadius = baseRadius * 0.42f;
            knobX = centerX;
            knobY = centerY;
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            canvas.drawCircle(centerX, centerY, baseRadius, basePaint);
            canvas.drawCircle(centerX, centerY, baseRadius, rimPaint);
            canvas.drawCircle(knobX, knobY, knobRadius, knobPaint);
        }

        @Override
        public boolean onTouchEvent(MotionEvent event) {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                case MotionEvent.ACTION_MOVE:
                    updateJoystick(event.getX(), event.getY());
                    return true;

                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    releaseJoystick();
                    performClick();
                    return true;

                default:
                    return true;
            }
        }

        @Override
        public boolean performClick() {
            super.performClick();
            return true;
        }

        private void updateJoystick(float touchX, float touchY) {
            float dx = touchX - centerX;
            float dy = touchY - centerY;
            float distance = (float) Math.sqrt(dx * dx + dy * dy);

            if (distance > baseRadius && distance > 0.0f) {
                float scale = baseRadius / distance;
                dx *= scale;
                dy *= scale;
            }

            knobX = centerX + dx;
            knobY = centerY + dy;

            float threshold = baseRadius * 0.24f;
            setDirections(
                    dx < -threshold,
                    dx > threshold,
                    dy < -threshold,
                    dy > threshold);

            invalidate();
        }

        private void releaseJoystick() {
            knobX = centerX;
            knobY = centerY;
            setDirections(false, false, false, false);
            invalidate();
        }

        private void setDirections(boolean left, boolean right, boolean up, boolean down) {
            boolean changed = left != leftPressed
                    || right != rightPressed
                    || up != upPressed
                    || down != downPressed;
            if (changed && (left || right || up || down)) {
                Log.i(TAG, "JOYSTICK_ACTIVE left=" + left
                        + " right=" + right
                        + " up=" + up
                        + " down=" + down);
            }

            if (left != leftPressed) {
                leftPressed = left;
                sendKey(left, "ArrowLeft", "ArrowLeft", 37);
            }
            if (right != rightPressed) {
                rightPressed = right;
                sendKey(right, "ArrowRight", "ArrowRight", 39);
            }
            if (up != upPressed) {
                upPressed = up;
                sendKey(up, "ArrowUp", "ArrowUp", 38);
            }
            if (down != downPressed) {
                downPressed = down;
                sendKey(down, "ArrowDown", "ArrowDown", 40);
            }
        }

        private void smokeExercise() {
            setDirections(false, true, true, false);
            postDelayed(() -> setDirections(false, false, false, false), 120L);
        }
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
        safePointGeneration++;

        if (interstitialAd != null) {
            interstitialAd.setAdEventListener(null);
            interstitialAd = null;
        }
        interstitialAdLoader = null;

        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }

    private void maybeRunNativeSmokeSelfTest() {
        if (!smokeTestMode || smokeSelfTestStarted || webView == null) return;
        smokeSelfTestStarted = true;
        webView.postDelayed(this::runNativeSmokeSelfTest, 1200L);
    }

    private void runNativeSmokeSelfTest() {
        if (webView == null || isFinishing()) return;
        Log.i(TAG, "SMOKE_SELFTEST_START");

        // 1) Workshop/profile keyboard gate: a profile-field-shaped tap with
        // the gate disarmed must never open the IME.
        setProfileInputMode(false);
        float hotspotX = webView.getWidth() * 0.35f;
        float hotspotY = webView.getHeight() * 0.31f;
        MotionEvent down = MotionEvent.obtain(
                SystemClock.uptimeMillis(), SystemClock.uptimeMillis(),
                MotionEvent.ACTION_DOWN, hotspotX, hotspotY, 0);
        MotionEvent up = MotionEvent.obtain(
                SystemClock.uptimeMillis(), SystemClock.uptimeMillis() + 16,
                MotionEvent.ACTION_UP, hotspotX, hotspotY, 0);
        webView.dispatchTouchEvent(down);
        webView.dispatchTouchEvent(up);
        down.recycle();
        up.recycle();

        webView.postDelayed(() -> {
            if (imeInput != null && imeInput.hasFocus()) {
                Log.e(TAG, "SMOKE_WORKSHOP_IME_GATE_FAIL");
                return;
            }
            Log.i(TAG, "SMOKE_WORKSHOP_IME_GATE_PASS");

            // 2) Profile input can still deliberately open the system IME.
            imeShowRequested = false;
            setProfileInputMode(true);
            handleMenuTap(0.35f, 0.31f);
            webView.postDelayed(() -> {
                Log.i(TAG, imeShowRequested
                        ? "SMOKE_PROFILE_IME_PASS"
                        : "SMOKE_PROFILE_IME_FAIL");
                hideNativeKeyboard();

                // 3) Direct gameplay canvas touches are blocked while the
                // native joystick is active.
                setGameplayControlsVisible(true);
                gameplayTouchBlockLogged = false;
                MotionEvent gameDown = MotionEvent.obtain(
                        SystemClock.uptimeMillis(), SystemClock.uptimeMillis(),
                        MotionEvent.ACTION_DOWN,
                        webView.getWidth() * 0.5f, webView.getHeight() * 0.5f, 0);
                MotionEvent gameUp = MotionEvent.obtain(
                        SystemClock.uptimeMillis(), SystemClock.uptimeMillis() + 16,
                        MotionEvent.ACTION_UP,
                        webView.getWidth() * 0.5f, webView.getHeight() * 0.5f, 0);
                webView.dispatchTouchEvent(gameDown);
                webView.dispatchTouchEvent(gameUp);
                gameDown.recycle();
                gameUp.recycle();

                if (joystickView != null) joystickView.smokeExercise();

                webView.postDelayed(() -> {
                    Log.i(TAG, gameplayTouchBlockLogged
                            ? "SMOKE_GAMEPLAY_TOUCH_BLOCK_PASS"
                            : "SMOKE_GAMEPLAY_TOUCH_BLOCK_FAIL");

                    // 4) Confirming in-game quit must not close the Activity;
                    // AstroMenace owns the transition back to main menu.
                    pauseFlowActive = true;
                    handleMenuTap(0.42f, 0.60f);
                    Log.i(TAG, !isFinishing()
                            ? "SMOKE_QUIT_TO_MENU_GUARD_PASS"
                            : "SMOKE_QUIT_TO_MENU_GUARD_FAIL");

                    setGameplayControlsVisible(false);
                    Log.i(TAG, "SMOKE_NATIVE_CONTROLS_PASS");
                }, 260L);
            }, 450L);
        }, 300L);
    }

    private void gameReady() {
        runOnUiThread(() -> {
            if (loadingOverlay != null) loadingOverlay.setVisibility(View.GONE);
            if (controlsLayer != null) controlsLayer.setVisibility(View.GONE);
            Log.i(TAG, "GAME_READY");
        });
    }

    private void menuVisible() {
        runOnUiThread(() -> {
            gameplayActive = false;
            pauseFlowActive = false;
            safePointGeneration++;
            disarmProfileKeyboard("menu-visible");
            if (controlsLayer != null) controlsLayer.setVisibility(View.GONE);
            if (webView != null) {
                webView.evaluateJavascript(
                        "(()=>{const c=document.getElementById('canvas');"
                                + "if(!c)return;"
                                + "const r=c.getBoundingClientRect();"
                                + "AndroidHost.viewportReport(Math.round(r.width),Math.round(r.height),"
                                + "Math.round(window.innerWidth),Math.round(window.innerHeight),"
                                + "Math.round(c.width),Math.round(c.height),Number(window.devicePixelRatio||1));})()",
                        null);
            }
            Log.i(TAG, "MENU_VISIBLE");
            maybeRunNativeSmokeSelfTest();
        });
    }

    private void setEngineGameplayState(boolean active) {
        runOnUiThread(() -> {
            engineGameplayActive = active;
            if (!active) {
                pauseMenuVisible = false;
                pauseFlowActive = false;
                setGameplayControlsVisible(false);
            } else if (!pauseMenuVisible) {
                setGameplayControlsVisible(true);
            }
            Log.i(TAG, active
                    ? "ENGINE_GAMEPLAY_STATE_ON"
                    : "ENGINE_GAMEPLAY_STATE_OFF");
        });
    }

    private void setPauseMenuState(boolean visible) {
        runOnUiThread(() -> {
            pauseMenuVisible = visible;
            pauseFlowActive = visible;

            if (visible) {
                // Pause/game menu must receive normal WebView touches.
                gameplayActive = false;
                if (controlsLayer != null) {
                    controlsLayer.setVisibility(View.GONE);
                }
                if (joystickView != null) {
                    joystickView.releaseJoystick();
                }
            } else if (engineGameplayActive) {
                setGameplayControlsVisible(true);
            }

            Log.i(TAG, visible
                    ? "PAUSE_MENU_STATE_ON"
                    : "PAUSE_MENU_STATE_OFF");
        });
    }

    private void setGameplayControlsVisible(boolean visible) {
        runOnUiThread(() -> {
            gameplayActive = visible;
            if (visible) {
                profileScreenActive = false;
                pauseFlowActive = false;
                safePointGeneration++;
                disarmProfileKeyboard("gameplay-start");
                gameplayTouchBlockLogged = false;
            }

            if (controlsLayer != null) {
                controlsLayer.setVisibility(visible ? View.VISIBLE : View.GONE);
            }
            if (!visible && imeInput != null && imeInput.hasFocus()) {
                hideNativeKeyboard();
            }

            Log.i(TAG, visible
                    ? "GAMEPLAY_CONTROLS_SHOW joystick-only"
                    : "GAMEPLAY_CONTROLS_HIDE");
        });
    }

    private float preferredRenderAspect() {
        int width = getResources().getDisplayMetrics().widthPixels;
        int height = getResources().getDisplayMetrics().heightPixels;
        int longSide = Math.max(width, height);
        int shortSide = Math.max(1, Math.min(width, height));
        float aspect = (float) longSide / (float) shortSide;

        // AstroMenace missions officially support from 5:4 to 16:9.
        return Math.max(1.25f, Math.min(16.0f / 9.0f, aspect));
    }

    private int preferredRenderWidth() {
        ActivityManager manager =
                (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        int memoryClassMb = manager != null ? manager.getMemoryClass() : 128;
        int physicalLongSide = Math.max(
                getResources().getDisplayMetrics().widthPixels,
                getResources().getDisplayMetrics().heightPixels);

        int maxWidth;
        if (memoryClassMb >= 384 && physicalLongSide >= 2200) {
            maxWidth = 1920;
        } else if (memoryClassMb >= 256 && physicalLongSide >= 1900) {
            maxWidth = 1600;
        } else if (memoryClassMb >= 192 && physicalLongSide >= 1600) {
            maxWidth = 1366;
        } else {
            maxWidth = 1280;
        }

        float aspect = preferredRenderAspect();
        // Height is capped at 1080, so reduce width on 4:3/16:10 tablets
        // instead of distorting a 16:9 buffer to their physical screen.
        int widthFor1080 = Math.round(1080.0f * aspect);
        return Math.max(1280, Math.min(maxWidth, widthFor1080));
    }

    private int preferredRenderHeight() {
        int width = preferredRenderWidth();
        int height = Math.round(width / preferredRenderAspect());
        return Math.max(720, Math.min(1080, height));
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
        public void profileInputMode(boolean enabled) {
            MainActivity.this.setProfileInputMode(enabled);
        }

        @JavascriptInterface
        public void gameplayState(boolean active) {
            MainActivity.this.setEngineGameplayState(active);
        }

        @JavascriptInterface
        public void pauseMenuState(boolean visible) {
            MainActivity.this.setPauseMenuState(visible);
        }

        @JavascriptInterface
        public void gameplayControls(boolean visible) {
            MainActivity.this.setGameplayControlsVisible(visible);
        }

        @JavascriptInterface
        public void cleanExit() {
            runOnUiThread(MainActivity.this::finishCleanlyAfterGameQuit);
        }

        @JavascriptInterface
        public void requestInterstitial(String reason) {
            MainActivity.this.requestInterstitialAtSafePoint(
                    reason == null ? "unknown" : reason);
        }

        @JavascriptInterface
        public int renderWidth() {
            int value = MainActivity.this.preferredRenderWidth();
            Log.i(TAG, "MOBILE_RENDER_TARGET width=" + value);
            return value;
        }

        @JavascriptInterface
        public int renderHeight() {
            return MainActivity.this.preferredRenderHeight();
        }

        @JavascriptInterface
        public void viewportReport(int canvasWidth, int canvasHeight, int viewportWidth, int viewportHeight,
                                   int bufferWidth, int bufferHeight, float devicePixelRatio) {
            int deltaWidth = Math.abs(canvasWidth - viewportWidth);
            int deltaHeight = Math.abs(canvasHeight - viewportHeight);
            if (deltaWidth <= 2 && deltaHeight <= 2) {
                Log.i(TAG, "FULLSCREEN_CANVAS_PASS canvas="
                        + canvasWidth + "x" + canvasHeight
                        + " viewport=" + viewportWidth + "x" + viewportHeight
                        + " buffer=" + bufferWidth + "x" + bufferHeight
                        + " dpr=" + devicePixelRatio);
            } else {
                Log.e(TAG, "FULLSCREEN_CANVAS_FAIL canvas="
                        + canvasWidth + "x" + canvasHeight
                        + " viewport=" + viewportWidth + "x" + viewportHeight
                        + " buffer=" + bufferWidth + "x" + bufferHeight
                        + " dpr=" + devicePixelRatio);
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
