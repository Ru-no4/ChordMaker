import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useProjectStore } from '../store/useProjectStore';
import { capturePointer, releasePointer } from '../lib/pointer';
import { useT } from '../i18n/useT';
import { strings } from '../i18n/strings';
import './ChordTrackResizeHandle.css';

/**
 * コードトラックとピアノロールの間の境界。上下にドラッグしてコードトラック
 * 「エリア」（全レーンをまとめて表示する領域）の表示高さを調整する
 * （下限は既定ズームでのレーン1本ぶんの高さ、上限は514px。lib/grid.ts 参照）。
 * 個々のレーンの高さは縦ズーム（chordZoomY）から決まるので、ここでは触らない。
 * ズームとは独立した、純粋な表示レイアウトの好みなので Undo 対象にはしない。
 */
export function ChordTrackResizeHandle() {
  const chordTrackAreaHeight = useProjectStore((s) => s.chordTrackAreaHeight);
  const setChordTrackAreaHeight = useProjectStore((s) => s.setChordTrackAreaHeight);
  const { t } = useT();
  const dragRef = useRef<{ originY: number; originHeight: number } | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      capturePointer(e.currentTarget, e.pointerId);
      dragRef.current = { originY: e.clientY, originHeight: chordTrackAreaHeight };
    },
    [chordTrackAreaHeight],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      setChordTrackAreaHeight(drag.originHeight + (e.clientY - drag.originY));
    },
    [setChordTrackAreaHeight],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    releasePointer(e.currentTarget, e.pointerId);
  }, []);

  return (
    <div
      className="chord-track-resize-handle"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      role="separator"
      aria-orientation="horizontal"
      title={t(strings.chordTrackResizeHandle.title)}
      aria-label={t(strings.chordTrackResizeHandle.aria)}
    >
      <span className="chord-track-resize-handle__grip" aria-hidden="true" />
    </div>
  );
}
