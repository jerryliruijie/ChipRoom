// Coordinates share the arena's CSS pixel plane with the physical chip scene.
const compactRing = {
  7: [[50,86],[19,83],[15,49],[25,15],[75,15],[85,49],[81,83]],
  8: [[50,86],[19,83],[15,49],[20,15],[50,12],[80,15],[85,49],[81,83]],
  9: [[50,87],[20,84],[15,60],[15,35],[24,13],[76,13],[85,35],[85,60],[80,84]],
  10:[[50,87],[20,84],[15,62],[15,38],[20,15],[50,12],[80,15],[85,38],[85,62],[80,84]]
};

export function seatPoint(index, count, compact = false) {
  if (compact && compactRing[count]) return compactRing[count][index];
  if (index === 0) return [50,compact ? 86 : 89];
  if (count === 3) return index === 1 ? [23,18] : [77,18];
  const flank = Math.floor((count - 1) / 2);
  const opposite = count % 2 === 0;
  if (opposite && index === flank + 1) return [50,compact ? 14 : 11];
  const left = index <= flank;
  const row = left ? flank - index : index - flank - 1 - Number(opposite);
  const y = flank === 1 ? 47 : 19 + row * 60 / (flank - 1);
  const x = 14 + Math.abs(y - 50) * 0.12;
  return [left ? x : 100 - x,y];
}

// Chip piles use the same projected anchors in both the canvas and CSS fallback.
export function chipPoints(index,count,width,height,compact) {
  const [sx,sy] = seatPoint(index,count,compact);
  let bx,by;
  const dense = compact && count >= 7;
  if (dense && (sy < 25 || sy > 75)) {
    bx = sx;
    by = sy < 25 ? 29 : 71;
  } else if (dense) {
    bx = sx < 50 ? 30 : 70;
    by = sy;
  } else if (Math.abs(sx-50) < 1) {
    bx = 50 + (sy > 50 ? -1 : 1)*Math.min(21,8100/width);
    by = 50 + (sy-50)*.73;
  } else if (count === 3) {
    bx = sx;
    by = sy + Math.min(16,5200/height);
  } else {
    const dx = 50-sx, dy = 50-sy;
    const fraction = Math.min(.53,Math.max(.31,52/Math.hypot(dx*width/100,dy*height/100)));
    bx = sx+dx*fraction;
    by = sy+dy*fraction;
  }
  let wx = 50+(sx-50)*.50, wy = 50+(sy-50)*.52;
  if (dense && Math.abs(sx-50) < 1) wx += sy > 50 ? 7 : -7;
  return {bank:[bx,by], wager:[wx,wy]};
}
