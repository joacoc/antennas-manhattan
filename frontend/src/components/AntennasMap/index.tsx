import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { buildPulsingDot } from "./DotClone";
import { gql, useMutation, useSubscription } from "@apollo/client";
import { Button, Box, ListItem, Text, UnorderedList } from "@chakra-ui/react";
import mapboxgl, { Map as MapBox } from "mapbox-gl";

/**
 * Subscription
 */
const SUBSCRIBE_ANTENNAS = gql`
  subscription AntennasUpdates {
    antennasUpdates {
      antenna_id
      geojson
      performance
      diff
      timestamp
    }
  }
`;

/**
 * Mutation
 */
const MUTATE_ANTENNAS = gql`
  mutation Mutation($antenna_id: String!) {
    crashAntenna(antenna_id: $antenna_id) {
      antenna_id
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
    helps?: string;
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
  diff: number;
  timestamp: number;
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
function addPulsingDot(
  map: any,
  name: string,
  source: string,
  color: string,
  size?: number
) {
  (map.current as any).addImage(
    name,
    buildPulsingDot(map.current as any, color, size || 30),
    {
      pixelRatio: 2,
    }
  );

  (map.current as any).addLayer({
    id: name,
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

function handleTailUpdate(map: Map<string, Antenna>, update: Antenna) {
  const {
    antenna_id: antennaId,
    diff,
    timestamp: updateTimestamp,
    performance: updatePerformance,
  } = update;

  const currentAntenna = map.get(antennaId);

  if (diff > 0) {
    console.log("Setting antenna: ", update);
    map.set(antennaId, update);
  } else {
    console.log("Removing antenna: ", currentAntenna, update);
    if (currentAntenna) {
      const {
        performance: currentAntennaPerformance,
        timestamp: currentAntennaTimestamp,
      } = currentAntenna;

      if (
        currentAntennaPerformance === updatePerformance &&
        currentAntennaTimestamp <= updateTimestamp
      ) {
        map.delete(antennaId);
      }
    }
  }
}

/**
 * React component that renders antennas performance in a list and a map.
 * @returns
 */
export default function AntennasMap() {
  const mapContainer = useRef<any>(null);
  const map = useRef<MapBox>(null);
  const antennasMapRef = useRef<Map<string, Antenna>>(new Map());
  const helperAntennasMapRef = useRef<Map<string, Antenna>>(new Map());
  const antennasSupportedSetRef = useRef<Set<string>>(new Set());
  const { error, data } = useSubscription<AntennasUpdatesSubscription>(
    SUBSCRIBE_ANTENNAS,
    { fetchPolicy: "network-only", shouldResubscribe: true }
  );
  const [mutateFunction, { error: mutationError }] =
    useMutation<AntennasUpdatesSubscription>(MUTATE_ANTENNAS);
  const mainLayers = useMemo(
    () => [
      "healthy-antennas-layer",
      "unhealthy-antennas-layer",
      "semihealthy-antennas-layer",
      "healthy-pulsing-dot",
      "unhealthy-pulsing-dot",
      "semihealthy-pulsing-dot",
    ],
    []
  );

  if (error) {
    console.error(error);
  }

  if (mutationError) {
    console.error(mutationError);
  }

  /**
   * Callbacks
   */
  const onHighVoltageCrashClick = useCallback(
    (event) => {
      mutateFunction({
        variables: {
          antenna_id: event.target.id,
        },
      });
    },
    [mutateFunction]
  );

  const onHelpersClick = useCallback(() => {
    const { current: mapBox } = map;
    if (mapBox) {
      mapBox.setLayoutProperty(
        "helper-antennas-pulsing-dot",
        "visibility",
        "visible"
      );

      mainLayers.forEach((layer) =>
        mapBox.setLayoutProperty(layer, "visibility", "none")
      );
    }
  }, [mainLayers]);

  const onMainClick = useCallback(() => {
    const { current: mapBox } = map;
    if (mapBox) {
      mainLayers.forEach((layer) =>
        mapBox.setLayoutProperty(layer, "visibility", "visible")
      );
    }
  }, [mainLayers]);

  const onLoad = useCallback(() => {
    /**
     * Set up antenna geojson's
     */
    const { current: mapBox } = map;
    if (mapBox) {
      /**
       * Map sources
       */
      mapBox.addSource("helper-antennas", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

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
       * Map Layers
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
        "helper-antennas-pulsing-dot",
        "helper-antennas",
        "0, 255, 0",
        50
      );
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

  /**
   * Use effects
   */
  useEffect(() => {
    const { current: mapBox } = map;
    const { current: antennasMap } = antennasMapRef;
    const { current: helperAntennasMap } = helperAntennasMapRef;
    const { current: antennasSupportedSet } = antennasSupportedSetRef;

    if (data) {
      const { antennasUpdates: antennasUpdatesData } = data;

      if (antennasUpdatesData && antennasUpdatesData.length > 0) {
        antennasMap.clear();

        antennasUpdatesData.forEach((antennaUpdate) => {
          const { antenna_id } = antennaUpdate;

          try {
            const antenna = {
              ...antennaUpdate,
              geojson: JSON.parse(antennaUpdate.geojson),
            };
            antennasMap.set(antenna_id, antenna);
          } catch (errParsing) {
            console.error(errParsing);
          }
        });

        /**
         * Set Up Antennas
         */
        const healthy: Array<GeoJSON> = [];
        const semiHealthy: Array<GeoJSON> = [];
        const unhealthy: Array<GeoJSON> = [];
        const helpers: Array<GeoJSON> = [];

        Array.from(antennasMap.values()).forEach((antenna: Antenna) => {
          const { geojson, performance, diff } = antenna;
          const { properties } = geojson;
          const { helps } = properties;
          try {
            geojson.type = "Feature";

            if (diff < 0 && properties.helps) {
              console.log(antenna);
            }

            /**
             * Not a helper antenna
             */
            if (!helps) {
              if (performance > 5) {
                healthy.push(geojson);
              } else if (performance < 4.75) {
                unhealthy.push(geojson);
              } else {
                semiHealthy.push(geojson);
              }
            } else {
              handleTailUpdate(helperAntennasMap, antenna);
            }
          } catch (errParsing) {
            console.error(errParsing);
          }
        });

        /**
         * Flap helper antennas into one array
         */
        Array.from(helperAntennasMap.values()).forEach((helperAntenna) => {
          const { geojson } = helperAntenna;
          const { properties } = geojson;
          const { helps } = properties;

          helpers.push(geojson);

          if (helps) {
            antennasSupportedSet.add(helps);
          }
        });

        if (mapBox) {
          setSourceData(mapBox, "healthy-antennas", healthy);
          setSourceData(mapBox, "unhealthy-antennas", unhealthy);
          setSourceData(mapBox, "semihealthy-antennas", semiHealthy);
          setSourceData(mapBox, "helper-antennas", helpers);
        }
      }
    }
  }, [data]);

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
    <Box height={"100%"}>
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
          overflow={"scroll"}
        >
          {Array.from(antennasMapRef.current.values())
            .filter((x) => x.geojson.properties.helps === undefined)
            .map((x) => {
              return (
                <ListItem key={x.antenna_id} marginBottom={"10px"}>
                  <Box display={"flex"}>
                    <Text
                      fontSize={"2xl"}
                      textOverflow={"ellipsis"}
                      overflow={"hidden"}
                      whiteSpace={"nowrap"}
                      color={"gray.300"}
                      width={"200px"}
                    >
                      <span style={{ fontWeight: 300 }}>Performance:</span>{" "}
                      <b>{x.performance.toString().substring(0, 4)}</b>
                    </Text>
                    {helperAntennasMapRef.current.has(
                      x.geojson.properties.name
                    ) && <span>🛠️</span>}
                  </Box>
                  <Box display={"flex"} fontSize={"md"}>
                    <Text
                      textOverflow={"ellipsis"}
                      overflow={"hidden"}
                      whiteSpace={"nowrap"}
                      color={"gray.500"}
                      fontWeight={400}
                    >
                      📡 {x.geojson.properties.name}
                    </Text>
                    <Button
                      id={x.antenna_id}
                      onClick={onHighVoltageCrashClick}
                      size="xs"
                      marginLeft="0.5rem"
                    >
                      ⚡
                    </Button>
                  </Box>
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
      <Box marginTop={10} marginLeft={"5rem"} textAlign="left">
        <Button marginRight={10} onClick={onMainClick}>
          Main
        </Button>
        <Button onClick={onHelpersClick}>Helpers</Button>
      </Box>
    </Box>
  );
}
