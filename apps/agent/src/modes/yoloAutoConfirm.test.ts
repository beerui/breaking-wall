import { describe, expect, test } from "vitest";
import { autoConfirmResponse } from "./yoloAutoConfirm.js";

describe("yoloAutoConfirm", () => {
  test("responds to y/n prompts", () => {
    expect(autoConfirmResponse("Continue? (y/n)"))?.toBe("y\n");
    expect(autoConfirmResponse("Overwrite existing file? [y/N]"))?.toBe("y\n");
  });

  test("responds to are you sure prompts", () => {
    expect(autoConfirmResponse("Are you sure you want to continue?"))?.toBe(
      "yes\n"
    );
  });

  test("returns undefined when no prompt", () => {
    expect(autoConfirmResponse("Hello world"))?.toBeUndefined();
  });
});
