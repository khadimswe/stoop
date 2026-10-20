import { describe, expect, it } from "vitest";
import { cueKeyOf, FACT_KEYS, receiptHash, receiptKeyOf } from "./deep-link";
import { ACTIONS_EXPIRED_LINE, LIVE_ACTION_DAYS, REPORT_DAYS, RETENTION_LINE } from "./retention";
import { TTL, DAY_SECONDS } from "../../store/keys";

describe("receipt deep links", () => {
  it("reads #receipt-<cue> and nothing else", () => {
    expect(receiptKeyOf("#receipt-music")).toBe("music");
    expect(receiptKeyOf("#receipt-Music")).toBe("music");
    expect(receiptKeyOf("#receipt-setting-city")).toBe("setting-city");
    expect(receiptKeyOf(receiptHash("wardrobe"))).toBe("wardrobe");
    for (const hash of ["", "#", "#screening", "#receipt-", "#receipt-1abc", "#receipt-%E0%A4%A", "#receipt-a b", "#receipt-x\"]"]) expect(receiptKeyOf(hash), hash).toBeNull();
  });

  it("takes the words a link might use for the same cue", () => {
    expect(receiptKeyOf("#receipt-music-style")).toBe("music");
    expect(receiptKeyOf("#receipt-look")).toBe("visual");
    expect(receiptKeyOf("#receipt-voice-tone")).toBe("voice");
    expect(receiptKeyOf("#receipt-city")).toBe(FACT_KEYS.setting);
  });

  it("names each brief slot the way links name it", () => {
    expect(cueKeyOf("music")).toBe("music");
    expect(cueKeyOf("visual")).toBe("visual");
    expect(cueKeyOf("voice.tone")).toBe("voice");
    expect(["setting.0", "setting.1", "setting.2"].map(cueKeyOf)).toEqual(["setting", "setting", "setting"]);
    expect(cueKeyOf("productRole")).toBe("productrole");
    // The world facts never share a key with a brief cue.
    expect(new Set(Object.values(FACT_KEYS)).size).toBe(3);
    for (const key of Object.values(FACT_KEYS)) expect(["music", "visual", "wardrobe", "setting", "mood", "voice"]).not.toContain(key);
  });
});

describe("the retention statement", () => {
  it("says the store's own numbers: reports 30 days, storyboards and revisions 7", () => {
    expect(REPORT_DAYS).toBe(TTL.report / DAY_SECONDS);
    expect(LIVE_ACTION_DAYS).toBe(TTL.runEvents / DAY_SECONDS);
    expect([REPORT_DAYS, LIVE_ACTION_DAYS]).toEqual([30, 7]);
    expect(RETENTION_LINE).toBe('Live reports are kept for 30 days. Storyboards and "Not this vibe" work for the first 7.');
    expect(ACTIONS_EXPIRED_LINE).toMatch(/first 7 days.*30 days/);
  });
});
