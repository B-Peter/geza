import { describe, expect, it } from "vitest";
import { cleanAlbum, countryName, pickArtist, pickYear } from "../src/musicbrainz.js";

describe("pickArtist", () => {
  const json = {
    artists: [
      {
        score: 100,
        name: "Queen",
        country: "GB",
        type: "Group",
        tags: [
          { name: "rock", count: 30 },
          { name: "british", count: 25 },
          { name: "glam rock", count: 12 },
          { name: "seen live", count: 10 },
          { name: "70s", count: 9 },
          { name: "hard rock", count: 8 },
          { name: "art rock", count: 4 },
          { name: "pop rock", count: 3 },
        ],
      },
      { score: 80, name: "Queen Latifah", country: "US", type: "Person", tags: [] },
    ],
  };

  it("takes country, type and the top real genres", () => {
    expect(pickArtist(json, "Queen")).toEqual({
      country: "GB",
      type: "Group",
      genres: ["rock", "glam rock", "hard rock", "art rock"],
    });
  });

  it("refuses a weak or different match", () => {
    expect(pickArtist(json, "Queens of the Stone Age")).toBeNull();
    expect(pickArtist({ artists: [{ score: 70, name: "Queen" }] }, "Queen")).toBeNull();
  });
});

describe("album year", () => {
  it("strips remaster and deluxe suffixes", () => {
    expect(cleanAlbum("A Night at the Opera (2011 Remaster)")).toBe("A Night at the Opera");
    expect(cleanAlbum("Nevermind (30th Anniversary Super Deluxe)")).toBe("Nevermind");
    expect(cleanAlbum("Rumours - 2004 Remaster")).toBe("Rumours");
    expect(cleanAlbum("In Rainbows")).toBe("In Rainbows");
  });

  it("takes the original album, not a compilation", () => {
    const json = {
      "release-groups": [
        { score: 100, title: "A Night at the Opera", "first-release-date": "1975-11-21" },
        {
          score: 95,
          title: "A Night at the Opera",
          "secondary-types": ["Compilation"],
          "first-release-date": "2000",
        },
      ],
    };
    expect(pickYear(json, "A Night at the Opera")).toBe(1975);
    expect(
      pickYear({ "release-groups": [json["release-groups"][1]] }, "A Night at the Opera"),
    ).toBeUndefined();
    expect(pickYear({}, "Anything")).toBeUndefined();
  });
});

describe("countryName", () => {
  it("names countries", () => {
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("HU")).toBe("Hungary");
  });
});
