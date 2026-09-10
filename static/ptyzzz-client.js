// Browser adapter for ptyZZZ's semantic mouse protocol. The terminal reports
// whether the application has grabbed the mouse on its rendered cursor element;
// this adapter otherwise leaves native selection and scrollback alone.

function grabbed(pane) {
  return pane?.querySelector(".cursor")?.dataset.mouseGrabbed === "true";
}

function mods(ev) {
  return (ev.shiftKey ? 1 : 0) |
    (ev.altKey ? 2 : 0) |
    (ev.ctrlKey ? 4 : 0) |
    (ev.metaKey ? 8 : 0);
}

function locate(pane, ev) {
  const grid = pane?.querySelector('.scroll > [id^="grid-"]');
  if (!grid) return null;
  const rows = [...grid.querySelectorAll(":scope > .row")];
  const visible = Math.min(Number(grid.dataset.rows) || 0, rows.length);
  const live = rows.slice(rows.length - visible);
  if (!live.length) return null;

  let y = live.indexOf(ev.target.closest?.(".row"));
  if (y < 0) {
    y = live.findIndex(row => {
      const rect = row.getBoundingClientRect();
      return ev.clientY >= rect.top && ev.clientY < rect.bottom;
    });
  }
  if (y < 0) return null;

  const rect = live[y].getBoundingClientRect();
  const cols = Number(grid.dataset.cols) || 1;
  if (!rect.width || !rect.height || ev.clientX < rect.left || ev.clientX >= rect.right) {
    return null;
  }
  const exactX = (ev.clientX - rect.left) * cols / rect.width;
  const x = Math.max(0, Math.min(cols - 1, Math.floor(exactX)));
  return {
    point: {
      x,
      y,
      x_pixel_offset: Math.max(0, Math.floor((exactX - x) * rect.width / cols)),
      y_pixel_offset: Math.max(0, Math.floor(ev.clientY - rect.top)),
    },
    cellWidth: rect.width / cols,
    cellHeight: rect.height,
    visibleRows: visible,
  };
}

/**
 * Wire a pane container to ptyZZZ's {t:"mouse"} input protocol.
 *
 * send receives (paneName, frame). enabled can impose application-level focus
 * policy in addition to the terminal's own mouse-grab state.
 */
export function wirePtyMouse({
  root,
  send,
  enabled = () => true,
  paneFromEvent = ev => ev.target.closest?.(".pane"),
  paneName = pane => pane?.dataset.pane,
}) {
  const buttons = ["left", "middle", "right"];
  const wheel = new WeakMap();
  let active = null;
  let lastMove = "";

  const accepts = (pane, ev) =>
    !!pane && !ev.shiftKey && enabled(pane, ev) && grabbed(pane);

  function onDown(ev) {
    const pane = paneFromEvent(ev);
    if (!accepts(pane, ev)) return;
    const hit = locate(pane, ev);
    const button = buttons[ev.button];
    const name = paneName(pane);
    if (!hit || !button || !name) return;
    active = {pane, name, button, point: hit.point};
    send(name, {t: "mouse", kind: "press", button, ...hit.point, mods: mods(ev)});
    ev.preventDefault();
  }

  function onUp(ev) {
    if (!active) return;
    const hit = locate(active.pane, ev);
    const point = hit?.point || active.point;
    send(active.name, {
      t: "mouse",
      kind: "release",
      button: active.button,
      ...point,
      mods: mods(ev),
    });
    active = null;
    ev.preventDefault();
  }

  function onMove(ev) {
    const pane = active?.pane || paneFromEvent(ev);
    if (!accepts(pane, ev)) return;
    const hit = locate(pane, ev);
    const name = paneName(pane);
    if (!hit || !name) return;
    if (active) active.point = hit.point;
    const key = `${name}:${hit.point.x}:${hit.point.y}:${mods(ev)}`;
    if (key === lastMove) return;
    lastMove = key;
    send(name, {t: "mouse", kind: "move", ...hit.point, mods: mods(ev)});
  }

  function onOut(ev) {
    const pane = paneFromEvent(ev);
    if (pane && !pane.contains(ev.relatedTarget)) lastMove = "";
  }

  function onWheel(ev) {
    const pane = paneFromEvent(ev);
    if (!accepts(pane, ev)) return;
    const hit = locate(pane, ev);
    const name = paneName(pane);
    if (!hit || !name) return;

    const state = wheel.get(pane) || {x: 0, y: 0};
    const page = hit.cellHeight * hit.visibleRows;
    const scale = ev.deltaMode === 1 ? hit.cellHeight : ev.deltaMode === 2 ? page : 1;
    state.x = Math.max(
      -20 * hit.cellWidth,
      Math.min(20 * hit.cellWidth, state.x + ev.deltaX * scale),
    );
    state.y = Math.max(
      -20 * hit.cellHeight,
      Math.min(20 * hit.cellHeight, state.y + ev.deltaY * scale),
    );

    const vertical = Math.abs(state.y / hit.cellHeight) >= Math.abs(state.x / hit.cellWidth);
    const unit = vertical ? hit.cellHeight : hit.cellWidth;
    const axis = vertical ? "y" : "x";
    let steps = Math.trunc(state[axis] / unit);
    if (!steps) {
      wheel.set(pane, state);
      ev.preventDefault();
      return;
    }
    steps = Math.max(-20, Math.min(20, steps));
    state[axis] -= steps * unit;
    const button = vertical
      ? (steps < 0 ? "wheelup" : "wheeldown")
      : (steps < 0 ? "wheelleft" : "wheelright");
    for (let i = 0; i < Math.abs(steps); i++) {
      send(name, {t: "mouse", kind: "press", button, ...hit.point, mods: mods(ev)});
    }
    wheel.set(pane, state);
    ev.preventDefault();
  }

  function onContextMenu(ev) {
    const pane = paneFromEvent(ev);
    if (accepts(pane, ev)) ev.preventDefault();
  }

  root.addEventListener("mousedown", onDown);
  root.addEventListener("mousemove", onMove);
  root.addEventListener("mouseout", onOut);
  root.addEventListener("wheel", onWheel, {passive: false});
  root.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("mouseup", onUp, {capture: true});

  return () => {
    root.removeEventListener("mousedown", onDown);
    root.removeEventListener("mousemove", onMove);
    root.removeEventListener("mouseout", onOut);
    root.removeEventListener("wheel", onWheel);
    root.removeEventListener("contextmenu", onContextMenu);
    document.removeEventListener("mouseup", onUp, {capture: true});
  };
}
