// src/ui/components/DownloadPanel.tsx
interface Props {
  musicxmlPath: string;
  pdfPath: string;
}

export function DownloadPanel({ musicxmlPath, pdfPath }: Props) {
  return (
    <div className="flex gap-4 mt-6">
      <a
        href={musicxmlPath}
        download
        className="flex-1 text-center py-2 rounded border border-zinc-600 hover:bg-zinc-800"
      >
        Download MusicXML
      </a>
      <a
        href={pdfPath}
        download
        className="flex-1 text-center py-2 rounded bg-blue-600 hover:bg-blue-500"
      >
        Download PDF
      </a>
    </div>
  );
}
