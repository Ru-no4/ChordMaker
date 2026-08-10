import { useEffect, useRef, useState } from 'react';

interface NumberFieldProps {
  id?: string;
  className?: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  'aria-label'?: string;
}

/**
 * 入力中は値を触らず、確定（フォーカスアウト / Enter）でだけ範囲に丸める数値入力。
 *
 * onChange のたびにクランプすると、全消しして打ち直すことができない
 * （空欄が即座に最小値へ戻ってしまう）。編集中の文字列は下書きとして持ち、
 * 確定時にだけ数値へ変換する。
 */
export function NumberField({
  id,
  className,
  value,
  min,
  max,
  onCommit,
  'aria-label': ariaLabel,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const editingRef = useRef(false);

  // 外から値が変わったとき（スライダー操作など）は表示を合わせる。
  // 編集中は上書きしない。
  useEffect(() => {
    if (!editingRef.current) setDraft(String(value));
  }, [value]);

  /**
   * 確定処理。値は state ではなく入力要素から直接読む。
   * state 経由だと「入力してすぐ blur」したときに再レンダリング前の
   * 古いドラフトを掴んでしまう。
   */
  const commit = (raw: string) => {
    editingRef.current = false;
    const text = raw.trim();
    const parsed = Number(text);
    if (text === '' || Number.isNaN(parsed)) {
      setDraft(String(value)); // 空・不正入力は元に戻す
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      id={id}
      className={className}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      aria-label={ariaLabel}
      onFocus={() => {
        editingRef.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          editingRef.current = false;
          setDraft(String(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
