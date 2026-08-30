"use strict";

const minecraftData = require("minecraft-data");
const minecraftAssets = require("minecraft-assets");

const DEFAULT_VERSION = "1.21.8";

function createItemCatalog(version = DEFAULT_VERSION) {
  const requestedVersion = version || DEFAULT_VERSION;
  const data = minecraftData(requestedVersion);
  const assets = minecraftAssets(requestedVersion);
  if (!data || !assets) throw new Error(`unsupported Minecraft item catalog version: ${requestedVersion}`);

  const items = data.itemsArray.map(item => ({
    id: `minecraft:${item.name}`,
    name: item.displayName,
    query: item.name.replaceAll("_", " "),
    search: `${item.displayName} ${item.name} ${item.name.replaceAll("_", " ")}`.toLowerCase()
  }));
  const byId = new Map(items.map(item => [item.id, item]));

  function output(item) {
    return {
      id: item.id,
      name: item.name,
      query: item.query,
      image: assets.textureContent[item.id.slice("minecraft:".length)]?.texture || null
    };
  }

  return {
    find(ids) {
      return ids.map(id => byId.get(id)).filter(Boolean).map(output);
    },
    search(term, limit = 30) {
      const needle = String(term || "").trim().toLowerCase();
      if (!needle) return [];
      return items
        .filter(item => item.search.includes(needle))
        .sort((left, right) => {
          const leftStarts = left.search.startsWith(needle);
          const rightStarts = right.search.startsWith(needle);
          return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name);
        })
        .slice(0, limit)
        .map(output);
    }
  };
}

module.exports = { createItemCatalog, DEFAULT_VERSION };
