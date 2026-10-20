import { describe, expect, it } from "vitest";
import { checkText, checkValue, formatGuardIssues, stripEmDashes, unsupportedClaims, type GuardOptions, type GuardRule } from "./guardrails";

const EM_DASH = String.fromCharCode(0x2014);
const rulesOf = (text: string, options?: GuardOptions): GuardRule[] => checkText(text, options).map((issue) => issue.rule);
const flagged = (rule: GuardRule, text: string, options?: GuardOptions) => rulesOf(text, options).includes(rule);

describe("minor", () => {
  it.each([
    "a teen skating",
    "Teens at the skatepark",
    "two kids laughing",
    "a high school hallway",
    "a high-school hallway",
    "kids in school uniforms",
    "a school uniform",
    "prom night",
    "a girl on a bike",
    "boys on the court",
    "a 16-year-old skater",
    "a 15 year old",
    "fourteen-year-old twins",
    "two high schoolers",
    "a classroom",
    "a pre-teen",
    "made for Gen Alpha",
    "no clutter and two kids",
    "no clutter, two kids on the stoop",
    "a no-frills hangout for teens",
    "This is not your average teen hangout",
    "Nothing beats prom night",
  ])("flags %j", (text) => {
    expect(flagged("minor", text)).toBe(true);
  });

  it.each([
    "college students on a campus quad",
    "a minor key",
    "baby blue",
    "cowboy boots",
    "boyfriend jeans",
    "her girlfriend",
    "old-school sneakers",
    "childhood nostalgia, adults only",
    "a 25-year-old founder",
    "a twenty-five-year-old founder",
    "an 18-year-old",
    "the thirteenth floor",
    "No people, no kids",
    "no kids or teens",
    "No teens. Adults only.",
    "Do not show children.",
    "without children in frame",
    "avoid classrooms",
  ])("passes %j", (text) => {
    expect(flagged("minor", text)).toBe(false);
  });

  it("reports each match with an adult-only message", () => {
    const issues = checkText("two kids and a teen");
    expect(issues.map((issue) => issue.match).sort()).toEqual(["kids", "teen"]);
    expect(issues[0].message).toMatch(/adults/);
  });
});

describe("ethnicity", () => {
  it.each([
    "a Black woman",
    "a white man",
    "an Asian American couple",
    "a Latina model",
    "warm skin tone",
    "skin-tone matched",
    "a Black female model",
    "white male talent",
    "a Middle-Eastern family",
    "two Black young women",
    "a Korean founder",
    "dark-skinned hands",
    "light skin",
    "a mixed race couple",
    "Hispanic shoppers",
  ])("flags %j", (text) => {
    expect(flagged("ethnicity", text)).toBe(true);
  });

  it.each([
    "black leather jacket",
    "white sneakers",
    "Korean barbecue",
    "Japanese denim",
    "Indian restaurant",
    "brown paper bag",
    "a black and white photo",
    "white mom jeans",
    "a black dad hat",
    "white mother-of-pearl buttons",
    "a Japanese chef knife",
    "a watch with black hands",
    "white skinny jeans",
    "Latin music on a speaker",
    "No ethnicity cues. Fictional adults.",
  ])("passes %j", (text) => {
    expect(flagged("ethnicity", text)).toBe(false);
  });
});

describe("likeness", () => {
  it.each([
    "in the style of Wes Anderson",
    "In the style of Wes Anderson, symmetrical",
    "looks like Zendaya",
    "Looks like Zendaya at golden hour",
    "a young Zendaya lookalike",
    "a celebrity cameo",
    "celebs at brunch",
    "a lookalike",
    "a look-alike of a famous chef",
    "channeling Prince",
  ])("flags %j", (text) => {
    expect(flagged("likeness", text)).toBe(true);
  });

  it.each(["in the style of a 90s sitcom", "No celebrity likenesses", "no celebrities, no lookalikes", "looks like rain"])(
    "passes %j",
    (text) => {
      expect(flagged("likeness", text)).toBe(false);
    },
  );
});

