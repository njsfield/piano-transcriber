// src/ui/components/PlaylistSidebar.tsx
import { useState, useEffect } from 'react';
import { parseIRealUrl } from '../lib/parse-ireal';
import type { Song } from '../lib/parse-ireal';

const STORAGE_KEY = 'ireal-playlist';

interface Stored {
  songs: Song[];
  selectedTitle: string | null;
}

interface Props {
  onSongSelected: (song: Song | null) => void;
}

export function PlaylistSidebar({ onSongSelected }: Props) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Stored;
        setSongs(stored.songs);
        setSelectedTitle(stored.selectedTitle);
        const song = stored.songs.find(s => s.title === stored.selectedTitle) ?? null;
        onSongSelected(song);
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (newSongs: Song[], newTitle: string | null) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ songs: newSongs, selectedTitle: newTitle }));
  };

  const handleSelect = (song: Song) => {
    setSelectedTitle(song.title);
    onSongSelected(song);
    persist(songs, song.title);
  };

  const handleImport = () => {
    setImportError(null);
    try {
      const parsed = parseIRealUrl(importText.trim());
      if (parsed.length === 0) throw new Error('No songs found');
      const merged = [...songs, ...parsed.filter(p => !songs.some(s => s.title === p.title))];
      setSongs(merged);
      const first = parsed[0]!;
      setSelectedTitle(first.title);
      onSongSelected(first);
      persist(merged, first.title);
      setShowImport(false);
      setImportText('');
    } catch {
      setImportError('Could not parse playlist — paste the full irealb:// URL');
    }
  };

  return (
    <div className="w-44 min-h-full border-r border-zinc-800 flex flex-col p-3 shrink-0">
      <div className="text-xs text-zinc-500 uppercase tracking-widest mb-3">Playlist</div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto">
        {songs.map(song => (
          <li key={song.title}>
            <button
              onClick={() => handleSelect(song)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs truncate transition-colors
                ${selectedTitle === song.title
                  ? 'bg-blue-900 text-blue-200'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}
            >
              {song.title}
            </button>
          </li>
        ))}
      </ul>
      <div className="pt-3 border-t border-zinc-800 mt-3">
        {showImport ? (
          <div className="space-y-2">
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="Paste irealb:// URL here"
              className="w-full h-20 bg-zinc-900 border border-zinc-700 rounded text-xs p-1.5 text-zinc-200 resize-none"
            />
            {importError && <p className="text-red-400 text-xs">{importError}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleImport}
                className="flex-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded px-2 py-1"
              >
                Import
              </button>
              <button
                onClick={() => { setShowImport(false); setImportError(null); }}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowImport(true)}
            className="text-zinc-600 hover:text-zinc-400 text-xs"
          >
            + Import playlist
          </button>
        )}
      </div>
    </div>
  );
}
