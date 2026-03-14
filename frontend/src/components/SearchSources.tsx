import type { SearchSource } from "../hooks/useWebSocket";

interface SearchSourcesProps {
  sources: SearchSource[];
}

export function SearchSources({ sources }: SearchSourcesProps) {
  if (sources.length === 0) return null;

  return (
    <div className="source-row fade-in" role="status" aria-label="Search sources">
      {sources.map((source, i) => (
        <a
          key={i}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="chip chip--source"
        >
          {source.domain || source.title}
        </a>
      ))}
    </div>
  );
}
