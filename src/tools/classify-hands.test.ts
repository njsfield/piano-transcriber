import { describe, it, expect } from 'vitest';
import { classifyHands } from './classify-hands';
import type { MidiEvent, ChordEvent } from '../pipeline/types';

function note(id: string, pitch: number, startMs = 0): MidiEvent {
  return { id, pitch, startMs, durationMs: 500, velocity: 80 };
}

const CHORDS: ChordEvent[] = [
  { measure: 1, beat: 1, symbol: 'Dm7' }, // D=2, F=5, A=9, C=0
];

describe('classifyHands', () => {
  it('classifies low chord tones as left hand', () => {
    // D3=50, F3=53, C4=60 — all chord tones of Dm7, all ≤ 64
    const notes = [note('a', 50), note('b', 53), note('c', 60)];
    const { leftHand, rightHand } = classifyHands(notes, CHORDS, 120, 4);
    expect(leftHand.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(rightHand).toHaveLength(0);
  });

  it('classifies low non-chord-tones as right hand', () => {
    // E3=52 is not a chord tone of Dm7 (Dm7 tones: D,F,A,C)
    const notes = [note('a', 52)];
    const { leftHand, rightHand } = classifyHands(notes, CHORDS, 120, 4);
    expect(leftHand).toHaveLength(0);
    expect(rightHand.map(n => n.id)).toEqual(['a']);
  });

  it('classifies notes above E4 (64) as right hand even if chord tones', () => {
    // F4=65 is a chord tone of Dm7 but above the ceiling
    const notes = [note('a', 65)];
    const { leftHand, rightHand } = classifyHands(notes, CHORDS, 120, 4);
    expect(leftHand).toHaveLength(0);
    expect(rightHand.map(n => n.id)).toEqual(['a']);
  });

  it('falls back to pitch split at MIDI 60 when no chords given', () => {
    const notes = [note('a', 59), note('b', 60), note('c', 61)];
    const { leftHand, rightHand } = classifyHands(notes, [], 120, 4);
    expect(leftHand.map(n => n.id)).toEqual(['a']);
    expect(rightHand.map(n => n.id)).toEqual(['b', 'c']);
  });

  it('uses the correct active chord based on note timing', () => {
    const chords: ChordEvent[] = [
      { measure: 1, beat: 1, symbol: 'Cmaj7' }, // C=0, E=4, G=7, B=11
      { measure: 2, beat: 1, symbol: 'Dm7' },   // D=2, F=5, A=9, C=0
    ];
    // At 120 BPM 4/4: measure 2 starts at 2000ms
    // D3=50 (pitch class 2) is a chord tone of Dm7 but NOT of Cmaj7
    const noteInM1 = note('a', 50, 0);    // measure 1 — Cmaj7 active, D not a tone
    const noteInM2 = note('b', 50, 2000); // measure 2 — Dm7 active, D IS a tone
    const { leftHand, rightHand } = classifyHands([noteInM1, noteInM2], chords, 120, 4);
    expect(leftHand.map(n => n.id)).toEqual(['b']);
    expect(rightHand.map(n => n.id)).toEqual(['a']);
  });

  it('parses chord tones correctly for common qualities', () => {
    // G7 = G(7), B(11), D(2), F(5) — pitch classes
    const chords: ChordEvent[] = [{ measure: 1, beat: 1, symbol: 'G7' }];
    const gNote  = note('g',  43); // G2, pitch class 7
    const bNote  = note('b',  47); // B2, pitch class 11
    const dNote  = note('d',  50); // D3, pitch class 2
    const fNote  = note('f',  53); // F3, pitch class 5
    const eNote  = note('e',  52); // E3, pitch class 4 — NOT in G7
    const { leftHand } = classifyHands([gNote, bNote, dNote, fNote, eNote], chords, 120, 4);
    const lhIds = leftHand.map(n => n.id);
    expect(lhIds).toContain('g');
    expect(lhIds).toContain('b');
    expect(lhIds).toContain('d');
    expect(lhIds).toContain('f');
    expect(lhIds).not.toContain('e');
  });
});
