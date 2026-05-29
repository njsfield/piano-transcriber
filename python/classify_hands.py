from pydantic import BaseModel
from typing import List, Literal, Dict, Optional, cast


class MidiEvent(BaseModel):
    id: str
    pitch: int
    startMs: float
    durationMs: float
    velocity: int


class Chord(BaseModel):
    measure: int = 1  # 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16...
    beat_offset: int  # 1,2,3,4
    symbol: str  # Amaj


Hand = Literal["LH", "RH"]
HandAssignment = Dict[str, Hand]
HandConfidence = Dict[str, float]


class MidiSeperation(BaseModel):
    midiEvents: List[MidiEvent]
    chords: List[Chord]
    tempo: int


SUSTAIN_LH_SEC = 0.5
HIGH_RH_FLOOR = 72
SHORT_DUR_SEC = 0.3
CLUSTER_WINDOW_SEC = 0.05
CLUSTER_MAX_SPAN = 16
HAND_SPAN_MAX = 14
JUMP_MAX_SEC = 0.1
JUMP_MAX_SEMITONES = 24
ISOLATED_RH_FLOOR = 55
CLUSTER_ACTIVE_BUFFER = 0.15
CLUSTER_END_BUFFER = 0.05
PASS4_ABOVE_MARGIN = 4
PASS4_SUSTAINED_DUR = 0.3
PASS4_FAST_WINDOW = 0.4
PASS4_FAST_COUNT = 2
PASS4_FAST_PITCH_FLOOR = 60

CONFIDENCE = {
    "pass_1": 0.95,
    "pass_2": 0.90,
    "pass_3_verified": 0.95,
    "pass_4_clear": 0.80,
    "pass_4_ambiguous": 0.55,
    "pass_5": 0.65,
    "pass_6": 0.50,
}

_SINGLE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_MODIFIED = {
    "Db": 1,
    "Eb": 3,
    "Fb": 4,
    "Gb": 6,
    "Ab": 8,
    "Bb": 10,
    "Cb": 11,
    "C#": 1,
    "D#": 3,
    "E#": 5,
    "F#": 6,
    "G#": 8,
    "A#": 10,
}
_QUALITIES = {
    "": [0, 4, 7],
    "maj": [0, 4, 7],
    "M": [0, 4, 7],
    "maj7": [0, 4, 7, 11],
    "M7": [0, 4, 7, 11],
    "m": [0, 3, 7],
    "min": [0, 3, 7],
    "m7": [0, 3, 7, 10],
    "min7": [0, 3, 7, 10],
    "7": [0, 4, 7, 10],
    "dim": [0, 3, 6],
    "dim7": [0, 3, 6, 9],
    "m7b5": [0, 3, 6, 10],
    "aug": [0, 4, 8],
    "sus4": [0, 5, 7],
    "sus2": [0, 2, 7],
}


