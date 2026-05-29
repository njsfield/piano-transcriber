// src/ui/components/RecorderPanel.tsx
import { useState, useEffect, useRef } from "react";
import { createMidiRecorder } from "../lib/midi-recorder";
import type { MidiRecorder } from "../lib/midi-recorder";
import type { Song } from "../lib/parse-ireal";

interface Props {
  selectedSong: Song | null;
  onJobCreated: (jobId: string) => void;
}

type RecorderState = "idle" | "recording" | "uploading" | "error";

export function RecorderPanel({ selectedSong, onJobCreated }: Props) {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeNotes, setActiveNotes] = useState<string[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const recorderRef = useRef<MidiRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notePollerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    recorderRef.current = createMidiRecorder();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (notePollerRef.current) clearInterval(notePollerRef.current);
    };
  }, []);

  const formatElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const handleRecord = async () => {
    setErrorMsg(null);
    const recorder = recorderRef.current!;
    try {
      await recorder.start();
      setDeviceName(recorder.deviceName);
      setRecorderState("recording");
      setElapsedMs(0);
      timerRef.current = setInterval(() => setElapsedMs((ms) => ms + 100), 100);
      notePollerRef.current = setInterval(
        () => setActiveNotes(recorder.getActiveNotes()),
        50,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No MIDI device")) {
        setErrorMsg("No MIDI device detected");
      } else if (msg.includes("denied") || msg.includes("NotAllowedError")) {
        setErrorMsg("MIDI access denied — check browser permissions");
      } else {
        setErrorMsg(msg);
      }
      setRecorderState("error");
    }
  };

  const handleStop = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (notePollerRef.current) clearInterval(notePollerRef.current);
    setActiveNotes([]);

    const recorder = recorderRef.current!;
    const blob = recorder.stop();

    if (blob.size < 50) {
      setErrorMsg("No notes recorded");
      setRecorderState("idle");
      return;
    }

    setRecorderState("uploading");

    try {
      const fd = new FormData();
      fd.append("midi", blob, "recording.mid");
      if (selectedSong && selectedSong.chords.length > 0) {
        fd.append("chordsJson", JSON.stringify(selectedSong.chords));
      }

      const res = await fetch("/api/jobs", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { jobId } = (await res.json()) as { jobId: string };
      onJobCreated(jobId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setRecorderState("error");
    }
  };

  const isRecording = recorderState === "recording";
  const isUploading = recorderState === "uploading";

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4">
      {selectedSong && (
        <p className="text-zinc-400 text-sm">{selectedSong.title}</p>
      )}

      {/* Live notes above button */}
      <p
        className="text-zinc-300 font-mono text-sm min-h-5 tracking-widest"
        style={{
          animation:
            isRecording && activeNotes.length > 0
              ? "pulse 0.4s ease-in-out infinite alternate"
              : "none",
        }}
      >
        {activeNotes.join(" · ")}
      </p>

      <style>{`@keyframes pulse { from { opacity: 1; } to { opacity: 0.3; } }`}</style>

      <button
        onClick={isRecording ? handleStop : handleRecord}
        disabled={isUploading}
        className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-all
          ${
            isRecording
              ? "bg-red-600 shadow-[0_0_0_12px_rgba(220,38,38,0.25)] animate-pulse"
              : isUploading
                ? "bg-zinc-700 cursor-not-allowed"
                : "bg-red-600 hover:bg-red-500 shadow-[0_0_0_8px_rgba(220,38,38,0.15)]"
          }`}
        title={isRecording ? "Stop recording" : "Start recording"}
      >
        {isRecording ? "⏹" : isUploading ? "⏳" : "⏺"}
      </button>

      <p className="text-zinc-500 text-xs">
        {isRecording
          ? `${formatElapsed(elapsedMs)}${deviceName ? ` · ${deviceName}` : ""}`
          : isUploading
            ? "Uploading…"
            : deviceName
              ? `· ${deviceName}`
              : "Press to record"}
      </p>

      {errorMsg && <p className="text-red-400 text-sm">{errorMsg}</p>}
    </div>
  );
}
