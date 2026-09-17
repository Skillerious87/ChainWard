package com.chainward.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.Build;
import android.os.SystemClock;
import android.util.AttributeSet;
import android.view.View;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * A faint, slowly-drifting node-and-link field behind the splash icon - the
 * same "chain" motif the web app's own sign-in background draws (see the
 * canvas in login-backdrop.tsx), rendered natively so the handoff from splash
 * to that page reads as one continuous backdrop rather than two unrelated
 * looks glued together. Deliberately understated: this is ambient texture in
 * the margins, not a second focal point - nodes are kept clear of the icon
 * and wordmark column entirely.
 */
public class ChainFieldView extends View {

    private static final float LINK_DISTANCE_DP = 128f;
    private static final float DRIFT_AMPLITUDE_DP = 12f;
    private static final long PULSE_PERIOD_MS = 3400;
    private static final float KEEP_CLEAR_HALF_WIDTH_DP = 150f;
    private static final float KEEP_CLEAR_TOP_DP = 220f;
    private static final float KEEP_CLEAR_BOTTOM_DP = 230f;

    private final List<Node> nodes = new ArrayList<>();
    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pulsePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Random random = new Random();

    private ValueAnimator animator;
    private long startedAtElapsed;
    private float linkDistancePx;
    private float driftAmplitudePx;
    private float dotRadiusPx;
    private int[] pulseEdge;
    private float[] xs = new float[0];
    private float[] ys = new float[0];
    private boolean sized = false;
    private final int accentRgb;

    public ChainFieldView(Context context, AttributeSet attrs) {
        super(context, attrs);
        accentRgb = ContextCompat.getColor(context, R.color.splash_accent) & 0x00FFFFFF;
        linePaint.setStyle(Paint.Style.STROKE);
        linePaint.setStrokeWidth(dp(1f));
        dotPaint.setStyle(Paint.Style.FILL);
        dotPaint.setColor(withAlpha(accentRgb, 0.3f));
        pulsePaint.setStyle(Paint.Style.FILL);
        pulsePaint.setColor(withAlpha(accentRgb, 0.55f));
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldW, int oldH) {
        super.onSizeChanged(w, h, oldW, oldH);
        if (w <= 0 || h <= 0) return;
        float density = getResources().getDisplayMetrics().density;
        linkDistancePx = LINK_DISTANCE_DP * density;
        driftAmplitudePx = DRIFT_AMPLITUDE_DP * density;
        dotRadiusPx = 1.6f * density;

        float centerX = w / 2f;
        float centerY = h / 2f;
        RectF keepClear = new RectF(
            centerX - KEEP_CLEAR_HALF_WIDTH_DP * density,
            centerY - KEEP_CLEAR_TOP_DP * density,
            centerX + KEEP_CLEAR_HALF_WIDTH_DP * density,
            centerY + KEEP_CLEAR_BOTTOM_DP * density
        );

        // Same target-count shape as the web canvas (area / 26_000, clamped) -
        // capped lower here since this sits behind a hero icon rather than
        // carrying a whole page on its own.
        float widthDp = w / density;
        float heightDp = h / density;
        int target = Math.round(Math.min(26f, Math.max(9f, (widthDp * heightDp) / 26_000f)));

        nodes.clear();
        for (int i = 0; i < target; i++) {
            Node n = new Node();
            boolean placed = false;
            for (int attempt = 0; attempt < 10; attempt++) {
                float x = random.nextFloat() * w;
                float y = random.nextFloat() * h;
                if (!keepClear.contains(x, y)) {
                    n.baseX = x;
                    n.baseY = y;
                    placed = true;
                    break;
                }
            }
            if (!placed) continue;
            n.phase = random.nextFloat() * (float) (Math.PI * 2);
            n.speed = 0.5f + random.nextFloat() * 0.3f;
            nodes.add(n);
        }
        xs = new float[nodes.size()];
        ys = new float[nodes.size()];
        pulseEdge = findAnEdge();
        sized = true;
    }

    private int[] findAnEdge() {
        for (int i = 0; i < nodes.size(); i++) {
            for (int j = i + 1; j < nodes.size(); j++) {
                Node a = nodes.get(i);
                Node b = nodes.get(j);
                if (dist(a.baseX, a.baseY, b.baseX, b.baseY) < linkDistancePx) return new int[]{i, j};
            }
        }
        return null;
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        startedAtElapsed = SystemClock.elapsedRealtime();
        boolean reduceMotion = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ValueAnimator.areAnimatorsEnabled();
        if (reduceMotion) {
            invalidate();
            return;
        }
        // Duration is arbitrary - motion is driven off elapsed wall-clock time
        // in onDraw, not this value. INFINITE repeat is just what keeps
        // invalidate() ticking every frame.
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(16);
        animator.setRepeatCount(ValueAnimator.INFINITE);
        animator.addUpdateListener(a -> invalidate());
        animator.start();
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (animator != null) {
            animator.cancel();
            animator = null;
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (!sized || nodes.isEmpty()) return;
        long elapsed = SystemClock.elapsedRealtime() - startedAtElapsed;
        float t = elapsed / 1000f;

        for (int i = 0; i < nodes.size(); i++) {
            Node n = nodes.get(i);
            xs[i] = n.baseX + (float) Math.sin(t * n.speed + n.phase) * driftAmplitudePx;
            ys[i] = n.baseY + (float) Math.cos(t * n.speed * 0.8f + n.phase) * driftAmplitudePx;
        }

        for (int i = 0; i < nodes.size(); i++) {
            for (int j = i + 1; j < nodes.size(); j++) {
                float d = dist(xs[i], ys[i], xs[j], ys[j]);
                if (d >= linkDistancePx) continue;
                linePaint.setColor(withAlpha(accentRgb, 0.1f * (1f - d / linkDistancePx)));
                canvas.drawLine(xs[i], ys[i], xs[j], ys[j], linePaint);
            }
        }

        for (int i = 0; i < nodes.size(); i++) {
            canvas.drawCircle(xs[i], ys[i], dotRadiusPx, dotPaint);
        }

        if (pulseEdge != null) {
            float progress = (elapsed % PULSE_PERIOD_MS) / (float) PULSE_PERIOD_MS;
            int a = pulseEdge[0];
            int b = pulseEdge[1];
            float px = xs[a] + (xs[b] - xs[a]) * progress;
            float py = ys[a] + (ys[b] - ys[a]) * progress;
            float fade = (float) Math.sin(progress * Math.PI);
            pulsePaint.setAlpha(Math.round(150 * fade));
            canvas.drawCircle(px, py, dotRadiusPx * 1.6f, pulsePaint);
        }
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    private static float dist(float ax, float ay, float bx, float by) {
        float dx = ax - bx;
        float dy = ay - by;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    private static int withAlpha(int rgb, float alpha) {
        int a = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        return (a << 24) | rgb;
    }

    private static final class Node {
        float baseX;
        float baseY;
        float phase;
        float speed;
    }
}
