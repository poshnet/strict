// The explainer (brand/src/explainer.html, rendered by scripts/render-brand.mjs explainer): four launches dying four
// ways, then the rules at work, in a quiet window. Muted, looping, 1.4 MB; the poster is its first frame.
export function Explainer({ className = '' }: { className?: string }) {
  return (
    <figure className={`xpl ${className}`}>
      <div className="xpl-bar" aria-hidden><i /><i /><i /><span className="mono">strict.fun</span><b>40 s</b></div>
      <video src="/assets/hero/explainer.mp4" poster="/assets/hero/explainer.jpg" autoPlay muted loop playsInline preload="metadata"
        aria-label="What strict.fun does: four launches dying four ways, then the rules at work on a coin page" />
    </figure>
  );
}
