// Play the unmodified upstream recordings through the browser's native audio.
// The original adapter expects a Flash-era SoundManager instance.
(() => {
  const clips = new Map();
  Game.loadSounds = ({ sounds }) => {
    for (const [name, path] of Object.entries(sounds)) {
      const clip = new Audio(path.replace(/^\//, ''));
      clip.volume = 0.5;
      clips.set(name, clip);
    }
  };
  Breakout.playSound = function (name) {
    const clip = clips.get(name);
    if (!this.sound || !clip) return;
    clip.currentTime = 0;
    clip.play().catch(() => {});
  };
})();
