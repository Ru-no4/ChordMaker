import { describe, expect, it } from 'vitest';
import { candidateToMidi, detectChord, formatIntervalName, midiToName, pitchClass } from './theory';

describe('pitchClass / midiToName', () => {
  it('wraps negative and large MIDI numbers into 0-11', () => {
    expect(pitchClass(60)).toBe(0);
    expect(pitchClass(-1)).toBe(11);
    expect(pitchClass(13)).toBe(1);
  });

  it('formats MIDI 60 as C4', () => {
    expect(midiToName(60)).toBe('C4');
  });
});

describe('detectChord', () => {
  it('returns empty result for no notes', () => {
    expect(detectChord([]).kind).toBe('empty');
  });

  it('returns candidates for a single note', () => {
    const result = detectChord([60]);
    expect(result.kind).toBe('candidates');
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('returns candidates with interval for two notes', () => {
    const result = detectChord([60, 67]); // C, G = perfect 5th
    expect(result.kind).toBe('candidates');
    expect(result.intervalSemitones).toBe(7);
  });

  it('identifies a root-position C major triad', () => {
    const result = detectChord([60, 64, 67]);
    expect(result.kind).toBe('chord');
    expect(result.chord?.symbol).toBe('C');
    expect(result.chord?.category).toBe('major');
  });

  it('identifies a C minor triad', () => {
    const result = detectChord([60, 63, 67]);
    expect(result.chord?.symbol).toBe('Cm');
    expect(result.chord?.category).toBe('minor');
  });

  it('identifies a dominant 7th chord', () => {
    const result = detectChord([60, 64, 67, 70]);
    expect(result.chord?.symbol).toBe('C7');
    expect(result.chord?.category).toBe('dominant');
  });

  it('identifies a slash chord when the bass is not the root', () => {
    // E, G, C (first inversion of C major, bass = E)
    const result = detectChord([64, 67, 72]);
    expect(result.chord?.symbol).toBe('C/E');
    expect(result.chord?.slashBass).toBe(pitchClass(64));
  });

  it('prefers the bass-rooted interpretation among equally valid readings', () => {
    const result = detectChord([60, 64, 67, 71]); // C, E, G, B = Cmaj7
    expect(result.chord?.symbol).toBe('Cmaj7');
  });
});

describe('candidateToMidi', () => {
  it('round-trips a candidate template back into ascending MIDI notes', () => {
    const result = detectChord([0]); // pitch class only via single note path
    const candidate = result.candidates[0];
    const midis = candidateToMidi(candidate, 48);
    expect(midis).toEqual([...midis].sort((a, b) => a - b));
    expect(midis[0]).toBeGreaterThanOrEqual(48);
  });
});

describe('formatIntervalName', () => {
  it('names a perfect 5th', () => {
    expect(formatIntervalName(7, 'en')).toBe('Perfect 5th');
  });

  it('appends octave count beyond one octave', () => {
    expect(formatIntervalName(19, 'en')).toBe('Perfect 5th + 1oct');
  });
});
