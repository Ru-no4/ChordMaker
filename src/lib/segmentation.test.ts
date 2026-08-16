import { describe, expect, it } from 'vitest';
import { resolveActiveSegment, segmentAt, segmentBlock } from './segmentation';
import type { NoteItem } from '../store/useProjectStore';

const note = (partial: Partial<NoteItem> & Pick<NoteItem, 'midi' | 'start' | 'length'>): NoteItem => ({
  id: `n-${partial.midi}-${partial.start}`,
  velocity: 100,
  ...partial,
});

describe('segmentBlock', () => {
  it('returns a single empty segment covering the whole block when there are no notes', () => {
    const segments = segmentBlock({ start: 0, length: 32, notes: [] }, 8);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 0, length: 32 });
    expect(segments[0].detection.kind).toBe('empty');
  });

  it('keeps a single chord held for the whole block as one segment', () => {
    // C major triad held across the whole 1-bar block, resolution = quarter note (8 steps)
    const notes = [
      note({ midi: 60, start: 0, length: 32 }),
      note({ midi: 64, start: 0, length: 32 }),
      note({ midi: 67, start: 0, length: 32 }),
    ];
    const segments = segmentBlock({ start: 0, length: 32, notes }, 8);
    expect(segments).toHaveLength(1);
    expect(segments[0].detection.chord?.symbol).toBe('C');
    // covers the whole block with no gaps
    expect(segments[0].start).toBe(0);
    expect(segments[0].length).toBe(32);
  });

  it('splits into separate segments when the chord changes mid-block', () => {
    // C major triad for the first half, G major triad for the second half (1 bar, resolution = half bar)
    const notes = [
      note({ midi: 60, start: 0, length: 16 }),
      note({ midi: 64, start: 0, length: 16 }),
      note({ midi: 67, start: 0, length: 16 }),
      note({ midi: 67, start: 16, length: 16 }),
      note({ midi: 71, start: 16, length: 16 }),
      note({ midi: 74, start: 16, length: 16 }),
    ];
    const segments = segmentBlock({ start: 0, length: 32, notes }, 16);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0].detection.chord?.symbol).toBe('C');
    expect(segments[segments.length - 1].detection.chord?.symbol).toBe('G');
    // segments cover the block with no gaps
    expect(segments[0].start).toBe(0);
    expect(segments[segments.length - 1].start + segments[segments.length - 1].length).toBe(32);
  });
});

describe('segmentAt', () => {
  const segments = segmentBlock(
    { start: 0, length: 32, notes: [note({ midi: 60, start: 0, length: 32 })] },
    8,
  );

  it('finds the segment containing a given relative step', () => {
    expect(segmentAt(segments, 5)).toBe(segments[0]);
  });

  it('falls back to the last segment when the step is past the end', () => {
    expect(segmentAt(segments, 999)).toBe(segments[segments.length - 1]);
  });

  it('returns null for an empty segment list', () => {
    expect(segmentAt([], 0)).toBeNull();
  });
});

describe('resolveActiveSegment', () => {
  const segments = segmentBlock(
    { start: 0, length: 32, notes: [note({ midi: 60, start: 0, length: 32 })] },
    8,
  );

  it('prefers the explicitly selected segment', () => {
    expect(resolveActiveSegment(segments, 0, 20)).toBe(segmentAt(segments, 0));
  });

  it('falls back to the playhead position when nothing is selected', () => {
    expect(resolveActiveSegment(segments, null, 5)).toBe(segmentAt(segments, 5));
  });

  it('falls back to the first segment when nothing is selected or playing', () => {
    expect(resolveActiveSegment(segments, null, null)).toBe(segments[0]);
  });

  it('returns null when there are no segments', () => {
    expect(resolveActiveSegment([], null, null)).toBeNull();
  });
});
