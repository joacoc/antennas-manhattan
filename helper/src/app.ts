import { Pool } from "pg";
import { Kafka } from "kafkajs";
import { helperAntennas, mainAntennas } from "./data";

const antennasEventsTopicName = "antennas_performance";
const antennasTopic = "antennas";

/**
 * Create Materialize sources and materialized views
 * Before creating the views it will check if they aren't created already.
 */
async function setUpMaterialize() {
  const pool = await new Pool({
    host: "materialized",
    port: 6875,
    user: "materialize",
    password: "materialize",
    database: "materialize",
  });
  const poolClient = await pool.connect();

  await poolClient.query(`
    CREATE MATERIALIZED SOURCE IF NOT EXISTS antennas_performance
    FROM KAFKA BROKER 'broker:29092' TOPIC '${antennasEventsTopicName}'
    WITH (kafka_time_offset = 0)
    FORMAT BYTES;
  `);

  await poolClient.query(`
    CREATE MATERIALIZED SOURCE IF NOT EXISTS antennas
    FROM KAFKA BROKER 'broker:29092' TOPIC '${antennasTopic}'
    WITH (kafka_time_offset = 0)
    FORMAT BYTES;
  `);

  const { rowCount } = await pool.query(
    "SHOW sources WHERE name='antennas' OR name='antennas_performance';"
  );

  if (!rowCount) {

    await poolClient.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS last_half_minute_updates AS
      SELECT A.antenna_id, A.geojson, performance, AP.updated_at, ((CAST(EXTRACT( epoch from AP.updated_at) AS NUMERIC) * 1000) + 30000)
      FROM antennas A JOIN antennas_performance AP ON (A.antenna_id = AP.antenna_id)
      WHERE ((CAST(EXTRACT( epoch from AP.updated_at) AS NUMERIC) * 1000) + 30000) > mz_logical_timestamp();
    `);

    await poolClient.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS last_half_minute_performance_per_antenna AS
      SELECT antenna_id, geojson, AVG(performance) as performance
      FROM last_half_minute_updates
      GROUP BY antenna_id, geojson;
    `);
  }

  poolClient.release();
}

/**
 * Build a custom Postgres insert with a random performance and clients connected
 * @param antennaId Antenna Identifier
 * @returns
 */
function buildEvent(antennaId: number) {
  return {
    antennaId,
    clients_connected: Math.ceil(Math.random() * 100),
    performance: Math.random() * 10,
    updated_at: new Date().getTime()
  };
}

/**
 * Generate data to Postgres indefinitely
 */
async function dataGenerator() {
  const brokers = [process.env.KAFKA_BROKER || "localhost:9092"];

  const kafka = new Kafka({
    clientId: "kafkaClient",
    brokers,
  });

  const topics = await kafka.admin().listTopics();
  const producer = kafka.producer();
  await producer.connect();

  if (!topics.includes(antennasEventsTopicName)) {
    await kafka.admin().createTopics({
      topics: [
        {
          topic: antennasEventsTopicName,
        },
        {
          topic: antennasTopic,
        }
      ],
    });

    producer.send({
      topic: antennasTopic,
      messages: mainAntennas.map(antenna => ({ value: JSON.stringify(antenna) })),
    })

    producer.send({
      topic: antennasTopic,
      messages: helperAntennas.map(antenna => ({ value: JSON.stringify(antenna) })),
    })
  }


  setInterval(() => {
    const events = [1, 2, 3, 4, 5, 6, 7]
      .map((antennaId) => buildEvent(antennaId))
      .map((event) => ({ value: JSON.stringify(event) }));

    producer.send({
      topic: antennasEventsTopicName,
      messages: events,
    });
  }, 1000);
}

setUpMaterialize()
  .then(() => {
    console.log("Generating data.");
    dataGenerator();
  })
  .catch((err) => {
    console.error(err);
  });
