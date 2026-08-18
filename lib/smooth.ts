/** Centred rolling mean over a series that may contain nulls.
 *
 *  Instantaneous W/HR is intrinsically spiky — a one-second power blip moves
 *  efficiency by a lot — so the raw EF trace reads as noise rather than as
 *  drift. Nulls are skipped rather than treated as zero, and a window with no
 *  finite samples yields null so gaps stay gaps. */
export function rollingMean(xs: Array<number | null>, window: number): Array<number | null> {
  if (window <= 1) return xs.slice();
  const half = Math.floor(window / 2);
  const out: Array<number | null> = new Array(xs.length);

  for (let i = 0; i < xs.length; i++) {
    let sum = 0;
    let n = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(xs.length - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      const v = xs[j];
      if (v != null && Number.isFinite(v)) { sum += v; n++; }
    }
    out[i] = n > 0 ? sum / n : null;
  }
  return out;
}
