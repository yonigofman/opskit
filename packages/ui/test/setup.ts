import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// jsdom has no layout: give every element a width so charts fetch.
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FakeResizeObserver as unknown as typeof ResizeObserver;
Element.prototype.getBoundingClientRect = function () {
  return { width: 640, height: 240, top: 0, left: 0, right: 640, bottom: 240, x: 0, y: 0, toJSON() {} } as DOMRect;
};
