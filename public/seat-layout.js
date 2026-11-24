// Coordinates share the arena's CSS pixel plane with the physical chip scene.
export function seatPoint(index, count) {
  if (index === 0) return [50,89];
  if (count === 3) return index === 1 ? [23,18] : [77,18];
  const flank = Math.floor((count - 1) / 2);
  const opposite = count % 2 === 0;
  if (opposite && index === flank + 1) return [50,11];
  const left = index <= flank;
  const row = left ? flank - index : index - flank - 1 - Number(opposite);
  const y = flank === 1 ? 47 : 19 + row * 60 / (flank - 1);
  const x = 14 + Math.abs(y - 50) * 0.12;
  return [left ? x : 100 - x,y];
}
