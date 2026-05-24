// src/ui/components/FeedbackPanel.tsx
import type { FeedbackResult, CriterionResult, GradeValue } from '../../pipeline/types';

interface Props {
  feedback: FeedbackResult;
}

const GRADE_COLORS: Partial<Record<GradeValue, string>> = {
  'A+': 'text-emerald-400', 'A': 'text-emerald-400', 'A-': 'text-emerald-400',
  'B+': 'text-blue-400', 'B': 'text-blue-400', 'B-': 'text-blue-400',
  'C+': 'text-yellow-400', 'C': 'text-yellow-400', 'C-': 'text-yellow-400',
  'D': 'text-orange-400', 'F': 'text-red-400', 'n/a': 'text-zinc-500',
};

const CRITERIA: Array<{ key: keyof FeedbackResult; label: string }> = [
  { key: 'arpeggios', label: 'Arpeggios' },
  { key: 'scaleRuns', label: 'Scale Runs' },
  { key: 'nonChordTones', label: 'Non-Chord Tones' },
  { key: 'unresolvedNcts', label: 'Unresolved NCTs' },
  { key: 'bluesScale', label: 'Blues Scale' },
  { key: 'alteredDominant', label: 'Altered Dominant' },
  { key: 'interestingPatterns', label: 'Interesting Patterns' },
  { key: 'leaps', label: 'Leaps' },
  { key: 'motivicDevelopment', label: 'Motivic Development' },
  { key: 'expressiveDevices', label: 'Expressive Devices' },
  { key: 'phraseStartBeats', label: 'Phrase Start Beats' },
  { key: 'phraseEndBeats', label: 'Phrase End Beats' },
  { key: 'phraseLength', label: 'Phrase Length' },
  { key: 'interPhraseRest', label: 'Inter-phrase Rest' },
  { key: 'pitchRange', label: 'Pitch Range' },
  { key: 'rhythmicUnits', label: 'Rhythmic Units' },
];

function CriterionCard({ label, result }: { label: string; result: CriterionResult }) {
  const gradeColor = GRADE_COLORS[result.grade] ?? 'text-zinc-400';
  return (
    <div className="bg-zinc-800 rounded-lg p-3 space-y-1">
      <div className="text-zinc-500 text-xs uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold text-zinc-100">{result.count}</span>
        <span className={`text-sm font-semibold ${gradeColor}`}>{result.grade}</span>
      </div>
      {result.examples.length > 0 && (
        <p className="text-zinc-500 text-xs truncate">{result.examples.slice(0, 2).join(' · ')}</p>
      )}
      {result.note && <p className="text-zinc-600 text-xs italic">{result.note}</p>}
    </div>
  );
}

export function FeedbackPanel({ feedback }: Props) {
  const overallColor = GRADE_COLORS[feedback.overallGrade] ?? 'text-zinc-400';
  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold text-zinc-100">Improv Feedback</h3>
        <span className={`text-2xl font-bold ${overallColor}`}>{feedback.overallGrade}</span>
      </div>
      {feedback.overallNote && (
        <p className="text-zinc-400 text-sm">{feedback.overallNote}</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {CRITERIA.map(({ key, label }) => {
          const result = feedback[key];
          if (!result || typeof result !== 'object' || !('count' in result)) return null;
          return <CriterionCard key={key} label={label} result={result as CriterionResult} />;
        })}
      </div>
    </div>
  );
}
