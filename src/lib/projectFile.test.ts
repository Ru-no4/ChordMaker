import { describe, expect, it } from 'vitest';
import { ProjectFileError, parseProjectFile, serializeProject } from './projectFile';
import type { SerializedTrack } from './projectFile';

const baseTrack: SerializedTrack = {
  id: 'trk-1',
  name: 'TRACK 1',
  color: '#4f8cff',
  kind: 'chord',
  instrumentId: 'synth-basic',
  volumeDb: -6,
  muted: false,
  solo: false,
  laneHeightPx: null,
  blocks: [],
};

const baseSource = {
  bpm: 120,
  timeSignature: { numerator: 4, denominator: 4 },
  bars: 8,
  rangeStart: 0,
  chordResolution: 4 as const,
  quantize: 16 as const,
  snap: true,
  tracks: [baseTrack],
};

describe('serializeProject / parseProjectFile round trip', () => {
  it('parses back what it serialized', () => {
    const file = serializeProject(baseSource);
    const text = JSON.stringify(file);
    const parsed = parseProjectFile(text);
    expect(parsed.bpm).toBe(120);
    expect(parsed.tracks).toEqual([baseTrack]);
    expect(parsed.formatVersion).toBe(2);
  });
});

describe('parseProjectFile error handling', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseProjectFile('{not json')).toThrow(ProjectFileError);
    try {
      parseProjectFile('{not json');
    } catch (e) {
      expect((e as ProjectFileError).code).toBe('invalid-json');
    }
  });

  it('rejects files from another app', () => {
    const text = JSON.stringify({ ...serializeProject(baseSource), app: 'SomethingElse' });
    try {
      parseProjectFile(text);
      expect.unreachable();
    } catch (e) {
      expect((e as ProjectFileError).code).toBe('wrong-app');
    }
  });

  it('rejects unsupported (future) format versions', () => {
    const text = JSON.stringify({ ...serializeProject(baseSource), formatVersion: 999 });
    try {
      parseProjectFile(text);
      expect.unreachable();
    } catch (e) {
      expect((e as ProjectFileError).code).toBe('unsupported-version');
    }
  });

  it('rejects a corrupt time signature', () => {
    const file = serializeProject(baseSource) as unknown as Record<string, unknown>;
    file.timeSignature = { numerator: 4 };
    try {
      parseProjectFile(JSON.stringify(file));
      expect.unreachable();
    } catch (e) {
      expect((e as ProjectFileError).code).toBe('corrupt-time-signature');
    }
  });

  it('rejects tracks with malformed blocks', () => {
    const file = serializeProject(baseSource) as unknown as Record<string, unknown>;
    file.tracks = [{ ...baseTrack, blocks: [{ id: 'b1' /* missing fields */ }] }];
    try {
      parseProjectFile(JSON.stringify(file));
      expect.unreachable();
    } catch (e) {
      expect((e as ProjectFileError).code).toBe('corrupt-blocks');
    }
  });
});

describe('backward-compatible migration', () => {
  it('migrates a v1 file (no tracks array) into a single chord track', () => {
    const v1 = {
      app: 'ChrodMaker',
      formatVersion: 1,
      savedAt: new Date().toISOString(),
      bpm: 100,
      timeSignature: { numerator: 4, denominator: 4 },
      bars: 4,
      chordResolution: 4,
      quantize: 16,
      snap: true,
      instrumentId: 'synth-basic',
      volumeDb: -3,
      blocks: [],
    };
    const parsed = parseProjectFile(JSON.stringify(v1));
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0].kind).toBe('chord');
    expect(parsed.tracks[0].instrumentId).toBe('synth-basic');
    expect(parsed.tracks[0].laneHeightPx).toBeNull();
    // rangeStart absent in v1 -> defaults to 0
    expect(parsed.rangeStart).toBe(0);
  });

  it('fills in kind and laneHeightPx as chord/null when absent from a v2 track (pre-Phase7/6 file)', () => {
    const { kind: _kind, laneHeightPx: _laneHeightPx, ...trackWithoutNewFields } = baseTrack;
    const file = {
      ...serializeProject(baseSource),
      tracks: [trackWithoutNewFields],
    };
    const parsed = parseProjectFile(JSON.stringify(file));
    expect(parsed.tracks[0].kind).toBe('chord');
    expect(parsed.tracks[0].laneHeightPx).toBeNull();
  });

  it('preserves an explicit notes-kind track and a custom lane height', () => {
    const file = {
      ...serializeProject(baseSource),
      tracks: [{ ...baseTrack, kind: 'notes', laneHeightPx: 96 }],
    };
    const parsed = parseProjectFile(JSON.stringify(file));
    expect(parsed.tracks[0].kind).toBe('notes');
    expect(parsed.tracks[0].laneHeightPx).toBe(96);
  });
});
