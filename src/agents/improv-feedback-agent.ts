// src/agents/improv-feedback-agent.ts
import { OpenAIAgent } from '../openai-agent';
import { LoggingMiddleware } from '../middleware';
import { FeedbackTool } from '../tools/feedback-tool';
import type { MidiEvent, ChordEvent, MusicFeatures } from '../pipeline/types';

const CRITERIA_PROMPT = `
Score the improvisation on these 16 criteria. For each criterion, return a CriterionResult with:
- count: numeric count (or 0 for pattern-type criteria where counting is imprecise)
- grade: letter grade — must be one of: A+, A, A-, B+, B, B-, C+, C, C-, D, F, or n/a
- examples: 1-3 specific measure-level examples (e.g. "m7: G#→B→D over E7")
- note: optional caveat string

Grade on richness and variation relative to the length of the solo. A short solo with great ideas should score well.

CRITERIA:
1. arpeggios — 3+ consecutive RH notes outlining a chord, spanning ≥ a 5th
2. scaleRuns — 4+ consecutive stepwise notes (whole or half steps only)
3. nonChordTones — RH notes whose pitch class is not in the active chord tone set
4. unresolvedNcts — NCTs not followed by a step to a chord tone within 2 notes
5. bluesScale — windows of 5+ notes using the blues scale (1 b3 4 b5 5 b7) of the tonic
6. alteredDominant — b9/#9/#11/b13 tensions used over V7 chords
7. interestingPatterns — direction-changing scalar fragments, enclosures (chromatic from both sides), bebop devices
8. leaps — intervals ≥ a 5th within a phrase (not at phrase boundaries)
9. motivicDevelopment — recurring 3–5 note rhythmic or contour pattern across ≥ 2 non-adjacent phrases
10. expressiveDevices — grace notes (isGraceNote=true), trills (rapid alternation ≥ 3 times), octave gestures
11. phraseStartBeats — beat position of first note of each phrase (distribution across beats 1/2/3/4/upbeats)
12. phraseEndBeats — beat position of last note of each phrase (distribution)
13. phraseLength — mean and median phrase length in beats
14. interPhraseRest — mean and median gap between phrases in beats
15. pitchRange — semitones between lowest and highest RH note
16. rhythmicUnits — distribution of note durations (count of each: whole/half/quarter/dotted-quarter/8th/8th-triplet/16th/other)

Also return:
- overallGrade: single letter A, B, C, D, or F for the whole solo
- overallNote: optional 1–2 sentence summary of strengths and one key area to improve

Return ONLY a JSON object matching the FeedbackResult schema. No explanation outside the JSON.
`;

const SYSTEM = `You are an expert jazz educator analysing a piano improvisation.
Call get_feedback_data once to receive pre-processed musical data, then analyse it and return a FeedbackResult JSON.
${CRITERIA_PROMPT}`;

export function createImprovFeedbackAgent(
  _musicxmlPath: string,
  rhNotes: MidiEvent[],
  chords: ChordEvent[],
  features: MusicFeatures,
) {
  return new OpenAIAgent('ImprovFeedbackAgent', SYSTEM, {
    model: 'gpt-4o',
    tools: [new FeedbackTool(rhNotes, chords, features)],
    middleware: [new LoggingMiddleware()],
  });
}
