async function sample() {
  try {
    const { usage } = await navigator.storage.estimate();
    self.postMessage({ usage });
  } catch (error) {
    self.postMessage({ error: String(error) });
    self.close();
  }
}
await sample();
setInterval(sample, 2000);
