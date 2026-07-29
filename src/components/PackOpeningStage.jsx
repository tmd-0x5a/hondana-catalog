import { ArrowUp, Keyboard, MousePointer2 } from "lucide-react";
import { useRef, useState } from "react";

const ENVELOPE_DRAG_DISTANCE_PX = 120;
const BOOK_DRAG_DISTANCE_PX = 180;
const DRAG_COMPLETE_THRESHOLD = 72;

function clampProgress(value) {
  return Math.min(100, Math.max(0, value));
}

function isActivationKey(event) {
  return event.key === "Enter" || event.key === " ";
}

/**
 * 上方向のポインタ移動を0〜100%へ変換し、途中で離した場合は開始位置へ戻す。
 *
 * @param {object} options ドラッグの条件。
 * @param {boolean} options.disabled 操作を止めるか。
 * @param {number} options.distancePx 100%に達するまでの移動距離。
 * @param {() => Promise<void>|void} options.onComplete 閾値を超えて離したときの処理。
 * @returns {{progress: number, dragging: boolean, handlers: object}} ドラッグ状態とイベント。
 */
function useUpwardDrag({ disabled, distancePx, onComplete }) {
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef(null);
  const progressRef = useRef(0);

  function updateProgress(nextProgress) {
    const clamped = clampProgress(nextProgress);
    progressRef.current = clamped;
    setProgress(clamped);
  }

  function completeGesture() {
    if (disabled) return;
    setDragging(false);
    updateProgress(100);
    void onComplete();
  }

  function start(event) {
    if (disabled) return;

    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startProgress: progressRef.current,
      startY: event.clientY,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || disabled) return;

    event.preventDefault();
    const upwardDistance = dragState.startY - event.clientY;
    updateProgress(dragState.startProgress + (upwardDistance / distancePx) * 100);
  }

  function release(event) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (progressRef.current >= DRAG_COMPLETE_THRESHOLD) {
      completeGesture();
    } else {
      updateProgress(0);
    }
  }

  function cancel(event) {
    dragStateRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateProgress(0);
  }

  function handleKeyDown(event) {
    if (!isActivationKey(event) || disabled) return;
    event.preventDefault();
    completeGesture();
  }

  return {
    dragging,
    handlers: {
      onKeyDown: handleKeyDown,
      onPointerCancel: cancel,
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: release,
    },
    progress,
  };
}

/**
 * 未開封の封筒をドラッグで開き、中のカード束を上へ引き出すまでの2段階操作。
 * サーバー上の開封確定は、カード束の引き出し操作が完了するまで呼び出さない。
 *
 * @param {object} props 開封前のパック情報と操作。
 * @param {boolean} props.busy サーバーが開封処理中か。
 * @param {number} props.cardCount 封筒に入っている候補数。
 * @param {() => Promise<void>|void} props.onOpen 開封を確定する処理。
 * @returns {import("react").ReactElement} 封筒の開封ステージ。
 */
export function PackOpeningStage({ busy, cardCount, onOpen }) {
  const [envelopeOpened, setEnvelopeOpened] = useState(false);
  const [committing, setCommitting] = useState(false);
  const disabled = busy || committing || cardCount === 0;

  async function finishEnvelopeOpening() {
    await new Promise((resolve) => window.setTimeout(resolve, 140));
    setEnvelopeOpened(true);
  }

  async function finishBookPull() {
    setCommitting(true);
    try {
      // 束を抜き切る動きの後に、裏向きカードが順番に着地する画面へ切り替える。
      await new Promise((resolve) => window.setTimeout(resolve, 640));
      await onOpen();
    } finally {
      setCommitting(false);
    }
  }

  const envelopeDrag = useUpwardDrag({
    disabled,
    distancePx: ENVELOPE_DRAG_DISTANCE_PX,
    onComplete: finishEnvelopeOpening,
  });
  const bookDrag = useUpwardDrag({
    disabled,
    distancePx: BOOK_DRAG_DISTANCE_PX,
    onComplete: finishBookPull,
  });

  if (!envelopeOpened) {
    const openOpacity = envelopeDrag.progress / 100;
    return (
      <div className="pack-opening-layout" data-state="sealed">
        <div className="pack-envelope-object">
          <div
            aria-describedby="pack-envelope-help"
            aria-disabled={disabled}
            aria-label="封筒の上端を上へドラッグして開く"
            className="pack-envelope-pull-target"
            {...envelopeDrag.handlers}
            role="button"
            tabIndex={disabled ? -1 : 0}
          >
            <div className={`pack-envelope-scene sealed ${envelopeDrag.dragging ? "dragging" : ""}`}>
              <img
                alt=""
                aria-hidden="true"
                className="pack-envelope-image pack-envelope-open-layer"
                src="/assets/pack-envelope-open.png"
                style={{ opacity: openOpacity }}
              />
              <img
                alt="口を閉じた書店の紙封筒"
                className="pack-envelope-image pack-envelope-closed-layer"
                src="/assets/pack-envelope-closed.png"
                style={{
                  opacity: 1 - openOpacity,
                  transform: `translateY(${envelopeDrag.progress * -0.34}px)`,
                }}
              />
              <div className="pack-pull-indicator" aria-hidden="true">
                <ArrowUp size={26} />
                <strong>{Math.round(envelopeDrag.progress)}%</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="pack-opening-copy">
          <span className="pack-stage-status">未開封</span>
          <h3>封筒の口を開く</h3>
          <p>封筒の上端をつかみ、そのまま上へ引き上げてください。途中で離すと元へ戻ります。</p>
          <small id="pack-envelope-help"><MousePointer2 size={14} />上端を上へドラッグ</small>
          <small><Keyboard size={14} />Enterキーでも開けます</small>
        </div>
      </div>
    );
  }

  return (
    <div className="pack-opening-layout" data-state={committing ? "dealing" : "ready"}>
      <div className="pack-envelope-object">
        <div
          aria-describedby="pack-pull-help"
          aria-disabled={disabled}
          aria-label="封筒から本を上へ引き出す"
          className="pack-envelope-pull-target"
          {...bookDrag.handlers}
          role="button"
          tabIndex={disabled ? -1 : 0}
        >
          <div
            className={`pack-envelope-scene ${bookDrag.dragging ? "dragging" : ""} ${committing ? "committing" : ""}`}
            style={{ "--pull-offset": `${committing ? -220 : bookDrag.progress * -1.55}px` }}
          >
            <div className="pack-card-bundle-window">
              <img alt="" aria-hidden="true" className="pack-card-bundle" src="/assets/pack-card-bundle.png" />
            </div>
            <img alt="" aria-hidden="true" className="pack-envelope-image" src="/assets/pack-envelope-open.png" />
            <div className="pack-pull-indicator" aria-hidden="true">
              <ArrowUp size={26} />
              <strong>{Math.round(bookDrag.progress)}%</strong>
            </div>
          </div>
        </div>
      </div>
      <div className="pack-opening-copy">
        <span className="pack-stage-status">{committing ? "開封中" : "まだ中身は見えません"}</span>
        <h3>{committing ? "カードを並べています" : "本を上へ引き出す"}</h3>
        <p>
          {committing
            ? "取り出したカードを、裏向きのまま机へ並べています。"
            : "書店の袋から取り出すように、見えているカード束をつかんで上へ動かしてください。"}
        </p>
        <small id="pack-pull-help"><MousePointer2 size={14} />カード束を上へドラッグ</small>
        <small><Keyboard size={14} />Enterキーでも取り出せます</small>
      </div>
    </div>
  );
}
