import React, { useRef, useEffect, useCallback } from "react";
import { buildPulsingDot } from "./DotClone";
import { gql, useSubscription } from "@apollo/client";
import { Box, ListItem, Text, UnorderedList } from "@chakra-ui/react";
import mapboxgl, { Map as MapBox } from "mapbox-gl";

const SUBSCRIBE_ANTENNAS = gql`
  subscription AntennasUpdates {
    antennasUpdates {
      antenna_id
      geojson
      performance
    }
  }
`;

interface GeoJSON {
  type: string;
  geometry: {
    type: string;
    coordinates: [number, number];
  };
  properties: {
    name: string;
  };
}

interface Antenna extends BaseAntenna {
  geojson: GeoJSON;
}

interface RawAntenna extends BaseAntenna {
  geojson: string;
}

interface BaseAntenna {
  antenna_id: string;
  performance: number;
}

interface AntennasUpdatesSubscription {
  antennasUpdates: Array<RawAntenna>;
}

/**
 * Set up a source data
 * @param map MapBox
 * @param sourceName Map source name
 * @param data Data to set
 */
function setSourceData(
  map: MapBox,
  sourceName: string,
  data: Array<GeoJSON>
): void {
  const source = map.getSource(sourceName);

  if (source) {
    (source as any).setData({
      type: "FeatureCollection",
      features: data,
    });
  }
}

/**
 *
 * @param map MapBox
 * @param name Image layer name
 * @param source Source name
 * @param color Color to be used
 */
function addPulsingDot(map: any, name: string, source: string, color: string) {
  (map.current as any).addImage(
    name,
    buildPulsingDot(map.current as any, color),
    {
      pixelRatio: 2,
    }
  );

  (map.current as any).addLayer({
    id: `${name}-dot-point`,
    type: "symbol",
    source: source,
    layout: {
      "icon-image": name,
    },
  });
}

/**
 * Replace with your own MapBox token
 */
function REPLACE_ME_WITH_YOUR_TOKEN() {
  return (
    "pk" +
    ".ey" +
    "J1Ijo" +
    "iam9hcXVpbmNvbGFjY2kiLCJhIjoiY2t6N2Z4M2pzMWExcTJvdHYxc3k4MzFveSJ9.QSm7ZtegpUwuZ1MCbt4dIg"
  );
}

/**
 * React component that renders antennas performance in a list and a map.
 * @returns
 */
