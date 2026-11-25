import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EventCard } from "@/components/dashboard/event-card";
import { EventDialog } from "@/components/dashboard/event-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";
import type { IntelligenceEvent } from "@/lib/types";

const snapshot = buildDemoSnapshot();
const demoEvent = snapshot.events[0]!;
// An automatically published production record: not demo, confidence not assessed (stored as 0).
const realEvent: IntelligenceEvent = {
  ...demoEvent,
  isDemo: false,
  confidence: 0,
  geoConfidence: 0,
  relatedEventIds: [],
};

afterEach(() => cleanup());

/** Free text that belongs to the record itself (a fixture here says "demo"); only interface wording is under test. */
function recordOwnText(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    if (value.length > 8 && /demo|fictional/i.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => recordOwnText(item, found));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => recordOwnText(item, found));
  }
  return found;
}

function renderDialog(event: IntelligenceEvent) {
  return render(
    <TooltipProvider>
      <EventDialog
        event={event}
        events={[event]}
        referenceTime={DEMO_REFERENCE_TIME}
        onClose={() => undefined}
      />
    </TooltipProvider>,
  );
}

describe("demo versus real record labelling", () => {
  it("never calls a real published record demo or fictional", () => {
    renderDialog(realEvent);
    const dialog = screen.getByRole("dialog");
    // Report the offending context, not just "matched", so a regression is easy to locate.
    let interfaceText = dialog.textContent ?? "";
    for (const own of recordOwnText(realEvent).sort(
      (a, b) => b.length - a.length,
    )) {
      interfaceText = interfaceText.split(own).join(" ");
    }
    const offending = interfaceText.match(
      /.{0,50}(demo|fictional|not a real incident).{0,50}/i,
    );
    expect(offending?.[0]).toBeUndefined();
    expect(
      screen.getAllByText(/Confidence not assessed/).length,
    ).toBeGreaterThan(0);
    expect(dialog.textContent).toMatch(/Source reports are linked/);
    expect(dialog.textContent).not.toMatch(/not reviewed by a person|published automatically/i);
  });

  it("still labels demo records as fictional", () => {
    renderDialog(demoEvent);
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).toMatch(/Demo event/);
    expect(text).toMatch(/NOT A REAL INCIDENT/i);
    expect(text).toMatch(/Demo confidence/);
  });

  it("does not badge or announce a real record as demo on the wire card", () => {
    render(
      <TooltipProvider>
        <EventCard
          event={realEvent}
          referenceTime={DEMO_REFERENCE_TIME}
          onOpen={() => undefined}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByText("Demo")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Open event:/ }),
    ).toBeInTheDocument();
  });
});
