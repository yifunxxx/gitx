import { describe, expect, it } from "vitest";
import {
  formatErrorMessage,
  formatGitDetectError,
  invokeErrorCode,
} from "./errors";

describe("formatErrorMessage", () => {
  it("reads AppError-shaped invoke payloads", () => {
    expect(
      formatErrorMessage({
        code: "gitNotFound",
        message: "failed to spawn `git`: entity not found",
      }),
    ).toBe("failed to spawn `git`: entity not found");
  });

  it("does not stringify plain objects as [object Object]", () => {
    expect(formatErrorMessage({ code: "gitNotFound" })).not.toBe(
      "[object Object]",
    );
  });

  it("prefers Error.message", () => {
    expect(formatErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns strings as-is", () => {
    expect(formatErrorMessage("plain")).toBe("plain");
  });
});

describe("formatGitDetectError", () => {
  it("maps gitNotFound to localized copy", () => {
    expect(
      formatGitDetectError(
        { code: "gitNotFound", message: "spawn failed" },
        "未找到 git",
      ),
    ).toBe("未找到 git");
  });

  it("passes through other codes", () => {
    expect(
      formatGitDetectError(
        { code: "gitTooOld", message: "git 1.0.0 is older" },
        "未找到 git",
      ),
    ).toBe("git 1.0.0 is older");
  });
});

describe("invokeErrorCode", () => {
  it("reads code field", () => {
    expect(invokeErrorCode({ code: "gitNotFound" })).toBe("gitNotFound");
    expect(invokeErrorCode("x")).toBeNull();
  });
});
