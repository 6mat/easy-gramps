// One browser's saves and photo uploads, one after another: each starts when the one before has finished.
// A failed one doesn't hold up the rest: its own promise rejects for the caller, the queue goes on.
let last = Promise.resolve();
export function enqueue(fn) { const run = last.then(fn); last = run.catch(() => {}); return run; }
export const queueIdle = () => last;  // settles when everything sent so far has finished
