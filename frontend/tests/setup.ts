import "@testing-library/jest-dom/vitest"
import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"

vi.mock("@wailsio/runtime", () => ({
  Call: { ByName: vi.fn() },
  CancellablePromise: Promise,
  Events: {
    On: vi.fn(() => () => {}),
    Once: vi.fn(() => () => {}),
    Emit: vi.fn(async () => false),
    Off: vi.fn(),
  },
  Window: { Close: vi.fn(async () => {}) },
}))
afterEach(cleanup)
Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn().mockImplementation(query => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} })) })
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", ResizeObserverStub)
HTMLElement.prototype.scrollIntoView = vi.fn()
HTMLElement.prototype.hasPointerCapture = () => false
HTMLElement.prototype.setPointerCapture = vi.fn()
HTMLElement.prototype.releasePointerCapture = vi.fn()
HTMLElement.prototype.scrollTo = vi.fn()
Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return this.hasAttribute("data-index") ? this.getAttribute("role") === "row" ? 32 : 21 : 600 } })
Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return 1000 } })
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 600 } })
Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 1000 } })
