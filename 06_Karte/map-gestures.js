/** Own all contacts in one place; lost captures must never survive a gesture. */
export function bindMapGestures(canvas, actions) {
    const contacts = new Map();
    let tap = null;
    const reset = () => { contacts.clear(); tap = null; };
    const local = (x, y) => { const box = canvas.getBoundingClientRect(); return [x - box.left, y - box.top]; };
    const end = (event, cancelled = false) => {
        if (!contacts.has(event.pointerId))
            return;
        contacts.delete(event.pointerId);
        const candidate = tap;
        tap = null;
        if (!cancelled && candidate && !contacts.size && performance.now() - candidate.at < 650 && Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 8)
            actions.select(...local(event.clientX, event.clientY));
    };
    canvas.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0)
            return;
        // A primary contact begins a new sequence, even after a missing cancel/up.
        if (event.isPrimary)
            reset();
        for (const id of contacts.keys())
            if (!canvas.hasPointerCapture(id))
                contacts.delete(id);
        contacts.set(event.pointerId, [event.clientX, event.clientY]);
        tap = contacts.size === 1 ? { x: event.clientX, y: event.clientY, at: performance.now() } : null;
        try {
            canvas.setPointerCapture(event.pointerId);
        }
        catch {
            reset();
        }
    });
    canvas.addEventListener('pointermove', event => {
        const last = contacts.get(event.pointerId);
        if (!last)
            return;
        if (event.pointerType === 'mouse' && event.buttons === 0) {
            reset();
            return;
        }
        const current = [event.clientX, event.clientY];
        if (tap && Math.hypot(current[0] - tap.x, current[1] - tap.y) >= 8)
            tap = null;
        contacts.set(event.pointerId, current);
        if (contacts.size === 1) {
            actions.pan(current[0] - last[0], current[1] - last[1]);
            return;
        }
        if (contacts.size !== 2)
            return;
        const other = [...contacts.entries()].find(([id]) => id !== event.pointerId)[1];
        const oldDistance = Math.hypot(last[0] - other[0], last[1] - other[1]);
        const newDistance = Math.hypot(current[0] - other[0], current[1] - other[1]);
        const oldMid = [(last[0] + other[0]) / 2, (last[1] + other[1]) / 2];
        const mid = [(current[0] + other[0]) / 2, (current[1] + other[1]) / 2];
        actions.pan(mid[0] - oldMid[0], mid[1] - oldMid[1]);
        if (oldDistance > 2 && newDistance > 2)
            actions.zoomAt(...local(...mid), Math.log2(newDistance / oldDistance));
    });
    window.addEventListener('pointerup', event => end(event));
    window.addEventListener('pointercancel', event => end(event, true));
    canvas.addEventListener('lostpointercapture', event => end(event, true));
    window.addEventListener('blur', reset);
    window.addEventListener('pagehide', reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden)
        reset(); });
    canvas.addEventListener('wheel', event => { event.preventDefault(); actions.zoomAt(...local(event.clientX, event.clientY), event.deltaY < 0 ? .4 : -.4); }, { passive: false });
}
