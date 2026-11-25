import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// UI tests render Radix dialogs and a large demo snapshot; allow async queries
// enough headroom when the whole suite runs under CPU contention.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});
