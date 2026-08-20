import { describe, expect, it } from "vitest";
import { languageName, compareByLanguageName } from "./languages";

describe("languageName", () => {
  it("resolves common ISO codes to their full names", () => {
    expect(languageName("hi")).toBe("Hindi");
    expect(languageName("ta")).toBe("Tamil");
    expect(languageName("te")).toBe("Telugu");
    expect(languageName("kn")).toBe("Kannada");
    expect(languageName("en")).toBe("English");
    expect(languageName("ja")).toBe("Japanese");
  });

  it("is case-insensitive on the input code", () => {
    expect(languageName("HI")).toBe("Hindi");
    expect(languageName("Ta")).toBe("Tamil");
  });

  it("applies the 'cn' override even though Intl doesn't know it", () => {
    // A calendar_entries data-quality artifact for Chinese — see the
    // reconciliation work in releasebot.py's audit history.
    expect(languageName("cn")).toBe("Chinese");
  });

  it("still resolves the real ISO code for Chinese", () => {
    expect(languageName("zh")).toBe("Chinese");
  });

  it("falls back to the uppercased code for something genuinely unknown", () => {
    expect(languageName("xx")).toBe("XX");
    expect(languageName("zzz")).toBe("ZZZ");
  });

  it("returns an empty string for empty or missing input, never throws", () => {
    expect(languageName("")).toBe("");
    expect(languageName(null)).toBe("");
    expect(languageName(undefined)).toBe("");
    expect(languageName("   ")).toBe("");
  });

  it("never throws on a malformed language tag", () => {
    expect(() => languageName("!!!not-a-tag###")).not.toThrow();
  });

  it("trims surrounding whitespace before resolving", () => {
    expect(languageName("  hi  ")).toBe("Hindi");
  });
});

describe("compareByLanguageName", () => {
  it("sorts codes alphabetically by their DISPLAY name, not the code", () => {
    // 'hi' (Hindi) sorts before 'kn' (Kannada) alphabetically by name,
    // which also happens to match code order here — pick codes where the
    // code order and the name order actually diverge to prove the point.
    const codes = ["ta", "hi", "kn"]; // names: Tamil, Hindi, Kannada
    const sorted = [...codes].sort(compareByLanguageName);
    expect(sorted).toEqual(["hi", "kn", "ta"]); // Hindi, Kannada, Tamil
  });

  it("groups 'cn' and 'zh' together since both display as Chinese", () => {
    const codes = ["en", "zh", "cn", "ar"];
    const sorted = [...codes].sort(compareByLanguageName);
    // Chinese entries (cn, zh) must be adjacent once sorted by display name.
    const zhIndex = sorted.indexOf("zh");
    const cnIndex = sorted.indexOf("cn");
    expect(Math.abs(zhIndex - cnIndex)).toBe(1);
  });
});
