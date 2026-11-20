export class ViewFocus {
  private next = 2000;
  private views = new Map<number, { pid: number; instanceId: string }>();
  private owner: number | null = null;
  constructor(private releaseInput: (wid: number, reason: string) => void) {}
  create(pid: number, instanceId: string) {
    const wid = ++this.next;
    this.views.set(wid, { pid, instanceId });
    return wid;
  }
  get(wid: number) {
    return this.views.get(wid);
  }
  release(reason: string) {
    const previous = this.owner;
    this.owner = null;
    if (previous !== null) this.releaseInput(previous, reason);
  }
  focus(wid: number | null) {
    if (wid === this.owner) return;
    if (wid !== null && !this.views.has(wid)) throw Error('未知视图');
    this.release('blur');
    this.owner = wid;
  }
  disconnect(wid: number) {
    this.views.delete(wid);
    if (this.owner === wid) this.release('disconnect');
  }
}
