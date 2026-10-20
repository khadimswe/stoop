import { describe, expect, it } from "vitest";
import { renderAccessResponseSchema } from "../api/responses";
import { videoAccess, type AccessInput } from "./access";

const base: AccessInput = { renderable: true, byok: true, pass: false, server: false, room: null, draftSeconds: 15 };
const answer = (over: Partial<AccessInput>) => renderAccessResponseSchema.parse(videoAccess({ ...base, ...over }));

describe("which video line a visitor sees", () => {
  it("judge: a pass, server drafts on, and room on every counter", () => {
    expect(answer({ pass: true, server: true, room: 3 })).toEqual({ video: "judge", rendersLeft: 3, byok: true, draftSeconds: 15 });
    expect(answer({ pass: true, server: true, room: 1, byok: false })).toEqual({ video: "judge", rendersLeft: 1, byok: false, draftSeconds: 15 });
  });

  it("budget-used: a pass and server drafts on, but a counter is spent (BYOK still offered)", () => {
    expect(answer({ pass: true, server: true, room: 0 })).toEqual({ video: "budget-used", rendersLeft: 0, byok: true, draftSeconds: 15 });
    expect(answer({ pass: true, server: true, room: -2 })).toEqual({ video: "budget-used", rendersLeft: 0, byok: true, draftSeconds: 15 });
  });

  it("byok: no pass, or a pass while Stoop pays for nothing", () => {
    expect(answer({})).toEqual({ video: "byok", rendersLeft: null, byok: true, draftSeconds: 15 });
    expect(answer({ pass: true, server: false })).toEqual({ video: "byok", rendersLeft: null, byok: true, draftSeconds: 15 });
  });

  it("off: BYOK off without a pass, or nothing to render at all", () => {
    expect(answer({ byok: false })).toEqual({ video: "off", rendersLeft: null, byok: false, draftSeconds: 15 });
    expect(answer({ renderable: false })).toEqual({ video: "off", rendersLeft: null, byok: false, draftSeconds: 15 });
    expect(answer({ renderable: false, pass: true, server: true, room: 2 })).toEqual({ video: "off", rendersLeft: 2, byok: false, draftSeconds: 15 });
  });

  it("says how long a draft runs on every line, and only a length a draft can have", () => {
    for (const over of [{}, { byok: false }, { pass: true, server: true, room: 2 }, { renderable: false }]) expect(answer({ ...over, draftSeconds: 8 }).draftSeconds).toBe(8);
    expect(() => answer({ draftSeconds: 3 })).toThrow();
    expect(() => answer({ draftSeconds: 16 })).toThrow();
    expect(() => answer({ draftSeconds: 7.5 })).toThrow();
  });
});
