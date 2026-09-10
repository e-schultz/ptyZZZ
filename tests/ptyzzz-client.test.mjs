import test from "node:test";
import assert from "node:assert/strict";
import { wirePtyMouse } from "../static/ptyzzz-client.js";

function fixture() {
  globalThis.document = new EventTarget();
  globalThis.window = new EventTarget();
  const root = new EventTarget();
  const cursor = {dataset: {mouseGrabbed: "true"}};
  const rows = Array.from({length: 24}, (_, y) => ({
    getBoundingClientRect: () => ({left: 0, right: 800, top: y * 20, bottom: y * 20 + 20, width: 800, height: 20}),
  }));
  const grid = {
    dataset: {cols: "80", rows: "24"},
    querySelectorAll: () => rows,
  };
  const pane = {
    dataset: {pane: "p1"},
    querySelector: selector => selector === ".cursor" ? cursor : grid,
    contains: node => node === root,
  };
  const frames = [];
  const destroy = wirePtyMouse({
    root,
    paneFromEvent: () => pane,
    send: (name, frame) => frames.push({name, frame}),
  });
  return {root, cursor, frames, destroy};
}

function fire(target, type, props = {}) {
  const ev = new Event(type, {cancelable: true});
  Object.assign(ev, {clientX: 25, clientY: 85, button: 0, deltaX: 0, deltaY: 0, deltaMode: 0}, props);
  target.dispatchEvent(ev);
  return ev;
}

test("captures only while the terminal has grabbed the mouse", () => {
  const f = fixture();
  f.cursor.dataset.mouseGrabbed = "false";
  assert.equal(fire(f.root, "mousedown").defaultPrevented, false);
  assert.equal(f.frames.length, 0);

  f.cursor.dataset.mouseGrabbed = "true";
  assert.equal(fire(f.root, "mousedown").defaultPrevented, true);
  assert.deepEqual(f.frames[0], {
    name: "p1",
    frame: {
      t: "mouse",
      kind: "press",
      button: "left",
      x: 2,
      y: 4,
      x_pixel_offset: 5,
      y_pixel_offset: 5,
      mods: 0,
    },
  });

  fire(document, "mouseup");
  f.frames.length = 0;
  assert.equal(fire(f.root, "mousedown", {shiftKey: true}).defaultPrevented, false);
  assert.equal(f.frames.length, 0);
  f.destroy();
});

test("releases an active button when the window loses focus", () => {
  const f = fixture();
  fire(f.root, "mousedown", {ctrlKey: true});
  fire(window, "blur");
  assert.deepEqual(f.frames.map(({frame}) => frame.kind), ["press", "release"]);
  assert.deepEqual(f.frames[1].frame, {
    t: "mouse",
    kind: "release",
    button: "left",
    x: 2,
    y: 4,
    x_pixel_offset: 5,
    y_pixel_offset: 5,
    mods: 4,
  });
  fire(window, "blur");
  assert.equal(f.frames.length, 2);
  f.destroy();
});

test("accumulates trackpad deltas into terminal wheel steps", () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) fire(f.root, "wheel", {deltaY: 4});
  assert.equal(f.frames.length, 0);
  fire(f.root, "wheel", {deltaY: 4});
  assert.equal(f.frames.length, 1);
  assert.equal(f.frames[0].frame.button, "wheeldown");
  f.destroy();
});

test("reports pixel movement within the same cell", () => {
  const f = fixture();
  fire(f.root, "mousemove", {clientX: 25});
  fire(f.root, "mousemove", {clientX: 26});
  assert.equal(f.frames.length, 2);
  assert.equal(f.frames[0].frame.x, f.frames[1].frame.x);
  assert.notEqual(f.frames[0].frame.x_pixel_offset, f.frames[1].frame.x_pixel_offset);
  f.destroy();
});

test("reports the same cell again after the pointer leaves a pane", () => {
  const f = fixture();
  fire(f.root, "mousemove");
  fire(f.root, "mousemove");
  assert.equal(f.frames.length, 1);
  fire(f.root, "mouseout", {relatedTarget: null});
  fire(f.root, "mousemove");
  assert.equal(f.frames.length, 2);
  f.destroy();
});
