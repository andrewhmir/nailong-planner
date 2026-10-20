import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarIcon, LockIcon, MoreVerticalIcon, XIcon } from "@/components/ui/icons";

describe("icon set", () => {
  it("renders a 1.5px currentColor stroke icon with no fill", () => {
    const html = renderToStaticMarkup(createElement(CalendarIcon));
    expect(html).toContain("<svg");
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('fill="none"');
  });

  it("defaults to 20px, is decorative, and honours size", () => {
    expect(renderToStaticMarkup(createElement(LockIcon))).toContain('width="20"');
    expect(renderToStaticMarkup(createElement(XIcon))).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(createElement(MoreVerticalIcon, { size: 26 }))).toContain('width="26"');
  });

  it("exposes an accessible name only when a title is given", () => {
    const withTitle = renderToStaticMarkup(createElement(XIcon, { title: "Close" }));
    expect(withTitle).toContain("<title>Close</title>");
    expect(withTitle).not.toContain('aria-hidden="true"');
  });
});
