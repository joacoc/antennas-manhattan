import { Pool } from "pg";

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
    CREATE MATERIALIZED SOURCE IF NOT EXISTS antennas_publication_source
    FROM POSTGRES
    CONNECTION 'host=postgres port=5432 user=materialize password=materialize dbname=postgres'
    PUBLICATION 'antennas_publication_source';
  `);

  const { rowCount } = await pool.query(
    "SELECT * FROM mz_views WHERE name='antennas' OR name='antennas_performance' OR name='helper_antennas';"
  );

  if (!rowCount) {
    await poolClient.query(`
    CREATE MATERIALIZED VIEWS FROM SOURCE antennas_publication_source;
  `);

    await poolClient.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS last_half_minute_updates AS
      SELECT
        A.antenna_id,
        A.geojson,
        performance,
        AP.updated_at,
        ((CAST(EXTRACT( epoch from AP.updated_at) AS NUMERIC) * 1000) + 30000)
      FROM antennas A
        JOIN antennas_performance AP ON (A.antenna_id = AP.antenna_id)
        JOIN helper_antennas HA ON (HA.antenna_id = AP.antenna_id)
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
function buildQuery(antennaId: number) {
  return `
    INSERT INTO antennas_performance (antenna_id, clients_connected, performance, updated_at) VALUES (
      ${antennaId},
      ${Math.ceil(Math.random() * 100)},
      ${Math.random() * 10},
      now()
    );
  `;
}

/**
 * Build a custom Postgres insert with a random performance and clients connected
 * @param antennaId Antenna Identifier
 * @returns
 */
function buildHistoryQuery(antennaId: number, day: number) {
  return `
    INSERT INTO antennas_performance (antenna_id, clients_connected, performance, updated_at) VALUES (
      ${antennaId},
      ${Math.ceil(Math.random() * 100)},
      ${Math.random() * 10},
      NOW() - INTERVAL '${day} day'
    );
  `;
}

/**
 * Get a random number
 * @param min
 * @param max
 * @returns
 */
function randomIntFromInterval(min, max) {
  // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Generate data to Postgres indefinitely
 */
async function dataGenerator() {
  const pool = await new Pool({
    host: "postgres",
    user: "postgres",
    password: "pg_password",
  });

  const intervalClient = await pool.connect();
  setInterval(() => {
    const query = [1, 2, 3, 4, 5, 6, 7]
      .map((antennaId) => buildQuery(antennaId))
      .join("\n");

    intervalClient.query(query);
  }, 1000);

  const historyClient = await pool.connect();
  let day = 1;

  while (day < 365) {
    let antennaId = 1;
    const queries = new Array<string>();

    while (antennaId <= 7) {
      queries.push(buildHistoryQuery(antennaId, day));
      antennaId += 1;
    }

    let randomEvents = 1;
    while (randomEvents <= 100) {
      queries.push(buildHistoryQuery(randomIntFromInterval(8, 34), day));
      randomEvents += 1;
    }

    const query = queries.join("\n");
    await historyClient.query(query);
    day += 1;
  }

  console.log("Finished loading history.");
}

setUpMaterialize()
  .then(() => {
    console.log("Generating data.");
    dataGenerator();
  })
  .catch((err) => {
    console.error(err);
  });
