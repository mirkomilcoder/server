/* Shimmer placeholders shown while data loads. */

export function Skel({ w = '100%', h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden />;
}

export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="card" aria-busy="true">
      <Skel w="40%" h={18} />
      <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
        {Array.from({ length: lines }, (_, i) => (
          <Skel key={i} w={`${90 - ((i * 13) % 35)}%`} />
        ))}
      </div>
    </div>
  );
}

export function RowsSkeleton({ rows = 4, h = 52 }: { rows?: number; h?: number }) {
  return (
    <div style={{ display: 'grid', gap: 10 }} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skel key={i} h={h} r={12} />
      ))}
    </div>
  );
}
