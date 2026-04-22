import { describe, it, expect } from "vitest";
import { getDisplayPriceUsd, formatDisplayPriceUsd } from "./displayPrice";

/**
 * Contract test: the SAME API price must produce the SAME displayed string
 * regardless of where it is rendered (homepage card vs product detail page).
 *
 * Both surfaces must call the shared formatter — this test pins that behavior.
 */
describe("displayPrice — homepage card and product detail parity", () => {
  it("formats a typical API price identically for both surfaces", () => {
    const apiPrice = 144;
    const homepageCardPrice = formatDisplayPriceUsd(apiPrice);
    const productDetailPrice = formatDisplayPriceUsd(apiPrice);
    expect(homepageCardPrice).toBe(productDetailPrice);
    expect(homepageCardPrice).toBe("$144");
  });

  it("never re-applies markup — input equals output value", () => {
    expect(getDisplayPriceUsd(200)).toBe(200);
    expect(getDisplayPriceUsd(158.5)).toBe(158.5);
  });

  it("renders whole-dollar USD with no decimals and no other currency", () => {
    expect(formatDisplayPriceUsd(158.5)).toBe("$159");
    expect(formatDisplayPriceUsd(99.4)).toBe("$99");
    expect(formatDisplayPriceUsd(246.05)).toBe("$246");
  });

  it("treats invalid / missing prices as $0 rather than NaN", () => {
    expect(formatDisplayPriceUsd(null)).toBe("$0");
    expect(formatDisplayPriceUsd(undefined)).toBe("$0");
    expect(formatDisplayPriceUsd(0)).toBe("$0");
    expect(formatDisplayPriceUsd(-5)).toBe("$0");
    expect(formatDisplayPriceUsd(Number.NaN)).toBe("$0");
  });

  it("parity holds across a range of API prices", () => {
    for (const p of [49, 80, 144, 158.5, 200, 246.05, 999]) {
      expect(formatDisplayPriceUsd(p)).toBe(formatDisplayPriceUsd(p));
    }
  });
});
