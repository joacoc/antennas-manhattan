import express from "express";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/lib/use/ws";
import { buildSchema } from "graphql";
import MaterializeClient from "./MaterializeClient";
import EventEmitter from "events";
import { Pool } from "pg";

/**
 * Materialize Client
 */
const materializeClient = new MaterializeClient({
  //   host: "localhost",
  host: "materialized",
  port: 6875,
  user: "materialize",
  password: "materialize",
  database: "materialize",
});

/**
 * Postgres Client
 */
const postgresPool = new Pool({
  //   host: "localhost",
  host: "postgres",
  port: 5432,
  user: "postgres",
  password: "pg_password",
  database: "postgres",
});

/**
 * Build GraphQL Schema
 */
const schema = buildSchema(`
  type Antenna {
    antenna_id: String
    geojson: String
    performance: Float
    diff: Int
    timestamp: Float
  }

  type Query {
    getAntennas: [Antenna]
  }

  type Mutation {
    crashAntenna(antenna_id: String!): Antenna
  }

  type Subscription {
    antennasUpdates: [Antenna]
  }
`);

/**
 * Build a custom Postgres insert with a low performance value to crash antenna
 * @param antennaId Antenna Identifier
 * @returns
 */
function buildQuery(antennaId: number) {
  return `
      INSERT INTO antennas_performance (antenna_id, clients_connected, performance, updated_at) VALUES (
        ${antennaId},
        ${Math.ceil(Math.random() * 100)},
        -100,
        now()
      );
    `;
}

/**
 * Queries
 */
const getAntennas = async () => {
  try {
    const { rows } = await materializeClient.query("SELECT * FROM antennas;");

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
const crashAntenna = async (context) => {
  const { antenna_id: antennaId } = context;

  postgresPool.connect(async (err, client, done) => {
    if (err) {
      console.error(err);
      return;
    }

    try {
      /**
       * Smash the performance
       */
      const query = buildQuery(antennaId);

      await client.query(query);
    } catch (clientErr) {
      console.error(clientErr);
    } finally {
      done();
    }
  });

  return {
    antenna_id: antennaId,
  };
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
        diff: x.mz_diff,
        timestamp: x.mz_timestamp,
      }));
      results = mappedData;
      resolve(mappedData);
      promise = new Promise((r) => (resolve = r));
    });

    materializeClient
      .tail(
        // "TAIL (SELECT * FROM last_minute_performance_per_antenna WHERE antenna_id = 1 OR antenna_id = 8 OR antenna_id = 9 OR antenna_id = 10)",
        "TAIL (SELECT * FROM last_minute_performance_per_antenna)",
        eventEmmiter
      )
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
    crashAntenna,
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