class ClassifyHands(MidiSeperation):
    confidence: dict[str, float] = {}
    label: dict[str, str | None] = {}
    lh_clusters: list[list] = []

    def __init__(self, midiEvents, chords, tempo):
        super().__init__(midiEvents=midiEvents, chords=chords, tempo=tempo)
        self.label = {n.id: None for n in self.midiEvents}

    def onset(self, n: MidiEvent):
        return n.startMs / 1000.0

    def offset(self, n: MidiEvent):
        return (n.startMs + n.durationMs) / 1000.0

    def dur(self, n: MidiEvent):
        return n.durationMs / 1000.0

    def chord_time(self, c: Chord):
        return ((c.measure - 1) * 4 + (c.beat_offset - 1)) * (60.0 / self.tempo)

    def chord_at(self, onset_s: float) -> Optional[Chord]:
        if not self.chords:
            return None
        active = None
        for c in sorted(self.chords, key=self.chord_time):
            if self.chord_time(c) <= onset_s:
                active = c
        return active

    def parse_root_and_quality(self, symbol: str) -> tuple[int, str] | None:
        if not symbol:
            return None
        if len(symbol) >= 2 and symbol[:2] in _MODIFIED:
            return _MODIFIED[symbol[:2]], symbol[2:]
        if symbol[0] in _SINGLE:
            return _SINGLE[symbol[0]], symbol[1:]
        return None

    def chord_pcs(self, symbol: str) -> set[int] | None:
        parsed = self.parse_root_and_quality(symbol)
        if parsed is None:
            return None
        root, quality = parsed
        intervals = _QUALITIES.get(quality, _QUALITIES[""])
        return {(root + i) % 12 for i in intervals}

    def tensions(self, symbol: str) -> set[int]:
        parsed = self.parse_root_and_quality(symbol)
        if parsed is None:
            return set()
        root, _ = parsed
        return {(root + 2) % 12, (root + 5) % 12, (root + 9) % 12}

    def matches_voicing(self, cluster_pcs: set[int], symbol: str) -> bool:
        pcs = self.chord_pcs(symbol)
        if pcs is None:
            return True  # unrecognised symbol: can't verify, assume OK
        extended = pcs | self.tensions(symbol)
        return len(cluster_pcs & extended) >= len(cluster_pcs) - 1

    def active_lh_cluster(self, onset_s: float):
        for cluster in self.lh_clusters:
            c_onset = self.onset(cluster[0])
            c_max_offset = max(self.offset(n) for n in cluster)
            if (
                c_onset - CLUSTER_ACTIVE_BUFFER
                <= onset_s
                <= c_max_offset - CLUSTER_END_BUFFER
            ):
                return cluster
        return None

    def count_fast_near(self, onset_s: float) -> int:
        half = PASS4_FAST_WINDOW / 2
        return sum(
            1
            for n in self.midiEvents
            if abs(self.onset(n) - onset_s) <= half and self.dur(n) < SHORT_DUR_SEC
        )

    def furthest_from_median(self, note_list: list[MidiEvent]) -> MidiEvent:
        pitches = sorted(n.pitch for n in note_list)
        k = len(pitches)
        median = (
            (pitches[k // 2 - 1] + pitches[k // 2]) / 2.0
            if k % 2 == 0
            else float(pitches[k // 2])
        )
        return max(note_list, key=lambda n: abs(n.pitch - median))

    def pass_1(self):
        notes = self.midiEvents

        for note in notes:
            d = self.dur(note)
            if d >= SUSTAIN_LH_SEC and note.pitch <= HIGH_RH_FLOOR:
                self.label[note.id] = "LH"
                self.confidence[note.id] = CONFIDENCE["pass_1"]
            elif d < SHORT_DUR_SEC and note.pitch >= HIGH_RH_FLOOR:
                self.label[note.id] = "RH"
                self.confidence[note.id] = CONFIDENCE["pass_1"]

    def pass_2(self):
        notes = self.midiEvents

        sorted_notes = sorted(notes, key=lambda n: (self.onset(n), n.id))
        raw_clusters: list[list[MidiEvent]] = []
        current: list[MidiEvent] = []
        for note in sorted_notes:
            if (
                current
                and (self.onset(note) - self.onset(current[0])) < CLUSTER_WINDOW_SEC
            ):
                current.append(note)
            else:
                if len(current) >= 3:
                    raw_clusters.append(current)
                current = [note]
        if len(current) >= 3:
            raw_clusters.append(current)

        for cluster in raw_clusters:
            span = max(n.pitch for n in cluster) - min(n.pitch for n in cluster)
            if span <= CLUSTER_MAX_SPAN:
                self.lh_clusters.append(cluster)
                for note in cluster:
                    if self.label[note.id] is None:
                        self.label[note.id] = "LH"
                        self.confidence[note.id] = CONFIDENCE["pass_2"]

    def pass_3(self):
        confirmed_lh_clusters: list[list] = []
        for cluster in self.lh_clusters:
            active = self.chord_at(self.onset(cluster[0]))
            if active is None or self.chord_pcs(active.symbol) is None:
                confirmed_lh_clusters.append(cluster)
                continue
            cpcs = {n.pitch % 12 for n in cluster}
            if self.matches_voicing(cpcs, active.symbol):
                confirmed_lh_clusters.append(cluster)
                for note in cluster:
                    if self.label[note.id] == "LH":
                        self.confidence[note.id] = CONFIDENCE["pass_3_verified"]
            else:
                for note in cluster:
                    self.label[note.id] = None
                    self.confidence.pop(note.id, None)

        self.lh_clusters = confirmed_lh_clusters

    def pass_4(self):
        notes = self.midiEvents

        for note in notes:
            if self.label[note.id] is not None:
                continue
            cluster = self.active_lh_cluster(self.onset(note))
            if cluster is None:
                continue
            lh_top = max(n.pitch for n in cluster)
            lh_min = min(n.pitch for n in cluster)
            d = self.dur(note)
            if note.pitch < lh_min - 12:
                self.label[note.id] = "LH"
                self.confidence[note.id] = CONFIDENCE["pass_4_clear"]
            elif note.pitch <= lh_top and d >= PASS4_SUSTAINED_DUR:
                self.label[note.id] = "LH"
                self.confidence[note.id] = CONFIDENCE["pass_4_clear"]
            elif note.pitch > lh_top + PASS4_ABOVE_MARGIN:
                self.label[note.id] = "RH"
                self.confidence[note.id] = CONFIDENCE["pass_4_clear"]
            else:
                nearby_fast = self.count_fast_near(self.onset(note))
                if (
                    nearby_fast >= PASS4_FAST_COUNT
                    and note.pitch >= PASS4_FAST_PITCH_FLOOR
                ):
                    self.label[note.id] = "RH"
                else:
                    self.label[note.id] = "LH"
                self.confidence[note.id] = CONFIDENCE["pass_4_ambiguous"]

    def pass_5(self):
        notes = self.midiEvents
        for note in notes:
            if self.label[note.id] is not None:
                continue
            if note.pitch >= ISOLATED_RH_FLOOR:
                self.label[note.id] = "RH"
            elif note.pitch <= ISOLATED_RH_FLOOR - 1:
                self.label[note.id] = "LH"
            else:
                self.label[note.id] = "RH" if note.pitch > 60 else "LH"
            self.confidence[note.id] = CONFIDENCE["pass_5"]

        # Safety net: label any remaining unlabeled notes
        for note in notes:
            if self.label[note.id] is None:
                self.label[note.id] = "RH" if note.pitch > 60 else "LH"
                self.confidence[note.id] = CONFIDENCE["pass_5"]

    def pass_6(self):
        notes = self.midiEvents
        reassigned: set[str] = set()

        for hand in ["LH", "RH"]:
            other = "RH" if hand == "LH" else "LH"
            hand_notes = sorted(
                [n for n in notes if self.label[n.id] == hand],
                key=lambda n: (self.onset(n), n.id),
            )

            # Check 1: simultaneous span exceeds one hand
            for note in hand_notes:
                if note.id in reassigned:
                    continue
                window = [
                    n
                    for n in hand_notes
                    if n.id not in reassigned
                    and self.onset(note)
                    <= self.onset(n)
                    <= self.onset(note) + CLUSTER_WINDOW_SEC
                ]
                if len(window) > 1:
                    span = max(n.pitch for n in window) - min(n.pitch for n in window)
                    if span > HAND_SPAN_MAX:
                        outlier = self.furthest_from_median(window)
                        self.label[outlier.id] = other
                        self.confidence[outlier.id] = CONFIDENCE["pass_6"]
                        reassigned.add(outlier.id)

            # Rebuild after span reassignments before checking leaps
            hand_notes = sorted(
                [n for n in notes if self.label[n.id] == hand],
                key=lambda n: (self.onset(n), n.id),
            )

            # Check 2: implausibly fast leaps
            for i in range(len(hand_notes) - 1):
                n1, n2 = hand_notes[i], hand_notes[i + 1]
                if n1.id in reassigned or n2.id in reassigned:
                    continue
                gap = self.onset(n2) - self.onset(n1)
                leap = abs(n2.pitch - n1.pitch)
                if gap < JUMP_MAX_SEC and leap > JUMP_MAX_SEMITONES:
                    self.label[n2.id] = other
                    self.confidence[n2.id] = CONFIDENCE["pass_6"]
                    reassigned.add(n2.id)

    def separate(self) -> tuple[HandAssignment, HandConfidence]:
        self.pass_1()
        self.pass_2()
        self.pass_3()
        self.pass_4()
        self.pass_5()
        self.pass_6()
        return (cast(HandAssignment, dict(self.label)), self.confidence)