describe("named-reference", () => {
  const names = ["Her", "Gap", "Wes Anderson", "Fly By Jing", "Levi's", "Beyoncé", "U2"];

  it.each([
    "Her, shot on film",
    "a Gap hoodie",
    "wes anderson symmetry",
    "WES ANDERSON pastel",
    "Wes-Anderson framing",
    "#WesAnderson",
    "a jar of fly by jing",
    "no Gap logos",
    "Levi’s jacket",
    "a Beyonce tour shirt",
    "Gap's denim",
  ])("flags %j", (text) => {
    expect(flagged("named-reference", text, { names })).toBe(true);
  });

  it.each(["her smile", "a gap in the fence", "andersons hardware", "a U2 tribute"])("passes %j", (text) => {
    expect(flagged("named-reference", text, { names })).toBe(false);
  });

  it("lets allowed names through, ignoring case", () => {
    expect(flagged("named-reference", "a Gap hoodie", { names, allowedNames: ["gap"] })).toBe(false);
    expect(flagged("named-reference", "a Gap hoodie in a Wes Anderson frame", { names, allowedNames: ["Gap"] })).toBe(true);
  });

  it("reports the matched text", () => {
    const issue = checkText("wes anderson symmetry", { names }).find((i) => i.rule === "named-reference");
    expect(issue?.match.toLowerCase()).toBe("wes anderson");
  });

  it("checks nothing without names", () => {
    expect(rulesOf("a Gap hoodie")).toEqual([]);
  });

  it("with exact-case names, a title written as a title is caught and the plain phrase is not", () => {
    const titles = ["Every Day", "The Mending Bench"];
    expect(flagged("named-reference", "the small ritual of every day", { names: titles, exactCaseNames: true })).toBe(false);
    expect(flagged("named-reference", "a look like Every Day", { names: titles, exactCaseNames: true })).toBe(true);
    expect(flagged("named-reference", "the small ritual of every day", { names: titles })).toBe(true);
  });
});

describe("health-claim", () => {
  it.each([
    "FDA approved",
    "clinically proven",
    "SPF 30",
    "spf 50 daily",
    "cures hangovers",
    "dermatologist-recommended",
    "dermatologist tested",
    "boosts immunity",
    "a 3-day detox",
  ])("flags %j", (text) => {
    expect(flagged("health-claim", text)).toBe(true);
  });

  it.each(["a fresh start", "healthy glow lighting", "a curated shelf"])("passes %j", (text) => {
    expect(flagged("health-claim", text)).toBe(false);
  });
});

describe("fake-proof", () => {
  it.each([
    "sold out",
    "selling out fast",
    "#1 best seller",
    "bestselling hot sauce",
    "5 stars",
    "five-star reviews",
    "4.9 stars",
    "rated 4.9",
    "10,000 customers",
    "10k+ customers",
    "2 million customers",
    "50,000 happy customers",
    "1,200 reviews",
    "thousands of happy customers",
    "as seen on TV",
    "it went viral",
    "top-rated",
    "award-winning salsa",
    "loved by thousands",
  ])("flags %j", (text) => {
    expect(flagged("fake-proof", text)).toBe(true);
  });

  it.each(["a fresh start", "five friends", "a #10 envelope", "three stairs up to the stoop", "no ratings, no sold out claims"])(
    "passes %j",
    (text) => {
      expect(flagged("fake-proof", text)).toBe(false);
    },
  );
});

describe("em-dash", () => {
  it("flags the em dash once per string", () => {
    expect(rulesOf(`bright${EM_DASH}loud${EM_DASH}fast`)).toEqual(["em-dash"]);
  });

  it("does not flag hyphens or en dashes", () => {
    expect(rulesOf("well-lit, 9-to-5, 18 – 24")).toEqual([]);
  });
});

describe("clean text", () => {
  it("passes an ordinary adult scene prompt", () => {
    const prompt =
      "Two adult friends on a brownstone stoop at dusk, black leather jacket, white sneakers, warm tungsten light. No people in the background, no text, no logos, no celebrity likenesses.";
    expect(checkText(prompt, { names: ["Wes Anderson"] })).toEqual([]);
  });
});

describe("checkValue", () => {
  it("reports dotted paths into objects and arrays", () => {
    const issues = checkValue({ hooks: ["a clean hook", "two teens on a stoop"], scene: { music: { feel: "kids choir" } } });
    expect(issues.map((issue) => issue.path)).toEqual(["hooks.1", "scene.music.feel"]);
    expect(issues.every((issue) => issue.rule === "minor")).toBe(true);
  });

  it("prefixes a base path and passes options down", () => {
    const issues = checkValue([{ caption: "a Gap tee" }], { names: ["Gap"] }, "brief");
    expect(issues).toEqual([expect.objectContaining({ rule: "named-reference", path: "brief.0.caption", match: "Gap" })]);
  });

  it("ignores numbers, booleans and null and returns an empty path for a bare string", () => {
    expect(checkValue({ n: 5, b: true, z: null, u: undefined })).toEqual([]);
    expect(checkValue("a teen")[0].path).toBe("");
  });
});

