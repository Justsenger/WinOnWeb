const closeWorker = self.close.bind(self);
self.close = () => {
  self.postMessage({ type: 'wow-runtime:worker-exit' });
  closeWorker();
};
