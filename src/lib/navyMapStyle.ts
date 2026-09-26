import type { StyleSpecification } from "maplibre-gl";

/** Restyle geographic features themselves, keeping text and roads crisp. */
export function navyMapStyle(source: StyleSpecification): StyleSpecification {
  const style = structuredClone(source);
  style.name = "NEMT midnight streets";
  for (const layer of style.layers) {
    const id = layer.id;
    if (layer.type === "background") {
      layer.paint = { ...layer.paint, "background-color": "#202936" };
    } else if (layer.type === "fill") {
      const color = id === "water" ? "#090f18"
        : /park|wood/.test(id) ? "#263e40"
        : id === "building" ? "#263140" : "#202936";
      layer.paint = { ...layer.paint, "fill-color": color };
      delete layer.paint["fill-pattern"];
      if (id === "building") {
        layer.minzoom = 16;
        layer.paint["fill-outline-color"] = "#2d3949";
      }
    } else if (layer.type === "line") {
      const color = /water/.test(id) ? "#090f18"
        : /casing/.test(id) ? "#202936"
        : /motorway/.test(id) ? "#7696be"
        : /major/.test(id) ? "#607997"
        : /highway|road/.test(id) ? "#3e5068" : "#344354";
      layer.paint = { ...layer.paint, "line-color": color };
      if (/railway/.test(id)) layer.layout = { ...layer.layout, visibility: "none" };
    } else if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      layer.paint = {
        ...layer.paint,
        "text-color": /water/.test(id) ? "#8eabbf" : /highway/.test(id) ? "#b6c3d4" : "#d1d9e3",
        "text-halo-color": "#202936",
        "text-halo-width": 1.2,
        "text-halo-blur": 0.3,
      };
    }
  }
  return style;
}
