import express from "express";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { buildSchema } from "graphql";
import MaterializeClient from "./MaterializeClient";
import EventEmitter from "events";

const client = new MaterializeClient({
  host: "materialized",
  port: 6875,
  user: "materialize",
  password: "materialize",
  database: "materialize",
});

/**
 * Build GraphQL Schema
 */
const schema = buildSchema(`
  type Antenna {
    antenna_id: String
    geojson: String
    performance: Float
  }

  type Query {
    getAntennas: [Antenna]
  }

  type Mutation {
    updateAntenna: Antenna
  }

  type Subscription {
    antennasUpdates: [Antenna]
  }
`);

/**
 * Queries
 */
const getAntennas = async () => {
  try {
    const { rows } = await client.query("SELECT * FROM antennas;");

    /**
     * Stringify GEOJson
     */
    const mappedRows = rows.map((x) => ({
      ...x,
      geojson: JSON.stringify(x.geojson),
    }));
    return mappedRows;
  } catch (err) {
    console.log("Error running query.");
    console.error(err);
  }

  return "Hello!";
};

/**
 * Mutations
 */
const updateAntennas = async () => {
  console.log("Mutation");
  return "Mutated";
};

/**
 * Subscriptions
 */
async function* antennasUpdates() {
  try {
    /**
     * Yield helpers
     */
    let results = [];
    let resolve: (value: unknown) => void;
    let promise = new Promise((r) => (resolve = r));
    let done = false;

    /**
     * Listen tail events
     */
    const eventEmmiter = new EventEmitter();
    eventEmmiter.on("data", (data) => {
      const mappedData = data.map((x) => ({
        ...x,
        geojson: JSON.stringify(x.geojson),
      }));
      results = mappedData;
      resolve(mappedData);
      promise = new Promise((r) => (resolve = r));
    });

    client
      .tail("TAIL last_minute_performance_per_antenna", eventEmmiter)
      .catch((tailErr) => {
        console.error("Error running tail.");
        console.error(tailErr);
      })
      .finally(() => {
        console.log("Finished.");
        done = true;
      });

    /**
     * Yield results
     */
    while (!done) {
      await promise;
      yield { antennasUpdates: results };
      results = [];
    }
  } catch (error) {
    console.error("Error running antennas updates subscription.");
    console.error(error);
  }
}

/**
 * The roots provide resolvers for each GraphQL operation
 */
const roots = {
  query: {
    getAntennas,
  },
  mutation: {
    updateAntennas,
  },
  subscription: {
    antennasUpdates,
  },
};

/**
 * Setup server
 */
const app = express();

const server = app.listen(4000, () => {
  const wsServer = new WebSocketServer({
    server,
    path: "/graphql",
  });

  useServer({ schema, roots }, wsServer);

  console.log(
    "🚀 GraphQL web socket server listening on port 4000. \n\nUse 'ws://localhost:4000/graphql' to connect."
  );
});
