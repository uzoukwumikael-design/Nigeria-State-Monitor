import { describe, expect, it, vi } from "vitest";
import { pickWindow, rotate, runInBatches } from "./batch";

describe("rotate", () => {
  it("starts from a different item for each offset and wraps, including negatives", () => {
    expect(rotate([1, 2, 3, 4], 0)).toEqual([1, 2, 3, 4]);
    expect(rotate([1, 2, 3, 4], 1)).toEqual([2, 3, 4, 1]);
    expect(rotate([1, 2, 3, 4], 6)).toEqual([3, 4, 1, 2]);
    expect(rotate([1, 2, 3, 4], -1)).toEqual([4, 1, 2, 3]);
    expect(rotate([], 3)).toEqual([]);
  });

  it("gives every item a turn at the front over successive minutes", () => {
    const items = ["a", "b", "c"];
    const firsts = [0, 1, 2].map((minute) => rotate(items, minute)[0]);
    expect(new Set(firsts).size).toBe(3);
  });
});

describe("runInBatches", () => {
  it("runs each batch concurrently but batches one after another, keeping input order", async () => {
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const { results, skipped } = await runInBatches([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      order.push(item);
      return item * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(skipped).toEqual([]);
    expect(peak).toBe(2);
    expect(order.slice(0, 2).sort()).toEqual([1, 2]);
  });

  it("always runs the first batch, then skips the rest once the budget is spent", async () => {
    const shouldStop = vi.fn(() => true);
    const { results, skipped } = await runInBatches(["a", "b", "c", "d", "e"], 2, async (item) => item.toUpperCase(), shouldStop);
    expect(results).toEqual(["A", "B"]);
    expect(skipped).toEqual(["c", "d", "e"]);
  });

  it("treats a non-positive size as one at a time", async () => {
    const { results } = await runInBatches([1, 2, 3], 0, async (item) => item);
    expect(results).toEqual([1, 2, 3]);
  });
});

describe("pickWindow", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("walks through the whole list, two at a time, over successive runs", () => {
    const seen = [0, 1, 2, 3].flatMap((counter) => pickWindow(items, counter, 2));
    expect(seen).toEqual(items);
  });

  it("wraps around and repeats the cycle", () => {
    expect(pickWindow(items, 4, 2)).toEqual(["a", "b"]);
    expect(pickWindow(items, 5, 2)).toEqual(["c", "d"]);
  });

  it("handles short lists, empty lists and bad sizes", () => {
    expect(pickWindow(["a"], 7, 2)).toEqual(["a"]);
    expect(pickWindow([], 3, 2)).toEqual([]);
    expect(pickWindow(items, 3, 0)).toEqual([]);
  });
});
