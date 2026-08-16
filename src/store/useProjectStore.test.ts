import { describe, expect, it } from 'vitest';
import { useProjectStore } from './useProjectStore';
import type { ProjectFile } from '../lib/projectFile';

const baseFile: ProjectFile = {
  app: 'ChrodMaker',
  formatVersion: 2,
  savedAt: new Date().toISOString(),
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  bars: 8,
  rangeStart: 0,
  chordResolution: 4,
  quantize: 16,
  snap: true,
  tracks: [
    {
      id: 'trk-1',
      name: 'TRACK 1',
      color: '#4f8cff',
      kind: 'chord',
      instrumentId: 'synth-basic',
      volumeDb: -6,
      muted: false,
      solo: false,
      blocks: [],
    },
  ],
};

describe('loadProject: untrusted .chrd file value clamping', () => {
  it('clamps an absurdly large bars value instead of trusting it verbatim', () => {
    useProjectStore.getState().loadProject({ ...baseFile, bars: 10_000_000_000 });
    expect(useProjectStore.getState().bars).toBeLessThanOrEqual(512);
  });

  it('clamps bpm into the normal 20-300 range', () => {
    useProjectStore.getState().loadProject({ ...baseFile, bpm: 999999 });
    expect(useProjectStore.getState().bpm).toBe(300);
    useProjectStore.getState().loadProject({ ...baseFile, bpm: -50 });
    expect(useProjectStore.getState().bpm).toBe(20);
  });

  it('clamps time signature numerator/denominator away from zero and extreme values', () => {
    useProjectStore.getState().loadProject({
      ...baseFile,
      timeSignature: { numerator: 0, denominator: -1 },
    });
    const sig = useProjectStore.getState().timeSignature;
    expect(sig.numerator).toBeGreaterThanOrEqual(1);
    expect(sig.denominator).toBeGreaterThanOrEqual(1);
  });

  it('falls back to a default chordResolution/quantize when given a value outside the allowed set', () => {
    // 実際には parseProjectFile を経ずに untyped な JSON からここへ来る想定なので、
    // 許容値の外にある数値をあえて型を迂回して渡す。
    useProjectStore.getState().loadProject({
      ...baseFile,
      chordResolution: 999,
      quantize: 999,
    } as unknown as ProjectFile);
    const s = useProjectStore.getState();
    expect([1, 2, 3, 4, 6, 8]).toContain(s.chordResolution);
    expect([4, 8, 16, 32]).toContain(s.quantize);
  });

  it('still accepts values that were already within the normal range', () => {
    useProjectStore.getState().loadProject({ ...baseFile, bpm: 140, bars: 16 });
    const s = useProjectStore.getState();
    expect(s.bpm).toBe(140);
    expect(s.bars).toBe(16);
  });
});
