// lib/unsaved.ts
type Listener = (dirty: boolean) => void;

let dirty = false;
const listeners = new Set<Listener>();

export function setUnsaved(d: boolean) {
  dirty = d;
  listeners.forEach((fn) => fn(dirty));
}

export function getUnsaved() {
  return dirty;
}

export function subscribeUnsaved(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
