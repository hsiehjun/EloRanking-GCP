import { STORAGE_KEY_LAYOUT_MEASUREMENTS } from "./constants.js";
import { toDeckSlug } from "./dispositions.js";

export const DISPOSITION_TERRAIN_INFO = [
  {
    name: "Take and Hold",
    slug: "take-and-hold",
    image: "/assets/11th/force-disposition/take-and-hold.png",
    color: "#2f6b4f"
  },
  {
    name: "Purge the Foe",
    slug: "purge-the-foe",
    image: "/assets/11th/force-disposition/purge-the-foe.png",
    color: "#8a2b2b"
  },
  {
    name: "Reconnaissance",
    slug: "reconnaissance",
    image: "/assets/11th/force-disposition/reconnaissance.png",
    color: "#1f7a82"
  },
  {
    name: "Priority Assets",
    slug: "priority-assets",
    image: "/assets/11th/force-disposition/priority-assets.png",
    color: "#a17b14"
  },
  {
    name: "Disruption",
    slug: "disruption",
    image: "/assets/11th/force-disposition/disruption.png",
    color: "#1f4f8a"
  }
];

const DISPOSITION_ORDER = [
  "take-and-hold",
  "disruption",
  "purge-the-foe",
  "priority-assets",
  "reconnaissance"
];

// Portrait orientation flags for specific layout numbers
const PORTRAIT_LAYOUTS = {
  "disruption-mirror": 3,
  "disruption-vs-priority-assets": 1,
  "disruption-vs-purge-the-foe": 3,
  "disruption-vs-reconnaissance": 2,
  "priority-assets-mirror": 1,
  "priority-assets-vs-reconnaissance": 3,
  "purge-the-foe-mirror": 3,
  "purge-the-foe-vs-priority-assets": 1,
  "purge-the-foe-vs-reconnaissance": 2,
  "reconnaissance-mirror": 1,
  "take-and-hold-mirror": 2,
  "take-and-hold-vs-disruption": 1,
  "take-and-hold-vs-priority-assets": 3,
  "take-and-hold-vs-purge-the-foe": 1,
  "take-and-hold-vs-reconnaissance": 2
};

function getLayoutImagePath(matchupKey, layoutNumber, withMeasurements) {
  const isPortrait = PORTRAIT_LAYOUTS[matchupKey] === layoutNumber ? "-portrait" : "";
  const folder = withMeasurements ? "with-measurements" : "no-measurements";
  return `/assets/11th/layouts/${folder}/${matchupKey}-${layoutNumber}${isPortrait}.png`;
}

export function getMatchupTerrain(p1Key, p2Key) {
  const slug1 = toDeckSlug(p1Key);
  const slug2 = toDeckSlug(p2Key);
  const home = DISPOSITION_TERRAIN_INFO.find(d => d.slug === slug1);
  const opp = DISPOSITION_TERRAIN_INFO.find(d => d.slug === slug2);
  if (!home || !opp) return null;

  let matchupKey;
  if (slug1 === slug2) {
    matchupKey = `${slug1}-mirror`;
  } else {
    const [first, second] = [slug1, slug2].sort(
      (a, b) => DISPOSITION_ORDER.indexOf(a) - DISPOSITION_ORDER.indexOf(b)
    );
    matchupKey = `${first}-vs-${second}`;
  }

  const [firstObj, secondObj] = [home, opp].sort(
    (a, b) => DISPOSITION_ORDER.indexOf(a.slug) - DISPOSITION_ORDER.indexOf(b.slug)
  );
  const matchupName =
    firstObj.slug === secondObj.slug
      ? `${firstObj.name} Mirror`
      : `${firstObj.name} vs ${secondObj.name}`;

  return {
    home,
    opponent: opp,
    name: matchupName,
    matchupKey,
    layouts: [1, 2, 3].map(num => ({
      number: num,
      name: `Layout ${num}`,
      image: getLayoutImagePath(matchupKey, num, false),
      measurementsImage: getLayoutImagePath(matchupKey, num, true)
    }))
  };
}

export function getShowMeasurements() {
  try {
    return localStorage.getItem(STORAGE_KEY_LAYOUT_MEASUREMENTS) === "1";
  } catch (e) {
    return false;
  }
}

export function setShowMeasurements(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY_LAYOUT_MEASUREMENTS, enabled ? "1" : "0");
  } catch (e) {}
}
