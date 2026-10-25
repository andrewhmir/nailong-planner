import { afterEach, describe, expect, it, vi } from "vitest";
import { hasOpenOverlay, isTextEntryTarget } from "@/lib/ui/shortcutGuards";

/**
 * The guards run in the browser, where `HTMLElement` and `document` exist. The
 * unit environment is Node, so this file installs minimal stand-ins and checks
 * the exact predicates the keyboard layers rely on.
 */
class FakeElement {
  constructor(
    public tagName: string,
    public isContentEditable = false,
  ) {}
}

const fakeDocument = { querySelector: vi.fn<(selector: string) => unknown>() };

function stubDom(): void {
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("document", fakeDocument);
}

function asTarget(element: FakeElement): EventTarget {
  return element as unknown as EventTarget;
}

afterEach(() => {
  vi.unstubAllGlobals();
  fakeDocument.querySelector.mockReset();
});

describe("isTextEntryTarget", () => {
  it("recognises the four editable element shapes", () => {
    stubDom();
    expect(isTextEntryTarget(asTarget(new FakeElement("INPUT")))).toBe(true);
    expect(isTextEntryTarget(asTarget(new FakeElement("TEXTAREA")))).toBe(true);
    expect(isTextEntryTarget(asTarget(new FakeElement("SELECT")))).toBe(true);
    expect(isTextEntryTarget(asTarget(new FakeElement("DIV", true)))).toBe(true);
  });

  it("lets ordinary elements and non-elements through", () => {
    stubDom();
    expect(isTextEntryTarget(asTarget(new FakeElement("DIV")))).toBe(false);
    expect(isTextEntryTarget(asTarget(new FakeElement("BUTTON")))).toBe(false);
    expect(isTextEntryTarget(asTarget(new FakeElement("INPUT", true)))).toBe(true);
    expect(isTextEntryTarget(null)).toBe(false);
    // A non-element EventTarget (window/document in the browser) is not a field.
    expect(isTextEntryTarget(new EventTarget())).toBe(false);
  });
});

describe("hasOpenOverlay", () => {
  const OVERLAY_SELECTOR =
    '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]';

  it("reports an open dialog, menu or Radix popover", () => {
    stubDom();
    fakeDocument.querySelector.mockReturnValue(new FakeElement("DIV"));
    expect(hasOpenOverlay()).toBe(true);
    expect(fakeDocument.querySelector).toHaveBeenCalledWith(OVERLAY_SELECTOR);
    // Radix popover content has no role; only the positioned wrapper is marked.
    expect(OVERLAY_SELECTOR).toContain("[data-radix-popper-content-wrapper]");
  });

  it("is false when nothing modal is mounted", () => {
    stubDom();
    fakeDocument.querySelector.mockReturnValue(null);
    expect(hasOpenOverlay()).toBe(false);
    expect(fakeDocument.querySelector).toHaveBeenCalledWith(OVERLAY_SELECTOR);
  });
});