describe("stripEmDashes", () => {
  it("turns an em dash into a comma without doubled or leading commas", () => {
    expect(stripEmDashes(`a${EM_DASH}b`)).toBe("a, b");
    expect(stripEmDashes(`a ${EM_DASH} b`)).toBe("a, b");
    expect(stripEmDashes(`a,${EM_DASH}b`)).toBe("a, b");
    expect(stripEmDashes(`a ${EM_DASH}, b`)).toBe("a, b");
    expect(stripEmDashes(`a ${EM_DASH} ${EM_DASH} b`)).toBe("a, b");
    expect(stripEmDashes(`${EM_DASH} a`)).toBe("a");
  });

  it("leaves no trailing comma or comma before end punctuation", () => {
    expect(stripEmDashes(`Wait${EM_DASH}`)).toBe("Wait");
    expect(stripEmDashes(`Wait ${EM_DASH}.`)).toBe("Wait.");
  });

  it("recurses into nested objects and arrays and leaves other values alone", () => {
    const input = { a: `x${EM_DASH}y`, list: [`p ${EM_DASH} q`, 3, null, { deep: [`m${EM_DASH}n`] }], ok: true };
    expect(stripEmDashes(input)).toEqual({ a: "x, y", list: ["p, q", 3, null, { deep: ["m, n"] }], ok: true });
    expect(input.a).toBe(`x${EM_DASH}y`);
  });

  it("keeps non-plain objects such as dates intact", () => {
    const when = new Date("2026-10-16T00:00:00Z");
    expect(stripEmDashes({ when }).when).toBe(when);
  });

  it("leaves text with no em dash unchanged", () => {
    expect(stripEmDashes("a, b, c")).toBe("a, b, c");
  });

  it("produces text that passes the em-dash check", () => {
    expect(rulesOf(stripEmDashes(`one${EM_DASH}two ${EM_DASH} three`))).toEqual([]);
  });
});

describe("formatGuardIssues", () => {
  it("writes one line per issue, with the path when there is one", () => {
    const text = formatGuardIssues([
      { rule: "minor", match: "teen", message: "first", path: "hooks.0" },
      { rule: "em-dash", match: EM_DASH, message: "second" },
    ]);
    expect(text).toBe("- hooks.0: first\n- second");
  });

  it("is empty for no issues", () => {
    expect(formatGuardIssues([])).toBe("");
  });
});

describe("place codes and allowed places", () => {
  it("flags uppercase two-letter place codes but not other short names", () => {
    expect(checkText("a rooftop in LA at dusk", { names: ["LA", "Al"] }).map((i) => i.match)).toEqual(["LA"]);
    expect(checkText("la la land vibes", { names: ["LA"] })).toEqual([]);
  });

  it("allows a name contained in an allowed place", () => {
    expect(checkText("a Brooklyn rooftop", { names: ["Brooklyn"], allowedNames: ["Brooklyn Museum"] })).toEqual([]);
    expect(checkText("a Brooklyn rooftop", { names: ["Brooklyn"], allowedNames: ["Brooklynite Cafe"] })).toHaveLength(1);
  });
});

describe("Qloo tag names kept in the fixtures", () => {
  // Real tag names from the Gate 2 recordings. Gate 4 runs checkText on every tag before craft
  // translation uses it; these must be caught.
  it.each(["Contemporary latinx aesthetic", "Indigenous visual vernacular", "Afro-Indigenous Influenced", "Teen Pop", "Classroom centric"])(
    "flags %s",
    (name) => {
      expect(checkText(name).some((issue) => issue.rule === "ethnicity" || issue.rule === "minor")).toBe(true);
    },
  );
});

describe("unsupportedClaims", () => {
  const seller = "Soy wax candles poured by hand. Each one burns for about 50 hours in a reusable glass jar. Price: $36.";

  it("passes the facts the seller gave, in any spelling of the same number and unit", () => {
    expect(unsupportedClaims("A 50-hour burn in a reusable jar, $36.", seller)).toEqual([]);
    expect(unsupportedClaims("Burns 50 hours.", seller)).toEqual([]);
  });

  it("names prices, quantities and claims the seller never made", () => {
    expect(unsupportedClaims("Now $29, burns 80 hours, vegan and machine washable.", seller)).toEqual(["$29", "80 hours", "machine washable", "vegan"]);
  });

  it("leaves plain numbers and timecodes alone", () => {
    expect(unsupportedClaims("Scene 3, 0 to 3 s, two hands, 9:16.", seller)).toEqual([]);
  });
});