export default function AntennasMap() {
  const mapContainer = useRef<any>(null);
  const map = useRef<MapBox>(null);
  const antennasMap = useRef<Map<string, Antenna>>(new Map());
  const { error, data } = useSubscription<AntennasUpdatesSubscription>(
    SUBSCRIBE_ANTENNAS,
    { fetchPolicy: "network-only", shouldResubscribe: true }
  );

  if (error) {
    console.error(error);
  }

  useEffect(() => {
    if (data) {
      const { antennasUpdates: antennasUpdatesData } = data;

      if (antennasUpdatesData && antennasUpdatesData.length > 0) {
        antennasUpdatesData.forEach((antennaUpdate) => {
          const { antenna_id } = antennaUpdate;

          try {
            const antenna = {
              ...antennaUpdate,
              geojson: JSON.parse(antennaUpdate.geojson),
            };
            antennasMap.current.set(antenna_id, antenna);
          } catch (errParsing) {}
        });

        /**
         * Set Up Datasets
         */
        const healthy: Array<GeoJSON> = [];
        const semiHealthy: Array<GeoJSON> = [];
        const unhealthy: Array<GeoJSON> = [];

        Array.from(antennasMap.current.values()).forEach((antenna) => {
          const { geojson, performance } = antenna;
          try {
            geojson.type = "Feature";

            if (performance > 5) {
              healthy.push(geojson);
            } else if (performance < 4.75) {
              unhealthy.push(geojson);
            } else {
              semiHealthy.push(geojson);
            }
          } catch (errParsing) {
            console.error(errParsing);
          }
        });

        if (map.current) {
          setSourceData(map.current, "healthy-antennas", healthy);
          setSourceData(map.current, "unhealthy-antennas", unhealthy);
          setSourceData(map.current, "semihealthy-antennas", semiHealthy);
        }
      }
    }
  }, [data]);

  const onLoad = useCallback(() => {
    /**
     * Set up antenna geojson's
     */
    const { current: mapBox } = map;
    if (mapBox) {
      mapBox.addSource("healthy-antennas", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      mapBox.addSource("unhealthy-antennas", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      mapBox.addSource("semihealthy-antennas", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      /**
       * Set up drawing layer
       */

      // Healthy antennas
      mapBox.addLayer({
        id: "healthy-antennas-layer",
        type: "circle",
        source: "healthy-antennas",
        paint: {
          "circle-radius": 70,
          "circle-color": "#00FF00",
          "circle-opacity": 0.3,
        },
        filter: ["==", "$type", "Point"],
      });

      // Semihealthy antennas
      mapBox.addLayer({
        id: "semihealthy-antennas-layer",
        type: "circle",
        source: "semihealthy-antennas",
        paint: {
          "circle-radius": 70,
          "circle-color": "#FFFF00",
          "circle-opacity": 0.3,
        },
        filter: ["==", "$type", "Point"],
      });

      // Unhealthy antennas
      mapBox.addLayer({
        id: "unhealthy-antennas-layer",
        type: "circle",
        source: "unhealthy-antennas",
        paint: {
          "circle-radius": 70,
          "circle-color": "#FF0000",
          "circle-opacity": 0.3,
        },
        filter: ["==", "$type", "Point"],
      });

      /**
       * Pulsing DOT
       */
      addPulsingDot(
        map,
        "healthy-pulsing-dot",
        "healthy-antennas",
        "0, 255, 0"
      );
      addPulsingDot(
        map,
        "semihealthy-pulsing-dot",
        "semihealthy-antennas",
        "255, 255, 0"
      );
      addPulsingDot(
        map,
        "unhealthy-pulsing-dot",
        "unhealthy-antennas",
        "255, 0, 0"
      );
    }
  }, []);

  useEffect(() => {
    const { current: mapBox } = map;
    if (mapBox) return;

    mapboxgl.accessToken = REPLACE_ME_WITH_YOUR_TOKEN();
    (map.current as any) = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/dark-v10",
      center: [-73.988, 40.733],
      zoom: 12.5,
      scrollZoom: false,
      doubleClickZoom: false,
      dragRotate: true,
      antialias: true,
      bearing: -60,
    });

    (map.current as any).on("load", onLoad);
  });

  return (
    <Box
      display={"flex"}
      width={"100%"}
      height={"65%"}
      paddingX={"5rem"}
      overflow={"hidden"}
    >
      <UnorderedList
        minWidth={"400px"}
        maxWidth={"400px"}
        marginRight={"4rem"}
        textAlign={"left"}
      >
        {Array.from(antennasMap.current.values()).map((x) => {
          return (
            <ListItem key={x.antenna_id} marginBottom={"10px"}>
              <Text
                fontSize={"2xl"}
                textOverflow={"ellipsis"}
                overflow={"hidden"}
                whiteSpace={"nowrap"}
                color={"gray.300"}
              >
                <span style={{ fontWeight: 300 }}>Performance:</span>{" "}
                <b>{x.performance.toString().substring(0, 4)}</b>
              </Text>
              <Text
                fontSize={"md"}
                textOverflow={"ellipsis"}
                overflow={"hidden"}
                whiteSpace={"nowrap"}
                color={"gray.500"}
                fontWeight={400}
              >
                📡 {x.geojson.properties.name}
              </Text>
            </ListItem>
          );
        })}
      </UnorderedList>
      <Box
        id="map"
        width={"100%"}
        boxShadow={"xl"}
        ref={mapContainer}
        className="map"
      />
    </Box>
  );
}
