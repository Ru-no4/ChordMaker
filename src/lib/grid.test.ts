import { describe, expect, it } from 'vitest';
import {
  chordResolutionSteps,
  clamp,
  contentExtentSteps,
  displayBars,
  edgeMarginSteps,
  formatPosition,
  quantizeSteps,
  snapLength,
  snapStep,
  stepsPerBar,
  stepsPerBeat,
  totalSteps,
} from './grid';

describe('step math', () => {
  it('computes 8 steps per beat in 4/4 (32分音符基準)', () => {
    expect(stepsPerBeat({ numerator: 4, denominator: 4 })).toBe(8);
    expect(stepsPerBar({ numerator: 4, denominator: 4 })).toBe(32);
  });

  it('computes 4 steps per beat in 6/8', () => {
    expect(stepsPerBeat({ numerator: 6, denominator: 8 })).toBe(4);
    expect(stepsPerBar({ numerator: 6, denominator: 8 })).toBe(24);
  });

  it('multiplies bars into total steps', () => {
    expect(totalSteps({ numerator: 4, denominator: 4 }, 4)).toBe(128);
  });

  it('gives a 1-beat edge margin regardless of time signature', () => {
    expect(edgeMarginSteps({ numerator: 4, denominator: 4 })).toBe(8);
    expect(edgeMarginSteps({ numerator: 6, denominator: 8 })).toBe(4);
  });
});

describe('chordResolutionSteps', () => {
  it('divides a 4/4 bar evenly for divisions that fit', () => {
    expect(chordResolutionSteps({ numerator: 4, denominator: 4 }, 4)).toBe(8);
  });

  it('allows fractional windows for triplet-style divisions', () => {
    expect(chordResolutionSteps({ numerator: 4, denominator: 4 }, 3)).toBeCloseTo(32 / 3);
  });
});

describe('quantizeSteps', () => {
  it('maps quantize denominators to step counts', () => {
    expect(quantizeSteps(4)).toBe(8);
    expect(quantizeSteps(8)).toBe(4);
    expect(quantizeSteps(16)).toBe(2);
    expect(quantizeSteps(32)).toBe(1);
  });
});

describe('snapStep / snapLength', () => {
  it('rounds to the nearest integer when snap is off', () => {
    expect(snapStep(3.6, 16, false)).toBe(4);
  });

  it('snaps to the quantize grid when enabled', () => {
    // quantize 8 -> grid of 4 steps
    expect(snapStep(5, 8, true)).toBe(4);
    expect(snapStep(7, 8, true)).toBe(8);
  });

  it('never returns a length below one grid unit', () => {
    expect(snapLength(0, 16, true)).toBe(2);
    expect(snapLength(0, 32, false)).toBe(1);
  });
});

describe('contentExtentSteps / displayBars', () => {
  const sig = { numerator: 4, denominator: 4 };

  it('returns 0 for no blocks', () => {
    expect(contentExtentSteps([])).toBe(0);
  });

  it('finds the furthest block end', () => {
    expect(
      contentExtentSteps([
        { start: 0, length: 32 },
        { start: 64, length: 16 },
      ]),
    ).toBe(80);
  });

  it('uses bars as the floor even with no content', () => {
    expect(displayBars(sig, 4, [])).toBe(4);
  });

  it('extends past bars when content overflows it', () => {
    // content ends at step 160 = bar 5 (0-indexed 4..5), bars=4 -> should grow to 5
    expect(displayBars(sig, 4, [{ start: 0, length: 160 }])).toBe(5);
  });
});

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('formatPosition', () => {
  it('formats the first step of the first bar as 1.1.1', () => {
    expect(formatPosition(0, { numerator: 4, denominator: 4 })).toBe('1.1.1');
  });

  it('formats a step into the second bar', () => {
    // bar 0 = steps 0..31 in 4/4, so step 32 is bar 2 beat 1
    expect(formatPosition(32, { numerator: 4, denominator: 4 })).toBe('2.1.1');
  });

  it('formats mid-beat position', () => {
    // step 10 -> bar 1, beat 2 (steps 8-15), tick 3 within beat
    expect(formatPosition(10, { numerator: 4, denominator: 4 })).toBe('1.2.3');
  });
});
