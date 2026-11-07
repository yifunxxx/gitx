import { describe, expect, it } from "vitest";
import { isAuthError, parseAuthTarget } from "./auth";

describe("isAuthError", () => {
  it("detects AuthRequired code", () => {
    expect(isAuthError({ code: "authRequired", message: "x" })).toBe(true);
    expect(isAuthError({ code: "AuthRequired", message: "x" })).toBe(true);
  });

  it("detects terminal prompts disabled toast text", () => {
    expect(
      isAuthError({
        code: "gitCommandFailed",
        message:
          "fatal: could not read Password for 'https://xsaf1207@163.com@gitee.com': terminal prompts disabled",
      }),
    ).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isAuthError({ code: "networkError", message: "could not resolve host" })).toBe(
      false,
    );
  });
});

describe("parseAuthTarget", () => {
  it("parses gitee password prompt with email user", () => {
    const t = parseAuthTarget(
      "fatal: could not read Password for 'https://xsaf1207@163.com@gitee.com': terminal prompts disabled",
    );
    expect(t.protocol).toBe("https");
    expect(t.host).toBe("gitee.com");
    expect(t.username).toBe("xsaf1207@163.com");
  });

  it("parses plain remote URL", () => {
    const t = parseAuthTarget("https://github.com/org/repo.git");
    expect(t.host).toBe("github.com");
    expect(t.username).toBeNull();
  });
});
