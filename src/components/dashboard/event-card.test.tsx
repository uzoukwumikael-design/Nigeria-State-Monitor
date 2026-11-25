import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCard, EventCardMini } from "@/components/dashboard/event-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildDemoSnapshot, DEMO_REFERENCE_TIME } from "@/lib/demo/build";

const snapshot = buildDemoSnapshot();
const event =
  snapshot.events.find((candidate) => candidate.stateId === "NG-LA") ??
  snapshot.events[0]!;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("event cards", () => {
  it("opens a full event record from the card button", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <TooltipProvider>
        <EventCard
          event={event}
          referenceTime={DEMO_REFERENCE_TIME}
          onOpen={onOpen}
        />
      </TooltipProvider>,
    );

    expect(screen.getByTestId(`event-card-${event.id}`)).toBeInTheDocument();
    expect(screen.getByText(event.title)).toBeInTheDocument();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: new RegExp(
        `Open demo event: ${event.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    });
    await user.click(button);
    expect(onOpen).toHaveBeenCalledWith(event.id);
  });

  it("labels the mini card as an interactive event", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <EventCardMini
        event={event}
        referenceTime={DEMO_REFERENCE_TIME}
        onOpen={onOpen}
      />,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent(event.title.slice(0, 20));
    await user.click(button);
    expect(onOpen).toHaveBeenCalledWith(event.id);
  });
});
