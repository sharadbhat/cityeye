export function confettiOrigin(rect, viewport) {
  if (!rect || !viewport?.width || !viewport?.height) return { x: 0.5, y: 0.6 };
  const clamp = (value) => Math.max(0.05, Math.min(0.95, value));
  return {
    x: clamp((rect.left + rect.width / 2) / viewport.width),
    y: clamp((rect.top + rect.height / 2) / viewport.height),
  };
}

// Load the animation only after a win; never put celebration work in a render effect.
export function createWinConfetti({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  load = () => import('canvas-confetti'),
} = {}) {
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let generation = 0;
  let disposed = false;
  let lastRound = null;
  let cleanup = null;

  function cancel() {
    generation += 1;
    cleanup?.();
  }

  async function celebrate({ outcome, roundId, origin }) {
    if (disposed || outcome !== 'correct' || roundId === lastRound) return false;
    lastRound = roundId;
    cancel();
    if (reducedMotion.matches) return false;
    const request = generation;
    try {
      const { default: confetti } = await load();
      // A new round or unmount can happen while the animation chunk is loading.
      if (disposed || request !== generation || reducedMotion.matches) return false;
      const canvas = doc.createElement('canvas');
      canvas.className = 'win-confetti';
      canvas.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(canvas);
      let fire;
      let timer;
      let finished = false;
      const onMotionChange = () => { if (reducedMotion.matches) cancel(); };
      const finish = () => {
        if (finished) return;
        finished = true;
        win.clearTimeout(timer);
        reducedMotion.removeEventListener('change', onMotionChange);
        fire?.reset();
        canvas.remove();
        if (cleanup === finish) cleanup = null;
      };
      cleanup = finish;
      reducedMotion.addEventListener('change', onMotionChange);
      timer = win.setTimeout(finish, 6000);
      fire = confetti.create(canvas, { resize: true, useWorker: true, disableForReducedMotion: true });
      await fire({
        particleCount: 150,
        angle: 90,
        spread: 80,
        startVelocity: 42,
        decay: 0.92,
        gravity: 1.15,
        ticks: 190,
        origin: origin ?? { x: 0.5, y: 0.6 },
        colors: ['#ff3dbb', '#40cfff', '#95eb4b', '#ffe03b', '#b971fa', '#ffad42'],
        shapes: ['square', 'circle'],
        scalar: 0.95,
        disableForReducedMotion: true,
      });
      finish();
      return true;
    } catch {
      // A blocked animation must not interfere with the successful guess.
      if (request === generation) cleanup?.();
      return false;
    }
  }

  return {
    celebrate,
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
