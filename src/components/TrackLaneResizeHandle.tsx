import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { capturePointer, releasePointer } from '../lib/pointer';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';

interface TrackLaneResizeHandleProps {
  /** このトラックの現在の表示高さ(px)。共有ズーム由来か、既に上書き済みかは問わない */
  height: number;
  onResize: (px: number) => void;
  onReset: () => void;
}

/**
 * トラック1本ぶんのレーンの下端。ドラッグして、このトラックだけの高さを
 * 共有の縦ズーム（chordZoomY）から個別に上書きする
 * （ChordTrackResizeHandle と同じ考え方をトラック単位に一般化したもの）。
 * ダブルクリックで上書きを解除し、共有ズームへ戻す。
 * ズームとは独立した表示レイアウトの好みなので Undo 対象にはしない。
 * レーンの下端に薄く重ねるだけで、ホバーするまでは見えないようにしている
 * （常時表示するとトラックが増えたときに間延びして見えるため）。
 */
export function TrackLaneResizeHandle({ height, onResize, onReset }: TrackLaneResizeHandleProps) {
  const { t } = useT();
  const tl = strings.trackLane;
  const dragRef = useRef<{ originY: number; originHeight: number } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      capturePointer(e.currentTarget, e.pointerId);
      dragRef.current = { originY: e.clientY, originHeight: height };
    },
    [height],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      onResize(drag.originHeight + (e.clientY - drag.originY));
    },
    [onResize],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    releasePointer(e.currentTarget, e.pointerId);
  }, []);

  return (
    <div
      className="track-lane-resize-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset();
      }}
      role="separator"
      aria-orientation="horizontal"
      title={t(tl.resizeTitle)}
      aria-label={t(tl.resizeAria)}
    >
      <span className="track-lane-resize-handle__grip" aria-hidden="true" />
    </div>
  );
}
