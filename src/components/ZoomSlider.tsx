import { useCallback } from 'react';
import { ZOOM_FACTOR } from '../lib/grid';
import { useT } from '../i18n/useT';
import './ZoomSlider.css';

interface ZoomSliderProps {
  orientation: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

/** スライダー内部の目盛り解像度（連続値を整数レンジへマッピングする） */
const STEPS = 1000;

/**
 * Cubase のプロジェクト/キーエディタ右下にあるような、
 * 縮小・拡大ボタン + ドラッグ可能なズームスライダー。
 *
 * ズーム範囲は対数スケールでスライダーへマッピングする。線形だと
 * よく使う低倍率側の刻みが粗くなりすぎるため（0.25〜4倍の直線配分では
 * 実用域の1倍付近をわずかな移動量で通り過ぎてしまう）。
 */
export function ZoomSlider({ orientation, value, min, max, onChange, ariaLabel }: ZoomSliderProps) {
  const ratio = max / min;
  const toSlider = (v: number) => Math.round((Math.log(v / min) / Math.log(ratio)) * STEPS);
  const fromSlider = (raw: number) => min * Math.pow(ratio, raw / STEPS);
  const { locale } = useT();

  const step = useCallback(
    (factor: number) => onChange(Math.min(max, Math.max(min, value * factor))),
    [max, min, onChange, value],
  );

  return (
    <div className={`zoom-slider zoom-slider--${orientation}`} role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="zoom-slider__btn"
        onClick={() => step(1 / ZOOM_FACTOR)}
        disabled={value <= min + 1e-6}
        aria-label={locale === 'ja' ? `${ariaLabel} 縮小` : `${ariaLabel} zoom out`}
      >
        −
      </button>
      <span className="zoom-slider__track">
        <input
          type="range"
          className="zoom-slider__range"
          min={0}
          max={STEPS}
          value={toSlider(value)}
          onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
          aria-label={ariaLabel}
        />
      </span>
      <button
        type="button"
        className="zoom-slider__btn"
        onClick={() => step(ZOOM_FACTOR)}
        disabled={value >= max - 1e-6}
        aria-label={locale === 'ja' ? `${ariaLabel} 拡大` : `${ariaLabel} zoom in`}
      >
        ＋
      </button>
    </div>
  );
}
